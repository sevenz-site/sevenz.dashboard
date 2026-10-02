-- LA NOTA DEL DUEÑO: una columna que el cliente NO ve
--
-- ENTORNO: correr en LOS DOS — primero la rama dev (vzqppwrwnmlbrxizskdh) y
-- después producción (rabmiyqodnvnrwiartuj).
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ HACE FALTA UNA COLUMNA, Y SOLO PARA UNA DE LAS DOS COSAS
--
-- El rediseño de «Subir libreta» quiere recordar dos cosas de un movimiento
-- importado, y solo una necesita guardarse:
--
--   «Creado a través de Subir libreta el 28 sept 2026»  →  SE DEDUCE de
--        `source = 'photo_import'` y `created_at`, que ya existen. La lista de
--        movimientos ya lo pinta («· de libreta»). No necesita nada nuevo, y
--        añadir una columna para esto sería guardar por duplicado un dato que
--        puede quedarse desincronizado del que manda.
--
--   «Importado sabiendo que la suma no cuadraba»        →  NO SE DEDUCE de
--        nada. Cuando el dueño lee «la suma da $30 y tu cuenta en libreta da
--        $99» y decide importarlo así de todas formas, eso es una decisión
--        suya, tomada una vez, y sin guardarla desaparece al cerrar la
--        pantalla. Tres meses después el cliente reclama y nadie —tampoco el
--        dueño— puede distinguir un desajuste que se miró y se aceptó de uno
--        que nadie vio nunca.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ NO VA EN `description`
--
-- `description` es lo único de esta tabla que el CLIENTE lee: `get_shared_balance`
-- lo devuelve a la página pública `/s/[token]`. Una nota sobre las dudas del
-- dueño respecto a las cuentas de alguien, enseñada a ese alguien, es el peor
-- sitio posible para ponerla.
--
-- Y es segura por construcción, no por acordarse: desde la migración 043
-- `get_shared_balance` enumera sus 16 campos uno a uno en vez de devolver la
-- fila entera, así que una columna nueva en `movements` no se filtra sola. Este
-- es exactamente el caso para el que se escribió así.
--
-- No hace falta tocar RLS ni grants: la columna hereda las políticas de
-- `movements`, que ya scopean por dueño.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LA FUNCIÓN SE VUELVE A CREAR ENTERA, Y ES UNA COPIA EXACTA DE LA 073
--
-- Con DOS líneas añadidas: `owner_note` en la lista de columnas del insert de
-- movimientos, y su valor. Nada más cambia — ni un código de error, ni una
-- validación, ni el orden.
--
-- Se vuelve a crear entera en vez de parchearla porque PL/pgSQL no tiene forma
-- de parchear el cuerpo de una función: o se reemplaza completo o no se toca. Y
-- el `drop` de abajo la deja re-ejecutable, que es la regla de CLAUDE.md — el
-- momento en que hace falta correr una migración por segunda vez es justo
-- después de corregirla.

begin;

alter table public.movements
  add column if not exists owner_note text;

comment on column public.movements.owner_note is
  'Nota interna del dueño sobre este movimiento. NUNCA se devuelve al cliente: get_shared_balance enumera sus campos uno a uno y este no está en la lista. Hoy solo la escribe import_libreta, cuando el dueño importa una página cuya suma no cuadraba.';

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
      nullif(btrim(coalesce(v_item ->> 'owner_note', '')), '')
    );

    v_insertados := v_insertados + 1;
  end loop;

  return jsonb_build_object('ok', true,
                            'imported', v_insertados,
                            'clients_created', v_creados);
end;
$$;

-- Los mismos grants que la 073: la llama el DUEÑO con su propia sesión, que es
-- de donde sale `auth.uid()`. Se repiten porque el `drop function` de arriba se
-- llevó los de la 073 con él — un grant vive en la función, no en el nombre.
revoke execute on function public.import_libreta(jsonb) from public, anon;
grant execute on function public.import_libreta(jsonb) to authenticated;

insert into public.schema_migrations (key, description)
values (
  '074_movement_owner_note',
  'Anade movements.owner_note, la nota interna del dueno sobre un movimiento, y hace que import_libreta la guarde. De las dos cosas que el rediseno de Subir libreta quiere recordar, solo una necesita columna: "creado via Subir libreta el 28 sept" se deduce de source=photo_import y created_at, que ya existen; "importado sabiendo que la suma no cuadraba" no se deduce de nada y se perdia al cerrar la pantalla. NO va en description porque description es lo unico de la fila que el cliente lee en /s/[token], y es segura por construccion: get_shared_balance enumera sus 16 campos uno a uno desde la 043, asi que una columna nueva no se filtra sola. La funcion es copia exacta de la 073 con dos lineas anadidas.'
)
on conflict (key) do nothing;

commit;
