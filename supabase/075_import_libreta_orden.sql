-- EL ORDEN DE UNA LIBRETA, QUE HOY SE PIERDE Y DEJA LOS SALDOS MAL
--
-- ENTORNO: correr en LOS DOS — primero la rama dev (vzqppwrwnmlbrxizskdh) y
-- después producción (rabmiyqodnvnrwiartuj).
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL FALLO, MEDIDO EN DEV EL 2026-09-29
--
-- Una libreta de cuatro cargos —40, 50, 15, 35— se subió entera y correcta: las
-- cuatro filas entraron, con sus montos y su moneda. Pero sus saldos corridos
-- quedaron así:
--
--     40  →  running_balance 40    ✅
--     50  →  running_balance 90    ✅
--     15  →  running_balance 55    ❌  (debía ser 105)
--     35  →  running_balance 75    ❌  (debía ser 140)
--
-- Y `client_summary` dijo que la clienta debía **$40**, cuando debe $140. En la
-- pantalla de Inicio, el tendero ve $40.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ
--
-- `set_movement_running_balance()` corre BEFORE INSERT y busca el saldo
-- anterior de esa cadena así:
--
--     order by created_at desc, id desc limit 1
--
-- `created_at` es `now()`, y **`now()` es constante dentro de una transacción**:
-- devuelve el instante en que empezó, no el de cada `insert`. `import_libreta`
-- mete la libreta entera en una sola transacción, así que las cuatro filas
-- nacen con el MISMO `created_at` y el desempate cae en `id desc` — un uuid de
-- `gen_random_uuid()`, o sea **un orden aleatorio**.
--
-- Cada fila toma como "anterior" a la que sacó el uuid más alto, no a la que
-- venía antes en la libreta. Con dos movimientos se nota poco; con treinta, el
-- saldo final es un número cualquiera de la cadena.
--
-- ES UN FALLO QUE INTRODUJO LA 073. Antes, `confirmImport` insertaba las filas
-- una a una desde TypeScript, cada una en su propia transacción y por tanto con
-- su propio `now()`: el orden salía bien por accidente. Al volverse
-- transaccional —que era lo correcto, y resolvía un fallo peor— ese accidente
-- desapareció. **No ha llegado a producción**: la 073 solo está en dev.
--
-- Y `npm run qa:import` no lo vio porque contaba filas. Entraban las cuatro.
-- Esta migración viene con la comprobación que faltaba.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL ARREGLO
--
-- Dar a cada movimiento de la tanda un `created_at` un milisegundo posterior al
-- anterior, en el orden en que vienen en el payload — que es el orden en que
-- están escritos en la página de la libreta.
--
-- No es un truco para desempatar: **es guardar un dato que hoy se tira**. El
-- orden de los renglones de una libreta es información real, y de él dependen
-- tres cosas además del saldo: la comprobación de sumas de la revisión, el FIFO
-- de `get_oldest_unpaid_charge` —qué fiado es el más viejo sin pagar, que decide
-- la mora— y el propio historial que lee el cliente.
--
-- Un milisegundo por fila: una libreta de 30 movimientos ocupa 30 ms. La fecha
-- que se enseña es el día, así que no cambia nada de lo que nadie lee.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ NO SE ARREGLA EN EL TRIGGER
--
-- Se podría ordenar por otra cosa, pero no hay otra cosa: la fila no lleva
-- ningún número de orden, y añadirlo sería una columna nueva en `movements` que
-- solo significaría algo para las filas de una importación. El `created_at` ya
-- existe, ya se usa para ordenar en cinco sitios, y lo único que le falta es no
-- empatar.
--
-- ─────────────────────────────────────────────────────────────────────────
-- SIN BACKFILL, A PROPÓSITO
--
-- No se reparan los saldos ya escritos porque en producción no hay ninguno roto
-- por esto: la 073 nunca corrió allí. En dev sí hay filas mal, y son de cuentas
-- de prueba. Si esto hubiera llegado a producción, el arreglo de los datos
-- sería `recalc_client_running_balance` sobre cada cliente con movimientos
-- `source = 'photo_import'` — pero antes habría que decidir en qué orden, y ese
-- dato ya no existiría.

begin;

drop function if exists public.import_libreta(jsonb);

create function public.import_libreta(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner        uuid := auth.uid();
  v_nuevos       jsonb := coalesce(p_payload -> 'clients_new', '[]'::jsonb);
  v_docs         jsonb := coalesce(p_payload -> 'client_documents', '[]'::jsonb);
  v_whats        jsonb := coalesce(p_payload -> 'client_whatsapps', '[]'::jsonb);
  v_movs         jsonb := coalesce(p_payload -> 'movements', '[]'::jsonb);
  v_item         jsonb;
  v_ids          uuid[];
  v_id           uuid;
  v_doc          text;
  v_nombre       text;
  v_malos        int;
  v_choque       record;
  v_mapa         jsonb := '{}'::jsonb;
  v_vistos       text[] := '{}';
  v_creados      int := 0;
  v_insertados   int := 0;
  -- El instante de la tanda, leido UNA vez. Ver la cabecera de la 075.
  v_arranque     timestamptz := now();
begin
  -- ── 1. Quién ──────────────────────────────────────────────────────────
  if v_owner is null then
    return jsonb_build_object('ok', false, 'code', 'sin_sesion');
  end if;

  -- Una libreta son decenas de inserts. Con la cuenta pausada la política los
  -- rechazaría uno a uno y el dueño acabaría con cuarenta líneas en rojo.
  if not public.owner_puede_escribir(v_owner) then
    return jsonb_build_object('ok', false, 'code', 'cuenta_pausada');
  end if;

  if jsonb_array_length(v_movs) = 0 then
    return jsonb_build_object('ok', false, 'code', 'sin_movimientos');
  end if;

  -- ── 2. Cada client_id que llega, ¿es de este dueño y está visible? ─────
  --
  -- Se juntan los de las tres listas: un movimiento puede apuntar a un cliente
  -- que ya existe, y las otras dos solo tocan clientes existentes.
  select array_agg(distinct x)
    into v_ids
  from (
    select (e ->> 'client_id')::uuid as x from jsonb_array_elements(v_movs) e
     where e ->> 'client_id' is not null
    union
    select (e ->> 'client_id')::uuid from jsonb_array_elements(v_docs) e
     where e ->> 'client_id' is not null
    union
    select (e ->> 'client_id')::uuid from jsonb_array_elements(v_whats) e
     where e ->> 'client_id' is not null
  ) t;

  if v_ids is not null then
    -- Ajeno o inexistente. No se distingue a propósito: decir «ese cliente no
    -- es tuyo» y «ese cliente no existe» con mensajes distintos le confirma a
    -- quien pruebe ids al azar cuáles existen.
    select count(*) into v_malos
    from unnest(v_ids) i
    where not exists (
      select 1 from public.clients c
       where c.id = i and c.owner_id = v_owner
    );
    if v_malos > 0 then
      return jsonb_build_object('ok', false, 'code', 'cliente_invalido');
    end if;

    -- En la papelera. Escribirle movimientos sería meterlos en una ficha que
    -- ninguna lista enseña y ningún total cuenta: el tipo de error que no se
    -- ve hasta que alguien reclama.
    select c.name into v_nombre
    from public.clients c
    where c.owner_id = v_owner
      and c.id = any(v_ids)
      and (c.trashed_at is not null or c.deleted_at is not null)
    limit 1;
    if v_nombre is not null then
      return jsonb_build_object('ok', false, 'code', 'cliente_en_papelera', 'client_name', v_nombre);
    end if;
  end if;

  -- ── 3. Los clientes nuevos, antes de crear ninguno ────────────────────
  for v_item in select * from jsonb_array_elements(v_nuevos) loop
    if coalesce(btrim(v_item ->> 'name'), '') = '' then
      return jsonb_build_object('ok', false, 'code', 'falta_nombre');
    end if;

    v_doc := nullif(btrim(coalesce(v_item ->> 'document_id', '')), '');
    if v_doc is null then
      return jsonb_build_object('ok', false, 'code', 'falta_documento',
                                'client_name', v_item ->> 'name');
    end if;

    -- La misma normalización que el índice único de la 033, carácter por
    -- carácter. Si aquí se escribiera otra, esta comprobación diría que no hay
    -- choque y el insert fallaría igual — que es justo el fallo que se quiere
    -- quitar.
    v_doc := regexp_replace(lower(v_doc), '[^a-z0-9]', '', 'g');

    -- Contra los que el dueño ya tiene, incluidos los de la papelera: si el
    -- documento existe ahí, lo correcto es restaurarlo, no crear un segundo
    -- registro que parta el historial de una persona en dos.
    select c.name,
           (c.trashed_at is not null or c.deleted_at is not null) as oculto
      into v_choque
    from public.clients c
    where c.owner_id = v_owner
      and c.document_id is not null
      and regexp_replace(lower(c.document_id), '[^a-z0-9]', '', 'g') = v_doc
    limit 1;

    if found then
      return jsonb_build_object('ok', false, 'code', 'documento_de_otro_cliente',
                                'client_name', v_choque.name,
                                'hidden', v_choque.oculto);
    end if;

    -- Y contra los otros nuevos de esta misma tanda. Dos filas distintas con
    -- el mismo documento pasan las dos la comprobación de arriba —ninguna de
    -- las dos existe todavía— y revientan en el índice único al insertar la
    -- segunda.
    if v_doc = any(v_vistos) then
      return jsonb_build_object('ok', false, 'code', 'documento_repetido_en_lote',
                                'client_name', v_item ->> 'name');
    end if;
    v_vistos := v_vistos || v_doc;
  end loop;

  -- ── 4. Cada movimiento apunta a algo que va a existir ─────────────────
  for v_item in select * from jsonb_array_elements(v_movs) loop
    if v_item ->> 'client_id' is null then
      if v_item ->> 'client_key' is null
         or not exists (
           select 1 from jsonb_array_elements(v_nuevos) n
            where n ->> 'key' = v_item ->> 'client_key'
         ) then
        return jsonb_build_object('ok', false, 'code', 'referencia_invalida');
      end if;
    end if;
  end loop;

  -- ══ A partir de aquí SE ESCRIBE. Cualquier excepción deshace la tanda ══

  -- ── 5. Los clientes nuevos ────────────────────────────────────────────
  for v_item in select * from jsonb_array_elements(v_nuevos) loop
    insert into public.clients (owner_id, name, document_id, whatsapp,
                                document_source, document_country)
    values (
      v_owner,
      btrim(v_item ->> 'name'),
      btrim(v_item ->> 'document_id'),
      nullif(btrim(coalesce(v_item ->> 'whatsapp', '')), ''),
      -- Lo escribió el dueño en la revisión, no salió de la foto. Ver la 063.
      'owner',
      v_item ->> 'document_country'
    )
    returning id into v_id;

    v_mapa := v_mapa || jsonb_build_object(v_item ->> 'key', v_id::text);
    v_creados := v_creados + 1;
  end loop;

  -- ── 6. Documento de un cliente que no tenía ───────────────────────────
  --
  -- `document_id is null` en el WHERE y no un `if` antes: así no hay forma de
  -- pisar un documento ya guardado, ni siquiera si el payload viene mal.
  for v_item in select * from jsonb_array_elements(v_docs) loop
    update public.clients
       set document_id = btrim(v_item ->> 'document_id'),
           document_source = 'owner'
     where id = (v_item ->> 'client_id')::uuid
       and owner_id = v_owner
       and document_id is null;
  end loop;

  -- ── 7. WhatsApp, si el cliente no tenía ───────────────────────────────
  --
  -- Mismo criterio: `whatsapp is null`. El número de la libreta puede ser más
  -- viejo que el que el dueño corrigió a mano en la ficha, y en esa duda gana
  -- siempre lo que ya estaba.
  for v_item in select * from jsonb_array_elements(v_whats) loop
    update public.clients
       set whatsapp = btrim(v_item ->> 'whatsapp')
     where id = (v_item ->> 'client_id')::uuid
       and owner_id = v_owner
       and whatsapp is null;
  end loop;

  -- ── 8. Los movimientos ────────────────────────────────────────────────
  --
  -- Sin `needs_review`: el dueño vio y pudo corregir cada fila señalada en la
  -- pantalla de revisión antes de confirmar, así que confirmar ES la revisión.
  for v_item in select * from jsonb_array_elements(v_movs) loop
    v_id := coalesce(
      (v_item ->> 'client_id')::uuid,
      (v_mapa ->> (v_item ->> 'client_key'))::uuid
    );

    insert into public.movements (
      client_id, created_by, type, amount, currency, description, source,
      rate_mode_used, exchange_rate_used, official_bcv_rate_at_time,
      entry_currency, entry_amount, rate_usd_at_time, rate_eur_at_time,
      -- LO NUEVO DE LA 075: el orden de la libreta, hecho dato.
      created_at,
      -- LO NUEVO DE LA 074. Va aqui y no en description a proposito:
      -- description es lo unico de esta fila que el cliente lee en /s/[token].
      owner_note
    )
    values (
      v_id,
      v_owner,
      v_item ->> 'type',
      (v_item ->> 'amount')::numeric,
      v_item ->> 'currency',
      v_item ->> 'description',
      'photo_import',
      v_item ->> 'rate_mode_used',
      (v_item ->> 'exchange_rate_used')::numeric,
      (v_item ->> 'official_bcv_rate_at_time')::numeric,
      v_item ->> 'entry_currency',
      (v_item ->> 'entry_amount')::numeric,
      (v_item ->> 'rate_usd_at_time')::numeric,
      (v_item ->> 'rate_eur_at_time')::numeric,
      v_arranque + (v_insertados * interval '1 millisecond'),
      nullif(btrim(coalesce(v_item ->> 'owner_note', '')), '')
    );

    v_insertados := v_insertados + 1;
  end loop;

  -- ── 9. Reconstruir las cadenas de saldo de cada cliente tocado ────────
  --
  -- Cinturon y tirantes. Con los created_at ya separados el trigger acierta
  -- solo, pero esto no cuesta nada y cierra el caso que el trigger no puede
  -- ver: una libreta cuyos movimientos se intercalan con los que el cliente
  -- ya tenia. Reescribe cada cadena entera, por cliente y por moneda.
  for v_item in
    select distinct to_jsonb(x.id) as id
    from (
      select (e ->> 'client_id')::uuid as id from jsonb_array_elements(v_movs) e
       where e ->> 'client_id' is not null
      union
      select (v_mapa ->> k)::uuid from jsonb_object_keys(v_mapa) k
    ) x
    where x.id is not null
  loop
    perform public.recalc_client_running_balance((v_item #>> '{}')::uuid);
  end loop;

  return jsonb_build_object('ok', true,
                            'imported', v_insertados,
                            'clients_created', v_creados);
end;
$$;

revoke execute on function public.import_libreta(jsonb) from public, anon;
grant execute on function public.import_libreta(jsonb) to authenticated;

insert into public.schema_migrations (key, description)
values (
  '075_import_libreta_orden',
  'import_libreta da a cada movimiento de la tanda un created_at un milisegundo posterior al anterior, en el orden del payload. now() es constante dentro de una transaccion, asi que la libreta entera nacia con el MISMO created_at y el trigger set_movement_running_balance desempataba por id desc, que es un uuid aleatorio: los saldos corridos salian en orden arbitrario y client_summary daba un numero cualquiera de la cadena. Medido en dev el 2026-09-29 con cuatro cargos de 40/50/15/35: la clienta figuraba debiendo 40 en vez de 140. Lo introdujo la 073 al volverse transaccional (antes cada fila tenia su propio now() por estar en su propia transaccion) y NO llego a produccion. Tambien recalcula la cadena de cada cliente tocado al final, por si una libreta se intercala con movimientos que el cliente ya tenia. Sin backfill: en produccion no hay nada roto por esto.'
)
on conflict (key) do nothing;

commit;
