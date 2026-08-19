-- Additive migration: run once in the SQL editor. Doesn't touch existing data.

create table if not exists public.link_opens (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients (id) on delete cascade,
  opened_date date not null default current_date,
  opened_at timestamptz not null default now(),
  read_at timestamptz,
  unique (client_id, opened_date)
);

create index if not exists link_opens_client_id_idx on public.link_opens (client_id);

alter table public.link_opens enable row level security;

drop policy if exists "owners view own link opens" on public.link_opens;
create policy "owners view own link opens" on public.link_opens
  for select using (
    exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
  );

drop policy if exists "owners update own link opens" on public.link_opens;
create policy "owners update own link opens" on public.link_opens
  for update using (
    exists (select 1 from public.clients c where c.id = client_id and c.owner_id = auth.uid())
  );

-- Only `authenticated` (the owner) can read/mark these — writes happen only
-- through get_shared_balance() below, which runs as a trusted function and
-- needs no direct grant to anon.
grant select, update on public.link_opens to authenticated;

-- Record one open per client per day, then return the balance as before.
create or replace function public.get_shared_balance(p_token text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client public.clients%rowtype;
  v_business text;
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

  select business_name into v_business from public.owners where id = v_client.owner_id;

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
    'client_name', v_client.name,
    'whatsapp_last4', right(coalesce(v_client.whatsapp, ''), 4),
    'balance', coalesce(v_balance, 0),
    'movements', coalesce(v_movements, '[]'::json)
  );
end;
$$;
