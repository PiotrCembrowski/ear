"use client";

import { Mic, MicOff, ShieldCheck } from "lucide-react";
import { useEffect } from "react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cx } from "@/components/ui/cx";
import { Spinner } from "@/components/ui/spinner";
import type { ListenController, ListenDefaults, ListenMode, ListenState } from "../listen-controller";
import { LISTEN_ERRORS, PAUSED_MESSAGES } from "../messages";
import { useListenController, useListenState, useLiveSnapshot } from "../use-listen";
import { DevicePicker } from "./device-picker";
import { LevelMeter } from "./level-meter";
import { LiveVisualizer } from "./live-visualizer";
import { ClosestSetup, CompareSetup } from "./mode-setup";
import { ModeTabs } from "./mode-tabs";
import { ResultPanel } from "./result-panel";
import { NoteResultCard } from "./note-result-card";
import { SensitivityControl } from "./sensitivity-control";
import { TunerDisplay } from "./tuner-display";

export type ListenInitial = { mode: ListenMode; referenceId: string | null; instrumentId: string | null; variant: string | null };

/** Keeps the URL in step with the mode, so links like /listen?mode=compare&ref=… can be shared and reloaded. */
function writeUrl(params: Record<string, string | null>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value);
  const text = query.toString();
  window.history.replaceState(null, "", text ? `?${text}` : window.location.pathname);
}

export function ListenScreen({
  defaults,
  initial,
  instruments,
}: {
  defaults: ListenDefaults;
  initial: ListenInitial;
  instruments: Array<{ id: string; name: string }>;
}) {
  const controller = useListenController(defaults);
  const state = useListenState(controller);
  const listening = state.status === "listening";

  // Apply the mode, reference and instrument from the URL once.
  useEffect(() => {
    controller.selectMode(initial.mode);
    if (defaults.signedIn && initial.referenceId) void controller.loadReference(initial.referenceId);
    if (defaults.signedIn && initial.instrumentId) void controller.loadInstrument(initial.instrumentId, initial.variant);
  }, [controller, initial, defaults.signedIn]);

  const urlFor = (mode: ListenMode, closest: { instrumentId: string | null; variant: string | null } | null = null) => {
    const compare = state.compare.status === "empty" ? null : state.compare.referenceId;
    const instrumentId = closest ? closest.instrumentId : state.closest.status === "empty" ? null : state.closest.instrumentId;
    const variant = closest ? closest.variant : state.closest.status === "empty" ? null : state.closest.variant;
    return { mode: mode === "identify" ? null : mode, ref: compare, instrument: instrumentId, variant };
  };

  return (
    <div className="flex flex-col gap-6">
      <ModeTabs
        mode={state.mode}
        onChange={(mode) => {
          controller.selectMode(mode);
          writeUrl(urlFor(mode));
        }}
      />
    <div id="listen-mode-panel" role="tabpanel" aria-labelledby={`mode-tab-${state.mode}`} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section
        aria-labelledby="tuner-heading"
        className={cx(
          "relative flex flex-col gap-8 rounded-panel border bg-surface p-5 shadow-card transition-colors sm:p-8",
          listening ? "border-live/60 shadow-[0_0_0_1px_rgb(255_92_122/0.25),0_20px_60px_-30px_rgb(255_92_122/0.5)]" : "border-line",
        )}
      >
        <h2 id="tuner-heading" className="sr-only">
          Live note identification
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <StatusBadge state={state} controller={controller} />
          <StartStopButton state={state} controller={controller} />
        </div>

        <StatusMessage state={state} controller={controller} />

        <LiveReadout controller={controller} state={state} />
      </section>

      <aside className="flex flex-col gap-6" aria-label="Listening settings and results">
        {state.mode === "compare" && <CompareSetup state={state} signedIn={defaults.signedIn} />}
        {state.mode === "closest" && (
          <ClosestSetup
            state={state}
            controller={controller}
            signedIn={defaults.signedIn}
            instruments={instruments}
            onChange={(instrumentId, variant) => writeUrl(urlFor("closest", { instrumentId, variant }))}
          />
        )}
        <Card aria-labelledby="input-heading">
          <CardHeader>
            <CardTitle id="input-heading">Input</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <DevicePicker
              devices={state.devices}
              selectedDeviceId={state.selectedDeviceId}
              onChange={(deviceId) => void controller.selectDevice(deviceId)}
              disabled={state.status === "starting"}
            />
            <SensitivityControl value={state.sensitivityDb} onChange={(value) => controller.setSensitivity(value)} />
            {listening && state.activeDeviceLabel && (
              <p className="text-xs text-ink-muted">
                Using <span className="text-ink">{state.activeDeviceLabel}</span>
                {state.sampleRate ? ` at ${(state.sampleRate / 1000).toFixed(1)} kHz` : ""}.
              </p>
            )}
            {listening && state.lowQualityInput && (
              <Alert tone="warning">
                This input records at a low quality (often a Bluetooth headset in call mode). High notes and tone colour may not be measured well; a
                built-in or wired microphone works better.
              </Alert>
            )}
          </CardContent>
        </Card>

        {state.mode === "identify" && <NoteResultCard state={state} controller={controller} signedIn={defaults.signedIn} />}

        <p className="flex gap-2 text-xs leading-relaxed text-ink-muted">
          <ShieldCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
          <span>
            <strong className="font-medium text-ink">Your audio stays on this device.</strong> The microphone is on only while listening is
            switched on. Sound is analysed in your browser&apos;s memory and immediately discarded: nothing is recorded, saved or sent.
          </span>
        </p>
      </aside>
    </div>
      {state.mode !== "identify" && <ResultPanel state={state} controller={controller} />}
    </div>
  );
}

function StatusBadge({ state, controller }: { state: ListenState; controller: ListenController }) {
  const snapshot = useLiveSnapshot(controller);
  if (state.status === "listening") {
    const calibrating = snapshot?.calibrating ?? true;
    return (
      <span className="inline-flex items-center gap-2.5 rounded-full border border-live/50 bg-live/10 px-3.5 py-1.5 text-sm font-medium text-live">
        <span className="relative flex size-2.5" aria-hidden>
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-live opacity-60 motion-reduce:animate-none" />
          <span className="relative inline-flex size-2.5 rounded-full bg-live" />
        </span>
        {calibrating ? "Listening · measuring background…" : "Listening"}
      </span>
    );
  }
  const labels: Record<ListenState["status"], string> = {
    idle: "Microphone off",
    starting: "Starting microphone…",
    listening: "Listening",
    paused: "Paused · microphone off",
    error: "Microphone off",
  };
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface-raised px-3.5 py-1.5 text-sm text-ink-muted">
      {state.status === "starting" ? <Spinner className="size-3.5" /> : <MicOff aria-hidden className="size-4" />}
      {labels[state.status]}
    </span>
  );
}

function StartStopButton({ state, controller }: { state: ListenState; controller: ListenController }) {
  if (state.status === "listening" || state.status === "starting") {
    return (
      <Button variant="secondary" size="lg" onClick={() => void controller.stop()} className="border-live/50">
        <MicOff aria-hidden className="size-5 text-live" />
        Stop listening
      </Button>
    );
  }
  const resume = state.status === "paused";
  return (
    <Button size="lg" onClick={() => void (resume ? controller.resume() : controller.start())}>
      <Mic aria-hidden className="size-5" />
      {resume && state.pausedReason ? PAUSED_MESSAGES[state.pausedReason].action : "Start listening"}
    </Button>
  );
}

function StatusMessage({ state, controller }: { state: ListenState; controller: ListenController }) {
  if (state.status === "error" && state.errorCode) {
    const message = LISTEN_ERRORS[state.errorCode];
    return (
      <Alert tone="danger" title={message.title}>
        {message.body}
      </Alert>
    );
  }
  if (state.status === "paused" && state.pausedReason) {
    const message = PAUSED_MESSAGES[state.pausedReason];
    return (
      <Alert tone="info" title={message.title}>
        {message.body}{" "}
        <button type="button" className="font-medium text-brand-strong underline" onClick={() => void controller.resume()}>
          {message.action}
        </button>
      </Alert>
    );
  }
  if (state.status === "idle") {
    return (
      <p className="text-sm text-ink-muted">
        Press <strong className="text-ink">Start listening</strong>, then play or sing a single note near your device. The first moment is spent
        measuring the background noise, so keep quiet for a quarter of a second.
      </p>
    );
  }
  return null;
}

/** Everything that updates ~30 times a second lives here, so the rest of the page doesn't re-render. */
function LiveReadout({ controller, state }: { controller: ListenController; state: ListenState }) {
  const snapshot = useLiveSnapshot(controller);
  const listening = state.status === "listening";
  return (
    <>
      <TunerDisplay tuner={snapshot?.tuner ?? null} listening={listening} a4Hz={state.a4Hz} />
      <div className="flex flex-col gap-5">
        <div className="flex items-center gap-3">
          <span
            className={cx(
              "inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              snapshot?.soundActive ? "bg-success/15 text-success" : "bg-surface-raised text-ink-subtle",
            )}
          >
            <span aria-hidden className={cx("size-2 rounded-full", snapshot?.soundActive ? "bg-success" : "bg-ink-subtle/50")} />
            {!listening ? "Not listening" : snapshot?.soundActive ? "Sound detected" : "Waiting for sound"}
          </span>
        </div>
        <LevelMeter snapshot={snapshot} />
        <LiveVisualizer analyser={listening ? controller.analyser : null} active={listening} />
      </div>
    </>
  );
}
