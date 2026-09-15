-- 057_planes_y_suscripciones.sql
--
-- ENTORNO: correr en LOS DOS — primero la rama dev (vzqppwrwnmlbrxizskdh) y
-- después producción (rabmiyqodnvnrwiartuj).
--
-- Fase 1 de PLANES-Y-CUENTAS-PLAN.md: solo el esquema. **Ningún código lee
-- estas tablas todavía.** Se despliega sola, sin tocar la app, y el día que
-- /admin las use ya tendrán los datos migrados en vez de tener que rellenarlas
-- con la pantalla a medio hacer.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ TRES TABLAS Y NO UNA COLUMNA MÁS
--
-- Hoy todo esto es `owners.plan`, un text con check (plan in ('free','pro')).
--
-- 1. Los PLANES son datos, no código. Con un CHECK, cada plan nuevo es una
--    migración, un despliegue y un riesgo. Con una tabla, es una fila.
--
-- 2. QUÉ plan tiene y EN QUÉ estado está son dos cosas, y una sola columna
--    las confunde: una cuenta Pro bloqueada y una Free activa no son lo mismo,
--    y con `plan` solo no se distinguen. "Bloqueada" no puede ser un plan —
--    hay que seguir sabiendo qué era y cuánto pagaba para desbloquearla sin
--    volver a negociar.
--
-- 3. El HISTORIAL no es opcional en algo que cobra. El día que un tendero
--    diga "yo pagué y me bloqueaste", la respuesta no puede ser la memoria de
--    nadie.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LOS TRES PLANES, tal como se decidieron el 2026-09-15
--
--   demo   prueba del producto completo, X días negociados (2 meses por
--          defecto). Es un ESTADO, no un plan: se está probando 'pro'.
--   free   regalo deliberado a quien merece trato especial. Indefinido y
--          revocable. Nadie CAE aquí; se le DA.
--   pro    paga X cada X — mensual, trimestral o anual.

begin;

-- ── 1. El catálogo ──────────────────────────────────────────────────────
create table if not exists public.plans (
  code text primary key,
  nombre text not null,
  -- false = no se puede contratar de nuevo; quien ya lo tiene sigue igual.
  -- Es como se retira un plan sin tocar a nadie.
  activo boolean not null default true,
  -- De referencia. Lo que paga CADA negocio vive en su suscripción, porque el
  -- precio se negocia entre 15 y 30 USD y el catálogo es solo la plantilla.
  precio_usd numeric,
  -- jsonb y no columnas: cada límite nuevo sería otra migración. Se lee
  -- siempre con un valor por defecto, para que una llave que falte no tumbe
  -- nada.
  limites jsonb not null default '{}'::jsonb,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

-- Los límites de aquí reflejan lo que la app hace HOY, no lo que Pro va a
-- incluir el día que se decida — eso sigue en validación. `free` mantiene el
-- tope de 5 fotos al mes de FREE_PLAN_MONTHLY_IMPORT_LIMIT justamente para que
-- esta migración no cambie el comportamiento de nadie.
insert into public.plans (code, nombre, precio_usd, limites, orden)
values
  ('free', 'Free',  0, '{"fotos_al_mes": 5}'::jsonb,     1),
  ('pro',  'Pro',  20, '{"fotos_al_mes": null}'::jsonb,  2)
on conflict (code) do nothing;

-- ── 2. La suscripción de cada negocio ───────────────────────────────────
create table if not exists public.subscriptions (
  owner_id uuid primary key references public.owners (id) on delete cascade,
  plan_code text not null references public.plans (code),
  estado text not null default 'activa'
    check (estado in ('demo', 'activa', 'bloqueada', 'cancelada')),

  -- Cuándo termina la demo. Null si no está en demo. Se evalúa en
  -- America/Caracas, no en UTC: Vercel corre en UTC y allí el día cambia a las
  -- 8 de la noche de Caracas. Ya nos mordió con la tasa del BCV.
  demo_termina_el timestamptz,

  -- Hasta cuándo está pagada. Null en free y en demo.
  periodo_termina_el timestamptz,
  periodicidad text check (periodicidad in ('mensual', 'trimestral', 'anual')),

  -- COPIA de plans.limites y del precio al contratar, no una lectura del
  -- catálogo. Es grandfathering, y evita el peor escenario: el día que subas
  -- el precio de Pro o cambies un límite, quien ya pagaba no debe verse
  -- afectado a mitad de periodo. Si esto leyera el catálogo vivo, cambiar una
  -- fila le cambiaría las condiciones a todo el mundo, retroactivamente.
  limites jsonb not null default '{}'::jsonb,
  precio_pactado_usd numeric,

  notas text,

  -- Nacen vacías y sin usar. Son la respuesta a "a mano ahora, pasarela
  -- después": el hueco queda hecho, así que integrar Stripe o dLocal no
  -- obligará a migrar filas vivas. Cuestan tres columnas nulas.
  proveedor text,
  proveedor_cliente_id text,
  proveedor_suscripcion_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriptions_estado_idx on public.subscriptions (estado);
-- Para la lista de "demos por vencer" de /admin.
create index if not exists subscriptions_demo_termina_idx
  on public.subscriptions (demo_termina_el)
  where demo_termina_el is not null;

-- ── 3. El historial ─────────────────────────────────────────────────────
create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.owners (id) on delete cascade,
  ocurrido_el timestamptz not null default now(),
  -- Quién lo hizo. Texto y no una FK a auth.users: si algún día se borra esa
  -- cuenta, el historial de un cobro no puede quedarse sin autor.
  actor_email text,
  desde_estado text,
  hasta_estado text,
  desde_plan text,
  hasta_plan text,
  -- Obligatorio al bloquear. Que exista la columna no basta; lo exigirá la
  -- función que bloquea, en la Fase 2.
  motivo text,
  metodo_pago text,
  monto_usd numeric
);

create index if not exists subscription_events_owner_idx
  on public.subscription_events (owner_id, ocurrido_el desc);

-- ── 4. Cerradas a cal y canto ───────────────────────────────────────────
-- RLS activo y CERO políticas, igual que movement_rejections: nadie llega a
-- estas tablas directamente. Cuando la Fase 2 las lea, será por funciones
-- SECURITY DEFINER, que no necesitan grant de tabla — el patrón de la 039.
--
-- Sin políticas, `authenticated` no ve ni una fila aunque tenga el grant que
-- la 045 reparte sobre el esquema. Y no se le concede ninguno nuevo.
alter table public.plans enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_events enable row level security;

-- ── 5. owners.plan pasa a ser un espejo ─────────────────────────────────
-- LA PARTE QUE EVITA DOS VERDADES.
--
-- Durante las fases 1 y 2 hay dos sitios que dicen qué plan tiene un negocio:
-- `owners.plan`, que es lo que lee el límite de fotos hoy, y `subscriptions`,
-- que es lo nuevo. Dos fuentes para el mismo dato es como se separan.
--
-- En vez de migrar el código ahora, `subscriptions` manda y `owners.plan` se
-- vuelve una copia que se actualiza sola. Así el código de hoy sigue
-- funcionando sin tocarlo, y no existe un estado en el que discrepen.
--
-- Corre como el dueño de la función —postgres— así que el trigger de la 056
-- lo deja pasar: ese solo bloquea a `authenticated` y `anon`.
create or replace function public.subscriptions_refleja_plan_en_owners()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.owners
  set plan = new.plan_code
  where id = new.owner_id
    and plan is distinct from new.plan_code;
  return new;
end;
$$;

drop trigger if exists subscriptions_refleja_plan_en_owners on public.subscriptions;

create trigger subscriptions_refleja_plan_en_owners
  after insert or update of plan_code on public.subscriptions
  for each row
  execute function public.subscriptions_refleja_plan_en_owners();

comment on function public.subscriptions_refleja_plan_en_owners() is
  'Mantiene owners.plan como espejo de subscriptions.plan_code mientras el código siga leyendo la columna vieja. subscriptions es la fuente de la verdad; owners.plan es la copia.';

-- ── 6. Los negocios que ya existen ──────────────────────────────────────
-- NADIE PIERDE ACCESO. Cada negocio nace con el plan que ya tiene y en estado
-- 'activa': sin demo, sin fecha de vencimiento, sin bloqueo. Exactamente como
-- está trabajando hoy.
--
-- Son early adopters y no hay una respuesta única para todos — a algunos les
-- regalarás el producto, a otros les cobrarás tras su demo, a otros los
-- bloquearás. Eso se decide uno por uno desde /admin en la Fase 2, con nombre
-- y apellido y quedando en el historial. La migración no decide por ti.
insert into public.subscriptions (owner_id, plan_code, estado, limites, precio_pactado_usd)
select
  o.id,
  o.plan,
  'activa',
  coalesce(p.limites, '{}'::jsonb),
  p.precio_usd
from public.owners o
join public.plans p on p.code = o.plan
on conflict (owner_id) do nothing;

-- El `not exists` y no un `on conflict`: esta tabla no tiene clave única contra
-- la que chocar —un negocio puede tener veinte eventos— así que `on conflict do
-- nothing` no frenaría nada y repetir la migración inventaría historial
-- duplicado en la tabla que existe precisamente para ser la verdad de lo que
-- pasó.
insert into public.subscription_events (owner_id, hasta_estado, hasta_plan, motivo, actor_email)
select s.owner_id, 'activa', s.plan_code, 'Migración 057: estado inicial, sin cambio de acceso', 'sistema'
from public.subscriptions s
where not exists (
  select 1 from public.subscription_events e where e.owner_id = s.owner_id
);

insert into public.schema_migrations (key, description)
values (
  '057_planes_y_suscripciones',
  'Phase 1 of PLANES-Y-CUENTAS-PLAN.md — schema only, nothing reads it yet. plans (catalog: plans are data, not a CHECK constraint), subscriptions (separates WHICH plan from WHAT state, since "blocked" cannot be a plan) and subscription_events (audit trail, non-optional for anything that bills). Limits and price are COPIED into the subscription, not read from the catalog, so raising a price never changes terms retroactively. RLS on, zero policies, zero grants. owners.plan becomes a mirror kept in sync by a trigger, so there is never a moment where the old column and the new table disagree. Existing owners are backfilled as active on their current plan: nobody loses access.'
)
on conflict (key) do nothing;

commit;

-- ── verificación, después de correr lo de arriba ────────────────────────
--
-- 1. Cada negocio tiene su suscripción, y ninguno perdió su plan:
--
--   select count(*) as negocios,
--          count(s.owner_id) as con_suscripcion,
--          count(*) filter (where o.plan is distinct from s.plan_code) as discrepancias
--   from public.owners o
--   left join public.subscriptions s on s.owner_id = o.id;
--
--   ESPERADO: negocios = con_suscripcion, y discrepancias = 0.
--
-- 2. El espejo funciona (todo dentro de rollback, no cambia nada):
--
--   begin;
--   update public.subscriptions set plan_code = 'pro'
--   where owner_id = (select owner_id from public.subscriptions limit 1);
--
--   select o.plan as plan_en_owners, s.plan_code as plan_en_suscripcion
--   from public.owners o join public.subscriptions s on s.owner_id = o.id
--   where o.id = (select owner_id from public.subscriptions limit 1);
--   -- ESPERADO: los dos dicen 'pro'
--   rollback;
--
-- 3. Un dueño no ve nada de esto. Con su sesión, las tres tablas están vacías:
--
--   begin;
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<UUID>","role":"authenticated"}';
--   select count(*) as planes from public.plans;
--   select count(*) as suscripciones from public.subscriptions;
--   select count(*) as eventos from public.subscription_events;
--   rollback;
--   -- ESPERADO: 0, 0, 0 — RLS activo y cero políticas.
