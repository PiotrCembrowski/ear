"use client";

import { useRouter } from "next/navigation";
import { useId, useState, type FormEvent } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { DecodeError, normalizeReferenceFile } from "@/lib/audio-browser/decode";
import { ROUTES } from "@/lib/auth/routes";
import { REFERENCE_LIMITS } from "@/lib/config/app-config";
import type { Category } from "@/lib/services/references";
import { uploadReferenceWav } from "@/lib/services/reference-upload";
import { AUDIO_EXTENSIONS, fileExtension } from "@/lib/samples/sample-names";
import { finalizeSound, prepareSoundUpload } from "../actions";
import { metadataFromForm } from "../form-data";
import { ReferenceMetadataFields } from "./reference-metadata-fields";

type Stage = "idle" | "decoding" | "uploading" | "analysing";
const STAGE_TEXT: Record<Exclude<Stage, "idle">, string> = {
  decoding: "Reading and normalizing the file…",
  uploading: "Uploading…",
  analysing: "Checking the file and computing features…",
};

/**
 * Add one reference sound. The file is decoded and normalized in the browser
 * (mono, 44.1 kHz, 16-bit WAV, silence trimmed, ≤ 30 s), uploaded straight to
 * storage, then validated and analysed on the server.
 */
export function NewReferenceForm({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const fileId = useId();
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[] | undefined>>({});
  const [note, setNote] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setFieldErrors({});
    setNote(null);
    const formData = new FormData(event.currentTarget);
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return setFieldErrors({ file: ["Choose an audio file."] });
    if (!(AUDIO_EXTENSIONS as readonly string[]).includes(fileExtension(file.name))) {
      return setFieldErrors({ file: ["Unsupported file type. Use WAV, MP3, OGG, FLAC, M4A/AAC or WebM."] });
    }
    if (file.size > REFERENCE_LIMITS.maxImportFileBytes) return setFieldErrors({ file: ["The file is larger than 50 MB."] });
    const metadata = metadataFromForm(formData);

    try {
      setStage("decoding");
      const normalized = await normalizeReferenceFile(file);
      if (normalized.truncated) setNote("The sound was longer than 30 seconds; only the first 30 seconds were kept.");

      setStage("uploading");
      const prepared = await prepareSoundUpload(metadata);
      if (!prepared.ok) {
        setFieldErrors(prepared.fieldErrors ?? {});
        setError(prepared.message);
        return;
      }
      await uploadReferenceWav(prepared.value, normalized.wav);

      setStage("analysing");
      const result = await finalizeSound(metadata, { storagePath: prepared.value.path, originalFilename: file.name.slice(0, 255) });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      router.push(`${ROUTES.adminReferences}?notice=reference-created`);
    } catch (caught) {
      setError(caught instanceof DecodeError ? caught.message : "The upload failed. Check your connection and try again.");
      if (!(caught instanceof DecodeError)) console.error(caught);
    } finally {
      setStage("idle");
    }
  }

  const busy = stage !== "idle";
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
      {error && <Alert tone="danger">{error}</Alert>}
      {note && <Alert tone="info">{note}</Alert>}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={fileId} className="text-sm font-medium text-ink">
          Audio file
        </label>
        <p id={`${fileId}-hint`} className="text-xs text-ink-muted">
          WAV, MP3, OGG, FLAC, M4A/AAC or WebM, up to 50 MB. It is converted to mono 16-bit WAV, silence is trimmed, and it is cut to 30 s.
        </p>
        <input
          id={fileId}
          name="file"
          type="file"
          accept="audio/*,.wav,.mp3,.ogg,.oga,.opus,.flac,.m4a,.aac,.webm,.aif,.aiff"
          disabled={busy}
          aria-describedby={`${fileId}-hint${fieldErrors.file ? ` ${fileId}-error` : ""}`}
          aria-invalid={fieldErrors.file ? true : undefined}
          className="text-sm text-ink-muted file:mr-4 file:cursor-pointer file:rounded-control file:border-0 file:bg-surface-overlay file:px-4 file:py-2 file:text-sm file:font-medium file:text-ink"
        />
        {fieldErrors.file && (
          <p id={`${fileId}-error`} className="text-sm text-danger">
            {fieldErrors.file.join(" ")}
          </p>
        )}
      </div>
      <ReferenceMetadataFields categories={categories} errors={fieldErrors} disabled={busy} />
      <div className="flex items-center gap-4">
        <Button type="submit" disabled={busy}>
          {busy && <Spinner />}
          {busy ? "Saving…" : "Add reference"}
        </Button>
        {busy && (
          <p role="status" className="text-sm text-ink-muted">
            {STAGE_TEXT[stage as Exclude<Stage, "idle">]}
          </p>
        )}
      </div>
    </form>
  );
}
