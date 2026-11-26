-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- BEFORE the code that reads `phone`, with its own green light. Re-runnable: the
-- function is dropped and created again, and its grants are set every time.
--
-- ===========================================================================
-- 223: THE WEEKLY CAP OF THE CUOTA NOTICES COUNTS BY PHONE, WITHIN A BUSINESS
--
-- Owner's decision of 2026-11-26, «Opción A», after measuring it in production:
-- the phone 584163158011 carries two client records of the same business,
-- «Karina castillo (kari)» and «Karina castillo (Hermana)». It received
-- `overdue_debt_warning` on 2026-11-25 for one and on 2026-11-26 for the other,
-- two debt warnings in two days to one person, from a number she does not have
-- saved. The cap of 218 is ONE PER CLIENT PER WEEK, so two records sharing a
-- phone were two caps.
--
-- And the scope, chosen by the owner the same day: *«Solo mismo negocio»*. The
-- cap counts by phone INSIDE each business. A phone that is a client of two
-- bodegas can still get one notice from each per week: a business must not
-- lose its reminder because another one sent first, and it would never know.
--
-- WHAT A HELD NOTICE COSTS, said to the owner before he chose: it is not sent
-- later (each notice has its day, as in 218). The person whose notice was held
-- usually still hears: the 15-day warning falls 8 days after the 7-day one, and
-- by then the week is over. Only someone sharing a phone with several people
-- who always fall due the same week could go without one.
--
-- WHAT CHANGES HERE, and the rest stays as 218 wrote it:
--
--   1. `phone`: the normalized number, the same value the send gate stores in
--      `whatsapp_sends.recipient`. The server groups by owner + phone.
--
--   2. `ultimo_aviso`: the last cuota notice of the business to THIS CLIENT OR
--      TO THIS PHONE. Both, not only the phone: a client whose number was
--      corrected yesterday got his notice on the old one, and counting by the
--      new phone alone would send him a second one this week.
--
-- WHY THE OLD CODE STILL WORKS AGAINST THIS (deploy order, CLAUDE.md step 1):
-- the old code ignores `phone` and keeps grouping by client, but it reads this
-- `ultimo_aviso`, which now sees the phone's notices. So the case of 25 and 26
-- November is already held with the old code; only two people on one phone
-- falling due the SAME day would both still go out. And the new code against
-- the old function finds no `phone` and falls back to the client, which is the
-- behaviour of today. Neither order breaks anything.
--
-- THE FILTER ON `whatsapp_sends` names `audience`, `reminder` and `ok` so the
-- partial index of migration 099 (owner_id, sent_at desc) can serve it. Both
-- templates are sent with `p_reminder: true`.

begin;

drop function if exists public.whatsapp_cuotas_candidatas();

create function public.whatsapp_cuotas_candidatas()
returns table (
  movement_id uuid,
  client_id uuid,
  owner_id uuid,
  created_at timestamptz,
  amount numeric,
  currency text,
  plazo_dias int,
  cuotas int,
  pendiente numeric,
  business_name text,
  country text,
  is_flagged boolean,
  balance numeric,
  balance_usd numeric,
  balance_eur numeric,
  ultimo_aviso timestamptz,
  phone text
)
language sql
stable
security definer
set search_path = public
as $fn$
  select
    mv.id,
    mv.client_id,
    cl.owner_id,
    mv.created_at,
    mv.amount,
    mv.currency,
    mv.plazo_dias,
    mv.cuotas,
    -- What this fiado still owes, from the same function the screens read
    -- (`get_open_charges_for_client`). Unchanged from 218.
    coalesce(op.pending, 0) as pendiente,
    o.business_name,
    o.country,
    coalesce(c.is_flagged, false) as is_flagged,
    cl.balance,
    cl.balance_usd,
    cl.balance_eur,
    -- The last cuota notice this business sent to this client OR to this phone.
    -- See the header for why both.
    (
      select max(ws.sent_at)
      from public.whatsapp_sends ws
      where ws.owner_id = cl.owner_id
        and ws.audience = 'client'
        and ws.reminder is true
        and ws.ok is not false
        and ws.template in ('installment_due_soon', 'overdue_debt_warning')
        and (
          ws.client_id = mv.client_id
          or ws.recipient = public.normalize_whatsapp_phone(c.whatsapp)
        )
    ) as ultimo_aviso,
    public.normalize_whatsapp_phone(c.whatsapp) as phone
  from public.movements mv
  join public.clients c on c.id = mv.client_id
  join public.client_summary_all cl on cl.client_id = mv.client_id
  join public.owners o on o.id = cl.owner_id
  left join lateral (
    select oc.pending
    from public.get_open_charges_for_client(mv.client_id) oc
    where oc.movement_id = mv.id
  ) op on true
  where mv.type = 'charge'
    and mv.deleted_at is null
    and mv.plazo_dias is not null
    and mv.plazo_dias > 0
    and mv.created_at + (interval '1 day' * (mv.plazo_dias + 16)) >= now()
    and cl.trashed_at is null
    and cl.deleted_at is null
    and (case mv.currency
           when 'USD' then cl.balance_usd
           when 'EUR' then cl.balance_eur
           else cl.balance
         end) > 0
    and public.normalize_whatsapp_phone(c.whatsapp) is not null
    and public.client_accepts_whatsapp(mv.client_id)
    and public.owner_puede_escribir(cl.owner_id)
    and coalesce(op.pending, 0) > 0.005;
$fn$;

-- Supabase grants EXECUTE on every new function in public to anon and
-- authenticated, and this one returns clients' debts and phones. Only the cron
-- calls it.
revoke execute on function public.whatsapp_cuotas_candidatas() from public, anon, authenticated;
grant execute on function public.whatsapp_cuotas_candidatas() to service_role;

insert into public.schema_migrations (key, description)
values (
  '223_cuota_notice_cap_by_phone',
  'El tope de un aviso de cuota por semana deja de contarse por cliente y pasa a contarse por NÚMERO dentro de cada negocio (decisión del dueño el 2026-11-26, «Opción A» y «Solo mismo negocio»). Medido en producción: el 584163158011 lleva dos fichas del mismo negocio, «Karina castillo (kari)» y «Karina castillo (Hermana)», y recibió overdue_debt_warning el 25 y el 26 de noviembre, uno por ficha. whatsapp_cuotas_candidatas() devuelve ahora el número normalizado (phone) y ultimo_aviso mira el último aviso de cuota del negocio a ese cliente O a ese número. Un número cliente de dos bodegas sigue pudiendo recibir uno de cada una. El aviso retenido no se manda después, igual que en la 218. Funciona con el código viejo y con el nuevo, en cualquier orden.'
)
on conflict (key) do nothing;

commit;
