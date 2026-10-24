-- THE CLIENT PICKS THE LETTER OF THEIR OWN DOCUMENT TOO.
--
-- Closes the last place a document was captured without its type, found while
-- wiring the prefix on 2026-10-24 and closed the same day at the owner's
-- request. The dialog on `/s/[token]` -- the one a client is shown when their
-- shopkeeper has no document on file for them -- was rendering
-- `DocumentIdInput` with `sinTipo`, precisely because this function could not
-- store a letter.
--
-- ===========================================================================
-- IT IS THE ONE RECORD WE MOST WANT TO BE TRUE
--
-- This is the person typing their OWN document, not a shopkeeper copying it
-- from memory. In Venezuela V and J tell a person apart from a company and E
-- marks a foreign resident, so the letter is a fact about who owes the money,
-- not decoration. Capturing the digits and dropping the letter here threw away
-- the most reliable answer anyone will ever give us.
--
-- ===========================================================================
-- THE SIGNATURE GROWS, SO BOTH ARE DROPPED -- AND THE GRANT IS REDONE
--
-- Postgres overloads on argument types: `create or replace` would leave a
-- SECOND function and PostgREST would resolve calls to either. Dropping only
-- the OLD one makes this file work exactly once. So both go.
--
-- AND `drop function` TAKES THE GRANTS WITH IT. This function is called by an
-- ANONYMOUS visitor -- it is one of the two writes in Sevenz with no session
-- behind them -- so without the grant below the dialog would start answering
-- «No pudimos guardar tu cédula» to every client, and nothing in the
-- migration would have errored. `create or replace` preserves grants; a
-- signature change cannot use it, which is exactly when this is forgotten.
--
-- ===========================================================================
-- THE LETTER IS VALIDATED AGAINST THE BUSINESS'S COUNTRY, AND NEVER REJECTS
--
-- A type that does not belong to the country is dropped to null and the
-- document is still saved. The letter is an ornament of the document, not the
-- document, and this dialog is NON-DISMISSIBLE: refusing it would lock a
-- client out of their own balance over a dropdown. Same criterion as
-- `create_catalog_order` since migration `155`.
--
-- The country comes from the OWNER, which is what the dialog itself used to
-- decide which letters to offer (`get_shared_balance` returns `owner_country`).
-- Validating against anything else would reject what the screen just offered.
--
-- ===========================================================================
-- THE «NEVER OVERWRITE» GUARD IS UNCHANGED, and it still returns first
--
-- A client with a document already on file gets the early return exactly as
-- before, letter or no letter. Changing an existing document is the owner's
-- business from their own screen -- the rule migration `031` set and `079`
-- kept.

drop function if exists public.submit_shared_document_id(text, text);
drop function if exists public.submit_shared_document_id(text, text, text);

create function public.submit_shared_document_id(
  p_token text,
  p_document_id text,
  p_document_type text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_client_id uuid;
  v_existing_document_id text;
  v_digitos text;
  v_country text;
  v_tipo text;
begin
  select c.id, c.document_id, o.country
    into v_client_id, v_existing_document_id, v_country
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  join public.owners o on o.id = c.owner_id
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

  -- SOLO DIGITOS, igual que el campo en pantalla. La letra viaja aparte, en su
  -- propia columna, y nunca pegada dentro del número: el índice único de la
  -- migración `033` normaliza CONSERVANDO las letras, así que «V12345678» y
  -- «12345678» serían dos claves distintas para la misma persona.
  v_digitos := regexp_replace(p_document_id, '[^0-9]', '', 'g');

  if v_digitos = '' then
    return json_build_object('error', 'Escribe solo los números de tu documento, sin letras.');
  end if;

  -- LA LETRA, CONTRA EL PAÍS DEL NEGOCIO. Se descarta en silencio si no
  -- corresponde; nunca rechaza. Ver la cabecera.
  v_tipo := nullif(btrim(coalesce(p_document_type, '')), '');
  if v_tipo is not null then
    if v_country = 'VE' and v_tipo not in ('V', 'E', 'J') then
      v_tipo := null;
    elsif v_country = 'CO' and v_tipo not in ('CC', 'CE', 'NIT') then
      v_tipo := null;
    elsif v_country is null then
      v_tipo := null;
    end if;
  end if;

  -- `coalesce` Y NO UNA ASIGNACIÓN SECA: si el cliente no manda letra -- país
  -- desconocido, o una petición hecha a mano -- lo que la ficha ya tuviera se
  -- queda. Escribir null ahí borraría un dato que el dueño sí había puesto.
  update public.clients
  set document_id = v_digitos,
      document_type = coalesce(v_tipo, document_type),
      document_source = 'client'
  where id = v_client_id;

  return json_build_object('error', null, 'document_id', v_digitos);
end;
$$;

-- IMPRESCINDIBLE: `drop function` se llevó el permiso. Ver la cabecera.
grant execute on function public.submit_shared_document_id(text, text, text) to anon, authenticated;

comment on function public.submit_shared_document_id(text, text, text) is
  'El cliente completa su propio documento desde /s/[token]. La llama un visitante ANÓNIMO: el token resuelve al cliente DENTRO de la función y nunca viaja un id del navegador. Guarda solo dígitos y, desde la migración 156, también la letra (document_type) validada contra el país del negocio y descartada a null si no corresponde — la letra nunca rechaza, porque este diálogo no se puede cerrar y negarlo dejaría al cliente fuera de su propio saldo. Nunca pisa un documento ya guardado.';

insert into public.schema_migrations (key, description)
values (
  '156_el_cliente_elige_la_letra_de_su_cedula',
  'submit_shared_document_id recibe y guarda document_type, validado contra el país del negocio. Cierra el último sitio donde un documento se capturaba sin su letra: el diálogo de /s/[token], que es la persona tecleando su PROPIO documento.'
)
on conflict (key) do nothing;
