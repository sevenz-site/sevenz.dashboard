-- 050_movement_rejections.sql
--
-- Deja rastro de los movimientos que NO se escribieron.
--
-- El 2026-09-11 resolveMovementRateSnapshot dejó de adivinar la moneda: si el
-- negocio es venezolano y no llega moneda, o si no se puede leer el país del
-- dueño, el movimiento se rechaza en vez de archivarse en el libro que no es.
--
-- El cambio es correcto y tiene un precio que conviene decir en voz alta: antes
-- un fallo dejaba una fila torcida en movements —fea, pero buscable, y por eso
-- pudimos auditar ambos entornos y confirmar cero casos—. Un rechazo no deja
-- nada. El dueño lo ve; nosotros no. Cambiamos un fallo silencioso y rastreable
-- por uno visible y ciego.
--
-- Esta tabla cierra esa ceguera. Sin ella no hay forma de saber si esto ocurre
-- una vez al año o diez veces al día, y "diez veces al día" significa dueños
-- que no pueden registrar sus ventas mientras nosotros creemos que todo va bien.
--
-- Guarda cliente y monto por decisión explícita del 2026-09-11: permite llamar
-- al dueño y devolverle el dato exacto que no pudo registrar. A cambio, la
-- tabla contiene información de deudas fuera de las tablas de su dueño, así que
-- nadie la lee salvo /admin. Queda pendiente decidir un borrado periódico.

begin;

create table if not exists public.movement_rejections (
  id uuid primary key default gen_random_uuid(),
  -- A auth.users y no a owners: el motivo 'pais_desconocido' es justamente que
  -- no se pudo leer la fila de owners, y una FK contra ella podría impedir
  -- anotar el caso que más nos interesa.
  owner_id uuid not null references auth.users (id) on delete cascade,
  -- Lista cerrada: un motivo que no esté aquí es un rechazo nuevo que nadie
  -- diseñó, y preferimos que la escritura falle a que se cuente como "otro".
  reason text not null check (reason in ('ve_sin_moneda', 'pais_desconocido')),
  source text not null check (source in ('movimiento', 'cliente_nuevo', 'import')),
  -- Null cuando el cliente todavía no existía (alta con primer movimiento) o
  -- cuando la tanda del import traía varios.
  client_id uuid references public.clients (id) on delete set null,
  amount numeric,
  -- Lo que mandó el formulario. Por definición null en 've_sin_moneda'; en
  -- 'pais_desconocido' puede traer moneda y aun así rechazarse.
  attempted_currency text check (attempted_currency in ('USD', 'EUR')),
  -- Cuántas filas se perdieron. 1 en las altas manuales; la tanda entera en el
  -- import, que es donde un rechazo cuesta de verdad — ahí ya se gastó la
  -- extracción de la foto y la revisión línea por línea.
  rows_affected integer not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists movement_rejections_created_at_idx
  on public.movement_rejections (created_at desc);
create index if not exists movement_rejections_owner_idx
  on public.movement_rejections (owner_id);

-- RLS activo y sin políticas, a propósito: nadie llega a esta tabla
-- directamente. Se escribe por la función de abajo y se lee por /admin, las dos
-- SECURITY DEFINER. Una tabla sin política no es una tabla olvidada aquí — es
-- la forma de que no haga falta ningún grant sobre ella.
alter table public.movement_rejections enable row level security;

-- ── Escritura ───────────────────────────────────────────────────────────
-- SECURITY DEFINER en vez de un grant de insert a authenticated: así el dueño
-- no puede escribir en esta tabla por su cuenta, y owner_id no se acepta como
-- parámetro sino que se toma de la sesión. Una anotación de telemetría que
-- pudiera falsearse no vale para nada.
create or replace function public.record_movement_rejection(
  p_reason             text,
  p_source             text,
  p_client_id          uuid default null,
  p_amount             numeric default null,
  p_attempted_currency text default null,
  p_rows_affected      integer default 1
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  insert into public.movement_rejections (
    owner_id, reason, source, client_id, amount, attempted_currency, rows_affected
  )
  values (
    auth.uid(), p_reason, p_source, p_client_id, p_amount, p_attempted_currency,
    coalesce(p_rows_affected, 1)
  );
end;
$$;

-- ── Lectura desde /admin ────────────────────────────────────────────────
-- Los mismos cuatro filtros que el resto de admin_metrics_*, con null o array
-- vacío queriendo decir "sin filtrar".
--
-- movements_without_rate no sale de esta tabla: es un movimiento que SÍ se
-- escribió, con su moneda correcta, pero sin tasa sellada porque el BCV no
-- respondió. Se decidió permitirlo —bloquear un fiado por no poder sellar una
-- tasa convertiría una caída pasajera del proveedor en una caja que no puede
-- vender—, y por eso mismo hay que vigilarlo: si sube, muchos movimientos se
-- están guardando sin respaldo de tasa. Se deduce de movements, sin anotar nada.
create or replace function public.admin_metrics_health(
  p_country text default null,
  p_owners  uuid[] default null,
  p_from    timestamptz default null,
  p_to      timestamptz default null
)
returns table (
  rejections_total            bigint,
  rejections_sin_moneda       bigint,
  rejections_pais_desconocido bigint,
  rejected_rows               bigint,
  movements_without_rate      bigint
)
language sql
security definer
set search_path = public
as $$
  with rechazos as (
    select r.*
      from public.movement_rejections r
      -- left join: un rechazo por 'pais_desconocido' puede no tener fila legible
      -- en owners, y perderlo por el join seria perder justo el caso raro.
      left join public.owners o on o.id = r.owner_id
     where (p_country is null or o.country = p_country)
       and (p_owners  is null or cardinality(p_owners) = 0 or r.owner_id = any(p_owners))
       and (p_from    is null or r.created_at >= p_from)
       and (p_to      is null or r.created_at <  p_to)
  )
  select
    (select count(*) from rechazos),
    (select count(*) from rechazos where reason = 've_sin_moneda'),
    (select count(*) from rechazos where reason = 'pais_desconocido'),
    (select coalesce(sum(rows_affected), 0) from rechazos),
    (select count(*)
       from public.movements m
       join public.clients c on c.id = m.client_id
       join public.owners  o on o.id = c.owner_id
      where m.currency is not null
        and m.exchange_rate_used is null
        and m.deleted_at is null
        and (p_country is null or o.country = p_country)
        and (p_owners  is null or cardinality(p_owners) = 0 or o.id = any(p_owners))
        and (p_from    is null or m.created_at >= p_from)
        and (p_to      is null or m.created_at <  p_to));
$$;

revoke execute on function public.record_movement_rejection(text, text, uuid, numeric, text, integer) from public, anon;
grant execute on function public.record_movement_rejection(text, text, uuid, numeric, text, integer) to authenticated;

revoke execute on function public.admin_metrics_health(text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_metrics_health(text, uuid[], timestamptz, timestamptz) to service_role;

insert into public.schema_migrations (key, description)
values (
  '050_movement_rejections',
  'Records movements that were refused rather than written (VE owner with no currency, unreadable owner row), so the rejections the currency guard introduced stop being invisible to us. Plus admin_metrics_health(), which also counts movements written without a stamped BCV rate.'
)
on conflict (key) do nothing;

commit;

-- ── verificación, después de correr lo de arriba ────────────────────────
--   select count(*) from public.movement_rejections;              -- 0 al empezar
--   select * from public.admin_metrics_health();                  -- una fila de ceros
--
-- Y que la tabla no sea accesible directamente por un dueño:
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' and tablename = 'movement_rejections';   -- t
--   select count(*) from pg_policies
--    where schemaname = 'public' and tablename = 'movement_rejections';   -- 0
