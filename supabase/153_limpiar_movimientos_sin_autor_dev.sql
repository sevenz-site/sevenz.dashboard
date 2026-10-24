-- DEV-ONLY. **NEVER RUN THIS AGAINST PRODUCTION** -- see the ledger note at
-- the end for how production is squared off instead.
--
-- Four movements in the dev branch carry no `created_by`. They were not
-- written by anyone using the app: `qa/` scripts write with the service-role
-- key, where `auth.uid()` is null by definition, and these four were left
-- behind by runs that did not clean up after themselves.
--
-- ===========================================================================
-- WHY DELETE THEM INSTEAD OF TEACHING THE SUITE TO IGNORE THEM
--
-- `npm run qa:currency` asserts that every movement has an author. It has been
-- failing on these rows, and the count grew from two to four in three days.
--
-- An alarm that always rings stops being read -- the same reasoning CLAUDE.md
-- already applies to single-environment migrations. And an exclusion list is
-- the worse of the two fixes: it needs maintaining, and the day a REAL
-- authorless movement appears it is sitting inside the exemption nobody
-- revisits. Deleting the rubbish restores the signal; excusing it removes it.
--
-- Decision of the owner on 2026-10-24, asked with both options and their cost:
-- *«Borra las 4 filas»*.
--
-- ===========================================================================
-- BY ID, NOT BY CONDITION, AND THAT IS THE SAFETY
--
-- `delete from movements where created_by is null` is one word away from a
-- catastrophe in the wrong database. These four ids match nothing anywhere
-- else, so this file is inert outside the dev branch it was written for.
--
-- RE-RUNNABLE: a second run deletes nothing and the recalculation is
-- idempotent by construction.
--
-- ===========================================================================
-- AND IT RECALCULATES, BECAUSE DELETING A MOVEMENT MOVES A BALANCE
--
-- `movements.running_balance` is a chain: each row carries the balance after
-- itself. Removing a link leaves every row after it claiming a balance that no
-- longer follows from the rows above -- a number that is plausible and false,
-- which is exactly what `recalc_client_running_balance` exists to repair and
-- what the hard stop in the QA checklist exists to catch.
--
-- Two clients are touched: `Camilo Camisama` and the `QA Camino 1014` fixture.

delete from public.movements
where id in (
  'd3a888c0-eb83-4a94-ac94-661494c7f344',  -- charge 300 EUR · Camilo Camisama · 2026-10-24
  'fd6f63de-8ffb-4b99-b27f-b7357129e624',  -- charge 300 USD · Camilo Camisama · 2026-10-24
  '9347b697-b817-4d65-824f-a33e47c75998',  -- payment 15 USD · QA Camino 1014 · 2026-10-20
  '425960e9-c9f8-4c1a-ad5d-c335d931fcb0'   -- charge 60 USD · QA Camino 1014 · 2026-10-20
);

select public.recalc_client_running_balance('109eb4f2-483c-4fca-ab9c-4403ad5e77ac');
select public.recalc_client_running_balance('986a10f6-9d97-4775-bf14-d4dc0e929dad');

-- ── THE LEDGER ──────────────────────────────────────────────────────────
--
-- Logged in dev because CLAUDE.md logs every SQL statement run against the
-- branch, a two-line fix included. Production gets the same key registered as
-- a NO-OP -- the block is in the launch batch -- so the checklist's ledger
-- comparison keeps meaning something instead of flagging this for ever.
insert into public.schema_migrations (key, description)
values (
  '153_limpiar_movimientos_sin_autor_dev',
  'DEV-ONLY: borra 4 movimientos de prueba sin autor que dejaron guiones de qa/, y recalcula el saldo de sus dos clientes. NUNCA ejecutar contra producción: allí esos ids no existen y el archivo no tendría nada que borrar.'
)
on conflict (key) do nothing;
