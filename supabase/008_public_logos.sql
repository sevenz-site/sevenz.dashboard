-- Additive migration: run once in the SQL editor. Doesn't touch existing data.
-- Business logos move to their own PUBLIC bucket (separate from the private
-- `attachments` bucket, which keeps receipts/ID photos private). A logo is
-- meant to be shown to clients on their public balance page, so it isn't
-- sensitive the way a receipt or ID photo is.

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

-- Anyone can read (public bucket, no policy needed for that), but only the
-- owning authenticated user can upload/replace/delete inside their own folder.
drop policy if exists "owners upload own logo" on storage.objects;
create policy "owners upload own logo"
on storage.objects for insert
with check (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "owners update own logo" on storage.objects;
create policy "owners update own logo"
on storage.objects for update
using (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "owners delete own logo" on storage.objects;
create policy "owners delete own logo"
on storage.objects for delete
using (
  bucket_id = 'logos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "anyone reads logos" on storage.objects;
create policy "anyone reads logos"
on storage.objects for select
using (bucket_id = 'logos');

grant select on storage.objects to anon;

-- get_shared_balance() now also returns the logo's storage path, so the
-- client page can show the business's own logo (falling back to Sevenz's
-- icon when the business hasn't uploaded one).
create or replace function public.get_shared_balance(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_business text;
  v_owner_whatsapp text;
  v_owner_logo_path text;
  v_movements json;
  v_balance numeric(12, 2);
begin
  select c.* into v_client
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  where sl.token = p_token;

  if not found then
    return null;
  end if;

  insert into public.link_opens (client_id, opened_date)
  values (v_client.id, current_date)
  on conflict (client_id, opened_date) do nothing;

  select business_name, whatsapp, logo_path into v_business, v_owner_whatsapp, v_owner_logo_path
  from public.owners where id = v_client.owner_id;

  select json_agg(
    json_build_object(
      'id', m.id,
      'type', m.type,
      'amount', m.amount,
      'description', m.description,
      'running_balance', m.running_balance,
      'needs_review', m.needs_review,
      'created_at', m.created_at
    ) order by m.created_at asc
  )
  into v_movements
  from public.movements m
  where m.client_id = v_client.id;

  select running_balance into v_balance
  from public.movements
  where client_id = v_client.id
  order by created_at desc, id desc
  limit 1;

  return json_build_object(
    'business_name', v_business,
    'owner_whatsapp', v_owner_whatsapp,
    'owner_logo_path', v_owner_logo_path,
    'client_name', v_client.name,
    'whatsapp_last4', right(coalesce(v_client.whatsapp, ''), 4),
    'balance', coalesce(v_balance, 0),
    'movements', coalesce(v_movements, '[]'::json)
  );
end;
$$;
