"use client";

import { FileAudio, Square, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { SelectField } from "@/components/ui/fields";
import { Spinner } from "@/components/ui/spinner";
import { TextField } from "@/components/ui/text-field";
import { decodeAudioFile, DecodeError, normalizeReferenceFile } from "@/lib/audio-browser/decode";
import { ROUTES } from "@/lib/auth/routes";
import { formatNoteRanges } from "@/lib/samples/sample-names";
import type { Instrument } from "@/lib/services/references";
import { uploadReferenceWav } from "@/lib/services/reference-upload";
import { importSettingsSchema } from "@/lib/validation/references";
import { finalizeSample, loadExistingSamples, prepareSampleUpload } from "../actions";
import { countByStatus, planImport, plannedCoverage, STATUS_LABELS, type ImportRow, type ImportStatus } from "./plan";

const STATUS_TONE: Record<ImportStatus, BadgeTone> = {
  checking: "neutral",
  ok: "success",
  duplicate: "warning",
  "invalid-name": "danger",
  "unsupported-format": "danger",
  "decode-failure": "danger",
  importing: "info",
  imported: "success",
  failed: "danger",
};

const MAX_ZIP_BYTES = 500 * 1024 * 1024;

/** Expands .zip files (in a background thread via fflate) into their audio files; other files pass through. */
async function expandFiles(input: File[]): Promise<{ files: File[]; problems: string[] }> {
  const files: File[] = [];
  const problems: string[] = [];
  for (const file of input) {
    if (!/\.zip$/i.test(file.name)) {
      files.push(file);
      continue;
    }
    if (file.size > MAX_ZIP_BYTES) {
      problems.push(`${file.name} is larger than 500 MB; extract it and drop the files instead.`);
      continue;
    }
    try {
      const { unzip } = await import("fflate");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
        unzip(bytes, { filter: (entry) => !entry.name.startsWith("__MACOSX/") && !entry.name.endsWith("/") && !/(^|\/)\./.test(entry.name) }, (error, data) =>
          error ? reject(error) : resolve(data),
        ),
      );
      for (const [path, data] of Object.entries(entries)) {
        files.push(new File([data as BlobPart], path.split("/").pop() ?? path));
      }
    } catch {
      problems.push(`${file.name} couldn't be opened as a zip file.`);
    }
  }
  return { files, problems };
}

type Settings = { instrumentId: string; variant: string; visibility: "public" | "private"; license: string; sourceUrl: string; attribution: string };

export function ImportWizard({ instruments }: { instruments: Instrument[] }) {
  const inputId = useId();
  const [settings, setSettings] = useState<Settings>({
    instrumentId: instruments.find((i) => i.slug === "piano")?.id ?? instruments[0]?.id ?? "",
    variant: "",
    visibility: "public",
    license: "",
    sourceUrl: "",
    attribution: "",
  });
  const [settingsErrors, setSettingsErrors] = useState<Record<string, string[] | undefined>>({});
  const [files, setFiles] = useState<File[]>([]);
  /** Notes already stored, tagged with the instrument+variant they belong to (stale results are ignored). */
  const [stored, setStored] = useState<{ forKey: string; keys: Set<string>; midi: number[]; error: string | null } | null>(null);
  /** Decode-check results by row key (rows are re-planned often; files are decoded only once). */
  const [decoded, setDecoded] = useState<ReadonlyMap<string, { ok: true; durationMs: number } | { ok: false; detail: string }>>(new Map());
  /** Per-row changes made by the import itself (importing / imported / failed). */
  const [importUpdates, setImportUpdates] = useState<ReadonlyMap<string, Partial<ImportRow>>>(new Map());
  const [problems, setProblems] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const [phase, setPhase] = useState<"idle" | "importing" | "done">("idle");
  const [showOnlyProblems, setShowOnlyProblems] = useState(false);
  const cancelRef = useRef(false);

  const instrument = instruments.find((i) => i.id === settings.instrumentId) ?? null;
  const variantValid = /^[a-z0-9]+(-[a-z0-9]+)*$/.test(settings.variant) && settings.variant.length <= 60;
  const storedKey = instrument && variantValid ? `${instrument.id}:${settings.variant}` : null;
  const existing = useMemo(
    () => (stored && stored.forKey === storedKey ? stored : { keys: new Set<string>(), midi: [] as number[], error: null }),
    [stored, storedKey],
  );

  // Load what is already stored for this instrument + variant.
  useEffect(() => {
    if (!instrument || !storedKey) return;
    let current = true;
    void loadExistingSamples(instrument.id, settings.variant).then((result) => {
      if (!current) return;
      setStored(
        result.ok
          ? { forKey: storedKey, keys: new Set(result.value.keys), midi: result.value.midi, error: null }
          : { forKey: storedKey, keys: new Set(), midi: [], error: result.message },
      );
    });
    return () => {
      current = false;
    };
  }, [instrument, settings.variant, storedKey]);

  // The table: planned from names and stored notes, then decode results, then import progress.
  const rows = useMemo(() => {
    if (!instrument) return [];
    return planImport(files, instrument, existing.keys).map((row) => {
      let result = row;
      const check = row.status === "checking" ? decoded.get(row.key) : undefined;
      if (check) result = check.ok ? { ...row, status: "ok", durationMs: check.durationMs } : { ...row, status: "decode-failure", detail: check.detail };
      const update = importUpdates.get(row.key);
      return update ? { ...result, ...update } : result;
    });
  }, [files, instrument, existing.keys, decoded, importUpdates]);

  // Decode-check pending rows one at a time (decoding many long files at once would use too much memory).
  const nextToCheck = phase === "importing" ? undefined : rows.find((r) => r.status === "checking");
  const checking = rows.some((r) => r.status === "checking");
  useEffect(() => {
    if (!nextToCheck) return;
    const file = files[Number(nextToCheck.key.split(":")[0])];
    let current = true;
    void (async () => {
      let result: { ok: true; durationMs: number } | { ok: false; detail: string };
      try {
        const buffer = await decodeAudioFile(file!);
        result = { ok: true, durationMs: buffer.duration * 1000 };
      } catch (error) {
        result = { ok: false, detail: error instanceof DecodeError ? error.message : "The file couldn't be decoded." };
      }
      if (current) setDecoded((map) => new Map(map).set(nextToCheck.key, result));
    })();
    return () => {
      current = false;
    };
  }, [nextToCheck, files]);

  const addFiles = useCallback(async (list: FileList | File[]) => {
    const { files: expanded, problems: found } = await expandFiles([...list]);
    setProblems(found);
    setPhase((p) => (p === "done" ? "idle" : p));
    setFiles((previous) => [...previous, ...expanded]);
  }, []);

  function clearFiles() {
    setDecoded(new Map());
    setImportUpdates(new Map());
    setFiles([]);
    setProblems([]);
    setPhase("idle");
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
  }

  const coverage = instrument ? plannedCoverage(rows, instrument, existing.midi) : null;
  const counts = countByStatus(rows);
  const ready = rows.filter((r) => r.status === "ok");
  const visibleRows = showOnlyProblems ? rows.filter((r) => !["ok", "imported", "checking", "importing"].includes(r.status) || r.detectedNote) : rows;
  const importedCount = counts.imported ?? 0;
  const existingError = existing.error;

  async function runImport() {
    const parsed = importSettingsSchema.safeParse(settings);
    if (!parsed.success) {
      const errors: Record<string, string[]> = {};
      for (const issue of parsed.error.issues) (errors[String(issue.path[0])] ??= []).push(issue.message);
      setSettingsErrors(errors);
      return;
    }
    setSettingsErrors({});
    cancelRef.current = false;
    setPhase("importing");
    const queue = [...ready].sort((a, b) => a.midi! - b.midi! || (a.velocity ?? 0) - (b.velocity ?? 0));
    const update = (key: string, patch: Partial<ImportRow>) => setImportUpdates((map) => new Map(map).set(key, { ...map.get(key), ...patch }));

    for (const row of queue) {
      if (cancelRef.current) break;
      update(row.key, { status: "importing", detail: null });
      const file = files[Number(row.key.split(":")[0])]!;
      const target = { instrumentId: parsed.data.instrumentId, variant: parsed.data.variant, midiNote: row.midi!, velocity: row.velocity };
      try {
        const normalized = await normalizeReferenceFile(file);
        const prepared = await prepareSampleUpload(target);
        if (!prepared.ok) {
          update(row.key, { status: prepared.code === "duplicate" ? "duplicate" : "failed", detail: prepared.message });
          continue;
        }
        await uploadReferenceWav(prepared.value, normalized.wav);
        // Send the raw settings: the server validates (and transforms) them itself.
        const result = await finalizeSample(settings, target, { storagePath: prepared.value.path, originalFilename: file.name.slice(0, 255) });
        if (!result.ok) {
          update(row.key, { status: "failed", detail: result.message });
          continue;
        }
        const detected = result.value.detected;
        update(row.key, {
          status: "imported",
          durationMs: result.value.durationMs,
          detail: normalized.truncated ? "Cut to 30 s." : null,
          detectedNote:
            detected && detected.midi !== row.midi
              ? `Sounds like ${detected.name} (${detected.cents > 0 ? "+" : ""}${Math.round(detected.cents)}¢): check the file name.`
              : null,
        });
      } catch (error) {
        update(row.key, { status: "failed", detail: error instanceof DecodeError ? error.message : "Upload failed. Check your connection and try again." });
      }
    }
    setPhase("done");
  }

  const set = (patch: Partial<Settings>) => setSettings((s) => ({ ...s, ...patch }));

  return (
    <div className="flex flex-col gap-6">
      {/* 1. Settings */}
      <Card aria-labelledby="import-settings">
        <CardHeader>
          <CardTitle id="import-settings">1. What you are importing</CardTitle>
          <CardDescription>These apply to every file in this batch.</CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset disabled={phase === "importing"} className="grid gap-5 sm:grid-cols-2">
            <SelectField
              label="Instrument"
              name="instrumentId"
              value={settings.instrumentId}
              onChange={(e) => set({ instrumentId: e.target.value })}
              options={instruments.map((i) => ({ value: i.id, label: `${i.name} (${i.expectedNoteCount} notes)` }))}
              errors={settingsErrors.instrumentId}
            />
            <TextField
              label="Variant"
              name="variant"
              value={settings.variant}
              onChange={(e) => set({ variant: e.target.value.toLowerCase() })}
              placeholder="grand-default"
              hint="Names this sample set, e.g. grand-default or upright-felt. Lowercase letters, numbers, hyphens."
              errors={settingsErrors.variant ?? (settings.variant && !variantValid ? ["Use lowercase letters, numbers and hyphens."] : undefined)}
            />
            <TextField
              label="License"
              name="license"
              value={settings.license}
              onChange={(e) => set({ license: e.target.value })}
              placeholder="CC-BY-3.0"
              errors={settingsErrors.license}
            />
            <SelectField
              label="Visibility"
              name="visibility"
              value={settings.visibility}
              onChange={(e) => set({ visibility: e.target.value as Settings["visibility"] })}
              options={[
                { value: "public", label: "Public: every signed-in user" },
                { value: "private", label: "Private: admins only" },
              ]}
            />
            <TextField
              label="Source link"
              name="sourceUrl"
              type="url"
              value={settings.sourceUrl}
              onChange={(e) => set({ sourceUrl: e.target.value })}
              placeholder="https://…"
              errors={settingsErrors.sourceUrl}
            />
            <TextField
              label="Attribution"
              name="attribution"
              value={settings.attribution}
              onChange={(e) => set({ attribution: e.target.value })}
              hint="Who recorded the samples. A source link or an attribution is required."
              errors={settingsErrors.attribution}
            />
          </fieldset>
          {existingError && <Alert tone="danger" className="mt-4">{existingError}</Alert>}
          {variantValid && existing.midi.length > 0 && (
            <p className="mt-4 text-sm text-ink-muted">
              {existing.midi.length} note{existing.midi.length === 1 ? " is" : "s are"} already stored for “{settings.variant}”; matching files will be skipped as
              duplicates.
            </p>
          )}
        </CardContent>
      </Card>

      {/* 2. Files */}
      <Card aria-labelledby="import-files">
        <CardHeader>
          <CardTitle id="import-files">2. Files</CardTitle>
          <CardDescription>
            One note per file. Names like 069_A4_v80.wav, A#4.wav, Bb4.flac, C4v8.flac or Piano.ff.A4.aiff are understood. Zip files are unpacked.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex flex-col items-center gap-3 rounded-card border-2 border-dashed p-8 text-center transition-colors ${dragging ? "border-brand bg-brand/5" : "border-line-strong"}`}
          >
            <Upload aria-hidden className="size-8 text-ink-subtle" />
            <p className="text-sm text-ink">Drag audio files or a .zip here, or</p>
            <label htmlFor={inputId} className="cursor-pointer rounded-control bg-surface-overlay px-4 py-2 text-sm font-medium text-ink hover:bg-surface-raised">
              Choose files
            </label>
            <input
              id={inputId}
              type="file"
              multiple
              accept="audio/*,.wav,.mp3,.ogg,.oga,.opus,.flac,.m4a,.aac,.webm,.aif,.aiff,.zip"
              className="sr-only"
              disabled={phase === "importing"}
              onChange={(e) => {
                if (e.target.files?.length) void addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>
          {problems.map((p) => (
            <Alert key={p} tone="warning">
              {p}
            </Alert>
          ))}
        </CardContent>
      </Card>

      {/* 3. Preview */}
      {rows.length > 0 && instrument && (
        <Card aria-labelledby="import-preview">
          <CardHeader>
            <CardTitle id="import-preview">3. Preview</CardTitle>
            <CardDescription>Nothing is saved until you press Import.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2" aria-live="polite">
              {(Object.entries(counts) as Array<[ImportStatus, number]>).map(([status, count]) => (
                <Badge key={status} tone={STATUS_TONE[status]}>
                  {STATUS_LABELS[status]}: {count}
                </Badge>
              ))}
              {checking && (
                <span className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                  <Spinner className="size-3" /> Checking files…
                </span>
              )}
            </div>

            {coverage && (
              <Alert tone={coverage.complete ? "success" : "warning"} title={coverage.complete ? "Complete set" : "Partial set"}>
                {coverage.present} of {coverage.expected} {instrument.name.toLowerCase()} notes will be in “{settings.variant || "this variant"}”.
                {!coverage.complete && (
                  <>
                    {" "}
                    That&apos;s allowed (many free libraries sample every few keys), but notes without a sample can&apos;t be matched exactly.
                    <span className="mt-2 block text-ink-muted">Missing: {formatNoteRanges(coverage.missing)}</span>
                  </>
                )}
              </Alert>
            )}

            <label className="inline-flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" checked={showOnlyProblems} onChange={(e) => setShowOnlyProblems(e.target.checked)} className="accent-[var(--color-brand)]" />
              Show only files with problems
            </label>

            <div className="overflow-x-auto rounded-control border border-line">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <caption className="sr-only">Files to import, with the note read from each name and its status</caption>
                <thead className="bg-surface-raised text-xs text-ink-muted">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">File</th>
                    <th scope="col" className="px-3 py-2 font-medium">Note</th>
                    <th scope="col" className="px-3 py-2 font-medium">Velocity</th>
                    <th scope="col" className="px-3 py-2 font-medium">Length</th>
                    <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((row) => (
                    <tr key={row.key} className="border-t border-line align-top">
                      <td className="max-w-[16rem] truncate px-3 py-2 text-ink" title={row.fileName}>
                        <FileAudio aria-hidden className="mr-1.5 inline size-4 text-ink-subtle" />
                        {row.fileName}
                      </td>
                      <td className="px-3 py-2 font-mono whitespace-nowrap text-ink">{row.noteName ? `${row.noteName} (${row.midi})` : "—"}</td>
                      <td className="px-3 py-2 font-mono whitespace-nowrap text-ink-muted">{row.velocity ?? "—"}</td>
                      <td className="px-3 py-2 font-mono whitespace-nowrap text-ink-muted">{row.durationMs ? `${(row.durationMs / 1000).toFixed(1)} s` : "—"}</td>
                      <td className="px-3 py-2">
                        <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                        {row.detail && <p className="mt-1 text-xs text-ink-muted">{row.detail}</p>}
                        {row.detectedNote && <p className="mt-1 text-xs text-warning">{row.detectedNote}</p>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 4. Import */}
            <div className="flex flex-wrap items-center gap-3">
              {phase === "importing" ? (
                <>
                  <Button variant="secondary" onClick={() => (cancelRef.current = true)}>
                    <Square aria-hidden className="size-4" />
                    Stop after this file
                  </Button>
                  <ImportProgress done={importedCount + (counts.failed ?? 0)} total={importedCount + (counts.failed ?? 0) + ready.length + (counts.importing ?? 0)} />
                </>
              ) : (
                <>
                  <Button onClick={() => void runImport()} disabled={ready.length === 0 || checking}>
                    Import {ready.length} file{ready.length === 1 ? "" : "s"}
                  </Button>
                  <Button variant="ghost" onClick={clearFiles}>
                    Clear list
                  </Button>
                </>
              )}
            </div>
            {phase === "done" && (
              <Alert tone={counts.failed ? "warning" : "success"} title="Import finished">
                {importedCount} imported{counts.failed ? `, ${counts.failed} failed (see the table)` : ""}.{" "}
                <Link href={`${ROUTES.library}?instrument=${instrument.slug}`} className="font-medium text-brand-strong underline">
                  View in the library
                </Link>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ImportProgress({ done, total }: { done: number; total: number }) {
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex min-w-56 flex-1 items-center gap-3">
      <div
        role="progressbar"
        aria-label="Import progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${total} files`}
        className="h-2 flex-1 overflow-hidden rounded-full bg-surface-raised"
      >
        <div className="h-full bg-gradient-to-r from-brand to-brand-2 transition-[width]" style={{ width: `${percent}%` }} />
      </div>
      <span className="font-mono text-xs text-ink-muted">
        {done}/{total}
      </span>
    </div>
  );
}
