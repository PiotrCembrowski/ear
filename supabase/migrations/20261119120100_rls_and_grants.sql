-- =============================================================================
-- SoundMatch: privileges and Row Level Security
--
-- Two layers, both must allow an action:
--   1. GRANTs decide which roles may touch a table/column at all.
--   2. RLS policies decide which ROWS they may touch.
--
-- Supabase gives `anon` and `authenticated` broad default privileges on new
-- tables in `public`. We revoke them and grant back only what is needed.
-- NOTE for future migrations: every new table needs its own explicit grants
-- and `enable row level security`.
--
-- Roles:
--   anon          - signed-out visitors (publishable key, no session)
--   authenticated - signed-in users
--   service_role  - server code using the secret key; bypasses RLS
-- =============================================================================

revoke all on all tables in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

-- Functions that RLS policies or the app call as the user.
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to authenticated;
-- Used by generated columns; harmless pure functions.
grant execute on function public.midi_note_name(integer) to anon, authenticated;
grant execute on function public.midi_nominal_hz(integer) to anon, authenticated;
grant execute on function public.tags_to_text(text[]) to anon, authenticated;

alter table public.profiles             enable row level security;
alter table public.reference_categories enable row level security;
alter table public.instruments          enable row level security;
alter table public.reference_sounds     enable row level security;
alter table public.instrument_samples   enable row level security;
alter table public.reference_features   enable row level security;
alter table public.comparisons          enable row level security;
alter table public.rate_limit_counters  enable row level security;

-- `(select auth.uid())` instead of `auth.uid()` lets Postgres evaluate it once
-- per statement instead of once per row (Supabase performance guidance).

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------
grant select on public.profiles to authenticated;
-- Column-level grant: users can change ONLY these columns. `role` and `id` are
-- not updatable by users at all (the trigger in the previous migration is a
-- second guard).
grant update (display_name, settings) on public.profiles to authenticated;

create policy "profiles: read own (admins read all)"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.is_admin());

create policy "profiles: update own"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- reference_categories, instruments: readable by everyone, writable by admins
-- -----------------------------------------------------------------------------
grant select on public.reference_categories, public.instruments to anon, authenticated;
grant insert, update, delete on public.reference_categories, public.instruments to authenticated;

create policy "categories: read all"
  on public.reference_categories for select to anon, authenticated
  using (true);
create policy "categories: admin insert"
  on public.reference_categories for insert to authenticated
  with check (public.is_admin());
create policy "categories: admin update"
  on public.reference_categories for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "categories: admin delete"
  on public.reference_categories for delete to authenticated
  using (public.is_admin());

create policy "instruments: read all"
  on public.instruments for select to anon, authenticated
  using (true);
create policy "instruments: admin insert"
  on public.instruments for insert to authenticated
  with check (public.is_admin());
create policy "instruments: admin update"
  on public.instruments for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "instruments: admin delete"
  on public.instruments for delete to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- reference_sounds: public -> any signed-in user; private -> owner + admins.
-- Signed-out visitors cannot read references at all.
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.reference_sounds to authenticated;

create policy "references: read visible"
  on public.reference_sounds for select to authenticated
  using (
    visibility = 'public'
    or owner_id = (select auth.uid())
    or public.is_admin()
  );
create policy "references: admin insert"
  on public.reference_sounds for insert to authenticated
  with check (public.is_admin());
create policy "references: admin update"
  on public.reference_sounds for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "references: admin delete"
  on public.reference_sounds for delete to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- instrument_samples, reference_features: visible exactly when the parent
-- reference is visible (the subquery is itself filtered by the policy above).
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.instrument_samples, public.reference_features to authenticated;

create policy "samples: read if reference visible"
  on public.instrument_samples for select to authenticated
  using (exists (select 1 from public.reference_sounds r where r.id = reference_sound_id));
create policy "samples: admin insert"
  on public.instrument_samples for insert to authenticated
  with check (public.is_admin());
create policy "samples: admin update"
  on public.instrument_samples for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "samples: admin delete"
  on public.instrument_samples for delete to authenticated
  using (public.is_admin());

create policy "features: read if reference visible"
  on public.reference_features for select to authenticated
  using (exists (select 1 from public.reference_sounds r where r.id = reference_sound_id));
create policy "features: admin insert"
  on public.reference_features for insert to authenticated
  with check (public.is_admin());
create policy "features: admin update"
  on public.reference_features for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "features: admin delete"
  on public.reference_features for delete to authenticated
  using (public.is_admin());

-- -----------------------------------------------------------------------------
-- comparisons: users see and delete only their own rows.
-- There is NO insert grant for users: rows are created only by
-- POST /api/comparisons, which validates the summary with Zod, takes user_id
-- from the session, rate-limits, and inserts with the server-only key.
-- -----------------------------------------------------------------------------
grant select, delete on public.comparisons to authenticated;

create policy "comparisons: read own"
  on public.comparisons for select to authenticated
  using (user_id = (select auth.uid()));
create policy "comparisons: delete own"
  on public.comparisons for delete to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- rate_limit_counters: no direct access for anyone except service_role;
-- users touch it only through consume_rate_limit().
-- (RLS enabled above with no policies = deny all for anon/authenticated.)
-- -----------------------------------------------------------------------------
