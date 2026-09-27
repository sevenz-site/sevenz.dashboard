-- EL LATIDO DEL CRON DE WHATSAPP
--
-- POR QUÉ EXISTE ESTA TABLA, Y POR QUÉ `whatsapp_sends` NO BASTA.
--
-- `whatsapp_sends` gana una fila cuando se RESERVA un envío. Eso significa que
-- una tanda sin destinatarios no escribe nada — y que un cron que dejó de
-- dispararse tampoco escribe nada. Las dos situaciones son indistinguibles
-- desde la base:
--
--     el cron corrió y nadie tenía los avisos activos  ->  0 filas
--     el cron lleva tres semanas sin dispararse        ->  0 filas
--
-- Un panel que cuente envíos enseñaría "0" en los dos casos y parecería
-- tranquilo. Y la segunda es la que va a pasar: los crons de Vercel Hobby son
-- de mejor esfuerzo, así que si uno deja de correr nadie se entera hasta que
-- un dueño dice "hace semanas que no me llega nada".
--
-- Lo que hay que vigilar es el LATIDO, no el resultado. Esta tabla registra
-- una fila POR EJECUCIÓN, siempre, aunque el resultado sea cero.
--
-- LA CUENTA QUE IMPORTA NO ES "cuántos se enviaron" SINO "cuánto hace de la
-- última corrida". Esa es la única que distingue el silencio legítimo del
-- silencio roto.

begin;

-- ── la tabla ────────────────────────────────────────────────────────────
--
-- `resultado` es jsonb y no columnas sueltas a propósito: hoy la tanda son dos
-- plantillas, y `cartera_pausada` (MS-18) va a ser una tercera en cuanto Meta
-- la apruebe. Con columnas, cada plantilla nueva sería una migración más solo
-- para poder contarla. La tarjeta de /admin lee lo que necesita y lo que no
-- entiende no le estorba.
create table if not exists public.whatsapp_cron_runs (
  id uuid primary key default gen_random_uuid(),
  ran_at timestamptz not null default now(),
  -- Día ISO en hora de Colombia (1 lunes … 7 domingo), el mismo que decide si
  -- `cartera_attention` sale. Se guarda para poder explicar un "0 enviados"
  -- sin tener que recalcular la fecha: el lunes ese cero es correcto.
  dia_iso smallint not null,
  -- { "resumen": {periodo, destinatarios, enviados, omitidos, fallidos},
  --   "atencion": {...} | null }
  resultado jsonb not null,
  -- La tanda entera reventó. Nulo cuando terminó, aunque terminara con fallos
  -- dentro: eso vive en los contadores.
  error text
);

-- Una consulta, siempre la misma: la última corrida y las de esta semana.
create index if not exists whatsapp_cron_runs_ran_at_idx
  on public.whatsapp_cron_runs (ran_at desc);

-- RLS encendida, CERO políticas y sin grants, igual que `whatsapp_sends` y
-- `movement_rejections`. La tabla la escribe y la lee el servidor, y solo a
-- través de las dos funciones de abajo. Sin política, nadie con sesión la
-- alcanza — ni para leer.
alter table public.whatsapp_cron_runs enable row level security;

-- ── escribir el latido ──────────────────────────────────────────────────
--
-- La llama la ruta del cron al terminar, pase lo que pase. NO va dentro de la
-- transacción de los envíos: si la tanda falla a la mitad, el latido tiene que
-- quedar igual, porque "corrió y reventó" es información distinta de "no
-- corrió".
create or replace function public.whatsapp_cron_run_registrar(
  p_dia_iso smallint,
  p_resultado jsonb,
  p_error text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.whatsapp_cron_runs (dia_iso, resultado, error)
  values (p_dia_iso, coalesce(p_resultado, '{}'::jsonb), p_error)
  returning id into v_id;
  return v_id;
end;
$$;

-- ── leerlo desde /admin ─────────────────────────────────────────────────
--
-- Una función y no una lectura directa de la tabla: producción REVOCA el
-- SELECT a `service_role` sobre las tablas de clientes, y esa asimetría con
-- dev ya tiró /admin una vez (ver 039). Una SECURITY DEFINER no necesita
-- grant sobre la tabla, así que no puede volver a pasar. `npm run qa:service-role`
-- vigila que nadie lo haga por el otro camino.
--
-- Devuelve UNA fila. `horas_desde_ultima` es el número que decide el color de
-- la tarjeta: por encima de 26 h, algo dejó de correr.
create or replace function public.admin_whatsapp_cron_salud()
returns table (
  ultima_ran_at timestamptz,
  horas_desde_ultima numeric,
  ultimo_dia_iso smallint,
  ultimo_resultado jsonb,
  ultimo_error text,
  corridas_7d int,
  corridas_con_error_7d int,
  enviados_7d int,
  fallidos_7d int
)
language sql
stable
security definer
set search_path = public
as $$
  with ultima as (
    select * from public.whatsapp_cron_runs order by ran_at desc limit 1
  ),
  semana as (
    select
      count(*)::int as corridas,
      count(*) filter (where error is not null)::int as con_error,
      -- Los contadores viven en el jsonb de cada corrida. `coalesce` porque
      -- `atencion` es null los días en que no toca, y sumar null lo anula todo.
      coalesce(sum(
        coalesce((resultado -> 'resumen' ->> 'enviados')::int, 0)
        + coalesce((resultado -> 'atencion' ->> 'enviados')::int, 0)
      ), 0)::int as enviados,
      coalesce(sum(
        coalesce((resultado -> 'resumen' ->> 'fallidos')::int, 0)
        + coalesce((resultado -> 'atencion' ->> 'fallidos')::int, 0)
      ), 0)::int as fallidos
    from public.whatsapp_cron_runs
    where ran_at >= now() - interval '7 days'
  )
  select
    u.ran_at,
    round(extract(epoch from (now() - u.ran_at)) / 3600.0, 1),
    u.dia_iso,
    u.resultado,
    u.error,
    s.corridas,
    s.con_error,
    s.enviados,
    s.fallidos
  from semana s
  left join ultima u on true;
$$;

-- Los tres por nombre, como manda la 039: `revoke ... from public` a secas deja
-- a `anon` y `authenticated` con lo suyo intacto.
revoke execute on function public.whatsapp_cron_run_registrar(smallint, jsonb, text) from public, anon, authenticated;
revoke execute on function public.admin_whatsapp_cron_salud() from public, anon, authenticated;

-- Solo `service_role`. El latido lo escribe el cron y lo lee /admin, que corre
-- con el cliente de servicio detrás de `requireSuperadmin()`. Un dueño con
-- sesión no tiene nada que hacer aquí.
grant execute on function public.whatsapp_cron_run_registrar(smallint, jsonb, text) to service_role;
grant execute on function public.admin_whatsapp_cron_salud() to service_role;

insert into public.schema_migrations (key, description)
values (
  '071_whatsapp_cron_latido',
  'whatsapp_cron_runs: una fila por ejecucion del cron de WhatsApp, siempre, aunque no haya destinatarios. Existe porque whatsapp_sends solo escribe cuando se reserva un envio, asi que una tanda vacia y un cron que dejo de dispararse son indistinguibles desde la base -- y la segunda es la que pasa, porque los crons de Vercel Hobby son de mejor esfuerzo. La cuenta que importa no es cuantos se enviaron sino cuanto hace de la ultima corrida. RLS encendida, cero politicas, sin grants: se escribe con whatsapp_cron_run_registrar() y se lee con admin_whatsapp_cron_salud(), las dos SECURITY DEFINER y solo para service_role, que ademas evita depender de un grant de SELECT que produccion revoca y dev no (ver 039).'
)
on conflict (key) do nothing;

commit;
