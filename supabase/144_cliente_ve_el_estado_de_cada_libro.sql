-- 144 -- THE CLIENT'S OWN VIEW NEEDS ITS OPEN CHARGES, ALL OF THEM
--
-- Owner's instruction on 2026-10-23: each «Por cobrar» card carries its own
-- status chip, *«ya que puede tener un saldo a favor en dólares pero un plazo
-- vencido en euros»*, and *«tanto este requerimiento como el anterior del
-- chip "A favor" en la card aplícalas en la vista del cliente»*.
--
-- WHY THE SHARED PAYLOAD COULD NOT ANSWER IT, which is the whole reason this
-- file exists: `get_shared_balance` returns the LAST 50 movements by default
-- (migration `036`). A status computed from that list would be right for a
-- short history and quietly wrong for a long one -- and wrong in the
-- reassuring direction, because the list is newest-first, so the oldest
-- overdue fiado is exactly the one that falls off it. The client would read
-- «Dentro del plazo» over a debt three months past due, with nothing on
-- screen suggesting the answer was partial.
--
-- A SEPARATE FUNCTION, NOT A WIDER `get_shared_balance`. Same reasoning the
-- `MS-25` consent read already wrote down: that function is called by an
-- unauthenticated page on every visit, and changing its signature means drop
-- + create, so the deploy order decides whether every share link 404s in
-- between. A new function cannot break the page that works.
--
-- IT ONLY RESOLVES THE TOKEN. The judgement itself stays in TypeScript, in
-- `estadoPorLibro`, which the shopkeeper's screen calls with the rows of
-- `get_open_charges_for_client`. One derivation, two screens: the chip the
-- client sees cannot disagree with the one the owner sees. Putting the
-- judgement in SQL as well would have been a second derivation of one figure,
-- which is how the $89.72-vs-$68.59 row happened two days ago.

begin;

-- One signature, created here for the first time, so one drop. Stated because
-- the rule it follows is about the files that change a signature later: a
-- `drop ... if exists` naming only the OLD argument list makes a migration
-- work exactly once.
drop function if exists public.get_shared_open_charges(text);

create function public.get_shared_open_charges(p_token text)
returns table (
  currency    text,
  charge_at   timestamptz,
  amount      numeric,
  pending     numeric,
  plazo_dias  int,
  cuotas      int
)
language sql
stable
security definer
set search_path = public
as $$
  -- `get_open_charges_for_client` is granted to `authenticated` only and is
  -- not itself a definer function, so it reads `movements` under RLS. Called
  -- from inside this definer wrapper it runs as the owner of this function
  -- instead, which is what makes the token -- and nothing else -- the
  -- authorization for this read.
  select oc.currency, oc.charge_at, oc.amount, oc.pending, oc.plazo_dias, oc.cuotas
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  cross join lateral public.get_open_charges_for_client(c.id) oc
  where sl.token = p_token;
$$;

-- Same audience as `get_shared_balance`, and for the same reason: the page is
-- unauthenticated and the token is the credential. No row here that the client
-- cannot already see in their own history -- these are their own fiados, and
-- «Ver todo» already lists every one of them.
revoke execute on function public.get_shared_open_charges(text) from public;
grant execute on function public.get_shared_open_charges(text) to anon, authenticated;

insert into public.schema_migrations (key, description)
values (
  '144_cliente_ve_el_estado_de_cada_libro',
  'get_shared_open_charges(token) devuelve TODOS los fiados abiertos de un cliente, por moneda, para que su propia pantalla pueda pintar un chip de estado por libro. No se le anadio a get_shared_balance a proposito: esa funcion devuelve solo los ultimos 50 movimientos, asi que un estado calculado con su lista seria correcto en un historial corto y falso en uno largo, y falso hacia el lado tranquilizador -- la lista va del mas nuevo al mas viejo, o sea que el fiado vencido mas antiguo es justo el que se cae de ella. Ademas, cambiarle la firma a get_shared_balance obliga a drop + create y el orden de despliegue decide si todos los enlaces compartidos dan 404 mientras tanto. Esta funcion solo resuelve el token: el juicio del estado vive en TypeScript, en estadoPorLibro, que es la misma funcion que usa la pantalla del tendero, para que el chip que ve el cliente no pueda contradecir al que ve el dueno.'
)
on conflict (key) do nothing;

commit;
