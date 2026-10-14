-- 093_client_consent_asked.sql
--
-- ENVIRONMENT: run on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run against
-- production (rabmiyqodnvnrwiartuj) until the user says to launch. Production
-- has none of 081, 082, 091, 092 either; the order is 081, 082, 091, 092, 093.
--
-- ===========================================================================
-- "WE ALREADY ASKED ABOUT THIS PERSON" -- ONCE PER CLIENT, NOT PER MOVEMENT
--
-- MS-34. The consent checkbox sits above "Guardar fiado/abono", off by
-- default, and saving without ticking it opens a dialog that puts the same
-- checkbox in front of the shopkeeper one more time. The extra friction is the
-- point: it is what makes "they read it" true rather than hoped for.
--
-- THE FRICTION IS PAID ONCE PER CLIENT. Decision by the owner on 2026-10-10,
-- over the original proposal of showing it on every movement. Doña Rosa
-- registers fifteen fiados on a Saturday; by the fifth dialog she is tapping
-- "finish" from muscle memory, which is EXACTLY the failure the dialog exists
-- to prevent, moved one step along -- and in the meantime it taxes her every
-- day for nothing.
--
-- WHY THIS IS A COLUMN AND NOT localStorage. iOS Safari erases local storage
-- after a period of inactivity, so a "do not ask again" kept there comes back
-- as "never asked" weeks later, and the shopkeeper is back to a dialog per
-- movement with no way to explain it. The same reasoning already decided the
-- client's own modal in MS-25: anything that has to be remembered is
-- remembered by the server.
--
-- WHY ON `clients` AND NOT IN `client_whatsapp_consents`. That table is
-- EVIDENCE, keyed by phone number, append-only, and shared across every shop
-- the person buys from. "This shopkeeper has been asked about this client" is
-- none of those things: it is one shop's interface state, it is about a client
-- row rather than a person, and it proves nothing to anybody. Putting it in
-- the ledger would mean a row that is not a consent event sitting in a table
-- whose rows are read as consent events.
--
-- WHAT THIS DELIBERATELY DOES NOT DO: it does not come back when the client's
-- phone number is edited. Editing the number expires the consent (081), so
-- such a client ends up with no permission and no prompt, and only the ficha
-- (MS-35) can switch it back on. That is a known, accepted gap rather than an
-- oversight -- re-prompting would need this column to track WHICH number was
-- asked about, and nobody has yet seen the case happen. Written down because a
-- gap nobody recorded is indistinguishable from a bug.
-- ===========================================================================

begin;

alter table public.clients
  add column if not exists whatsapp_consent_asked_at timestamptz;

comment on column public.clients.whatsapp_consent_asked_at is
  'When this shop was last shown the WhatsApp consent prompt for this client. Null means never asked, which is what makes the prompt appear. Interface state, not evidence -- the evidence is client_whatsapp_consents, keyed by phone. Does not reset when the phone number changes (see 093).';

insert into public.schema_migrations (key, description)
values (
  '093_client_consent_asked',
  'MS-34: clients gana whatsapp_consent_asked_at, para que el modal del permiso salga UNA VEZ POR CLIENTE y no una vez por movimiento. Decision del dueno el 2026-10-10 sobre la propuesta original: quince fiados un sabado son quince modales, y al quinto se pulsa finalizar de memoria -- que es el mismo fallo que el modal existe para evitar, movido un paso, y encima cobrando friccion todos los dias. Es una columna y no localStorage porque iOS Safari lo borra tras un tiempo inactivo y el "no preguntes mas" volveria como "nunca se pregunto", misma razon que decidio el modal del cliente en MS-25. Y va en clients y no en client_whatsapp_consents porque esa tabla es EVIDENCIA, con clave de telefono, append-only y compartida entre todas las bodegas: "a este tendero ya se le pregunto por este cliente" no es ninguna de esas cosas, y meterlo ahi seria una fila que no es un consentimiento en una tabla cuyas filas se leen como consentimientos. Hueco conocido y aceptado: NO vuelve a preguntar si se edita el telefono, aunque eso caduque el permiso; esos clientes se arreglan desde la ficha (MS-35).'
)
on conflict (key) do nothing;

commit;
