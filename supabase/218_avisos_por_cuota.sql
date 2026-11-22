-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- before the code that calls it, with its own green light. Re-runnable: the
-- function is dropped and created again, and its grants are set every time.
--
-- ===========================================================================
-- 218: THE CLIENT'S NOTICES COUNT BY CUOTA -- `installment_due_soon` AND
-- `overdue_debt_warning`
--
-- Owner's request of 2026-11-19: *«que las notificaciones de whatsapp de plazo
-- vencido salgan no del plazo vencido total sino de las cuotas»*. Both
-- templates were approved by Meta and their bodies compared with the specs in
-- `../docs/WHATSAPP-PLANTILLAS.md` on 2026-11-22. They replace
-- `payment_due_date_v2` («Eliminar payment_due_date_v2», same day).
--
-- WHAT THIS FUNCTION DOES, AND WHAT IT DELIBERATELY DOES NOT.
--
-- It returns the CANDIDATES: every live charge with a term whose last cuota is
-- at most 16 days behind, of a client who can be messaged, with what the
-- screen's cuota table uses to judge it: the charge and what it STILL OWES,
-- from `get_open_charges_for_client` (the ledger's own queue). It does NOT
-- decide which cuota is paid or which day a notice goes out. That happens in
-- `lib/whatsapp/installment-notices.ts`, with `estadosDelFiado` and
-- `pagadoDelFiado`, the same functions that paint the «Estado» column.
--
-- Why not in SQL, when `120` and `168` did the old reminder in SQL: the specs
-- say so, and the owner chose it on 2026-11-22 («B», asked with the risk
-- named). A cuota the table paints «Vencida» and the message calls paid, or
-- the reverse, is the product arguing with itself about money. A second copy
-- of the paid/unpaid rule in SQL is exactly how that happens.
--
-- THE SAME DAY THE TABLE ITSELF WAS FIXED (owner's «solución 1», 2026-11-22).
-- It used to count the payments DIRECTED at the fiado plus the payment made at
-- the sale: the first missed undirected payments (12 of 107 open fiados in dev)
-- and the second counted the sale's payment twice, since the fiado is stored
-- for what was left after it (3 fiados in dev, one with all 4 cuotas «Pagado»
-- while owing $15). Both now read «stored amount minus what it still owes», so
-- this file returns `pendiente` and not the payments. It was corrected before
-- it ever reached production; dev re-runs it. One guard stays, because it
-- costs nothing: a book with no debt at all gets no notice.
--
-- WHY A SECURITY DEFINER FUNCTION AND NOT TABLE READS FROM THE SERVER: in
-- production the service role has no direct grant on the sales tables
-- (migration `213`, found by the v0.9.0 checklist). Reading `sale_payments`
-- from the cron with the service key would work in dev and fail in production.
--
-- THE WEEKLY CAP needs the last notice of each client, so it travels here as
-- `ultimo_aviso`: one per client per week, across both templates (owner's
-- decision of 2026-11-19). The receipt of a payment does not count.

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
  ultimo_aviso timestamptz
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
    -- (`get_open_charges_for_client`): directed payments, undirected ones in
    -- the queue's order, and returns. A settled fiado is not in its list, so
    -- it comes back as zero.
    coalesce(op.pending, 0) as pendiente,
    o.business_name,
    o.country,
    coalesce(c.is_flagged, false) as is_flagged,
    cl.balance,
    cl.balance_usd,
    cl.balance_eur,
    (
      select max(ws.sent_at)
      from public.whatsapp_sends ws
      where ws.client_id = mv.client_id
        and ws.template in ('installment_due_soon', 'overdue_debt_warning')
        and ws.ok is not false
    ) as ultimo_aviso
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
    -- Nothing goes out after the 15th day of the LAST cuota: older charges
    -- are not candidates, which keeps this list short.
    and mv.created_at + (interval '1 day' * (mv.plazo_dias + 16)) >= now()
    and cl.trashed_at is null
    and cl.deleted_at is null
    -- A book with no debt at all has nothing to remind.
    and (case mv.currency
           when 'USD' then cl.balance_usd
           when 'EUR' then cl.balance_eur
           else cl.balance
         end) > 0
    and public.normalize_whatsapp_phone(c.whatsapp) is not null
    and public.client_accepts_whatsapp(mv.client_id)
    -- A paused or blocked business sends nothing to its clients (specs of both
    -- templates, 2026-11-19).
    and public.owner_puede_escribir(cl.owner_id)
    -- Nothing owed on this fiado, nothing to remind.
    and coalesce(op.pending, 0) > 0.005;
$fn$;

-- Supabase grants EXECUTE on every new function in public to anon and
-- authenticated, and this one returns clients' debts. Only the cron calls it.
revoke execute on function public.whatsapp_cuotas_candidatas() from public, anon, authenticated;
grant execute on function public.whatsapp_cuotas_candidatas() to service_role;

insert into public.schema_migrations (key, description)
values (
  '218_avisos_por_cuota',
  'Nace whatsapp_cuotas_candidatas(): los fiados con plazo vivos, de clientes con permiso y número y de negocios que pueden escribir, con lo que la tabla de cuotas usa para juzgarlos (el fiado y lo que todavía debe, de get_open_charges_for_client: solución 1 del dueño el 2026-11-22) y el último aviso por cuota de cada cliente, para el tope de uno por semana. La decisión de qué cuota está pagada y qué día sale cada aviso la toma el servidor con estadosDelFiado y pagadoDelFiado, las mismas funciones de la pantalla. Alimenta installment_due_soon y overdue_debt_warning, que sustituyen a payment_due_date_v2. whatsapp_destinatarios_plazo() se queda en la base sin uso, para poder volver atrás.'
)
on conflict (key) do nothing;

commit;
