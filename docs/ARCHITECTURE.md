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

## Authentication and route protection

There are three layers, each enough on its own to stop data leaking:

1. **`src/proxy.ts`** (Next 16's "middleware") runs on every request.
   - It refreshes the Supabase session cookie when the access token expires.
   - It makes quick redirects: signed-out users are sent from protected paths (`/dashboard`, `/settings`, `/history`, `/library`, `/admin`) to `/sign-in?next=…`, and signed-in users are sent away from `/sign-in` and `/sign-up`.
   - The rules are pure functions in `src/lib/auth/routes.ts`, with tests.
2. **`requireUser()` / `requireAdmin()`** (`src/lib/auth/session.ts`) run at the top of every protected page, Server Action and Route Handler.
   - They use `getClaims()`, which verifies the JWT signature, rather than `getSession()`, which only reads the cookie.
   - Layouts are not relied on: Next.js doesn't re-run them on every client-side navigation.
3. **Row Level Security** in Postgres, whatever the app code does.

**Auth flows:**

- Server Actions in `src/features/auth/actions.ts` validate input with Zod, call `src/lib/services/auth.ts`, and return a `FormState`. On success they redirect.
- Supabase error codes become friendly messages in `auth-errors.ts`. Raw errors go to the server log.
- Password reset and sign-up never reveal whether an email is registered.
- `next` redirect targets pass through `safeRedirectPath()`, so the sign-in page can't be used as an open redirect.
- `?notice=` codes come from a fixed list, so nothing in the URL can inject text into a page.
- Email links land on `/auth/confirm`. It accepts both `token_hash` + `type` (recommended templates) and PKCE `code` links.

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
- **Event detection** (`event-detector.ts`) runs at the input rate, on frames of about 11.6 ms.
  - The first 250 ms only measure the background (a short "calibrating" moment after Start).
  - The noise floor is the 10th percentile of non-event frame levels over the last 3 s, clamped to −80…−30 dBFS.
  - A sound starts when the level is at least floor + sensitivity (6–30 dB, default 12) for 2 frames. It ends when the level stays below that threshold minus 4 dB (hysteresis) for 200 ms, or after 5 s, which then needs quiet before re-triggering.
  - 100 ms of pre-roll is kept so the attack isn't lost. Events under 80 ms are "too short".
  - Spectral-flux spikes split notes played back to back. A spike is provisional for 3 frames: if the level falls away, it was the sound stopping, not a new note.
  - The only raw audio kept is a ring buffer of about 150 ms. Event audio is handed to the analyzer frame by frame.
- **Browser pieces** (`src/lib/audio-browser/`):
  - `microphone.ts` builds the graph above and maps `getUserMedia` failures to clear error codes.
  - `worklets/capture-processor.ts` is compiled on its own by `tsc` into `public/worklets/` (`npm run build:worklets`, which runs before `dev` and `build`). Worklets are loaded by URL and can't import anything, so no bundler is needed.
  - `analysis.worker.ts` is bundled by Turbopack via `new Worker(new URL(...))`.
  - `ListenController` (`src/features/listen/`) owns the lifecycle: start inside the click (iOS), Stop (every track stopped), tab hidden → paused and mic released, device lost, and AudioContext interrupted.
- **`ListeningSession`** (engine) combines the detector, per-event analysis and a **continuous live tuner**. The tuner runs on all audio, not only inside events, so it keeps working on a note held longer than the 5 s event cap. It shows a pitch only above the detector's end threshold.
- **Live input ignores digital silence** (below −100 dBFS). Some microphones deliver pure zeros while starting up; learning the background from those made room hiss count as a sound. Reference files keep the old behaviour, because they are padded with silence on purpose.
- **Streaming analyzers keep features, not audio.** The pitch analyzer keeps per-frame f0 estimates; the timbre analyzer keeps per-frame features. Neither stores the raw event.
- Stop, unmount, `pagehide` and the tab going to the background all stop every track and close the AudioContext, so the browser's mic indicator turns off.
- `extract(clip)` (batch) pushes the clip through the same `LiveAnalyzer` used live. Tests check that 128-sample blocks give identical results.

## Strategies

- **pitch** (`strategies/pitch.ts`, version 1.0.0):
  - **Windows:** MPM (`pitchy`) every 512 samples on a 2048-sample window. A 4096-sample window is used below 120 Hz or when clarity is low.
  - **High notes:** periods shorter than 40 samples are refined over k = 4, 16, 64… periods, which cuts the error by about k. C8 is accurate to 0.1 cents on a sine.
  - **Summary:** skips 60 ms of attack, keeps frames with clarity ≥ 0.9, and clusters them into notes (±50 cents). The main cluster's median is f0.
  - **Comparison:** against the reference's *measured* f0. Score = `100·cos²(π·min(|cents|,50)/100)`: 0¢→100, 5¢→98, 10¢→90, 25¢→50, ≥50¢→0.
  - **Warnings:** octave error (k octaves away, within 50 cents), unstable pitch (σ > 15 cents), multiple notes, no clear pitch.
  - **Identify mode:** `identifyNote()` returns the note name, Hz, cents at the user's A4 and a confidence level (high/medium/low).
- **timbre** (`strategies/timbre.ts`, version 1.0.0):
  - **Frame features** (2048 samples, hop 1024, about 21.5 frames/s): MFCC c1–c12 with log mel energies floored at −100 dB absolute and 60 dB below the frame's peak band, so volume and faint hiss don't move them; power-weighted spectral centroid and rolloff; per-frame RMS.
  - **Fine envelope:** RMS every 256 samples (about 11.6 ms), so fast sounds like claps and knocks keep their shape.
  - **Trimming:** only the body is compared. Frames more than 35 dB below the loudest frame are trimmed from both ends.
  - **Sub-scores:**
    - MFCC sequences: DTW with a Sakoe–Chiba band (25%) and relaxed endpoints (10%);
    - envelope shape on normalized time;
    - brightness and rolloff as octave ratios;
    - length ratio.
  - **Curve:** each sub-score is `100 / (1 + (d/d₅₀)^p)`, with d₅₀ and p in `TIMBRE_CALIBRATION`.
  - **Weights:** MFCC 0.5, envelope 0.15, brightness 0.15, rolloff 0.1, length 0.1.
  - **Known characteristic:** sounds with identical spectra but different shapes (steady noise vs a noise burst) still score fairly high, because tone colour carries most of the weight.
- **Calibration:** `npm run engine:evaluate` prints score distributions for labelled pairs. On synthetic pairs:

  | Pair | Score |
  |---|---|
  | Same note | 100 |
  | +7¢ | ~95 |
  | +20¢ | ~65 |
  | A semitone or an octave apart | 0 |
  | Same sound re-played with noise | 82–99 |
  | Different kinds of sound | 10–46, median 19 |

  Add real recordings to `fixtures/real/` to refine the calibration.
- **Reference features come from the reference's main detected sound event** (`reference-features.ts`), capped at 5 s, so live and reference sides are comparable. Files are padded with 300 ms of silence before detection, so a sample that starts exactly at its attack keeps that attack.
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
