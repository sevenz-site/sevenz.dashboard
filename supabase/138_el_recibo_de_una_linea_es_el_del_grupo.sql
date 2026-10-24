-- 138. ASKING FOR ONE LINE'S RECEIPT ASKS FOR THE GROUP'S.
--
-- `137` made a split payment send ONE receipt for the total, through
-- `enviarReciboDeGrupo(group_id)`. The door it did not close is the other one:
-- `enviarReciboAlCliente(movement_id)` keys the send gate by the MOVEMENT, so
-- handed a line that belongs to a group it opens a second send and the client
-- gets a second message -- about a payment he made once.
--
-- ===========================================================================
-- NOBODY CAN REACH IT TODAY, AND THAT IS WHY IT GETS CLOSED NOW
--
-- The two callers of `enviarReciboAlCliente` are `addMovement` and
-- `registrarAbonoDirigido`, and neither creates a group. So this is not a bug
-- being fixed: it is a trap being disarmed before the code that springs it
-- exists.
--
-- It was found by the control row of `qa:recibo` -- `7d`, which asks for one
-- line's receipt on purpose and expects to be refused. Without that row the
-- suite was green and the hole was there: `7a` ("one receipt went out") passes
-- just as happily when nobody happened to ask for the others.
--
-- What it would cost later is the thing this whole feature exists to prevent.
-- A client who already gets messages about his debt from a US number
-- (`MS-17`) getting a second one for a payment he made once is exactly how
-- Sevenz ends up looking like what it is trying not to look like -- and it
-- would surface the way `MS-39` did: not in a log, but in a person asking why.
--
-- ===========================================================================
-- A FUNCTION, NOT A COLUMN ADDED TO `movement_notice_target`
--
-- The obvious move was to return `payment_group_id` from
-- `movement_notice_target` and let the sender branch on it. It was rejected:
-- that function is shared with the deadline reminders, its live definition is
-- the one in migration `101`, and `create or replace`-ing it here means
-- copying its whole body -- every guard of `MS-7`, the consent, the phone, the
-- trash -- to add one key. Copy it slightly wrong and the reminders break, and
-- they break quietly.
--
-- This answers one question and touches nothing: does this movement belong to
-- a split, and to which one.

begin;

drop function if exists public.payment_group_of(uuid);

create function public.payment_group_of(p_movement_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select m.payment_group_id
  from public.movements m
  where m.id = p_movement_id
    and m.deleted_at is null;
$fn$;

-- `service_role` ONLY, like `movement_notice_target` and
-- `payment_group_summary`: this is read by the sender, never by a browser.
revoke execute on function public.payment_group_of(uuid) from public, anon, authenticated;
grant execute on function public.payment_group_of(uuid) to service_role;

comment on function public.payment_group_of(uuid) is
  'A que reparto pertenece un movimiento, o null si no pertenece a ninguno --que son todos los abonos registrados de uno en uno--. La usa el emisor del recibo para que pedir el comprobante de UNA linea de un reparto acabe mandando el del grupo entero y no un segundo mensaje. Es una funcion y no una columna mas en movement_notice_target a proposito: aquella la comparten los recordatorios de plazo, su definicion viva es la de la 101, y anadirle una clave obliga a copiar su cuerpo entero --las guardas de MS-7, el permiso, el telefono, la papelera-- para cambiar una linea; copiarlo un poco mal rompe los recordatorios, y los rompe en silencio.';

insert into public.schema_migrations (key, description)
values (
  '138_el_recibo_de_una_linea_es_el_del_grupo',
  'payment_group_of(movimiento): a que reparto pertenece una fila, para que pedir el recibo de UNA linea de un reparto acabe mandando el del grupo y no un segundo mensaje al cliente. La 137 hizo que un reparto mandara UN recibo por el total via enviarReciboDeGrupo; la puerta que quedaba abierta es la otra, enviarReciboAlCliente(movimiento), que usa el id del MOVIMIENTO como clave de la puerta de envio y por tanto abre un segundo envio si le dan una linea agrupada. HOY NO LO ALCANZA NADIE --los dos que la llaman, addMovement y registrarAbonoDirigido, no crean grupos-- asi que esto no arregla un fallo: desarma una trampa antes de que exista el codigo que la pisa. Lo encontro la fila de control 7d de qa:recibo, que pide el recibo de una linea a proposito y espera que se lo nieguen; sin esa fila la suite estaba verde y el agujero estaba ahi, porque «salio un recibo» pasa igual de contento cuando nadie pidio los otros. ES UNA FUNCION Y NO UNA CLAVE MAS EN movement_notice_target a proposito: aquella la comparten los recordatorios de plazo, su definicion viva es la de la 101, y anadirle una clave obliga a copiar su cuerpo entero --las guardas de MS-7, el permiso, el telefono, la papelera-- para cambiar una linea; copiarlo un poco mal rompe los recordatorios en silencio.'
)
on conflict (key) do nothing;

commit;
