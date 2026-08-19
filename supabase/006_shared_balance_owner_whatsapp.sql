-- Additive migration: run once in the SQL editor. Doesn't touch existing data.
-- Adds the owner's WhatsApp number to what the public client-balance page gets back.

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

  select business_name, whatsapp into v_business, v_owner_whatsapp
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
    'client_name', v_client.name,
    'whatsapp_last4', right(coalesce(v_client.whatsapp, ''), 4),
    'balance', coalesce(v_balance, 0),
    'movements', coalesce(v_movements, '[]'::json)
  );
end;
$$;
