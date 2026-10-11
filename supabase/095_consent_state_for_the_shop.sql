-- 095_consent_state_for_the_shop.sql
--
-- ENVIRONMENT: run on the DEV branch (vzqppwrwnmlbrxizskdh). Do NOT run against
-- production (rabmiyqodnvnrwiartuj) until the user says to launch. Order there,
-- when it happens: 081, 082, 091, 092, 093, 094, 095.
--
-- ===========================================================================
-- LA PANTALLA TIENE QUE PODER PREGUNTAR SI ESE TELEFONO YA ACEPTO
--
-- MS-34. Hasta ahora la casilla del permiso salia cuando la FICHA no habia
-- sido preguntada (`whatsapp_consent_asked_at`, migracion 093). Eso no es la
-- pregunta correcta, y lo que lo demostro fue el dueno preguntando por un caso
-- que parecia de esquina: Pedro y el hijo de Pedro comparten telefono.
--
-- EL PERMISO ES DEL NUMERO, NO DE LA FICHA -- la 081 lo decidio asi y esta
-- comprobado (qa:consent 12a y 12b): una ficha nueva con el mismo numero
-- hereda el permiso, y una baja desde ese numero apaga las dos. Pero
-- `asked_at` SI es por ficha, asi que a un telefono con varias fichas se le
-- preguntaria una vez por cada una.
--
-- NO ES UN CASO DE ESQUINA. Medido en dev el 2026-10-10: 32 clientes vivos con
-- numero y 16 telefonos distintos. La mitad de las fichas comparten numero, y
-- hay un numero con NUEVE. Al tendero se le preguntaria nueve veces por la
-- misma persona, y ocho de esas marcas no escribirian nada -- una pantalla
-- preguntando "¿Fulano acepta?" por alguien cuyo telefono ya dijo que si.
--
-- Decision del dueno el 2026-10-10: cuando el telefono ya tiene permiso, la
-- casilla desaparece y en su sitio queda una linea de estado. No se esconde a
-- secas: esconderla dejaria al tendero sin saber si ese cliente esta cubierto,
-- que es informacion que si quiere.
--
-- ===========================================================================
-- POR QUE ESTO NECESITA UNA MIGRACION Y NO SOLO UNA PROP
--
-- `client_accepts_whatsapp()` ya contesta exactamente esa pregunta -- es la
-- unica fuente de verdad de la puerta de envio, y usar OTRA consulta desde la
-- pantalla seria una segunda copia del predicado que algun dia diria algo
-- distinto. Pero esta concedida solo a `service_role`, y la pagina del cliente
-- habla con la base con la SESION del tendero.
--
-- Es el mismo tropiezo de la 094, y por eso aqui se corrige de entrada en vez
-- de descubrirse ejecutando.
--
-- Y EL GRANT A SECAS NO VALE: hoy la funcion no mira de quien es el cliente.
-- Concedida a `authenticated` tal cual, cualquier tendero podria preguntar por
-- el `client_id` de otra bodega y averiguar si ese telefono acepta avisos. Es
-- un booleano, no una fuga grande, pero es informacion sobre una persona que
-- no es suya y no cuesta nada cerrarla.
--
-- La comprobacion solo se aplica CUANDO HAY SESION, igual que en la 094: bajo
-- la clave de servicio `auth.uid()` es null, y ahi estan la puerta de envio
-- (que consulta por cualquier cliente de cualquier dueno, que es su trabajo) y
-- los scripts de qa/. Si la comprobacion fuera incondicional, esta migracion
-- romperia la puerta de envio antes de que existiera.
-- ===========================================================================

begin;

drop function if exists public.client_accepts_whatsapp(uuid);

create function public.client_accepts_whatsapp(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select coalesce(
    (
      select cc.event = 'granted'
      from public.clients c
      join public.client_whatsapp_consents cc
        on cc.phone = public.normalize_whatsapp_phone(c.whatsapp)
      where c.id = p_client_id
        and c.trashed_at is null
        -- Con sesion, solo sobre los clientes de quien pregunta. Sin sesion
        -- (service_role: la puerta de envio, qa/) no filtra nada, porque su
        -- trabajo es justamente mirar los clientes de todos los duenos.
        and (auth.uid() is null or c.owner_id = auth.uid())
      order by cc.occurred_at desc, cc.id desc
      limit 1
    ),
    false
  );
$fn$;

comment on function public.client_accepts_whatsapp(uuid) is
  'Whether Sevenz may write to this client today. False when the number is missing, unreadable, edited since consent, never consented, revoked, or the client is in the bin. Under a session it only answers for that shop''s own clients; under the service key it answers for any, which is what the send gate needs. Never throws, never returns null.';

-- `authenticated` SI, para que la ficha del cliente pueda preguntar sin
-- duplicar el predicado. `anon` NO: /s/[token] tiene su propia puerta,
-- `client_whatsapp_consent_state(token)`, que no expone ningun id.
revoke execute on function public.client_accepts_whatsapp(uuid) from public, anon;
grant execute on function public.client_accepts_whatsapp(uuid) to authenticated, service_role;

insert into public.schema_migrations (key, description)
values (
  '095_consent_state_for_the_shop',
  'MS-34: la pantalla ya puede preguntar si el TELEFONO de un cliente acepta avisos, para esconder la casilla y poner una linea de estado en su sitio. Decision del dueno el 2026-10-10, al preguntar por Pedro y el hijo de Pedro compartiendo numero. El permiso es del numero y no de la ficha (081, comprobado en qa:consent 12a y 12b), pero whatsapp_consent_asked_at SI es por ficha, asi que a un telefono con varias fichas se le preguntaria una vez por cada una. No es un caso raro: medido en dev, 32 clientes vivos con numero y 16 telefonos distintos, uno de ellos compartido por NUEVE fichas. Se reutiliza client_accepts_whatsapp en vez de escribir otra consulta porque es la unica fuente de verdad de la puerta de envio y una segunda copia del predicado acabaria diciendo algo distinto -- o mensajes a quien no acepto, o silencio hacia quien si. Hacia falta migracion porque estaba concedida solo a service_role y la pagina habla con la sesion del tendero (mismo tropiezo que la 094, corregido aqui de entrada). Y el grant a secas no valia: la funcion no miraba de quien es el cliente, asi que cualquier tendero podria preguntar por el client_id de otra bodega. La comprobacion de dueno solo aplica cuando hay sesion; incondicional habria roto la puerta de envio antes de que exista.'
)
on conflict (key) do nothing;

commit;
