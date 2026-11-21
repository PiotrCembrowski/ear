# SoundMatch

Play or make a sound into your microphone, and SoundMatch analyses it live in your browser. It identifies musical notes, compares sounds against a reference library, and shows clear, honest results. **Your audio never leaves your device.**

> Status: built in phases. **Phases 2–3 are complete**: foundation (configuration, design tokens, database schema, Row Level Security, storage) plus accounts (sign up, sign in, password reset, profile, protected dashboard). The Listen screen comes next. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design.

## Requirements

- Node.js 20.9 or newer (developed on Node 22)
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

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / serve |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript, including the compile-time database type checks |
| `npm test` | Unit tests. Database tests are skipped unless `TEST_DATABASE_URL` is set. |
| `npm run db:test:reset` | Rebuilds the local test database from the migrations |

### Database tests (optional, local Postgres)

The DB tests apply the real migrations to a **throwaway local** Postgres database, with a small stand-in for Supabase's `auth` and `storage` schemas (`scripts/db/supabase-shim.sql`). They then check grants, RLS policies, constraints and triggers.

```bash
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/soundmatch_test npm test
```

The test runner **drops and recreates** that database, so it refuses any host other than localhost and any database name that doesn't contain `test`.

## Privacy

SoundMatch only listens while you have listening switched on, and your audio is analysed in your browser's memory, then discarded. Nothing is recorded, saved, downloaded or uploaded. Only result summaries (numbers and labels) are saved to your history, and you can switch that off.
