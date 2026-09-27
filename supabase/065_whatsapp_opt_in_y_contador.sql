-- 065_whatsapp_opt_in_y_contador.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the code that uses it is
-- ready to deploy and the user has said to launch.
--
-- Los dos cimientos de la fase 2 de WhatsApp, antes de que exista el envío: el
-- consentimiento del dueño, y el contador que impide mandar de más.
--
-- Contexto: ../docs/WHATSAPP-PLAN.md y ../docs/WHATSAPP-PLANTILLAS.md (repo
-- privado). Pendientes MS-2 y MS-8.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 1. EL OPT-IN, Y POR QUÉ SE GUARDA EL TEXTO CON LA FECHA
--
-- Meta exige recoger el consentimiento fuera de WhatsApp y poder demostrarlo
-- si el número empieza a recibir reportes. Una marca de tiempo sola no es
-- evidencia: la frase de la pantalla va a cambiar, y dentro de un año lo que
-- hay que poder enseñar es lo que ESA persona leyó, no lo que diga la pantalla
-- entonces. Por eso la frase exacta se guarda junto a la fecha.
--
-- Nada de esto es un booleano. `whatsapp_opt_in_at is null` significa "no ha
-- aceptado", y es el valor de todos los dueños existentes — nadie queda dado
-- de alta por una migración.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 2. EL CONTADOR, Y EL ÍNDICE QUE IMPORTA
--
-- `whatsapp_sends` registra lo que mandamos NOSOTROS, nunca lo que diga el
-- panel de un tercero. Misma regla que con los 500 créditos de Didit: un
-- contador que no es tuyo es un número sobre el que no puedes actuar.
--
-- El índice único sobre (owner_id, template, period_key) no es contabilidad:
-- es el freno. Un cron disparado diez veces una noche mandaría si no diez
-- copias del mismo resumen semanal a cada dueño y quemaría el cupo del mes
-- antes del desayuno. Con el índice, los intentos 2 al 10 no escriben ni
-- envían, porque la fila se inserta ANTES de llamar a Kapso y un conflicto
-- significa "ya se mandó".
--
-- `period_key` es lo que hace idempotente a un envío: '2026-W39' para una
-- plantilla semanal. Es texto y no una fecha a propósito — una diaria usaría
-- '2026-09-22' y una por evento (fase 3) el id del movimiento, las tres en la
-- misma columna y con la misma garantía.
--
-- NOTA: la migración 067 convierte este índice en PARCIAL, para que una fila
-- marcada como fallida libere el turno y el siguiente intento pueda salir.

begin;

-- ── el consentimiento del dueño ──────────────────────────────────────────

alter table public.owners
  add column if not exists whatsapp_opt_in_at timestamptz,
  -- La frase que el dueño leyó al aceptar. Se conserva aunque luego se dé de
  -- baja: la evidencia es que el consentimiento existió ese día, y borrarla
  -- eliminaría la única prueba que hay.
  add column if not exists whatsapp_opt_in_text text,
  -- Se escribe al apagarlo. Tener las dos fechas hace que la fila cuente la
  -- historia entera —aceptó, luego se dio de baja— en vez de volver a
  -- parecerse en silencio a alguien que nunca aceptó.
  add column if not exists whatsapp_opt_out_at timestamptz;

-- Sin política nueva: `owners` ya acota select y update a `id = auth.uid()`,
-- así que el dueño lee y cambia su propio interruptor y el de nadie más.
-- Añadir columnas a una tabla ya acotada no necesita nada más.

-- ── el contador ──────────────────────────────────────────────────────────

create table if not exists public.whatsapp_sends (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE CASCADE: si el dueño ya no está no hay nada que limitar, y la
  -- fila no tiene valor por sí sola.
  owner_id uuid not null references public.owners (id) on delete cascade,

  -- El nombre de la plantilla en Meta, tal como quedó aprobada:
  -- 'cartera_summary', 'cartera_attention'. No es un enum — una plantilla
  -- nueva no debería necesitar una migración antes de poder contarse.
  template text not null,

  -- Lo que hace único a un envío dentro de su plantilla. Ver la nota de
  -- arriba.
  period_key text not null,

  sent_at timestamptz not null default now(),

  -- Si Kapso lo aceptó. Se escribe después de la llamada, sobre la fila que ya
  -- se insertó antes. `null` es una reserva que todavía no ha reportado.
  ok boolean,

  -- El id de mensaje de Kapso cuando funcionó, su error cuando no. Nunca sale
  -- a una respuesta HTTP — es la regla de enmascarar errores de CLAUDE.md.
  provider_message_id text,
  error text
);

-- EL FRENO. Todo lo de arriba es contabilidad; esta línea es la garantía.
create unique index if not exists whatsapp_sends_idempotency_idx
  on public.whatsapp_sends (owner_id, template, period_key);

-- Leer el total del mes es la consulta caliente: "cuántos llevamos desde el
-- día 1", contra el cupo de Kapso.
create index if not exists whatsapp_sends_sent_at_idx
  on public.whatsapp_sends (sent_at);

alter table public.whatsapp_sends enable row level security;

-- RLS encendida, CERO políticas, y sin grants a anon ni a authenticated. Misma
-- forma que movement_rejections: esta tabla la escribe y la lee solo el
-- servidor. Un dueño no tiene nada que hacer leyendo nuestro registro de
-- envíos, y una política que se lo permitiera sería una puerta donde ahora hay
-- un muro.
--
-- Y por eso el acceso va por funciones SECURITY DEFINER (migración 067) y no
-- por lectura directa con la clave de servicio: `npm run qa:service-role`
-- falla ante eso, porque producción revoca SELECT a `service_role` sobre las
-- tablas de clientes y el branch dev no — una lectura directa pasaría en dev y
-- daría 500 en producción. Es la caída del 2026-09-05.

insert into public.schema_migrations (key, description)
values (
  '065_whatsapp_opt_in_y_contador',
  'Los dos cimientos de la fase 2 de WhatsApp, antes de que exista el envio. owners gana whatsapp_opt_in_at, whatsapp_opt_in_text y whatsapp_opt_out_at: Meta exige recoger el consentimiento fuera de WhatsApp y poder evidenciarlo, y una marca de tiempo sola no es evidencia porque el texto de la pantalla cambia — se guarda la frase que esa persona leyo. Nadie queda aceptado por la migracion: null es "no acepta". Y whatsapp_sends con indice UNICO en (owner_id, template, period_key), que no es contabilidad sino el freno: un cron disparado diez veces una noche mandaria diez copias del mismo resumen semanal a cada dueno y quemaria el cupo del mes, y con el indice los intentos 2 al 10 no escriben ni envian. RLS encendida, cero politicas y sin grants, como movement_rejections: la tabla la escribe solo el servidor desde el unico punto de salida.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. Nadie quedó dado de alta por la migración:
--
--   select count(*) filter (where whatsapp_opt_in_at is not null) as aceptaron,
--          count(*) as total
--   from public.owners;
--   -- EXPECTED: aceptaron = 0.
--
-- 2. El freno frena de verdad. Es la razón de ser de la migración, así que se
--    prueba en vez de darse por buena — con cualquier uuid de dueño real:
--
--   begin;
--   insert into public.whatsapp_sends (owner_id, template, period_key)
--   values ('<owner-uuid>', 'cartera_summary', '2026-W39');
--   insert into public.whatsapp_sends (owner_id, template, period_key)
--   values ('<owner-uuid>', 'cartera_summary', '2026-W39');
--   rollback;
--   -- EXPECTED: el segundo insert falla con 23505 unique_violation. Si pasa,
--   -- el índice no está y un cron en bucle puede vaciar el mes.
--
-- 3. La tabla es inalcanzable desde una sesión:
--
--   select count(*) from pg_policies
--   where schemaname = 'public' and tablename = 'whatsapp_sends';
--   -- EXPECTED: 0.
--
--   select has_table_privilege('authenticated', 'public.whatsapp_sends', 'select');
--   -- EXPECTED: false.
