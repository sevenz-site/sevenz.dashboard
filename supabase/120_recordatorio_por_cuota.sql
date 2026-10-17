-- 120: THE CLIENT'S REMINDER LOOKS AT EACH CUOTA, NOT ONLY AT THE WHOLE TERM
--
-- Owner's decision, 2026-10-16: *«esas fechas de plazo de la cuota debería
-- contar como plazo vencido y en consecuencia mostrarse en los mensajes de
-- whatsapp tanto para cliente como dueño»*.
--
-- ===========================================================================
-- THE OWNER'S HALF WAS ALREADY DONE. Migration `119`, earlier the same day,
-- made `whatsapp_destinatarios_resumen()` and `_atencion()` read
-- `client_summary.oldest_unpaid_charge_due_at`, which IS the next unpaid
-- cuota's deadline. This migration is the other half: the message that goes to
-- the CLIENT.
--
-- WHAT WAS WRONG, and it was wrong by omission rather than by error:
-- `whatsapp_destinatarios_plazo()` turned every charge into exactly ONE
-- deadline, the end of its term. A fiado of 90 agreed in 3 cuotas over 30 days
-- produced one reminder, seven days before day 30, and said nothing at all
-- about the cuotas falling due on days 10 and 20 -- the two dates the client
-- actually had to meet first, and the two whose absence the shopkeeper's own
-- screen was already painting red.
--
-- ===========================================================================
-- WHAT CHANGES, EXACTLY TWO EXPRESSIONS
--
-- 1. `cargos` now yields ONE ROW PER CUOTA instead of one per charge, through
--    a lateral `generate_series`. The deadline of cuota k of n is
--
--        created_at + plazo_dias * (k / n) days
--
--    which is character for character the expression migration `118` uses to
--    decide whether the badge says "Plazo vencido", and the one
--    `lib/cuotas.ts` uses to print the dates on the card. Three places, one
--    formula. `119` exists because two of them had drifted apart once already.
--
-- 2. `dias_antes` -- how early the reminder goes out -- is now a quarter of the
--    CUOTA's length, not a quarter of the whole term. The owner's rule from
--    2026-10-14 was «un 25% del plazo, acotado entre 1 y 7 días», and the
--    period the client actually has in front of them is now the cuota. Keeping
--    the term's 25% would warn 7 days before each cuota of a 10-day stretch,
--    which is a reminder arriving before the previous one is due -- three
--    overlapping warnings a month for a single fiado.
--
-- NOTHING ELSE MOVES. The body was copied verbatim from `101`: same selection
-- (the nearest deadline still ahead, NOT "the oldest unpaid charge" -- see that
-- file's long note on why), same consent rule, same Colombia dates, same
-- balance filter, same columns.
--
-- AND IT IS A NO-OP FOR EVERYTHING STORED TODAY. With `cuotas` null, coalesce
-- makes n = 1, the series yields k = 1 only, the deadline collapses to
-- `created_at + plazo_dias` and `dias_antes` to `round(plazo_dias * 0.25)`.
-- Byte for byte what `101` computed. Nobody's reminder moves by a day.
--
-- ===========================================================================
-- NO TEMPLATE GOES BACK TO META, and that corrects what was said this morning.
-- `payment_due_date_v2`'s approved body is *«Hola {{client_name}}, tu plazo de
-- pago en {{business_display}} vence el {{due_date}}. Saldo pendiente:
-- {{amount_due}}»*. Putting a cuota's date into `{{due_date}}` changes no text,
-- no variable, no order and no button -- which is all Meta validates. A new
-- version would only be needed for a message that NAMES the cuota ("cuota 2 de
-- 3, $30"), and that is a separate decision with its own approval wait.
--
-- THE ONE IMPRECISION THAT REMAINS, stated so nobody discovers it later:
-- `amount_due` is the client's pending BALANCE in that ledger, not the cuota's
-- amount. So the message can read "vence el 26 de octubre. Saldo pendiente:
-- $90" when only $30 falls due that day. It is not false -- the balance really
-- is 90 -- but it is not the cuota either. Fixing that is exactly the new
-- template above. Tracked as `CT-90`.

begin;

drop function if exists public.whatsapp_destinatarios_plazo();

create function public.whatsapp_destinatarios_plazo()
returns table (
  movement_id uuid,
  client_id uuid,
  owner_id uuid,
  client_name text,
  phone text,
  business_display text,
  due_date date,
  amount_due numeric,
  currency text
)
language sql
stable
security definer
set search_path = public
as $fn$
  with hoy as (select (now() at time zone 'America/Bogota')::date as d),
  cargos as (
    select
      mv.id,
      mv.client_id,
      mv.currency,
      -- Misma expresión que la `118` y que lib/cuotas.ts. Sin cuotas,
      -- coalesce deja n = 1 y k = 1, o sea el plazo entero: idéntico a la 101.
      (
        (mv.created_at
          + (interval '1 day'
             * (mv.plazo_dias::numeric * k / coalesce(mv.cuotas, 1))))
        at time zone 'America/Bogota'
      )::date as vence,
      -- La ventana del dueno, 2026-10-14, aplicada al tramo que el cliente
      -- tiene delante -- que con cuotas es la cuota y no el plazo entero. La
      -- tabla de los seis casos esta en WHATSAPP-PLANTILLAS.md.
      greatest(
        1,
        least(
          7,
          round((mv.plazo_dias::numeric / coalesce(mv.cuotas, 1)) * 0.25)::int
        )
      ) as dias_antes
    from public.movements mv
    cross join lateral generate_series(1, coalesce(mv.cuotas, 1)) as k
    where mv.type = 'charge'
      and mv.deleted_at is null
      and mv.plazo_dias is not null
      and mv.plazo_dias > 0
  ),
  -- El vencimiento mas cercano de cada cliente, de los que aun no han llegado.
  proximo as (
    select distinct on (c.client_id) c.*
    from cargos c, hoy
    where c.vence >= hoy.d
    order by c.client_id, c.vence asc, c.id asc
  )
  select
    p.id as movement_id,
    cl.client_id,
    cl.owner_id,
    cl.name as client_name,
    public.normalize_whatsapp_phone(cl.whatsapp) as phone,
    case
      when coalesce(btrim(o.first_name), '') = '' then o.business_name
      else btrim(o.first_name) || ' (' || o.business_name || ')'
    end as business_display,
    p.vence as due_date,
    case p.currency
      when 'USD' then cl.balance_usd
      when 'EUR' then cl.balance_eur
      else cl.balance
    end as amount_due,
    p.currency
  from proximo p
  join public.client_summary_all cl on cl.client_id = p.client_id
  join public.owners o on o.id = cl.owner_id
  cross join hoy
  where cl.trashed_at is null
    and cl.deleted_at is null
    -- Hoy es el dia: ni antes ni despues.
    and (p.vence - p.dias_antes) = hoy.d
    -- Sin deuda en ESE libro no hay nada que recordar.
    and (case p.currency
           when 'USD' then cl.balance_usd
           when 'EUR' then cl.balance_eur
           else cl.balance
         end) > 0
    and public.normalize_whatsapp_phone(cl.whatsapp) is not null
    and public.client_accepts_whatsapp(cl.client_id);
$fn$;

-- Supabase concede EXECUTE a anon y authenticated sobre toda función nueva del
-- esquema public, y aquí hay teléfonos de clientes. La `101` ya lo revocaba y
-- se repite porque el drop + create lo deshace.
revoke execute on function public.whatsapp_destinatarios_plazo() from public, anon, authenticated;
grant execute on function public.whatsapp_destinatarios_plazo() to service_role;

insert into public.schema_migrations (key, description)
values (
  '120_recordatorio_por_cuota',
  'whatsapp_destinatarios_plazo() mira cada CUOTA y no solo el final del plazo. Decision del dueno el 2026-10-16: las fechas de cada cuota cuentan como plazo y tienen que salir en los mensajes, del cliente y del dueno. La mitad del DUENO ya estaba hecha en la 119; esta es la del CLIENTE. Antes, un fiado de 90 en 3 cuotas de 30 dias generaba UN recordatorio, el del dia 30, y no decia nada de los dias 10 y 20 -- las dos fechas que el cliente tenia que cumplir primero y que la pantalla del tendero ya pintaba en rojo. Cambian dos expresiones: cargos saca una fila por cuota con un generate_series lateral, y la fecha de la cuota k de n es created_at + plazo_dias * (k/n) dias, que es la MISMA expresion de la 118 y de lib/cuotas.ts; y dias_antes pasa a ser el 25% de la CUOTA y no del plazo entero, porque con el plazo entero se avisaria 7 dias antes de cada cuota de un tramo de 10 y los avisos se solaparian. Sin cuotas es un NO-OP exacto: coalesce deja n=1, la serie da k=1, y sale el plazo entero igual que en la 101. NO hace falta volver a pasar por Meta: payment_due_date_v2 no cambia de texto ni de variables, solo recibe otra fecha en due_date. Queda una imprecision anotada en CT-90: amount_due sigue siendo el saldo del libro y no el monto de la cuota.'
)
on conflict (key) do nothing;

commit;
