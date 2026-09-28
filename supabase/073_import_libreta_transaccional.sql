-- SUBIR UNA LIBRETA ENTERA, O NINGUNA
--
-- ENTORNO: correr en LOS DOS — primero la rama dev (vzqppwrwnmlbrxizskdh) y
-- después producción (rabmiyqodnvnrwiartuj).
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL FALLO QUE ESTO ELIMINA
--
-- `confirmImport` recorre las filas una a una y, ante el primer fallo, vuelve
-- con las que ya entraron: `return { error, imported }`. No hay transacción.
--
-- En plano: María sube su libreta de 30 clientes, revisa media hora, le da a
-- importar y a los pocos segundos sale un error. Ella entiende «no se
-- importó», lo intenta otra vez, y ahora 26 clientes tienen sus fiados POR
-- DUPLICADO. Nadie le dijo que la primera vez sí entró la mayoría.
--
-- Hoy es raro porque el flujo bloquea casi todo antes. El rediseño de la
-- pantalla de revisión —«importar aunque haya error», «es otra persona»— lo
-- vuelve probable, porque multiplica los caminos por los que la fila 27 de 30
-- puede fallar con 26 ya escritas.
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ NO SE MUEVE TODO `confirmImport` AQUÍ
--
-- Porque la parte cara de ese archivo NO es el bucle: es resolver la tasa de
-- cambio de cada moneda (`resolveMovementRateSnapshot`), que hace tres viajes
-- a la base, puede disparar un refresco del BCV y decide en qué libro entra
-- cada movimiento. Reescribir eso en PL/pgSQL dejaría dos versiones libres de
-- separarse, que es exactamente lo que `CLAUDE.md` evita con el puntaje de
-- crédito.
--
-- Y no hace falta: ese archivo YA resuelve todas las monedas antes de escribir
-- la primera fila, precisamente para que una moneda irresoluble no deje media
-- libreta dentro. Lo único que no es atómico es el bucle de escrituras.
--
-- Así que el reparto es:
--
--   TypeScript  resuelve  — sesión, cuenta pausada, tasas, país, propiedad de
--                           cada cliente, papelera, índice de documentos, y a
--                           qué cliente pertenece cada movimiento
--   esta función escribe  — crea clientes, completa documentos y WhatsApp,
--                           inserta movimientos. Todo o nada
--
-- ─────────────────────────────────────────────────────────────────────────
-- POR QUÉ ESTO ES ATÓMICO SIN ESCRIBIR `begin`
--
-- El cuerpo de una función PL/pgSQL corre dentro de UNA transacción: si algo
-- levanta una excepción, se deshace todo lo que la función llevaba hecho. No
-- hay que abrirla a mano, y no se puede hacer commit parcial dentro.
--
-- Por eso las validaciones que se conocen de antemano DEVUELVEN un error en
-- vez de levantarlo, y lo hacen antes de la primera escritura: devolver es más
-- barato que deshacer, y deja un mensaje que el dueño puede leer. Lo que
-- levanta excepción es lo inesperado —una restricción que salta— y ahí sí
-- queremos que se deshaga la tanda entera.
--
-- ─────────────────────────────────────────────────────────────────────────
-- EL DUEÑO SALE DE `auth.uid()`, NUNCA DE UN PARÁMETRO
--
-- Misma regla que `record_movement_rejection`. Esta función es SECURITY
-- DEFINER, o sea que se salta RLS: si aceptara un `p_owner` cualquiera podría
-- escribir movimientos en la cartera de otro negocio. Leyendo `auth.uid()` no
-- hay nada que falsificar, y cada `client_id` que llega del navegador se
-- verifica contra ese dueño aquí dentro otra vez —RLS es el respaldo, no la
-- única línea, que es la regla de CLAUDE.md.
--
-- ─────────────────────────────────────────────────────────────────────────
-- LOS MENSAJES NO VIVEN AQUÍ
--
-- Devuelve un `code` y los datos que hagan falta para armar la frase; el texto
-- que lee el tendero se escribe en TypeScript, donde está el resto del copy y
-- donde se puede cambiar sin una migración. Mismo patrón que los `skip` de
-- `whatsapp_send_begin`.
--
-- ─────────────────────────────────────────────────────────────────────────
-- FORMA DEL PAYLOAD
--
-- {
--   "clients_new":       [{key, name, document_id, whatsapp, document_country}],
--   "client_documents":  [{client_id, document_id}],
--   "client_whatsapps":  [{client_id, whatsapp}],
--   "movements":         [{client_id | client_key, type, amount, currency,
--                          description, rate_mode_used, exchange_rate_used,
--                          official_bcv_rate_at_time, entry_currency,
--                          entry_amount, rate_usd_at_time, rate_eur_at_time}]
-- }
--
-- `key` es un identificador temporal que inventa TypeScript para las filas de
-- un cliente que todavía no existe: el movimiento no puede traer un uuid que
-- aún no se ha generado, así que trae la clave y aquí se traduce.

begin;

-- Se tiran las dos: la de esta migración también, para que el archivo se pueda
-- volver a correr. La vez que hace falta correrlo otra vez es justo después de
-- corregirlo.
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
      entry_currency, entry_amount, rate_usd_at_time, rate_eur_at_time
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
      (v_item ->> 'rate_eur_at_time')::numeric
    );

    v_insertados := v_insertados + 1;
  end loop;

  return jsonb_build_object('ok', true,
                            'imported', v_insertados,
                            'clients_created', v_creados);
end;
$$;

-- La llama el DUEÑO con su propia sesión, que es de donde sale `auth.uid()`.
-- Con la clave de servicio `auth.uid()` es nulo y la función se niega sola, así
-- que no hay forma de usarla desde un script sin sesión.
revoke execute on function public.import_libreta(jsonb) from public, anon;
grant execute on function public.import_libreta(jsonb) to authenticated;

insert into public.schema_migrations (key, description)
values (
  '073_import_libreta_transaccional',
  'import_libreta(jsonb): una libreta entra entera o no entra. confirmImport recorria las filas una a una y ante el primer fallo devolvia con las que ya habian entrado, sin transaccion: la fila 27 de 30 dejaba 26 escritas, el dueno entendia "no se importo", lo reintentaba y duplicaba. El cuerpo de una funcion PL/pgSQL es UNA transaccion, asi que una excepcion deshace la tanda entera. NO se mueve todo confirmImport aqui: la resolucion de tasas sigue en TypeScript, porque reescribirla en PL/pgSQL dejaria dos versiones libres de separarse. TypeScript resuelve y esta funcion escribe. El dueno sale de auth.uid() y nunca de un parametro, como record_movement_rejection: es SECURITY DEFINER y se salta RLS, asi que cada client_id del navegador se verifica aqui otra vez. Los mensajes no viven en SQL: devuelve un code y TypeScript arma la frase.'
)
on conflict (key) do nothing;

commit;
