-- EL DOCUMENTO SE GUARDA EN DIGITOS, TAMBIEN CUANDO LO ESCRIBE EL CLIENTE
--
-- ENTORNO: correr en LOS DOS -- primero la rama dev (vzqppwrwnmlbrxizskdh) y
-- despues produccion (rabmiyqodnvnrwiartuj).
--
-- ---------------------------------------------------------------------------
-- DE DONDE SALE ESTO, Y POR QUE NO ES LO QUE LA FICHA CT-32 PEDIA
--
-- CT-32 decia que `normalizeDocumentId` quita la puntuacion pero no las
-- letras, y que por eso un "V-18356808" guardado no casaria con "18356808"
-- tecleado -- partiendo el historial de una persona sin que nadie avise.
--
-- Se midio produccion antes de tocar nada, el 2026-10-03, y la premisa era
-- falsa. De 215 clientes con documento:
--
--   2   tienen alguna letra
--   2   no tienen NINGUN digito  <- son las mismas dos
--   0   pares que hoy esten invisibles y se verian al quitar las letras
--
-- O sea: la poblacion de cedulas con prefijo "V-" que la ficha daba por
-- supuesta NO EXISTE, y nadie en produccion tiene hoy un duplicado escondido
-- por una letra. Las dos filas raras son de un solo caracter, creadas el 1 y
-- el 2 de septiembre -- antes de que el campo pasara a aceptar solo digitos el
-- 17. Basura, no pasaportes.
--
-- Asi que NO se toca la normalizacion. Quitar las letras al comparar no
-- arreglaria ningun caso real y si arriesgaria uno nuevo: en Venezuela la
-- letra es parte de la identidad, y "V-12345678" y "E-12345678" son un
-- venezolano y un extranjero, dos personas distintas. Sevenz empezaria a
-- ofrecer fundirlas.
--
-- ---------------------------------------------------------------------------
-- LO QUE SI HABIA, Y ES LO QUE ESTA MIGRACION CIERRA
--
-- El campo en pantalla filtra los digitos desde el 2026-09-17
-- (`DocumentIdInput`, `replace(/\D/g, "")`), y lo usan las seis pantallas
-- donde se escribe un documento, incluida la del cliente en su propio enlace.
--
-- Pero esta funcion -- la que guarda el documento cuando el CLIENTE lo escribe
-- en `/s/[token]` -- hacia `set document_id = trim(p_document_id)`, sin filtro.
-- Y es la unica puerta de las tres que se alcanza SIN INICIAR SESION.
--
-- El navegador filtrando no es una defensa del servidor: es una comodidad para
-- quien escribe. Una peticion hecha a mano guardaria lo que fuera en el campo
-- del que depende que Sevenz reconozca a dos fichas como la misma persona.
-- Mismo criterio que la regla de las comprobaciones de propiedad explicitas en
-- CLAUDE.md: la capa de arriba no exime a la de abajo.
--
-- ---------------------------------------------------------------------------
-- QUE PASA SI LO QUE LLEGA NO TIENE NINGUN DIGITO
--
-- Se rechaza con un mensaje que dice QUE hacer, en vez de guardar una cadena
-- vacia. Guardar "" seria peor que rechazar: el cliente veria su documento
-- como aceptado, el dueño lo veria vacio, y la comprobacion de duplicados
-- tendria otra fila que no casa con nada.
--
-- El mensaje no menciona nada interno -- es un endpoint publico, y la regla de
-- enmascarar errores en superficies sin autenticar se aplica igual a un
-- mensaje de validacion.
--
-- ---------------------------------------------------------------------------
-- LO QUE NO HACE: LIMPIAR LAS DOS FILAS QUE YA EXISTEN
--
-- A proposito. Son dos clientes reales de un dueño real, y poner su
-- `document_id` a null hace que su enlace vuelva a pedirles el documento. Eso
-- es seguramente lo correcto, pero es una decision sobre los datos de alguien
-- y se toma aparte, no de regalo dentro de una migracion de funcion.

begin;

create or replace function public.submit_shared_document_id(p_token text, p_document_id text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_existing_document_id text;
  v_digitos text;
begin
  select c.id, c.document_id into v_client_id, v_existing_document_id
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  where sl.token = p_token;

  if v_client_id is null then
    return json_build_object('error', 'Link inválido.');
  end if;

  -- NUNCA PISA UNO YA GUARDADO. Se queda como estaba (ver la 031): una persona
  -- pone su documento una vez, y cambiarlo es cosa del dueño desde su ficha.
  if v_existing_document_id is not null and trim(v_existing_document_id) <> '' then
    return json_build_object('error', null, 'document_id', v_existing_document_id);
  end if;

  if p_document_id is null or trim(p_document_id) = '' then
    return json_build_object('error', 'Escribe tu número de documento.');
  end if;

  -- SOLO DIGITOS, igual que el campo en pantalla. La "V-" de la cedula
  -- venezolana se enseña fuera del input desde el 2026-09-17 y no forma parte
  -- de lo que se guarda.
  v_digitos := regexp_replace(p_document_id, '[^0-9]', '', 'g');

  if v_digitos = '' then
    return json_build_object('error', 'Escribe solo los números de tu documento, sin letras.');
  end if;

  update public.clients
  set document_id = v_digitos,
      document_source = 'client'
  where id = v_client_id;

  return json_build_object('error', null, 'document_id', v_digitos);
end;
$$;

insert into public.schema_migrations (key, description)
values (
  '079_documento_solo_digitos',
  'submit_shared_document_id guarda solo digitos, igual que el campo en pantalla desde el 2026-09-17. Era la unica de las tres puertas que escriben document_id alcanzable SIN iniciar sesion, y hacia trim() sin filtro: el navegador filtrando es una comodidad para quien escribe, no una defensa del servidor, y una peticion hecha a mano guardaria lo que fuera en el campo del que depende la deteccion de duplicados. Si lo que llega no tiene ningun digito se RECHAZA con un mensaje que dice que hacer, en vez de guardar una cadena vacia que el cliente veria como aceptada y el dueño veria vacia. Sale de medir CT-32 en produccion el 2026-10-03: de 215 clientes con documento solo 2 tienen letras, los 2 sin ningun digito y creados antes de que el campo se endureciera, y CERO pares estan hoy invisibles por una letra. Por eso NO se toca la normalizacion: quitar las letras al comparar no arreglaria ningun caso real y arriesgaria confundir V-12345678 con E-12345678, que en Venezuela son dos personas distintas. No limpia las dos filas existentes: son datos de clientes reales y esa decision se toma aparte.'
)
on conflict (key) do nothing;

commit;
