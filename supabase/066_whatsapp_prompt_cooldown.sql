-- 066_whatsapp_prompt_cooldown.sql
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the code that uses it is
-- ready to deploy and the user has said to launch.
--
-- Cuándo se le preguntó a un dueño si quiere los avisos por WhatsApp, y
-- cuántas veces. Es lo que convierte "volver a preguntar" en algo acotado y
-- comprobable en vez de una molestia.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ ESTO VIVE EN EL SERVIDOR Y NO EN EL NAVEGADOR
--
-- Es la regla del iPhone de CLAUDE.md, y aquí muerde de una forma concreta:
-- iOS Safari borra `localStorage` tras un periodo de inactividad. Un contador
-- guardado ahí vuelve a cero solo, y el dueño recibe el diálogo otra vez como
-- si fuera la primera — que es exactamente lo invasivo que se quiere evitar.
--
-- El precedente está en casa: `lib/install-prompt.ts` guarda su descarte en
-- `sessionStorage` y su propio comentario admite que si se pierde "vuelve a
-- salir. Molesto, no roto." Para un banner vale. Para algo que pide un
-- consentimiento y que solo se puede preguntar tres veces, no.
--
-- ─────────────────────────────────────────────────────────────────────────
-- DÍAS, NO ACCESOS
--
-- La idea original era preguntar "cada X veces que entre". Un tendero abre
-- Sevenz veinte veces al día: cada 5 accesos serían cuatro diálogos diarios.
-- El acceso no mide tiempo. Por eso se guarda una fecha y la espera se cuenta
-- en días — 14 tras el primer "ahora no", 45 tras el segundo, y a la tercera
-- no se pregunta más. La lógica vive en lib/whatsapp-opt-in.ts; aquí solo los
-- dos datos que necesita.

begin;

alter table public.owners
  -- Cuándo se le enseñó el diálogo por última vez. `null` = nunca.
  add column if not exists whatsapp_prompt_last_at timestamptz,
  -- Cuántas veces se le ha enseñado. Al llegar al tope no se pregunta más y el
  -- interruptor de Mi negocio queda como el único camino, que es lo correcto:
  -- quien dijo que no tres veces ya contestó.
  add column if not exists whatsapp_prompt_count int not null default 0;

-- Sin política nueva: `owners` ya está acotada a `id = auth.uid()` para select
-- y update, así que el dueño solo lee y escribe su propia fila.

insert into public.schema_migrations (key, description)
values (
  '066_whatsapp_prompt_cooldown',
  'owners.whatsapp_prompt_last_at y whatsapp_prompt_count: cuando se le pregunto a un dueno si quiere los avisos por WhatsApp y cuantas veces. Vive en el servidor y no en el navegador por la regla del iPhone — iOS Safari borra localStorage tras un periodo de inactividad, el contador volveria a cero solo y el dialogo reapareceria como si fuera la primera vez, que es justo lo invasivo que se quiere evitar. Y se cuentan DIAS y no accesos: un tendero abre la app veinte veces al dia, asi que "cada 5 accesos" serian cuatro dialogos diarios. La cadencia (14 dias tras el primer no, 45 tras el segundo, y a la tercera nunca mas) vive en lib/whatsapp-opt-in.ts.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. Nadie arranca con preguntas hechas:
--
--   select count(*) filter (where whatsapp_prompt_count <> 0) as con_preguntas,
--          count(*) filter (where whatsapp_prompt_last_at is not null) as con_fecha,
--          count(*) as total
--   from public.owners;
--   -- EXPECTED: con_preguntas = 0 y con_fecha = 0.
