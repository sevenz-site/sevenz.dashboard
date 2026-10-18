-- THE DOCUMENT'S TYPE: V / E / J in Venezuela, CC / CE / NIT in Colombia.
--
-- Asked for by the owner on 2026-10-18, with the new-client screen (frame
-- `1389:8313`): «se podrá seleccionar el tipo de documento entre V
-- (venezolano), E (extranjero) y J (jurídico), por defecto estará
-- seleccionado siempre V». Colombia getting its own three letters was his
-- call the same day, when asked.
--
-- ===========================================================================
-- THIS REVERSES A DECISION, AND BOTH REASONS BELONG ON THE RECORD
--
-- `lib/document-id.ts` says, in writing, that storing the letter was tried and
-- dropped on 2026-09-17 before it ever reached production:
--
--   «the prefix carried no information: every Venezuelan record got the same
--   letter, the country already lives in clients.document_country, and
--   normalizeDocumentId had to strip the letter again to compare two records»
--
-- That reasoning was right and still is -- FOR A LETTER THAT IS ALWAYS "V".
-- What changes today is that the letter is CHOSEN, and the three choices are
-- three different kinds of person: a J- is a company, an E- is a foreigner
-- living in the country. That is a real fact about who owes the money, and it
-- is the owner's to record. The old decision is not being overruled by taste;
-- its premise stopped holding.
--
-- ===========================================================================
-- ITS OWN COLUMN, NOT GLUED INTO document_id -- AND THIS IS THE PART THAT
-- WOULD HAVE BITTEN SILENTLY
--
-- Migration `033` protects against a duplicate client with a unique index on
--
--   (owner_id, regexp_replace(lower(document_id), '[^a-z0-9]', '', 'g'))
--
-- That normalisation keeps LETTERS. So writing "V-12345678" into document_id
-- gives the key `v12345678`, while the same person already stored as
-- "12345678" gives `12345678`. Two different keys: the index would raise no
-- objection, and the shopkeeper would end up with the same client twice, each
-- holding half of what he owes. Nothing would error, which is why this is
-- worth a paragraph.
--
-- With the type in its own column, `document_id` stays digits, the index keeps
-- comparing what it always compared, and an old record and a new one for the
-- same number still collide -- which is the behaviour anyone would expect.
--
-- The cost, stated: a cédula and a RIF that happen to share digits cannot both
-- exist for one owner. In Venezuela that can happen (V-12345678 and
-- J-12345678 are different holders). It is rare, it fails LOUDLY -- the
-- shopkeeper is told it is a duplicate -- and the alternative fails silently.
-- Noisy and wrong beats quiet and wrong.
alter table public.clients
  add column if not exists document_type text;

alter table public.clients
  drop constraint if exists clients_document_type_check;

-- THE SIX VALUES ARE ENGLISH-FREE ON PURPOSE: they are the letters printed on
-- the documents themselves, the same in both languages, and what the shopkeeper
-- picks in the selector is literally what is stored. A value stored in the
-- database outlives the code (CLAUDE.md), so it is the letters and not an
-- invented enum like 'natural' / 'foreign' / 'company' that would need a
-- translation table on every screen.
alter table public.clients
  add constraint clients_document_type_check check (
    document_type is null
    or document_type in ('V', 'E', 'J', 'CC', 'CE', 'NIT')
  );

comment on column public.clients.document_type is
  'Tipo de documento: V/E/J en Venezuela, CC/CE/NIT en Colombia. NULL = se guardo antes de que el selector existiera, o el pais del cliente no se sabe. Vive aparte de document_id a proposito: el indice unico de la migracion 033 normaliza conservando las letras, asi que meter la letra dentro del valor dejaria pasar el mismo documento dos veces.';

-- ── LOS QUE YA EXISTÍAN ────────────────────────────────────────────────
--
-- DECISIÓN DEL DUEÑO, 2026-10-18, preguntada antes de tocar ninguna fila:
-- marcar como 'V' a los clientes venezolanos que ya tienen documento.
--
-- No es una suposición sobre ellos: la pantalla **ya les enseñaba «V-»** al
-- lado de la caja a todos los clientes venezolanos desde que el campo existe,
-- así que V es literalmente lo que el tendero vio y quiso decir al teclear
-- esos números. Escribirlo ahora no inventa un dato, lo guarda.
--
-- QUIÉNES NO ENTRAN, y es parte de la misma decisión: los colombianos y los
-- que no tienen país se quedan en NULL. De los colombianos no sabemos si son
-- CC o NIT, y de los sin país no sabemos ni el juego de letras.
--
-- Y LOS QUE YA LLEVAN LETRA DENTRO de `document_id` tampoco: son los 9 que
-- `parseDocumentId` llama «legacy» y que la pantalla deja intactos a
-- propósito. Un «E-12345678» guardado así no es una V, y marcarlo como V sería
-- exactamente perder el dato real que esa rama existe para no perder.
--
-- `is distinct from` y no `is null`: es idempotente. Correrlo dos veces no
-- pisa un tipo que alguien haya cambiado a mano entre una vez y otra.
update public.clients
set document_type = 'V'
where document_country = 'VE'
  and document_id is not null
  and document_type is null
  and document_id !~ '[a-zA-Z]';

insert into public.schema_migrations (key, description)
values (
  '125_client_document_type',
  'clients.document_type (V/E/J en Venezuela, CC/CE/NIT en Colombia) para el selector de la pantalla de cliente nuevo. Columna aparte y NO dentro de document_id: el indice unico de la 033 normaliza conservando letras, asi que V-12345678 y 12345678 serian claves distintas y el mismo cliente podria entrar dos veces sin que nada fallara. Incluye backfill a V de los clientes venezolanos con documento solo numerico, decidido por el dueno: la pantalla ya les enseniaba V- al lado de la caja, asi que es lo que quiso decir quien los tecleo. Los colombianos, los que no tienen pais y los 9 que ya llevan letra dentro del valor se quedan en NULL.'
)
on conflict (key) do nothing;
