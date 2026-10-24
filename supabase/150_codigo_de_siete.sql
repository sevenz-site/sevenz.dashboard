-- THE TRANSACTION CODE GROWS TO SEVEN: FOUR LETTERS AND THREE DIGITS.
--
-- Decision of the owner on 2026-10-23, the day after the code shipped to dev:
-- *«Ajusta los códigos de transacción que sean de 7 dígitos, 4 letras y 3
-- números»*.
--
-- ===========================================================================
-- WHAT IT BUYS, SINCE THE OLD ONE WAS NOT RUNNING OUT
--
-- Three letters and three digits was 13.8 million codes, far more than this
-- product will write. The fourth letter takes it to 331 million, and that is
-- not the point: a 24x wider space makes a collision between two codes a
-- shopkeeper might see on the same screen vanishingly rare, and it leaves
-- room for the day a code is read out loud over a counter with one character
-- lost in the noise.
--
-- THE ALPHABET IS UNCHANGED and so is the reason: no I and no O, because next
-- to 1 and 0 they are the two characters this code loses when it is spoken or
-- retyped from a screenshot.
--
-- ===========================================================================
-- THE OLD CODES ARE REGENERATED, AND THAT IS SAFE EXACTLY TODAY
--
-- Every code in existence was written yesterday, in dev, by the backfill in
-- migration 147. Production has none: 147 has not run there. So nothing that
-- anyone has read, shared or written down changes -- and this is the only
-- window in which that is true. Once a shopkeeper has sent a receipt carrying
-- a code, regenerating it would make that receipt point at nothing.
--
-- RE-RUNNABLE, and the condition is what makes it so: only codes whose length
-- is not 7 are replaced. A second run finds none and does nothing. Writing it
-- as «regenerate everything» would hand out new codes every time the file is
-- pasted, which is the failure mode CLAUDE.md warns about -- the re-run after
-- a correction is the one that actually happens.

-- ── THE GENERATOR ───────────────────────────────────────────────────────
--
-- Same shape as migration 147, one letter longer. `create or replace` is
-- enough: no arguments, same return type.
create or replace function public.generar_codigo_transaccion()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  -- No I and no O: see the header.
  v_letras constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_codigo text;
  v_intento int := 0;
begin
  loop
    v_intento := v_intento + 1;
    v_codigo :=
      substr(v_letras, 1 + floor(random() * length(v_letras))::int, 1) ||
      substr(v_letras, 1 + floor(random() * length(v_letras))::int, 1) ||
      substr(v_letras, 1 + floor(random() * length(v_letras))::int, 1) ||
      substr(v_letras, 1 + floor(random() * length(v_letras))::int, 1) ||
      lpad(floor(random() * 1000)::int::text, 3, '0');

    insert into public.transaction_codes (code)
    values (v_codigo)
    on conflict (code) do nothing;

    if found then
      return v_codigo;
    end if;

    if v_intento >= 50 then
      raise exception 'No se pudo generar un código de transacción libre tras % intentos', v_intento;
    end if;
  end loop;
end;
$$;

-- ── THE CODES ALREADY WRITTEN ───────────────────────────────────────────
--
-- SAME FOUR PASSES AND THE SAME ORDER AS 147, for the same reason: a sale's
-- movements copy the sale's code, so the sale has to be renumbered first or
-- the two end up with different codes. The only change is the condition --
-- «length is not 7» instead of «is null».
--
-- The old codes are deliberately LEFT in `transaction_codes`. Freeing them
-- would let a future code reuse a string that a dev screenshot still shows,
-- and the table costs nothing.
do $$
declare
  v_fila record;
  v_codigo text;
begin
  -- 1. SALES.
  for v_fila in
    select id from public.sales
    where transaction_code is null or length(transaction_code) <> 7
  loop
    update public.sales
    set transaction_code = public.generar_codigo_transaccion()
    where id = v_fila.id;
  end loop;

  -- 2. MOVEMENTS THAT BELONG TO A SALE.
  update public.movements m
  set transaction_code = s.transaction_code
  from public.sales s
  where m.sale_id = s.id
    and (m.transaction_code is null or length(m.transaction_code) <> 7)
    and s.transaction_code is not null;

  -- 3. SPLIT PAYMENTS, one code per group.
  for v_fila in
    select distinct payment_group_id
    from public.movements
    where payment_group_id is not null
      and (transaction_code is null or length(transaction_code) <> 7)
  loop
    v_codigo := public.generar_codigo_transaccion();
    update public.movements
    set transaction_code = v_codigo
    where payment_group_id = v_fila.payment_group_id
      and (transaction_code is null or length(transaction_code) <> 7);
  end loop;

  -- 4. EVERYTHING ELSE, one each.
  for v_fila in
    select id from public.movements
    where transaction_code is null or length(transaction_code) <> 7
  loop
    update public.movements
    set transaction_code = public.generar_codigo_transaccion()
    where id = v_fila.id;
  end loop;
end;
$$;

insert into public.schema_migrations (key, description)
values (
  '150_codigo_de_siete',
  'El código de transacción pasa a 7 caracteres: 4 letras y 3 números. Regenera los que no midan 7, lo cual es seguro hoy porque solo existen en dev.'
)
on conflict (key) do nothing;
