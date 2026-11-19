-- =============================================================================
-- SoundMatch: Storage
--
-- One private bucket, `references`, holding admin-imported reference sounds
-- (mono 16-bit WAV, at most 30 s). There is deliberately no bucket for user
-- audio: users' sound never leaves their device.
--
-- Supabase already enables RLS on storage.objects; we only add policies.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'references',
  'references',
  false,                                              -- private: files are served via signed URLs
  5242880,                                            -- 5 MB, matches REFERENCE_LIMITS.maxStoredBytes
  array['audio/wav', 'audio/x-wav', 'audio/wave']
)
on conflict (id) do update
  set public             = excluded.public,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Read: a file is readable exactly when its reference_sounds row is readable by
-- the caller (the subquery is filtered by that table's RLS policy), so the
-- public/private visibility rule is defined in one place. Admins can also read
-- files that are uploaded but not yet linked to a row.
create policy "reference files: read if reference visible"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'references'
    and (
      exists (select 1 from public.reference_sounds r where r.storage_path = storage.objects.name)
      or public.is_admin()
    )
  );

create policy "reference files: admin insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'references' and public.is_admin());

create policy "reference files: admin update"
  on storage.objects for update to authenticated
  using (bucket_id = 'references' and public.is_admin())
  with check (bucket_id = 'references' and public.is_admin());

create policy "reference files: admin delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'references' and public.is_admin());
