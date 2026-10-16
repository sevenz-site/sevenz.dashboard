-- A PRODUCT WRITTEN WITHOUT THE PER-TIER BASES GETS THE PRODUCT'S OWN.
--
-- ENVIRONMENT: run first on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run
-- against production (rabmiyqodnvnrwiartuj) until the user says to launch.
-- RUN MIGRATION 114 FIRST: this trigger fills in the columns 114 creates.
--
-- ===========================================================================
-- WHAT 114 GOT WRONG, FOUND MINUTES AFTER RUNNING IT
--
-- 114 made `base_currency_retail` and `base_currency_wholesale` NOT NULL with
-- no default, so EVERY insert into `products` that does not name them fails:
--
--   null value in column "base_currency_retail" violates not-null constraint
--
-- The app was fine -- `app/(app)/productos/actions.ts` had been updated in the
-- same batch -- which is exactly why this was not obvious. What broke was
-- `qa/orden.mjs`, whose fixture creates a product directly, and it broke by
-- crashing before its first assertion rather than by failing one. A suite that
-- cannot build its fixture reports nothing, and "nothing" is easy to read as
-- "nothing wrong".
--
-- ===========================================================================
-- A TRIGGER AND NOT A `default`, BECAUSE A DEFAULT CANNOT DO THIS
--
-- A column default is a constant expression: it cannot read `base_currency`
-- from the row being inserted. Copying the product's own base is precisely
-- what is wanted, so it has to happen in a `before insert`.
--
-- ===========================================================================
-- WHY THIS IS SAFE, WHEN 114 ARGUED AGAINST EXACTLY THIS KIND OF FALLBACK
--
-- 114's header rejected "null means fall back to `base_currency`" and still
-- does. The difference is the direction, and it decides everything:
--
--   * A READER that falls back is dangerous. It quotes a price with the wrong
--     currency and looks right forever, which is the silent mispricing 114
--     exists to prevent. The columns stay NOT NULL, so no reader ever sees a
--     null and no reader ever needs a fallback.
--   * A WRITER that omits them is saying "I do not distinguish tiers", and
--     the product's single base is the correct answer to that. It is the same
--     value 114's own backfill wrote into every existing row.
--
-- So the invariant readers depend on is untouched, and what disappears is a
-- whole class of breakage for code that has not learned about tiers yet.
--
-- ===========================================================================
-- INSERT ONLY, AND THAT IS THE IMPORTANT PART
--
-- On UPDATE this must NOT sync, and the temptation is real because it looks
-- symmetrical. A shopkeeper who sets wholesale to euros and later changes the
-- product's default currency would have their choice silently overwritten --
-- the feature 114 exists to deliver, undone by a trigger meant to help.
--
-- `app/(app)/productos/actions.ts` writes all three on every save, so an
-- update always carries what it means.

begin;

create or replace function public.product_base_por_escalon()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.base_currency_retail := coalesce(new.base_currency_retail, new.base_currency);
  new.base_currency_wholesale := coalesce(new.base_currency_wholesale, new.base_currency);
  return new;
end;
$$;

-- `create or replace` is enough for a trigger FUNCTION: it takes no arguments,
-- so the overload trap CLAUDE.md documents cannot happen here. The TRIGGER
-- itself is dropped by name, which is what makes the file re-runnable.
drop trigger if exists product_base_por_escalon on public.products;

create trigger product_base_por_escalon
  before insert on public.products
  for each row execute function public.product_base_por_escalon();

comment on function public.product_base_por_escalon() is
  'Fills base_currency_retail and base_currency_wholesale from base_currency when an insert does not name them. BEFORE INSERT only: on update it would silently overwrite a shopkeeper who set a different wholesale currency, which is the feature migration 114 exists to deliver.';

insert into public.schema_migrations (key, description)
values (
  '115_la_base_por_escalon_se_rellena_sola',
  'Arregla un fallo de la 114, encontrado minutos despues de correrla: dejo base_currency_retail y base_currency_wholesale NOT NULL SIN valor por defecto, asi que cualquier insert en products que no las nombre falla con "violates not-null constraint". La app no se entero porque productos/actions.ts se habia actualizado en el mismo lote; lo que se rompio fue qa/orden.mjs, cuya fixture crea un producto directamente, y se rompio REVENTANDO antes de su primera comprobacion en vez de fallando una -- una suite que no puede montar su fixture no reporta nada, y nada se lee facil como "nada va mal". Es un trigger y no un default porque un default es una expresion constante y no puede leer base_currency de la fila que se esta insertando. NO contradice a la 114: esa rechazaba una reserva en la LECTURA, que es la peligrosa -- cotiza con la moneda equivocada y parece correcta para siempre. Las columnas siguen NOT NULL, asi que ningun lector ve jamas un null. Un ESCRITOR que las omite esta diciendo "no distingo escalones", y la base del producto es la respuesta correcta a eso: es el mismo valor que el traspaso de la 114 escribio en todas las filas existentes. SOLO EN INSERT, y esa es la parte importante: en update sincronizar borraria la eleccion del tendero que puso el mayor en euros, que es justo la funcion que la 114 vino a dar.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. An insert that names neither column now works and copies the base:
--
-- insert into public.products (owner_id, name, base_currency, price_retail, published_retail)
-- select id, 'QA 115 sonda', 'EUR', 10, true from public.owners limit 1;
--
-- select name, base_currency, base_currency_retail, base_currency_wholesale
-- from public.products where name = 'QA 115 sonda';
--
-- EXPECTED: the three columns all 'EUR'.
--
-- 2. And an insert that DOES name them keeps what it was given -- the trigger
--    must not overwrite a caller that knows what it wants:
--
-- update public.products
-- set base_currency_wholesale = 'USD'
-- where name = 'QA 115 sonda';
--
-- select base_currency, base_currency_retail, base_currency_wholesale
-- from public.products where name = 'QA 115 sonda';
--
-- EXPECTED: EUR, EUR, USD. If the wholesale one went back to EUR the trigger
-- is firing on update, which would silently undo the owner's per-tier choice.
--
-- 3. Clean up the probe:
--
-- delete from public.products where name = 'QA 115 sonda';
