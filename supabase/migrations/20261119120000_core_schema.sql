-- =============================================================================
-- SoundMatch: core schema
--
-- Design notes
-- * There is deliberately NO table for user audio. Users never record, save or
--   upload audio; only result summaries (no audio) are stored in `comparisons`.
-- * A note's canonical identity is its MIDI number. Note names and equal-
--   tempered frequencies are GENERATED from it, so they can never disagree.
-- * Row Level Security and grants live in the next migration.
-- =============================================================================

create extension if not exists pg_trgm with schema extensions;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------

-- Keeps `updated_at` current on every UPDATE.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- MIDI number -> canonical sharp note name, e.g. 69 -> 'A4', 70 -> 'A#4', 0 -> 'C-1'.
-- (Storage paths use 's' instead of '#'; that mapping lives in the TypeScript importer.)
create or replace function public.midi_note_name(midi integer)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select (array['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'])[(midi % 12) + 1]
         || ((midi / 12) - 1)::text
$$;

-- Equal-tempered frequency at A4 = 440 Hz. Users may choose another A4 in their
-- settings; the app rescales at display time, the stored value stays at 440.
create or replace function public.midi_nominal_hz(midi integer)
returns double precision
language sql
immutable
parallel safe
set search_path = ''
as $$
  select 440.0 * power(2.0, (midi - 69) / 12.0)
$$;

-- array_to_string() is only STABLE, but generated columns need IMMUTABLE functions.
-- Joining text with a space is genuinely immutable, so this wrapper is safe.
create or replace function public.tags_to_text(tags text[])
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(array_to_string(tags, ' '), '')
$$;

-- -----------------------------------------------------------------------------
-- profiles: one row per auth user
-- -----------------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text check (display_name is null or char_length(display_name) between 1 and 80),
  role          text not null default 'user' check (role in ('user', 'admin')),
  -- { "a4Hz": number, "sensitivityDb": number, "saveHistory": boolean }
  -- Validated by Zod in the app; the most important ranges are repeated here.
  -- CASE guarantees the type test runs before the cast.
  settings      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint profiles_settings_is_object check (jsonb_typeof(settings) = 'object'),
  constraint profiles_settings_a4 check (
    not (settings ? 'a4Hz') or case
      when jsonb_typeof(settings -> 'a4Hz') = 'number'
        then (settings ->> 'a4Hz')::numeric between 400 and 480
      else false end),
  constraint profiles_settings_sensitivity check (
    not (settings ? 'sensitivityDb') or case
      when jsonb_typeof(settings -> 'sensitivityDb') = 'number'
        then (settings ->> 'sensitivityDb')::numeric between 6 and 30
      else false end),
  constraint profiles_settings_save_history check (
    not (settings ? 'saveHistory') or jsonb_typeof(settings -> 'saveHistory') = 'boolean')
);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Create a profile automatically when someone signs up.
-- SECURITY DEFINER because the new user has no INSERT privilege on profiles.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    nullif(left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80), '')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users must never change their own role. Column grants (next migration) already
-- block it; this trigger is a second, independent line of defense.
-- SECURITY INVOKER on purpose: `current_user` must be the caller's role.
-- 'postgres' = SQL editor / migrations, 'service_role' = server code with the secret key.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role is distinct from old.role
     and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'Changing a profile role is not allowed'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger profiles_protect_role
  before update on public.profiles
  for each row execute function public.protect_profile_role();

-- Admin check used by RLS policies. SECURITY DEFINER so it can read `profiles`
-- regardless of the caller's own policies (and without recursion).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  )
$$;

-- -----------------------------------------------------------------------------
-- reference_categories
-- -----------------------------------------------------------------------------
create table public.reference_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name        text not null check (char_length(name) between 1 and 80),
  description text check (description is null or char_length(description) <= 500),
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger reference_categories_set_updated_at
  before update on public.reference_categories
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- instruments
-- -----------------------------------------------------------------------------
create table public.instruments (
  id                  uuid primary key default gen_random_uuid(),
  slug                text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 60),
  name                text not null check (char_length(name) between 1 and 80),
  category_id         uuid not null references public.reference_categories (id) on delete restrict,
  -- Playable MIDI range, e.g. piano 21 (A0) .. 108 (C8).
  midi_min            smallint not null check (midi_min between 0 and 127),
  midi_max            smallint not null check (midi_max between 0 and 127),
  -- Used by the coverage report ("62 of 88 keys sampled").
  expected_note_count smallint not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint instruments_range_order check (midi_min <= midi_max),
  constraint instruments_expected_count check (expected_note_count between 1 and (midi_max - midi_min + 1))
);

create index instruments_category_id_idx on public.instruments (category_id);

create trigger instruments_set_updated_at
  before update on public.instruments
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- reference_sounds: the single comparable entity
-- -----------------------------------------------------------------------------
create table public.reference_sounds (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(name) between 1 and 120),
  description       text check (description is null or char_length(description) <= 2000),
  category_id       uuid not null references public.reference_categories (id) on delete restrict,
  tags              text[] not null default '{}' check (cardinality(tags) <= 20),
  -- Path inside the `references` bucket. No '#' (breaks URLs), no '..', no leading '/'.
  storage_path      text not null unique check (
                      storage_path ~ '^[A-Za-z0-9][A-Za-z0-9/_.-]*$'
                      and storage_path !~ '\.\.'
                      and char_length(storage_path) <= 300),
  duration_ms       integer not null check (duration_ms between 1 and 30000),
  sample_rate       integer not null check (sample_rate between 8000 and 192000),
  -- Stored files are normalized to mono 16-bit PCM WAV by the importer.
  channels          smallint not null default 1 check (channels = 1),
  format            text not null default 'wav' check (format in ('wav')),
  original_filename text check (original_filename is null or char_length(original_filename) <= 255),
  visibility        text not null default 'public' check (visibility in ('public', 'private')),
  owner_id          uuid references public.profiles (id) on delete set null,
  -- Provenance is mandatory: a license, plus a source URL and/or an attribution line.
  license           text not null check (char_length(btrim(license)) between 1 and 200),
  source_url        text check (source_url is null or (source_url ~* '^https?://' and char_length(source_url) <= 500)),
  attribution       text check (attribution is null or char_length(attribution) between 1 and 500),
  -- Synthetic tones are allowed only in tests and the dev seed, and are always labelled in the UI.
  is_synthetic      boolean not null default false,
  search            tsvector generated always as (
                      setweight(to_tsvector('simple'::regconfig, coalesce(name, '')), 'A')
                      || setweight(to_tsvector('simple'::regconfig, public.tags_to_text(tags)), 'B')
                      || setweight(to_tsvector('simple'::regconfig, coalesce(description, '')), 'C')
                    ) stored,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint reference_sounds_provenance check (source_url is not null or attribution is not null)
);

create index reference_sounds_category_id_idx on public.reference_sounds (category_id);
create index reference_sounds_visibility_idx on public.reference_sounds (visibility);
create index reference_sounds_owner_id_idx on public.reference_sounds (owner_id);
create index reference_sounds_created_at_idx on public.reference_sounds (created_at desc);
create index reference_sounds_tags_idx on public.reference_sounds using gin (tags);
create index reference_sounds_search_idx on public.reference_sounds using gin (search);
create index reference_sounds_name_trgm_idx on public.reference_sounds using gin (name extensions.gin_trgm_ops);

create trigger reference_sounds_set_updated_at
  before update on public.reference_sounds
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- instrument_samples: links a reference sound to an instrument note
-- -----------------------------------------------------------------------------
create table public.instrument_samples (
  id                 uuid primary key default gen_random_uuid(),
  reference_sound_id uuid not null unique references public.reference_sounds (id) on delete cascade,
  instrument_id      uuid not null references public.instruments (id) on delete cascade,
  -- e.g. 'grand-default', 'upright-felt'
  variant            text not null check (variant ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(variant) <= 60),
  midi_note          smallint not null check (midi_note between 0 and 127),
  -- Optional velocity layer (MIDI 1..127). NULL = single layer.
  velocity           smallint check (velocity is null or velocity between 1 and 127),
  note_name          text generated always as (public.midi_note_name(midi_note)) stored,
  nominal_hz         double precision generated always as (public.midi_nominal_hz(midi_note)) stored,
  created_at         timestamptz not null default now(),
  -- NULLS NOT DISTINCT: two "no velocity" samples of the same note are duplicates too.
  constraint instrument_samples_unique_note
    unique nulls not distinct (instrument_id, variant, midi_note, velocity)
);

create index instrument_samples_instrument_idx on public.instrument_samples (instrument_id, variant, midi_note);

-- A CHECK constraint cannot look at another table, so the per-instrument MIDI
-- range (piano: 21..108) is enforced by this trigger.
create or replace function public.check_instrument_sample_range()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_min smallint;
  v_max smallint;
begin
  select midi_min, midi_max into v_min, v_max
  from public.instruments
  where id = new.instrument_id;

  if not found then
    raise exception 'Unknown instrument %', new.instrument_id using errcode = '23503';
  end if;

  if new.midi_note < v_min or new.midi_note > v_max then
    raise exception 'MIDI note % is outside this instrument''s range (% to %)',
      new.midi_note, v_min, v_max
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger instrument_samples_check_range
  before insert or update of midi_note, instrument_id on public.instrument_samples
  for each row execute function public.check_instrument_sample_range();

-- -----------------------------------------------------------------------------
-- reference_features: precomputed features per strategy + algorithm version
-- -----------------------------------------------------------------------------
create table public.reference_features (
  id                 uuid primary key default gen_random_uuid(),
  reference_sound_id uuid not null references public.reference_sounds (id) on delete cascade,
  strategy_id        text not null check (strategy_id ~ '^[a-z][a-z0-9-]{0,39}$'),
  algorithm_version  text not null check (algorithm_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  -- Timbre features for a 5 s event are ~10 KB; 256 KB is a generous safety cap.
  features           jsonb not null check (jsonb_typeof(features) = 'object' and pg_column_size(features) <= 262144),
  computed_at        timestamptz not null default now(),
  constraint reference_features_unique unique (reference_sound_id, strategy_id, algorithm_version)
);

create index reference_features_strategy_idx on public.reference_features (strategy_id, algorithm_version);

-- -----------------------------------------------------------------------------
-- comparisons: result summaries only (never audio)
-- -----------------------------------------------------------------------------
create table public.comparisons (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references public.profiles (id) on delete cascade,
  mode               text not null check (mode in ('compare', 'identify', 'closest')),
  -- SET NULL keeps history readable after an admin deletes a reference; `result`
  -- holds a snapshot of the reference's name and details.
  reference_sound_id uuid references public.reference_sounds (id) on delete set null,
  instrument_id      uuid references public.instruments (id) on delete set null,
  strategy_id        text not null check (strategy_id ~ '^[a-z][a-z0-9-]{0,39}$'),
  algorithm_version  text not null check (algorithm_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  -- Heuristic similarity score. Identify mode has no score (it reports a note + confidence).
  score              numeric(5, 2) check (score is null or score between 0 and 100),
  -- Short human-readable label used for searching history, e.g. "A4 vs Grand piano A4".
  title              text not null check (char_length(title) between 1 and 200),
  result             jsonb not null check (jsonb_typeof(result) = 'object' and pg_column_size(result) <= 16384),
  -- Scores are computed on the user's device and trusted only for their own history.
  -- A future server-verified mode would add 'server' here.
  computed_on        text not null default 'client' check (computed_on in ('client')),
  created_at         timestamptz not null default now(),
  constraint comparisons_score_matches_mode check ((mode = 'identify') = (score is null))
);

create index comparisons_user_created_idx on public.comparisons (user_id, created_at desc);
create index comparisons_user_mode_created_idx on public.comparisons (user_id, mode, created_at desc);
create index comparisons_reference_idx on public.comparisons (reference_sound_id);
create index comparisons_instrument_idx on public.comparisons (instrument_id);
create index comparisons_title_trgm_idx on public.comparisons using gin (title extensions.gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- Rate limiting (fixed windows), used for history writes
-- -----------------------------------------------------------------------------
create table public.rate_limit_counters (
  user_id       uuid not null references auth.users (id) on delete cascade,
  bucket        text not null check (char_length(bucket) between 1 and 60),
  window_start  timestamptz not null,
  request_count integer not null default 0,
  primary key (user_id, bucket, window_start)
);

-- Counts one request for the CURRENT user in the current window and returns
-- true if they are still within `p_max`. SECURITY DEFINER because users have no
-- direct access to `rate_limit_counters`. Calling it directly only ever uses
-- up the caller's own quota, so exposing it to `authenticated` is harmless.
create or replace function public.consume_rate_limit(
  p_bucket text,
  p_max integer,
  p_window_seconds integer
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user   uuid := auth.uid();
  v_window timestamptz;
  v_count  integer;
begin
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;
  if p_max < 1 or p_window_seconds < 1 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit parameters' using errcode = '22023';
  end if;

  -- Start of the fixed window that contains now(), e.g. 12:00:00, 12:10:00, ...
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_counters as c (user_id, bucket, window_start, request_count)
  values (v_user, p_bucket, v_window, 1)
  on conflict (user_id, bucket, window_start)
    do update set request_count = c.request_count + 1
  returning request_count into v_count;

  -- Keep the table small: drop this user's windows older than a day.
  delete from public.rate_limit_counters
  where user_id = v_user and window_start < now() - interval '1 day';

  return v_count <= p_max;
end;
$$;
