# SoundMatch

Play or make a sound into your microphone, and SoundMatch analyses it live in your browser. It identifies musical notes, compares sounds against a reference library, and shows clear, honest results. **Your audio never leaves your device.**

What it does:

- **Identify note** (`/listen`): a live tuner showing the note name, cents off and a confidence level. It works without an account.
- **Compare** (`/listen?mode=compare`): play along with a reference sound and get a heuristic similarity score with a breakdown.
- **Closest match** (`/listen?mode=closest`): play a note and see the five closest samples of an instrument.
- **Reference library** (`/library`): browse, search, filter and preview reference sounds.
- **History** (`/history`): saved result summaries (numbers and labels, never audio), searchable and deletable.
- **Settings**: A4 reference pitch, sensitivity, whether to save history, default microphone, and account deletion.
- **Admin** (`/admin`): add, edit and delete references, and bulk-import a whole instrument (for example 88 piano notes).

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design, and "Known limitations" below for what it can't do yet.

## Requirements

- Node.js 20.9 or newer (developed on Node 22; `features:recompute` and `verify:rls` need Node 22 for `--env-file-if-exists`)
- A Supabase project (the free tier is fine)
- Optional, for database tests: a local PostgreSQL 15+ server

## Setup

### 1. Install

```bash
npm install
```

### 2. Environment variables

```bash
cp .env.example .env.local
```

Fill in the values from **Supabase Dashboard → Project Settings → API Keys**:

| Variable | Where it's used | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser + server | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser + server | `sb_publishable_…` or the legacy anon key. Safe to expose; RLS protects data. |
| `NEXT_PUBLIC_SITE_URL` | auth emails | `http://localhost:3000` locally, your Vercel URL in production |
| `SUPABASE_SECRET_KEY` | **server only** | `sb_secret_…` or the legacy service_role key. Bypasses RLS. Never prefix it with `NEXT_PUBLIC_`. |
| `HISTORY_RATE_LIMIT_MAX`, `HISTORY_RATE_LIMIT_WINDOW_SECONDS` | server | Optional; defaults are 120 per 600 s |

### 3. Database

Apply the files in `supabase/migrations/` **in filename order**, then `supabase/seed.sql`. Either:

- **SQL editor (no tools needed):** open each file, paste it into Supabase Dashboard → SQL Editor, and run it, in order; or
- **Supabase CLI:** `npx supabase link --project-ref <ref>`, then `npx supabase db push`, then run `seed.sql` in the SQL editor.

The migrations create:

- all tables, with Row Level Security;
- the private `references` storage bucket (WAV only, 5 MB per file) and its policies;
- the triggers that create a profile on sign-up and stop users changing their own role.

### 4. Configure Supabase Auth

In **Supabase Dashboard → Authentication**:

1. **URL Configuration**
   - **Site URL**: the same value as `NEXT_PUBLIC_SITE_URL`.
   - **Redirect URLs**: add `http://localhost:3000/auth/confirm` and `https://<your-domain>/auth/confirm`.
2. **Email Templates** (recommended). Edit the link in two templates so it opens our `/auth/confirm` page with a token hash. This works even when the email is opened in a different browser or on another device.
   - **Confirm signup**:
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next=/dashboard`
   - **Reset password**:
     `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/update-password`

   With the default templates, the links still work, but only in the browser where the user signed up or asked for the reset.
3. **Sign In / Providers → Email**: keep **Confirm email** on.
4. **Emails (SMTP)**: Supabase's built-in email sender is only for testing and has a very low hourly limit. Set up your own SMTP before real users sign up.
5. **JWT signing keys** (Project Settings → JWT Keys): new projects use asymmetric keys. Then the app verifies sessions locally, without a call to Supabase Auth on every page view. Older projects can switch from that page.

### 5. Promote the first admin

Sign up in the app, then run this in the SQL editor:

```sql
update public.profiles
set role = 'admin'
where id = (select id from auth.users where email = 'you@example.com');
```

This works only from the SQL editor or with the secret key. Users can't change their own role: a column grant and a trigger both block it.

### 6. Run

```bash
npm run dev
```

Then open <http://localhost:3000>. Microphone access needs HTTPS; `localhost` is allowed for development.

### 7. Check the security rules (recommended)

```bash
npm run verify:rls -- --yes
```

This proves, against your real project and through the same API the browser uses, that one user can't read or change another user's data and that nobody can make themselves admin (see "Security check" below). Use a development or staging project.

### 8. Deploy

Any Node host works; on Vercel, import the repository and add the four environment variables from step 2 (with `NEXT_PUBLIC_SITE_URL` set to the deployed URL). Then add `https://<your-domain>/auth/confirm` to Supabase's Redirect URLs (step 4). The build runs `build:worklets` automatically.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, including the compile-time database type checks |
| `npm test` | Unit tests (engine, validation, services). Database tests are skipped unless `TEST_DATABASE_URL` is set. |
| `npm run db:test:reset` | Rebuilds the local test database from the migrations |
| `npm run test:e2e` | Browser tests in Chromium with a fake microphone: every flow, accessibility (axe) and layout from 360 px to desktop. Builds and starts the app against a local stand-in for Supabase; no project needed. |
| `npm run verify:rls -- --yes` | Security check against a **real** Supabase project (creates and then deletes two test users; needs all three keys in `.env.local`) |
| `npm run build:worklets` | Compiles the AudioWorklet to `public/worklets/` (runs automatically before `dev` and `build`) |
| `npm run features:recompute` | Recomputes reference features after an engine version change (needs `SUPABASE_SECRET_KEY`; Node 22+; add `-- --dry` to only list) |
| `npm run engine:evaluate` | Prints the engine's score distributions on labelled sound pairs (add `-- --verbose` for every pair) |

### Database tests (optional, local Postgres)

The DB tests apply the real migrations to a **throwaway local** Postgres database, with a small stand-in for Supabase's `auth` and `storage` schemas (`scripts/db/supabase-shim.sql`). They then check grants, RLS policies, constraints and triggers.

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/soundmatch_test npm test
```

The test runner **drops and recreates** that database, so it refuses any host other than localhost and any database name that doesn't contain `test`.

## Security check

There are two layers of proof that the database rules hold.

1. **`npm test` with `TEST_DATABASE_URL`** applies the migrations to a local Postgres and checks every grant, policy, constraint and trigger in SQL. It is fast and needs no Supabase project, but it uses a small stand-in for Supabase's `auth` and `storage` schemas.
2. **`npm run verify:rls -- --yes`** runs against a real Supabase project, through PostgREST, Auth and Storage, exactly as the browser would. It creates two temporary users (A and B) and two temporary, clearly labelled test files, then checks that:
   - A can't read, change or delete B's profile or history;
   - A can't make themselves admin (by editing their profile or their user metadata);
   - users can't write history directly (only the server can), can't edit scores, and can't create, edit or delete references, categories, instruments, samples or features;
   - B's private reference and its file are invisible to A, the bucket refuses user uploads and deletes, and signed-out visitors can't download files;
   - the rate-limit table can't be read directly;
   - signed-out visitors can read only categories and instruments.

   Positive controls (A *can* edit their own name, delete their own history, read public references) make sure the checks aren't passing just because everything is blocked. Everything it created is deleted at the end, even when a check fails. It prints one PASS/FAIL line per check and exits with code 1 if any fail.

## Importing a sample set (admins)

1. Sign in as an admin (see "Promote the first admin") and open **Admin → Bulk import samples** (`/admin/import`).
2. Choose the **instrument** and a **variant** name for this set (for example `salamander` or `grand-default`), then enter the **license** and a **source link or attribution**. All of these are required, so every sound's origin is documented.
3. Drop the files, or a `.zip`. One note per file. These names are understood:
   - `069_A4_v80.wav`, `A#4.wav`, `As4.wav`, `Bb4.flac`, `A-sharp-4.wav`;
   - bare MIDI numbers (`60.wav`);
   - Salamander-style `C4v8.flac`;
   - dynamics such as `Piano.ff.A4.aiff`.
4. Check the **preview table**. Each file is marked:
   - *Ready*;
   - *Duplicate* (already stored, or twice in this batch);
   - *Invalid name* (no note found, or outside the instrument's range);
   - *Unsupported format*;
   - *Decode failure* (this browser can't read it; AIFF only works in Safari).

   The **coverage report** says how many of the 88 keys you will have and lists the missing ones. Partial sets are allowed.
5. Press **Import**. Each file is then:
   - converted in the browser (mono, 44.1 kHz, 16-bit WAV, silence trimmed, at most 30 s; loudness is kept, so velocity layers stay distinct);
   - uploaded straight to storage through a signed URL;
   - validated and analysed on the server, which stores its pitch and timbre features.

   If a file's detected pitch doesn't match its name, it is flagged ("Sounds like C4: check the file name").

Free sources include the Salamander Grand Piano (CC-BY 3.0, samples every third key, so expect a partial set) and the University of Iowa Electronic Music Studios instrument samples (check their terms; AIFF files need converting outside Safari). Only import recordings you have the right to use.

Single sounds (a bark, a door) are added one at a time under **Admin → Add reference**.

## Manual testing

Real microphones, Firefox, Safari and phones must be checked by hand. See [`docs/MANUAL-TEST-CHECKLIST.md`](docs/MANUAL-TEST-CHECKLIST.md). It covers Chrome, Firefox and Safari on desktop and iOS, checking that the microphone indicator turns off after Stop and that no audio appears in network requests, and responsive layout.

## Known limitations

**Scores are heuristics, not measurements.** The similarity score says how alike two sounds are by this app's rules (pitch in cents; timbre from MFCCs, envelope, brightness and duration). It is not a judgement of musical quality. The scoring curves were tuned on synthetic test sounds; run `npm run engine:evaluate` with your own recordings in `fixtures/real/` to check them on real microphones and rooms.

**Pitch**
- One note at a time. Chords, several instruments at once, or loud background music confuse note detection.
- The tracker works from about 25 Hz to 4.5 kHz (all 88 piano keys). The lowest notes (below about A1) take longer and are less confident, because they need longer windows and their fundamental is weak on small speakers and phone mics.
- Pianos and singers are rarely exactly in tune, so a few cents off is normal. Set A4 in Settings if your instrument is tuned to something other than 440 Hz.

**Timbre (non-note sounds and velocity layers)**
- Timbre ignores loudness on purpose (so a quiet and a loud clap still match), so velocity layers of the same note are told apart only by brightness and attack.
- Room echo, distance from the mic, and the mic itself all change timbre. Phone mics and Bluetooth headsets in call mode lower scores; the app warns about the last.

**Listening**
- A single sound is analysed for at most 5 seconds; longer sounds are cut (with a warning). Sounds shorter than 80 ms are reported as too short.
- Listening stops when you switch tabs or apps, by design, so the microphone is never on in the background. Press Start again when you come back.
- Needs a browser with AudioWorklet (current Chrome, Edge, Firefox and Safari, and iOS 14.5+) and HTTPS.

**Trust model**
- Results are computed in the browser, so a determined user could save made-up scores to **their own** history. That is acceptable because history is private and never compared between users; the database records this as `computed_on = 'client'`.

**Library and import**
- Stored references are mono 16-bit WAV, at most 30 s and 5 MB. The importer converts in the browser; which input formats it can read depends on the browser (AIFF only in Safari).
- Closest match loads one instrument's samples in a single request, so it is limited by Supabase's API row limit (1,000 by default). That is plenty for 88 notes with several velocity layers.
- Changing the analysis engine needs `npm run features:recompute` (or the button in Admin) so stored features match the new version. Until then, Compare says such a reference "hasn't been analysed with the current engine yet", and Closest match leaves those samples out.

**Accounts**
- Supabase's built-in email sender has a very low hourly limit; set up SMTP before real users sign up.

## Privacy

SoundMatch only listens while you have listening switched on, and your audio is analysed in your browser's memory, then discarded. Nothing is recorded, saved, downloaded or uploaded. Only result summaries (numbers and labels) are saved to your history, and you can switch that off.
