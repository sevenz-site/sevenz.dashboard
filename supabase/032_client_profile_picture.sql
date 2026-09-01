-- Run once in the SQL editor, BOTH the dev branch and production Supabase
-- project — same dual-environment discipline as every migration before it.
--
-- Lets a client upload/change their own profile picture from their public
-- "Mi perfil" page (/s/[token]/perfil). Unlike the logos/attachments
-- buckets (uploaded directly from an authenticated owner session, gated by
-- storage.objects policies keyed on auth.uid()), there is no auth.uid()
-- for an anonymous client — so this bucket carries NO storage.objects
-- policies at all. Every write goes through a server action using the
-- service-role client (lib/supabase/service.ts), which bypasses RLS
-- entirely; resolve_shared_client() below is the actual gate, verifying
-- the caller has a real share-link token before that service-role write
-- ever happens. Reads work because the bucket is public, same as logos.

alter table public.clients add column if not exists profile_picture_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('client-profile-pictures', 'client-profile-pictures', true, 5242880, array['image/jpeg', 'image/jpg', 'image/png'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Resolves a share token to its client_id — the same trusted token ->
-- client resolution get_shared_balance() and submit_shared_document_id()
-- already use, factored out here since the profile-picture upload needs
-- it independently (to know which client_id to use as the Storage folder
-- before handing off to the service-role client).
create or replace function public.resolve_shared_client(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
begin
  select client_id into v_client_id from public.share_links where token = p_token;
  return v_client_id;
end;
$$;

grant execute on function public.resolve_shared_client(text) to anon, authenticated;

-- Dedicated payload for the /s/[token]/perfil page — separate from
-- get_shared_balance() deliberately, so whatsapp/address (never exposed
-- on the main balance page) are only ever returned to whoever's looking
-- at the profile page specifically, not bundled into a payload used
-- elsewhere too.
create or replace function public.get_shared_client_profile(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_business text;
  v_owner_logo_path text;
begin
  select c.* into v_client
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  where sl.token = p_token;

  if not found then
    return null;
  end if;

  select business_name, logo_path into v_business, v_owner_logo_path
  from public.owners where id = v_client.owner_id;

  return json_build_object(
    'business_name', v_business,
    'owner_logo_path', v_owner_logo_path,
    'client_name', v_client.name,
    'document_id', v_client.document_id,
    'whatsapp', v_client.whatsapp,
    'address', v_client.address,
    'profile_picture_path', v_client.profile_picture_path
  );
end;
$$;

grant execute on function public.get_shared_client_profile(text) to anon, authenticated;

insert into public.schema_migrations (key, description)
values ('032_client_profile_picture', 'Adds clients.profile_picture_path, the client-profile-pictures bucket, resolve_shared_client(), and get_shared_client_profile()')
on conflict (key) do nothing;
