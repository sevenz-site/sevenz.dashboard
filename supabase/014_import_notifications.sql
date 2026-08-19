-- Additive migration: run once in the SQL editor. Doesn't touch existing data.
-- A second notification source (alongside link_opens) for when a libreta
-- photo finishes processing — successfully or not. Unlike link_opens (public,
-- written by an anonymous visitor through a SECURITY DEFINER function), these
-- rows are written by the owner's own authenticated session, so a normal
-- owner-scoped policy is enough — no SECURITY DEFINER needed.

create table if not exists public.import_notifications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  file_name text not null,
  status text not null check (status in ('done', 'error')),
  movements_count int,
  error_message text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists import_notifications_owner_id_idx on public.import_notifications (owner_id);

alter table public.import_notifications enable row level security;

drop policy if exists "owners manage own import notifications" on public.import_notifications;
create policy "owners manage own import notifications" on public.import_notifications
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

grant select, insert, update on public.import_notifications to authenticated;
