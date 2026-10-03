-- UN CLIENTE OCULTO SE RECUPERA DESDE LA IMPORTACION, EN LA MISMA ESCRITURA
--
-- ENTORNO: correr en LOS DOS -- primero la rama dev (vzqppwrwnmlbrxizskdh) y
-- despues produccion (rabmiyqodnvnrwiartuj).
--
-- ---------------------------------------------------------------------------
-- EL CALLEJON QUE CIERRA
--
-- Hasta aqui, una cedula de alguien oculto paraba la tanda y mandaba a otra
-- pantalla: "Restauralo desde Papelera para poder subir esta libreta". Salir de
-- la revision, ir a Papelera, restaurar, volver y rehacerlo todo.
--
-- Y para un cliente "oculto definitivamente" el mensaje era directamente
-- FALSO: ese no aparece ni en Papelera -- la propia app avisa de que "no vas a
-- poder restaurarlo tu mismo" --, asi que mandaba a buscarlo a un sitio vacio.
--
-- Debajo habia un tercer problema: la pantalla de revision leia
-- `client_summary`, que filtra a los ocultos, asi que NO PODIA ENSEÑARLOS. El
-- aviso nombraba a una persona que no salia en ninguna lista de esa pantalla.
-- Eso se arregla en `app/(app)/import/page.tsx`, que ahora lee
-- `client_summary_all`; esta migracion es la otra mitad.
--
-- ---------------------------------------------------------------------------
-- DOS CAMBIOS, Y EL SEGUNDO ES EL QUE TOCA DINERO
--
--   1. `restore_clients`: una lista de ids en el payload. Esos clientes salen
--      de la papelera (o del oculto definitivo) EN LA MISMA TRANSACCION que
--      escribe los movimientos. Si la importacion falla, no se restaura a
--      nadie -- hacerlo antes, desde el server action, dejaria al cliente de
--      vuelta en la cartera con un "no se guardo nada" en pantalla, que seria
--      mentira. Por lo mismo va en la seccion 4b, DESPUES de la ultima
--      validacion: un `return` de plpgsql no revierte lo ya escrito, asi
--      que puesto entre las validaciones un rechazo posterior habria
--      dejado al cliente restaurado igualmente.
--
--   2. Un choque de cedula con alguien OCULTO deja de bloquear la cuenta
--      separada. La 077 lo prohibia aunque viniera confirmado, y el argumento
--      -- no partir un historial -- era bueno MIENTRAS la pantalla no pudiera
--      enseñar al oculto. Ahora lo enseña con su marca y su saldo, asi que
--      decir "es una cuenta separada" es una decision informada igual que con
--      un cliente vivo. Decidido con el usuario el 2026-10-02, con los riesgos
--      por delante.
--
-- ---------------------------------------------------------------------------
-- RESTAURAR NO ES SOLO PONER trashed_at A NULL
--
-- Se replica EXACTAMENTE lo que hace `restoreClient`
-- (`app/(app)/clients/[id]/actions.ts`), porque dos formas distintas de
-- restaurar al mismo cliente acaban dejando filas en estados distintos:
--
--   * `trashed_at` y `deleted_at` a null -- los dos, no solo uno.
--   * las tres columnas `trashed_balance*` a null. Son la foto que explicaba
--     por que bajo "Capital por cobrar" al ocultarlo; con el saldo de vuelta en
--     los totales ya no explican nada, y dejarlas haria que la Papelera
--     enseñara una cifra de un cliente que ya no esta ahi.
--   * `is_flagged` NO se toca, igual que alli: quien era mala paga al ocultarlo
--     vuelve siendo mala paga. Restaurar no es perdonar.
--   * una fila en `client_hides` con action 'restored'. Esa tabla guarda una
--     fila por transicion, no un estado, y una restauracion que no deja rastro
--     rompe justo lo que esa tabla existe para contar.
--
-- ---------------------------------------------------------------------------
-- IDEMPOTENTE
--
-- Misma firma `(p_payload jsonb)`, mismo `drop function if exists` de una sola
-- firma, asi que el archivo se puede volver a correr. Y `restore_clients` es
-- opcional: el codigo viejo que no lo mande se comporta como la 077.

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
  -- CT-33. Opcional: sin ella la funcion se comporta como la 077.
  v_restaurar    jsonb := coalesce(p_payload -> 'restore_clients', '[]'::jsonb);
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
    --
    -- CT-33: SALVO LOS QUE EL DUEÑO PIDIO RECUPERAR. Sin este `not in`, la
    -- funcion rechazaba aqui y no llegaba nunca a restaurar a nadie: la
    -- caracteristica entera no habria funcionado, y el sintoma habria sido el
    -- mensaje de siempre, como si el cambio no se hubiera desplegado.
    select c.name into v_nombre
    from public.clients c
    where c.owner_id = v_owner
      and c.id = any(v_ids)
      and (c.trashed_at is not null or c.deleted_at is not null)
      and c.id not in (
        select (value #>> '{}')::uuid from jsonb_array_elements(v_restaurar)
      )
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
    -- EL `order by` SE QUEDA, aunque desde CT-33 ya no decida si se acepta.
    --
    -- Lo puso la 077, cuando el oculto rechazaba y el vivo no: sin el, Postgres
    -- devolvia el que le convenia y la papelera se saltaba la mitad de las
    -- veces. Ahora los dos se aceptan con confirmacion, asi que esto solo
    -- decide QUE NOMBRE sale en el error. Se mantiene igualmente: un mensaje
    -- que nombra a una persona distinta en cada intento es un mensaje que nadie
    -- puede comprobar.
    select c.name,
           (c.trashed_at is not null or c.deleted_at is not null) as oculto
      into v_choque
    from public.clients c
    where c.owner_id = v_owner
      and c.document_id is not null
      and regexp_replace(lower(c.document_id), '[^a-z0-9]', '', 'g') = v_doc
    order by (c.trashed_at is not null or c.deleted_at is not null) desc
    limit 1;

    -- CT-29b, corregido por CT-33. Un choque confirmado se acepta, este el
    -- otro cliente visible o no.
    --
    -- La 077 lo prohibia para los ocultos. Se quita porque la premisa cambio:
    -- entonces la pantalla no podia enseñarlos y la confirmacion habria sido a
    -- ciegas; ahora salen como candidatos, con su marca y su saldo. `oculto`
    -- se sigue calculando porque viaja en el mensaje de error.
    if found and not coalesce((v_item ->> 'confirm_duplicate')::boolean, false) then
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

  -- ── 4b. CT-33: recuperar a los que el dueño pidio ─────────────────────
  --
  -- VA AQUI Y NO ARRIBA, y la diferencia es dinero.
  --
  -- Un `return` de plpgsql NO revierte lo que la funcion ya escribio: sale
  -- normalmente y la transaccion se cierra con el update dentro. Puesto entre
  -- las validaciones, cualquier rechazo posterior —una cedula repetida en el
  -- lote, un movimiento mal referenciado— habria dejado al cliente de vuelta
  -- en la cartera, con su saldo otra vez en los totales, mientras la pantalla
  -- decia "no se guardo nada". Aqui abajo ya no queda ninguna validacion que
  -- pueda rechazar: o se escribe todo, o no se escribio nada.
  --
  -- Se comprueba la PROPIEDAD en los dos statements. La funcion es SECURITY
  -- DEFINER, asi que sin ese filtro un payload con el id de un cliente ajeno
  -- lo sacaria de la papelera de OTRO dueño. Por eso va en los dos, no en uno.
  if jsonb_array_length(v_restaurar) > 0 then
    update public.clients c
       set trashed_at = null,
           deleted_at = null,
           trashed_balance = null,
           trashed_balance_usd = null,
           trashed_balance_eur = null
     where c.owner_id = v_owner
       and c.id in (
         select (value #>> '{}')::uuid from jsonb_array_elements(v_restaurar)
       );

    -- Una fila por transicion, como hace `restoreClient`. Sin esto, una
    -- restauracion hecha desde aqui seria invisible en el historial de
    -- ocultaciones del cliente, y ese historial es lo que explica por que su
    -- saldo salio y volvio a los totales.
    insert into public.client_hides (client_id, owner_id, action)
    select c.id, v_owner, 'restored'
      from public.clients c
     where c.owner_id = v_owner
       and c.id in (
         select (value #>> '{}')::uuid from jsonb_array_elements(v_restaurar)
       );
  end if;

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
  '078_import_libreta_recuperar_oculto',
  'import_libreta acepta restore_clients: los clientes de la papelera (o ocultos definitivamente) que el dueno pidio recuperar salen de ese estado EN LA MISMA TRANSACCION que escribe los movimientos, asi que una importacion fallida no restaura a nadie. Replica exactamente lo que hace restoreClient: trashed_at y deleted_at a null, las tres columnas trashed_balance a null, is_flagged intacto (quien era mala paga vuelve siendo mala paga) y una fila en client_hides con action restored. El update va en la seccion 4b, despues de la ultima validacion, porque un return de plpgsql no revierte lo ya escrito: entre las validaciones, un rechazo posterior habria dejado al cliente restaurado con un no se guardo nada en pantalla. Y el guard de cliente_en_papelera excluye a los de restore_clients, sin lo cual la funcion rechazaba antes de llegar a restaurar y la caracteristica entera no habria funcionado. Comprueba owner_id en los dos statements porque la funcion es SECURITY DEFINER y sin eso un payload con un id ajeno sacaria de la papelera al cliente de otro dueno. Ademas quita la prohibicion que la 077 ponia a crear una cuenta separada cuando la cedula era de alguien oculto: la premisa era que la pantalla no podia ensenarlo, y desde CT-33 la revision lee client_summary_all y lo ensena como candidato con su marca y su saldo, asi que la confirmacion ya no es a ciegas. El order by oculto desc se mantiene aunque ya no decida si se acepta: ahora solo fija que nombre sale en el error, y un mensaje que nombra a alguien distinto en cada intento no se puede comprobar.'
)
on conflict (key) do nothing;

commit;
