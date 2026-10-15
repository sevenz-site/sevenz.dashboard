-- LA PUERTA POR LA QUE ENTRA UNA ORDEN, Y SUS CINCO CANDADOS.
--
-- La escribe un visitante ANONIMO por un enlace hecho para circular. Es la
-- unica escritura de Sevenz que no tiene detras ni una sesion ni una fila que
-- ya existiera, asi que todo lo que normalmente comprueba la aplicacion tiene
-- que comprobarlo esta funcion.
--
-- ===========================================================================
-- EL CANDADO 5 ES EL QUE NO ES OBVIO: EL PRECIO NO VIAJA
--
-- Quien llama manda QUE producto, CUANTOS y EN QUE MONEDA. El importe lo lee
-- esta funcion de la ficha. Si el precio viajara en la peticion, cualquiera
-- con las herramientas del navegador abiertas cambiaria un 5 por un 0.01 y
-- mandaria la orden: al tendero le llegaria un pedido por dos centimos con
-- pinta de venir de Sevenz.
--
-- Y HAY UN COROLARIO QUE SIMPLIFICA TODO: aqui NO se convierte nada con la
-- tasa. Las monedas que la pantalla ofrece son la base del producto mas las
-- que el tendero fijo a mano para ese escalon (`monedasDelEscalon`), o sea que
-- cualquier moneda valida tiene un importe EXACTO en la base de datos. Si la
-- moneda pedida no es una de esas, la orden se rechaza en vez de inventarse
-- una conversion. Eso cierra de paso la deriva entre lo que el cliente vio y
-- lo que queda escrito: no hay tasa de por medio que pueda haberse movido
-- entre que miro la pantalla y pulso el boton.
--
-- ===========================================================================
-- EL ESCALON LO DECIDE ESTA FUNCION, Y HAY UNA COPIA EN TYPESCRIPT
--
-- `lib/products/public-pricing.ts` tiene la misma regla, y eso es dos copias
-- de una logica de dinero — justo lo que este proyecto evita en todas partes.
-- Aqui no hay alternativa: la pantalla tiene que ENSENAR el precio antes de
-- enviar, y el servidor tiene que DECIDIRLO sin fiarse de la pantalla.
--
-- La jerarquia queda escrita para que nadie la invente mas tarde: **manda
-- esta funcion**. La de TypeScript es presentacion. El dia que discrepen, el
-- cliente vera un precio y la orden guardara otro, y ese es un fallo que no
-- da ningun error — por eso `qa:orden` compara las dos con los mismos casos.

begin;

drop function if exists public.create_catalog_order(text, text, text, text, boolean, text, jsonb);

create function public.create_catalog_order(
  p_token text,
  p_customer_name text,
  p_customer_document text,
  p_customer_whatsapp text,
  p_wants_notices boolean,
  -- La frase literal que la casilla tenia en pantalla. Es LA evidencia ante
  -- Meta, misma regla que el resto de los permisos: dos textos distintos
  -- convierten la prueba en una reconstruccion.
  p_consent_text text,
  -- [{ "product_id": uuid, "quantity": number, "currency": text,
  --    "comment": text|null }]
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- LOS TOPES, JUNTOS Y ARRIBA para que se vean de un vistazo y se cambien en
  -- un sitio. Los numeros tienen razon de ser, no son redondos por gusto:
  --
  --   50 lineas: un pedido de bodega real no pasa de diez. Cincuenta deja
  --   sitio de sobra y corta una peticion de megabytes.
  --
  --   20 por minuto y por enlace: un guion hace miles por minuto y una bodega
  --   no hace veinte. El limite distingue las dos cosas por su FORMA, no por
  --   su volumen, que es lo que evita bloquear a un cliente de verdad.
  --   Vigilarlo es `CT-68`, porque quedarse corto cuesta ventas y no avisa.
  c_max_lineas constant int := 50;
  c_max_por_minuto constant int := 20;

  v_owner_id uuid;
  v_link_id uuid;
  v_recientes int;
  v_phone text;
  v_nombre text;
  v_documento text;
  v_order_id uuid;
  v_item jsonb;
  v_n_items int;

  p public.products%rowtype;
  v_cantidad numeric;
  v_moneda text;
  v_tier text;
  v_precio numeric;
  v_fijado numeric;
  v_min numeric;
begin
  -- ── CANDADO 1: el dueno sale del TOKEN ────────────────────────────────
  select owner_id, id into v_owner_id, v_link_id
  from public.catalog_share_links
  where token = p_token;

  if not found then
    -- El mismo «no» para un token inexistente y para uno revocado, igual que
    -- en el resto de las superficies publicas: quien pruebe tokens al azar no
    -- aprende nada de la diferencia.
    return jsonb_build_object('ok', false, 'reason', 'enlace_invalido');
  end if;

  -- ── CANDADO 4: tope por enlace y por minuto ───────────────────────────
  select count(*) into v_recientes
  from public.catalog_orders
  where catalog_link_id = v_link_id
    and created_at > now() - interval '1 minute';

  if v_recientes >= c_max_por_minuto then
    return jsonb_build_object('ok', false, 'reason', 'demasiadas_ordenes');
  end if;

  -- ── Quien pide ────────────────────────────────────────────────────────
  v_nombre := btrim(coalesce(p_customer_name, ''));
  v_documento := btrim(coalesce(p_customer_document, ''));

  if v_nombre = '' or length(v_nombre) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'nombre_invalido');
  end if;

  if v_documento = '' or length(v_documento) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'documento_invalido');
  end if;

  -- Normalizado AQUI y nunca por quien llama, que es la misma regla que el
  -- resto del producto: el telefono es la clave del permiso y dos formas de
  -- escribir el mismo numero son dos personas distintas para la base.
  v_phone := public.normalize_whatsapp_phone(p_customer_whatsapp);
  if v_phone is null then
    return jsonb_build_object('ok', false, 'reason', 'whatsapp_invalido');
  end if;

  -- ── CANDADO 3: tamano ─────────────────────────────────────────────────
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    return jsonb_build_object('ok', false, 'reason', 'sin_productos');
  end if;

  v_n_items := jsonb_array_length(p_items);
  if v_n_items = 0 then
    return jsonb_build_object('ok', false, 'reason', 'sin_productos');
  end if;
  if v_n_items > c_max_lineas then
    return jsonb_build_object('ok', false, 'reason', 'demasiados_productos');
  end if;

  -- ── La orden ──────────────────────────────────────────────────────────
  insert into public.catalog_orders (
    owner_id, catalog_link_id,
    customer_name, customer_document,
    customer_whatsapp, customer_whatsapp_raw,
    wants_whatsapp_notices
  )
  values (
    v_owner_id, v_link_id,
    v_nombre, v_documento,
    v_phone, btrim(coalesce(p_customer_whatsapp, '')),
    coalesce(p_wants_notices, false)
  )
  returning id into v_order_id;

  -- ── Las lineas, una por una ───────────────────────────────────────────
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    -- CANDADO 2: el producto es de ESTE dueno, no esta en la papelera y esta
    -- publicado. Un id cualquiera pegado en la peticion no entra.
    select * into p
    from public.products
    where id = (v_item ->> 'product_id')::uuid
      and owner_id = v_owner_id
      and trashed_at is null
      and (published_retail or published_wholesale);

    if not found then
      -- Se deshace la orden entera. Media orden es peor que ninguna: el
      -- tendero atenderia un pedido al que le falta lo que el cliente creia
      -- haber pedido, sin que nada lo diga.
      raise exception 'producto_invalido' using errcode = 'P0001';
    end if;

    v_cantidad := (v_item ->> 'quantity')::numeric;
    if v_cantidad is null or v_cantidad <= 0 or v_cantidad > 99999999999 then
      raise exception 'cantidad_invalida' using errcode = 'P0001';
    end if;

    -- EL ESCALON, con la misma regla que `escalonParaCantidad`. Ver la
    -- cabecera: aqui es donde se DECIDE, el TypeScript solo lo ensena.
    --
    -- Sin cantidad minima NUNCA se llega al mayor, y es el lado seguro: un
    -- precio mayorista cobrado por una unidad es dinero perdido. La migracion
    -- 088 permite el nulo y documenta lo contrario; se descarta a proposito.
    v_min := p.wholesale_min_quantity;
    if not (p.published_retail and p.price_retail is not null) then
      v_tier := 'wholesale';
    elsif not (p.published_wholesale and p.price_wholesale is not null) then
      v_tier := 'retail';
    elsif v_min is null then
      v_tier := 'retail';
    elsif v_cantidad >= v_min then
      v_tier := 'wholesale';
    else
      v_tier := 'retail';
    end if;

    -- EL MINIMO ES BARRERA SOLO CUANDO NO HAY DONDE CAER. Un producto que solo
    -- se vende al mayor no tiene precio de detal al que bajar, asi que pedir
    -- menos del minimo no significa nada. Con los dos escalones publicados,
    -- pedir poco si significa algo: es el precio al detal.
    if v_tier = 'wholesale'
       and not (p.published_retail and p.price_retail is not null)
       and v_min is not null and v_cantidad < v_min then
      raise exception 'cantidad_bajo_el_minimo' using errcode = 'P0001';
    end if;

    v_precio := case when v_tier = 'wholesale' then p.price_wholesale else p.price_retail end;
    if v_precio is null then
      raise exception 'sin_precio' using errcode = 'P0001';
    end if;

    -- CANDADO 5: el importe sale de la ficha.
    --
    -- La moneda pedida tiene que ser la base del producto o una fijada a mano
    -- para ESTE escalon. Nada se convierte con la tasa: ver la cabecera.
    v_moneda := upper(btrim(coalesce(v_item ->> 'currency', '')));
    if v_moneda <> p.base_currency then
      select amount into v_fijado
      from public.product_price_overrides
      where product_id = p.id and tier = v_tier and currency = v_moneda;

      if not found then
        raise exception 'moneda_invalida' using errcode = 'P0001';
      end if;
      v_precio := v_fijado;
    end if;

    insert into public.catalog_order_items (
      order_id, product_id, product_name,
      quantity, unit_price, currency, tier, comment
    )
    values (
      v_order_id, p.id, p.name,
      v_cantidad, v_precio, v_moneda, v_tier,
      nullif(btrim(coalesce(left(v_item ->> 'comment', 500), '')), '')
    );
  end loop;

  -- ── El permiso, si lo pidio ───────────────────────────────────────────
  --
  -- DECISION DEL DUENO EL 2026-10-15, y desplaza la «salida A» que el mismo
  -- habia decidido el 2026-10-14. La razon vieja queda escrita porque es la
  -- que haria falta para revertir: el permiso vale para TODOS los negocios
  -- (migracion 081) y aqui el numero lo teclea un visitante anonimo, asi que
  -- cualquiera podria dar de alta el numero de un tercero.
  --
  -- Lo que lo desplaza es que el tendero ahora ABRE la orden y verifica
  -- nombre, documento y telefono —puede corregirlos— antes de atenderla. Esa
  -- es la doble verificacion que el 14 no existia.
  --
  -- El riesgo que queda, dicho: el permiso existe desde que se marca la
  -- casilla hasta que el tendero mira. En esa ventana no sale ningun mensaje
  -- por si solo —hace falta ademas que ese numero sea cliente de alguna bodega
  -- y que le registren un movimiento— pero la ventana existe. Por eso el
  -- origen es `client_order` y no `client_self`: si algun dia hay que
  -- encontrarlos y revocarlos, esta columna es la unica forma.
  if coalesce(p_wants_notices, false) and btrim(coalesce(p_consent_text, '')) <> '' then
    insert into public.client_whatsapp_consents (phone, event, consent_text, source)
    values (v_phone, 'granted', btrim(p_consent_text), 'client_order');
  end if;

  return jsonb_build_object('ok', true, 'order_id', v_order_id);

exception
  when sqlstate 'P0001' then
    -- El texto del `raise` es un codigo estable, no una frase para ensenar.
    -- Quien llama lo traduce; la pagina publica NUNCA ensena texto crudo de la
    -- base, que es la regla de CLAUDE.md sobre enmascarar errores.
    --
    -- Y ATRAPARLO AQUI DESHACE LA ORDEN ENTERA, que es el comportamiento
    -- buscado: un bloque con `exception` es una subtransaccion, asi que al
    -- entrar aqui las filas ya insertadas se van. Media orden es peor que
    -- ninguna — el tendero atenderia un pedido al que le falta lo que el
    -- cliente creia haber pedido, sin que nada lo diga.
    return jsonb_build_object('ok', false, 'reason', sqlerrm);

  when others then
    -- LO QUE NO PREVIMOS. Un `product_id` que no es un uuid, una cantidad que
    -- no es un numero: cosas que no vienen de un navegador normal y que, sin
    -- esto, saldrian como un error crudo de Postgres.
    --
    -- Al que llama se le da una razon generica —regla de enmascarar errores—
    -- y el detalle real va al log del servidor con `raise warning`, que es el
    -- unico sitio donde queremos verlo. Sin el `warning`, este `when others`
    -- se tragaria tambien nuestros propios fallos y no lo sabriamos nunca.
    raise warning 'create_catalog_order fallo inesperado: % (%)', sqlerrm, sqlstate;
    return jsonb_build_object('ok', false, 'reason', 'error');
end;
$fn$;

-- REVOCAR A `public` NO BASTA. Supabase concede EXECUTE a anon, authenticated
-- y service_role sobre toda funcion nueva del esquema public mediante `alter
-- default privileges`, asi que quitarle el permiso a `public` no toca ese
-- grant explicito. La migracion 067 documenta el agujero real que esto abrio
-- una vez. Aqui anon SI debe poder llamarla —es quien hace el pedido— pero se
-- nombra a proposito en vez de heredarlo sin querer.
revoke execute on function public.create_catalog_order(text, text, text, text, boolean, text, jsonb) from public;
grant execute on function public.create_catalog_order(text, text, text, text, boolean, text, jsonb) to anon, authenticated;

comment on function public.create_catalog_order(text, text, text, text, boolean, text, jsonb) is
  'Crea una orden desde el catalogo publico. La llama un visitante ANONIMO. Cinco candados: el dueno sale del token y nunca del navegador; cada producto se valida como suyo, sin borrar y publicado; topes de tamano (50 lineas, textos acotados); tope de 20 ordenes por enlace y por minuto; y el PRECIO lo calcula esta funcion leyendolo de la ficha, nunca viaja en la peticion. No convierte con la tasa: la moneda pedida tiene que ser la base del producto o una fijada a mano para ese escalon, o la orden se rechaza. El escalon lo decide esta funcion con la misma regla que lib/products/public-pricing.ts, y MANDA esta: la de TypeScript es presentacion.';

insert into public.schema_migrations (key, description)
values (
  '109_crear_orden_del_catalogo',
  'create_catalog_order: la puerta por la que un visitante ANONIMO crea una orden desde el catalogo publico. Primera escritura sin sesion ni fila previa de todo Sevenz, asi que lleva los cinco candados acordados con el dueno el 2026-10-15: (1) el owner sale del token, nunca del navegador; (2) cada producto se valida como de ese dueno, sin trashed_at y publicado; (3) topes de tamano, 50 lineas y textos acotados; (4) tope de 20 ordenes por enlace y por minuto -- un guion hace miles por minuto y una bodega no hace veinte, asi que el limite distingue por FORMA y no por volumen; vigilarlo es CT-68 porque quedarse corto cuesta ventas y no avisa; (5) el PRECIO lo lee la funcion de la ficha y NUNCA viaja en la peticion, porque si viajara cualquiera cambiaria un 5 por un 0.01 desde las herramientas del navegador. Corolario del quinto: no se convierte nada con la tasa -- la moneda pedida tiene que ser la base o una fijada a mano para ese escalon, o se rechaza, lo que ademas elimina la deriva entre lo que el cliente vio y lo que queda escrito. El escalon se decide aqui con la misma regla que public-pricing.ts y MANDA esta; la de TypeScript es presentacion y qa:orden compara las dos. Media orden no existe: cualquier linea invalida deshace la orden entera. El permiso de WhatsApp entra con source client_order -- decision del dueno del 2026-10-15 que desplaza la salida A del 14, apoyada en que ahora el tendero abre la orden y verifica los datos.'
)
on conflict (key) do nothing;

commit;

-- ── verification, after running the above ───────────────────────────────
--
-- 1. Una sola version de la funcion, y `anon` puede llamarla:
--
-- select has_function_privilege('anon', 'public.create_catalog_order(text, text, text, text, boolean, text, jsonb)', 'execute') as anon_puede;
--
-- EXPECTED: true.
--
-- 2. Y `anon` sigue sin tocar las tablas:
--
-- select count(*) as grants_de_anon
-- from information_schema.role_table_grants
-- where table_schema = 'public' and table_name like 'catalog_order%' and grantee = 'anon';
--
-- EXPECTED: 0. La puerta es la funcion, no la tabla.
