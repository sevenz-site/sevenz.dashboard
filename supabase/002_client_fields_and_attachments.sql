-- Additive migration: run once in the SQL editor. Doesn't touch existing data.

-- ── new client/movement fields ────────────────────────────────────────────
alter table public.clients add column if not exists document_id text;
alter table public.movements add column if not exists photo_path text;

-- ── private attachments bucket (receipts, invoices, merchandise, ID photos) ─
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

grant usage on schema storage to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;

-- Files are stored as "{owner_id}/{filename}" — these policies make sure an
-- owner can only touch files under their own folder.
drop policy if exists "owners upload own attachments" on storage.objects;
create policy "owners upload own attachments"
on storage.objects for insert
with check (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "owners read own attachments" on storage.objects;
create policy "owners read own attachments"
on storage.objects for select
using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "owners delete own attachments" on storage.objects;
create policy "owners delete own attachments"
on storage.objects for delete
using (
  bucket_id = 'attachments'
  and (storage.foldername(name))[1] = auth.uid()::text
);
