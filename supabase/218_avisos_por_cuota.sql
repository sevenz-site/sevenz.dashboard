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
-- at most 16 days behind, of a client who can be messaged, with everything the
-- screen's cuota table uses to judge it -- the charge, what was paid at the
-- moment of the sale in its book, and the payments directed at it. It does NOT
-- decide which cuota is paid or which day a notice goes out. That happens in
-- `lib/whatsapp/installment-notices.ts`, with `estadosDelFiado`, the same
-- function that paints the «Estado» column.
--
-- Why not in SQL, when `120` and `168` did the old reminder in SQL: the specs
-- say so, and the owner chose it on 2026-11-22 («B», asked with the risk
-- named). A cuota the table paints «Vencida» and the message calls paid, or
-- the reverse, is the product arguing with itself about money. A second copy
-- of the paid/unpaid rule in SQL is exactly how that happens.
--
-- THE KNOWN COST OF THAT CHOICE, stated so nobody rediscovers it: the table
-- counts only payments DIRECTED at the fiado and the payment made at the sale.
-- A payment that was not directed lowers the real debt but not the table, so a
-- client can get a notice about a cuota the ledger considers paid. Measured in
-- dev on 2026-11-22: 12 of 107 open fiados with a term. The owner chose this
-- knowing it. One guard stays, because it costs nothing and is not a second
-- rule: a book with no debt at all gets no notice (`balance_* > 0` below).
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
  abono_inicial numeric,
  abonos jsonb,
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
    -- The payment made at the sale, in this fiado's book. Same normalisation
    -- as the transaction screen (`?? "COP"` on both sides): `sale_payments`
    -- writes the Colombian book as 'COP' and `movements` writes it NULL.
    coalesce((
      select sum(sp.amount)
      from public.sale_payments sp
      where mv.sale_id is not null
        and sp.sale_id = mv.sale_id
        and coalesce(sp.currency, 'COP') = coalesce(mv.currency, 'COP')
    ), 0) as abono_inicial,
    -- The payments directed at this fiado, as the screen reads them: payments
    -- and returns, alive, above zero, and of THIS client (`applies_to` is a
    -- loose foreign key and nothing forces it to stay inside the client).
    coalesce((
      select jsonb_agg(jsonb_build_object('fecha', p.created_at, 'amount', p.amount) order by p.created_at)
      from public.movements p
      where p.client_id = mv.client_id
        and p.applies_to_movement_id = mv.id
        and p.type in ('payment', 'return')
        and p.amount > 0
        and p.deleted_at is null
    ), '[]'::jsonb) as abonos,
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
    and public.owner_puede_escribir(cl.owner_id);
$fn$;

-- Supabase grants EXECUTE on every new function in public to anon and
-- authenticated, and this one returns clients' debts. Only the cron calls it.
revoke execute on function public.whatsapp_cuotas_candidatas() from public, anon, authenticated;
grant execute on function public.whatsapp_cuotas_candidatas() to service_role;

insert into public.schema_migrations (key, description)
values (
  '218_avisos_por_cuota',
  'Nace whatsapp_cuotas_candidatas(): los fiados con plazo vivos, de clientes con permiso y número y de negocios que pueden escribir, con lo que la tabla de cuotas usa para juzgarlos (el fiado, el pago del momento de la venta en su libro y los abonos dirigidos) y el último aviso por cuota de cada cliente, para el tope de uno por semana. La decisión de qué cuota está pagada y qué día sale cada aviso la toma el servidor con estadosDelFiado, la misma función de la pantalla (opción B del dueño, 2026-11-22). Alimenta installment_due_soon y overdue_debt_warning, que sustituyen a payment_due_date_v2. whatsapp_destinatarios_plazo() se queda en la base sin uso, para poder volver atrás.'
)
on conflict (key) do nothing;

commit;
