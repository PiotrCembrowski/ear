# SoundMatch architecture

This is the plan approved at the end of Phase 1, kept up to date as the build progresses. It explains *why* things are the way they are, so the code can be maintained without the original conversation.

## Principles

- **Audio never leaves the device.** The app listens only while the user has listening switched on. Audio lives in browser memory (at most a 5 s window for one sound event) and is discarded after analysis. It is never recorded, saved, downloaded or uploaded. Only result summaries (numbers and labels, no audio) are stored in history.
- **Honest results.** Scores are labelled as heuristic similarity scores. Every result explains what was measured and shows quality warnings.
- **One engine, two runtimes.** `src/lib/audio-engine/` is plain TypeScript, with no React, Next.js, Supabase or browser APIs. It runs in a Web Worker for live analysis and in Node for reference-feature extraction and tests.
- **Pluggable strategies.** New comparison methods are added by registering a strategy. Existing code doesn't change.

## Stack and dependency decisions

| Need | Choice | Why |
|---|---|---|
| Framework | Next.js 16 (App Router, Turbopack) | Current stable. Uses `proxy.ts` (formerly `middleware.ts`) and async `cookies()`/`params`. |
| Language | TypeScript 5.9 (strict) | TypeScript 7 is a native (Go) binary; 5.9 keeps the toolchain JS-only. |
| Auth, DB, Storage | Supabase via `@supabase/ssr` | Cookie sessions that work in Server Components, Route Handlers and the browser. |
| Validation | Zod 4 | All server input and env vars. |
| Styling | Tailwind CSS 4 | Tokens live in `src/app/globals.css` (`@theme`). |
| Fonts | `geist` (npm) | Self-hosted, so builds need no network. |
| Pitch | `pitchy` (MPM) | Small, typed, ESM, works in workers and Node. |
| FFT | `fft.js` | Used by pitchy; also used for our spectrum/MFCC. |
| Audio features | In-house (on `fft.js`) | See below. |
| Zip import | `fflate` | Small, maintained, browser-native. |
| UI primitives | `radix-ui` | Accessible dialogs, tabs, toasts and menus (focus management, keyboard). |
| Tests | Vitest; Playwright optional | |

**Why not Meyda at runtime.** Meyda 5.6.3 (the last stable release, April 2024):

- doesn't expose its ESM build: browsers get a UMD bundle and Node gets CJS, so the worker and server would run different builds;
- keeps its configuration (`bufferSize`, `sampleRate`) in mutable globals, so two strategies with different windows would overwrite each other;
- depends on an old `fftjs@0.0.4`;
- installs unused CLI dependencies.

Features are reproducible only if the same code runs everywhere, so we use about 200 lines of commented in-house MFCC/spectral code instead. Meyda stays a **dev dependency**, used only in tests to cross-check our values.

## Live audio pipeline (browser)

```
mic (getUserMedia; echoCancellation/noiseSuppression/autoGainControl = false; chosen deviceId)
  └─ AudioContext (created on the Start tap; device's native sample rate, never forced)
       ├─ AnalyserNode ─────────────────▶ main thread: waveform/spectrum (visual only)
       └─ AudioWorkletNode "capture" ── MessageChannel ──▶ Web Worker (engine)
                                                             ├─ resample → 22,050 Hz
                                                             ├─ sound-event detector
                                                             ├─ LiveAnalyzer.push()
                                                             └─ snapshots (~30 Hz) and results
```

- The AudioContext isn't forced to a fixed rate: Firefox refuses to connect a mic to a context with a different rate. The engine resamples any input rate to the 22,050 Hz analysis rate, which is also used for reference features.
- **Event detection.** Frames are 256 samples (≈11.6 ms) at 22,050 Hz.
  - RMS is measured in dBFS against an adaptive noise floor (the 10th percentile over the last 3 s).
  - The start threshold is floor + sensitivity (6–30 dB, default 12).
  - The end threshold is 4 dB lower (hysteresis), held for 200 ms.
  - 100 ms of pre-roll is kept so the attack isn't lost.
  - Events under 80 ms are "too short"; events are capped at 5 s.
  - Spectral-flux onsets split notes played back to back.
- Stop, unmount, `pagehide` and the tab going to the background all stop every track and close the AudioContext, so the browser's mic indicator turns off.
- `extract(clip)` (batch) pushes the clip through the same `LiveAnalyzer` used live. Tests check that 128-sample blocks give identical results.

## Strategies

- **pitch:**
  - MPM with 2048-sample windows (4096 below ~100 Hz) and a hop of 512.
  - Skips ~60 ms of attack, keeps frames with clarity ≥ 0.9, and takes the median f0.
  - Compares against the reference's *measured* f0 and reports the nominal note at the user's A4.
  - Score = `100·cos²(π·min(|cents|,50)/100)`: 0¢→100, 5¢→98, 10¢→90, 25¢→50, ≥50¢→0.
  - Flags octave errors, unstable pitch and multiple notes. In compare mode it may finish after ~0.6 s of stable pitch.
- **timbre:**
  - MFCC c1–c12, spectral centroid, rolloff and RMS envelope at ~20 frames/s.
  - Compared with DTW inside a Sakoe-Chiba band; score = `100·exp(−d/τ)`, with τ calibrated by `scripts/evaluate-engine.ts`.
  - Breakdown weights: MFCC 0.6, envelope 0.15, centroid 0.15, rolloff 0.1.
- **Reference features come from the reference's detected sound event**, capped at 5 s, so live and reference sides are comparable.
- **Closest match:**
  - piano uses `pitch`, with timbre as the tie-break between velocity layers;
  - timbre instruments get a quick first pass on summary vectors, then DTW on the top 20.

## Reference import and features

1. The admin's browser decodes the file (any format the browser supports), downmixes it to mono, and encodes it as 16-bit WAV at 44.1 kHz (at most 30 s).
2. The file is uploaded to the private `references` bucket under RLS (admins only).
3. `POST /api/admin/references/[id]/features` runs the engine in Node on that WAV and stores features per `strategy_id` + `algorithm_version`.
4. `scripts/recompute-features.ts` and an admin action reprocess references whose features are outdated.
5. The browser fetches features (not audio) from the `/api/references/[id]/features` and `/api/instruments/[id]/features` routes, and caches them.

## Data model (see `supabase/migrations/`)

- `profiles`: `role` (`user` | `admin`) and `settings` (`a4Hz`, `sensitivityDb`, `saveHistory`).
  - Users can update only `display_name` and `settings` (column grants), and a trigger blocks role changes.
- `reference_categories`, `instruments`: readable by everyone; admins write.
- `reference_sounds`: public rows are readable by signed-in users; private rows by the owner and admins.
  - `license` is required, plus a `source_url` or `attribution`.
  - `is_synthetic` marks test tones. No `#` in storage paths.
- `instrument_samples`:
  - `note_name` and `nominal_hz` are generated from `midi_note`;
  - a range trigger keeps notes within the instrument's range (piano 21–108);
  - unique with `NULLS NOT DISTINCT`.
- `reference_features`: unique per (reference, strategy, version).
- `comparisons`: result summaries only.
  - Users can read and delete their own rows. There is **no user insert grant**: rows are written by `POST /api/comparisons` with the server-only key, after Zod validation, the session-based `user_id`, a registry check and the rate limit.
  - `computed_on = 'client'`; `result` ≤ 16 KB; identify mode has no score.
- `rate_limit_counters` + `consume_rate_limit()`: fixed-window limiter for history writes.
- Storage has a single private bucket, `references`: WAV only, 5 MB per file, read access follows the reference row's visibility, admins write. **There is no user-audio table or bucket.**

### Trust model

Scores are computed in the user's browser, so they are trusted only for that user's own history. Anything shared or competitive (leaderboards, certificates, public results) would need a separate server-verified mode; `computed_on` exists for that.

## Decisions made with the product owner

1. In-house features; Meyda only as a dev-time cross-check.
2. Identify works signed out. Compare and closest match need sign-in, because references are readable only by signed-in users.
3. Identify results are saved only through a "Save this note" button. Compare and closest match auto-save when history saving is on.
4. When the tab goes to the background, listening stops and the mic is released, with a message.
5. The default input device is stored per browser (localStorage), because device IDs are specific to each browser and site. A4, sensitivity and save-history are stored in the profile.
6. Pitch score uses the cos² curve. Package manager: npm.

## Testing approach

- **Engine:** synthetic signals in Vitest (allowed in tests only).
- **Database:**
  - `tests/db/` rebuilds a local Postgres from the migrations, using a small stand-in for Supabase's `auth` and `storage` schemas (`scripts/db/supabase-shim.sql`), and checks grants, RLS, constraints and triggers.
  - Phase 9 adds a script that runs the same checks against a real Supabase project.
- **Design tokens:** WCAG AA contrast is checked in `tests/ui/design-tokens.test.ts`.
- **Live audio:** a Playwright smoke test uses Chromium's fake microphone, plus a manual checklist for Chrome, Firefox and Safari (desktop and iOS).
