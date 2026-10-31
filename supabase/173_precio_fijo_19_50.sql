-- ENVIRONMENT: run in DEV first (vzqppwrwnmlbrxizskdh). Production comes later,
-- with its own green light, and AFTER reading the read-only list of the prices
-- this changes there. Re-runnable: every update only touches rows still above
-- the new price, so a second run changes nothing and writes no history.
--
-- ===========================================================================
-- 173: ONE PUBLISHED PRICE, 19,50 USD A MONTH
--
-- The owner's decisions of 2026-10-31, asked as straight choices:
--   - the site says «19,50 USD fijo (antes 35)», not «desde 20 USD»;
--   - businesses that already agreed a different price: «Todos pasan a 19,50».
--
-- WHAT THIS DISPLACES: since 057 the price was negotiated per business
-- («el precio se negocia entre 15 y 30 USD y el catálogo es solo la
-- plantilla»), and the site said «desde» because of it.
--
-- THREE EDGES, each decided here:
--
-- 1. A PRICE IS PER BILLING PERIOD. `precio_pactado_usd` is what is charged
--    each `periodicidad`, so «19,50 a month» is 58,50 a quarter and 234 a year.
--    Comparing a yearly 200 with 19,50 would have cut it to 19,50 a year.
--
-- 2. ONLY PRICES ABOVE IT GO DOWN. The owner's choice was offered as lowering
--    the price of those who pay more. A business that agreed LESS than 19,50
--    is left alone: raising what someone pays is not something the Terms allow
--    without telling them first («anunciado con anticipación … antes de que el
--    Usuario deba pagar»). That one is the owner's call, per business, in
--    /admin.
--
-- 3. NO PERIOD, NO GUESS. A row with a price and no `periodicidad` cannot be
--    converted safely, so it is left alone too and shows up in the check.
--
-- Every changed row writes its line in `subscription_events`, so /admin's
-- history says when the price moved and why.

begin;

-- New Pro subscriptions take their price from the catalogue (`handle_new_user`
-- and the 171 backfill copy `plans.precio_usd`).
update public.plans
set precio_usd = 19.50
where code = 'pro' and precio_usd is distinct from 19.50;

with objetivo as (
  select s.owner_id, s.estado, s.plan_code, s.precio_pactado_usd as antes,
         case s.periodicidad
           when 'mensual' then 19.50
           when 'trimestral' then 58.50
           when 'anual' then 234.00
         end as nuevo
  from public.subscriptions s
  where s.precio_pactado_usd is not null
    and s.periodicidad in ('mensual', 'trimestral', 'anual')
),
cambiadas as (
  update public.subscriptions s
  set precio_pactado_usd = o.nuevo,
      updated_at = now()
  from objetivo o
  where s.owner_id = o.owner_id
    and o.antes > o.nuevo
  returning s.owner_id, o.estado, o.plan_code, o.antes, o.nuevo
)
insert into public.subscription_events
  (owner_id, actor_email, desde_estado, hasta_estado, desde_plan, hasta_plan, motivo)
select owner_id, 'sistema', estado, estado, plan_code, plan_code,
       'Precio fijo de 19,50 USD al mes (migración 173): de ' || antes || ' a ' || nuevo || ' USD por periodo'
from cambiadas;

insert into public.schema_migrations (key, description)
values (
  '173_precio_fijo_19_50',
  'Precio publicado fijo de 19,50 USD al mes, decisión del dueño el 2026-10-31. plans.pro pasa a 19,50 y toda suscripción con un precio pactado MAYOR baja a 19,50 al mes (58,50 trimestral, 234 anual), con su fila en el historial. No sube a nadie: un precio pactado menor, o sin periodicidad, se queda como estaba.'
)
on conflict (key) do nothing;

commit;
