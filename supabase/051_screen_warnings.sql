-- 051_screen_warnings.sql
--
-- Cuenta también las veces que el aviso "No pudimos cargar los datos de tu
-- negocio" aparece EN PANTALLA, no solo los movimientos rechazados al guardar.
--
-- Por qué hace falta. La 050 dejó un hueco que se vio al repasar los riesgos
-- del lanzamiento: anotamos el rechazo cuando el dueño pulsa Guardar, pero el
-- aviso que le tapa la pantalla antes de llegar ahí no se anotaba en ningún
-- sitio. Y ese es justamente el número que decide si el reintento que añade
-- este mismo release hace falta o no. Sin él estaríamos adivinando otra vez,
-- que es de lo que trata todo este trabajo.
--
-- Importa sobre todo para los negocios colombianos. Hasta ahora, cuando la app
-- no lograba leer el país, asumía Colombia — y para un dueño colombiano eso
-- acertaba siempre. Al quitar esa suposición le cambiamos un acierto por
-- casualidad por una interrupción visible. Si este contador se queda en cero,
-- el cambio le salió gratis; si sube, le estamos cobrando algo a cambio de
-- nada y hay que devolvérselo.
--
-- Va en la misma tabla y no en una nueva porque es el mismo hecho — no se
-- pudieron leer los datos del negocio — visto en otro momento. Lo que cambia
-- es el 'source', y por eso los dos números se cuentan por separado en
-- admin_metrics_health: un aviso en pantalla no es una venta perdida, es un
-- susto; un rechazo al guardar sí es un fiado que no entró.

begin;

alter table public.movement_rejections
  drop constraint if exists movement_rejections_source_check;

alter table public.movement_rejections
  add constraint movement_rejections_source_check
  check (source in ('movimiento', 'cliente_nuevo', 'import', 'pantalla'));

-- drop + create, no create or replace: la función gana una columna y Postgres
-- no deja cambiar la forma de un `returns table` sobre la marcha. Se nombra la
-- firma completa porque es lo único que identifica a una función, y omitirlo
-- deja la vieja viva junto a la nueva.
drop function if exists public.admin_metrics_health(text, uuid[], timestamptz, timestamptz);

create function public.admin_metrics_health(
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
  movements_without_rate      bigint,
  screen_warnings             bigint
)
language sql
security definer
set search_path = public
as $$
  with anotaciones as (
    select r.*
      from public.movement_rejections r
      -- left join: un rechazo por 'pais_desconocido' puede no tener fila legible
      -- en owners, y perderlo por el join seria perder justo el caso raro.
      left join public.owners o on o.id = r.owner_id
     where (p_country is null or o.country = p_country)
       and (p_owners  is null or cardinality(p_owners) = 0 or r.owner_id = any(p_owners))
       and (p_from    is null or r.created_at >= p_from)
       and (p_to      is null or r.created_at <  p_to)
  ),
  -- Los tres origenes de escritura. 'pantalla' queda fuera a proposito: no es
  -- un fiado que no entro, es un aviso que el dueño vio.
  rechazos as (
    select * from anotaciones where source in ('movimiento', 'cliente_nuevo', 'import')
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
        and (p_to      is null or m.created_at <  p_to)),
    (select count(*) from anotaciones where source = 'pantalla');
$$;

revoke execute on function public.admin_metrics_health(text, uuid[], timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_metrics_health(text, uuid[], timestamptz, timestamptz) to service_role;

insert into public.schema_migrations (key, description)
values (
  '051_screen_warnings',
  'Adds the ''pantalla'' source to movement_rejections and a screen_warnings counter to admin_metrics_health, so the blocking "no pudimos cargar los datos de tu negocio" dialog is counted too — until now only write-time rejections were. Counted separately: a screen warning is a scare, a rejection is a fiado that never happened.'
)
on conflict (key) do nothing;

commit;

-- ── verificación, después de correr lo de arriba ────────────────────────
--   select * from public.admin_metrics_health();   -- ahora con screen_warnings
--
--   select pg_get_constraintdef(oid)
--   from pg_constraint
--   where conname = 'movement_rejections_source_check';   -- debe incluir 'pantalla'
