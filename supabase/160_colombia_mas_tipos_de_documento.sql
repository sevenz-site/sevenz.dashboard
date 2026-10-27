-- ═══════════════════════════════════════════════════════════════════════
-- COLOMBIA: CUATRO LETRAS MÁS, Y LOS OCHO QUE SE QUEDARON SIN NINGUNA
-- ═══════════════════════════════════════════════════════════════════════
--
-- Asked for by the owner on 2026-10-26, after reading the production count:
-- *«Pongámosle a SIN letra - Colombiano = CC»*, and for the picker,
-- *«creémoslo con las opciones CC, CE, TI, PAS, PEP y PPT»*.
--
-- WHY THESE FOUR AND NOT ANY FOUR. They are what people actually hand over
-- in a Colombian shop: a minor carries a `TI`, a visitor or a newcomer a
-- passport, and `PEP` / `PPT` are the permits the Venezuelan migration is
-- regularised with — which in some neighbourhoods is not an edge case, it is
-- half the customers.
--
-- ───────────────────────────────────────────────────────────────────────
-- `NIT` STAYS VALID HERE EVEN THOUGH IT LEAVES THE PICKER
--
-- The owner's list does not name it, so `lib/document-id.ts` stops OFFERING
-- it. Dropping it from this constraint is a different thing and would be
-- wrong: any row already storing `NIT` would make the constraint fail to
-- validate, and the `alter table` itself would refuse. Narrowing a check
-- constraint is the one edit that can be blocked by data nobody remembered.
--
-- So the database keeps accepting what it already holds, and the screen stops
-- proposing it. The same split is written in `EXTRAS_ACEPTADOS` on the code
-- side, with the reason: a ficha saved before today must survive being opened
-- and saved again.
--
-- ───────────────────────────────────────────────────────────────────────
-- THE EIGHT, AND WHY `CC` IS NOT A GUESS
--
-- Migration `125` deliberately left Colombians at NULL: *«De los colombianos
-- no sabemos si son CC o NIT»*. That was the honest call with three options
-- and no way to tell them apart.
--
-- What changed is that the owner looked at the number and decided. Eight rows
-- in production, counted on 2026-10-26 with a read-only query, and `CC` is
-- the cédula every adult Colombian carries — the same reasoning migration
-- `125` used to write `V` on the Venezuelans: the screen was already showing
-- them that letter.
--
-- IT IS RE-RUNNABLE, and that is what `document_type is null` buys: the
-- second pass finds no row to touch, and a type corrected by hand afterwards
-- does not get overwritten back to `CC`.
--
-- AND IT LEAVES ALONE anyone whose letter already lives inside `document_id`
-- — the `!~ '[a-zA-Z]'` — for the same reason as `125`: a `CE-12345678`
-- stored that way is not a `CC`, and stamping one would lose the real datum.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.clients
  drop constraint if exists clients_document_type_check;

alter table public.clients
  add constraint clients_document_type_check check (
    document_type is null
    or document_type in ('V', 'E', 'J', 'CC', 'CE', 'NIT', 'TI', 'PAS', 'PEP', 'PPT')
  );

comment on column public.clients.document_type is
  'Tipo de documento: V/E/J en Venezuela; CC/CE/TI/PAS/PEP/PPT en Colombia, mas NIT que ya no se ofrece pero sigue siendo valido para las fichas que lo tienen. NULL = se guardo antes de que el selector existiera, o el pais del cliente no se sabe. Vive aparte de document_id a proposito: el indice unico de la migracion 033 normaliza conservando las letras, asi que meter la letra dentro del valor dejaria pasar el mismo documento dos veces.';

-- ── LOS OCHO COLOMBIANOS SIN LETRA ─────────────────────────────────────
update public.clients
set document_type = 'CC'
where document_country = 'CO'
  and document_id is not null
  and btrim(document_id) <> ''
  and document_type is null
  and document_id !~ '[a-zA-Z]';

insert into public.schema_migrations (key, description)
values (
  '160_colombia_mas_tipos_de_documento',
  'Colombia suma TI, PAS, PEP y PPT al selector de tipo de documento (decision del dueno el 2026-10-26) y los clientes colombianos que se habian quedado sin letra pasan a CC. NIT sale del desplegable pero SIGUE siendo valido en la base: quitarlo del check haria fallar el alter si alguna ficha lo tiene, y dejaria de guardarse en silencio al reabrir una vieja.'
)
on conflict (key) do nothing;
