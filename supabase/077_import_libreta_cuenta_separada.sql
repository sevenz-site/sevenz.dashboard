-- UNA CEDULA REPETIDA DEJA DE SER UN RECHAZO Y PASA A SER UNA PREGUNTA
--
-- ENTORNO: correr en LOS DOS -- primero la rama dev (vzqppwrwnmlbrxizskdh) y
-- despues produccion (rabmiyqodnvnrwiartuj).
--
-- ---------------------------------------------------------------------------
-- QUE CAMBIA, Y POR QUE NO ES UN PERMISO NUEVO SINO UNO QUE YA EXISTIA
--
-- La migracion 034 tiro el indice unico de cedula a proposito: una persona
-- puede llevar DOS fichas bajo el mismo documento, el libro personal y el del
-- negocio, y eso es deliberado, no un error. El alta manual lo ofrece desde
-- entonces con `confirm_duplicate` y su boton "Crear cuenta separada".
--
-- `import_libreta` nunca se entero. Rechazaba el choque siempre, asi que subir
-- una libreta era MAS ESTRICTO que teclear el mismo cliente a mano. Desde aqui
-- un cliente nuevo puede traer `confirm_duplicate: true` y entonces el choque
-- con un cliente VIVO deja de parar la tanda.
--
-- ---------------------------------------------------------------------------
-- LAS DOS PUERTAS QUE SIGUEN CERRADAS, Y NO ES UN OLVIDO
--
--   1. LA PAPELERA. Ni con confirmacion. Un segundo registro cuando el primero
--      sigue existiendo —solo que escondido— parte el historial de una persona
--      en dos sin que nadie pueda volver a juntarlo. Lo correcto ahi es
--      restaurarlo, y eso es lo que el mensaje dice.
--
--   2. DOS RENGLONES DE LA MISMA LIBRETA. `documento_repetido_en_lote` se
--      queda igual. No es el caso que la 034 quiso permitir: alli son dos
--      libros creados a lo largo del tiempo, aqui son dos lineas de la misma
--      pagina, y eso casi siempre es una cedula mal copiada.
--
-- ---------------------------------------------------------------------------
-- LA COMPROBACION VIVE EN DOS SITIOS, Y TIENE QUE SER ASI
--
-- `confirmImport` ya comprueba el choque antes de llamar, y lo seguira
-- haciendo: asi el dueño ve la pregunta en la pantalla de revision, con las
-- fichas delante, en vez de un error al final del viaje. La de aqui dentro caza
-- lo que a esa se le escapa —una carrera, un payload que no salio de esa
-- pantalla— y por eso las dos tienen que conocer la respuesta. Si solo la de
-- fuera la conociera, esta rechazaria justo lo que aquella acaba de permitir.
--
-- ---------------------------------------------------------------------------
-- SIN CAMBIO DE FIRMA, A PROPOSITO
--
-- `confirm_duplicate` entra DENTRO del json de cada cliente nuevo, no como un
-- parametro nuevo. La firma sigue siendo `(p_payload jsonb)`, asi que el codigo
-- viejo que no lo mande sigue funcionando y se comporta como hasta hoy
-- —rechaza—, que es la direccion segura de fallar mientras el despliegue va a
-- medias. Y el `drop function if exists` de abajo sigue nombrando esa unica
-- firma, asi que el archivo se puede volver a correr.

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
  -- La fecha que traiga el movimiento, si la trae y es creible.
  v_fecha        timestamptz;
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
    -- EL DE LA PAPELERA GANA EL `limit 1`, y eso es nuevo (CT-29b).
    --
    -- Antes daba igual cual saliera: cualquiera de los dos rechazaba. Ahora el
    -- vivo se puede aceptar y el oculto no, asi que con una cedula compartida
    -- por uno de cada —posible: la 034 lo permite— el orden DECIDE. Sin este
    -- `order by`, Postgres devuelve el que le conviene y la papelera se
    -- saltaria la mitad de las veces, sin que nada lo delate.
    select c.name,
           (c.trashed_at is not null or c.deleted_at is not null) as oculto
      into v_choque
    from public.clients c
    where c.owner_id = v_owner
      and c.document_id is not null
      and regexp_replace(lower(c.document_id), '[^a-z0-9]', '', 'g') = v_doc
    order by (c.trashed_at is not null or c.deleted_at is not null) desc
    limit 1;

    -- CT-29b. Un choque con alguien VIVO se puede aceptar: es el caso que la
    -- 034 abrio. Con alguien en la papelera, no -- ver la cabecera.
    if found then
      if v_choque.oculto or not coalesce((v_item ->> 'confirm_duplicate')::boolean, false) then
        return jsonb_build_object('ok', false, 'code', 'documento_de_otro_cliente',
                                  'client_name', v_choque.name,
                                  'hidden', v_choque.oculto);
      end if;
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

    -- ── La fecha del movimiento (076) ───────────────────────────────────
    --
    -- Si la libreta traia una fecha y el dueno no la corrigio, el movimiento
    -- se guarda con ELLA. Si no traia ninguna, con la de la subida.
    --
    -- EL OFFSET DE MILISEGUNDOS SE QUEDA EN LOS DOS CASOS, y es lo que impide
    -- que vuelva el fallo de la 075: varios renglones del MISMO dia son el caso
    -- normal en una libreta, y sin el llegarian con el mismo timestamp exacto
    -- -- medianoche de ese dia -- y el trigger del saldo volveria a desempatar
    -- por uuid. Con el, dentro de un mismo dia manda el orden de la pagina.
    v_fecha := nullif(btrim(coalesce(v_item ->> 'created_at', '')), '')::timestamptz;

    -- Una fecha del futuro no es una fecha, es una lectura mala. La IA puede
    -- leer "30/8/26" como 2226, y un movimiento fechado en el futuro se queda
    -- para siempre al final de la cadena del cliente y falsea la mora. Lo mismo
    -- una anterior a que existiera nada de esto. En ambos casos gana la fecha
    -- de la subida, que es verdad comprobable.
    if v_fecha is null or v_fecha > v_arranque or v_fecha < timestamptz '2015-01-01' then
      v_fecha := v_arranque;
    end if;

    v_fecha := v_fecha + (v_insertados * interval '1 millisecond');

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
      v_fecha,
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
  '077_import_libreta_cuenta_separada',
  'import_libreta acepta confirm_duplicate por cliente nuevo: una cedula que ya es de otro cliente VIVO deja de parar la tanda cuando el dueno confirma que le esta abriendo una cuenta aparte. Es el permiso que la 034 abrio al tirar el indice unico y que el alta manual ya ofrecia; la importacion era mas estricta que teclear el cliente a mano. Dos puertas siguen cerradas a proposito: un cliente en la PAPELERA rechaza aunque venga confirmado (un segundo registro partiria su historial en dos y lo correcto es restaurarlo), y dos renglones de la MISMA libreta con la misma cedula siguen cayendo en documento_repetido_en_lote. El select del choque lleva ahora order by oculto desc: antes daba igual cual de los dos devolviera el limit 1 porque los dos rechazaban, y ahora el vivo se acepta y el oculto no, asi que sin ese orden la papelera se saltaria la mitad de las veces. Sin cambio de firma: confirm_duplicate va dentro del json de cada cliente nuevo, asi que el codigo viejo que no lo mande se sigue comportando como hasta hoy.'
)
on conflict (key) do nothing;

commit;
