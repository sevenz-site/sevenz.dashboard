-- 213 · The month's close, readable by the Thursday batch
--
-- WHY. `cierre_mensual` is sent by the weekly cron, which runs as the service role. Its first
-- version (v0.9.0 as it was frozen) read `sales`, `sale_lines`, `sale_returns` and
-- `whatsapp_sends` straight from that client. That works in the dev branch and cannot work in
-- production, which revokes SELECT from `service_role` on the customer tables (the 2026-09-05
-- outage, migration 039). The failure would have been silent and total: both reads sit behind
-- a fallback that means «do not send», so no business would ever have received its close and
-- nothing would have turned red. Caught by `qa:service-role` in the release checklist of
-- v0.9.0, on 2026-11-16, before it reached production.
--
-- WHAT. Two SECURITY DEFINER functions for the service role only, which is the pattern every
-- other WhatsApp read already follows (`whatsapp_business_weekly_targets`):
--
--   whatsapp_monthly_close_rows(owner, from, to)
--     The raw rows of one business's month: its sale lines and its returns. NOT the totals:
--     the arithmetic stays in `calcularCierre` (lib/reports/cierre-del-mes.ts), the same
--     function the «Cierre de …» card in Reportes runs with the owner's own session, so the
--     message and the screen cannot disagree. One jsonb value, so the API's 1,000-row cut
--     (PL-34) does not apply.
--
--   whatsapp_monthly_closes_sent(since)
--     Which businesses already have a `cierre_mensual` sent or on its way since that instant.
--     A failed send (ok false) does not count, so the next run in the window retries it.
--
-- Read-only, no schema change, nothing for the owner's session: Reportes keeps reading under
-- RLS as before.
--
-- RE-RUNNABLE: both functions are dropped by their exact signature first, so a corrected file
-- can be run again.

drop function if exists public.whatsapp_monthly_close_rows(uuid, timestamptz, timestamptz);

create function public.whatsapp_monthly_close_rows(
  p_owner_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    -- The same rows `cargarCierreDelMes` reads: lines of the live sales created in the month.
    'lineas', coalesce((
      select jsonb_agg(jsonb_build_object(
               'sale_id', l.sale_id,
               'currency', l.currency,
               'quantity', l.quantity,
               'unit_price', l.unit_price,
               'unit_cost', l.unit_cost))
        from public.sale_lines l
        join public.sales s on s.id = l.sale_id
       where s.owner_id = p_owner_id
         and s.deleted_at is null
         and s.created_at >= p_from
         and s.created_at < p_to
    ), '[]'::jsonb),
    -- Live returns created in the month, each with the frozen cost of the line it returns.
    -- `currency` stays as the ledger spells it (NULL for a Colombian book); the reader maps it.
    'devoluciones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'currency', r.currency,
               'quantity', r.quantity,
               'unit_price', r.unit_price,
               'amount', r.amount,
               'unit_cost', rl.unit_cost))
        from public.sale_returns r
        left join public.sale_lines rl on rl.id = r.sale_line_id
       where r.owner_id = p_owner_id
         and r.deleted_at is null
         and r.created_at >= p_from
         and r.created_at < p_to
    ), '[]'::jsonb)
  );
$fn$;

revoke execute on function public.whatsapp_monthly_close_rows(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.whatsapp_monthly_close_rows(uuid, timestamptz, timestamptz) to service_role;


drop function if exists public.whatsapp_monthly_closes_sent(timestamptz);

create function public.whatsapp_monthly_closes_sent(p_since timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('owner_id', w.owner_id, 'sent_at', w.sent_at)), '[]'::jsonb)
    from public.whatsapp_sends w
   where w.template = 'cierre_mensual'
     and w.ok is not false
     and w.sent_at >= p_since;
$fn$;

revoke execute on function public.whatsapp_monthly_closes_sent(timestamptz) from public, anon, authenticated;
grant execute on function public.whatsapp_monthly_closes_sent(timestamptz) to service_role;


insert into public.schema_migrations (key, description)
values ('213_monthly_close_for_the_server', 'cierre_mensual: dos funciones para que el envío del jueves lea las ventas del mes y los cierres ya enviados sin permiso directo sobre las tablas, que en producción el servidor no tiene. Sin esto ningún negocio recibiría su cierre, sin error visible.')
on conflict (key) do nothing;
