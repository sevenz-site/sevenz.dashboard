-- 145 -- THE CLIENT'S SCREEN GETS THE ONE NUMBER IT WAS MISSING
--
-- Owner's decision on 2026-10-23, asked with the two screens side by side and
-- three ways out on the table: *«igualarlas, la propuesta de valor del
-- producto es "Cuentas claras" y eso es parte de ello»*.
--
-- WHAT HE SAW. He deleted a payment of Mariangel's, his own screen went back
-- to «Crítico», and her link kept saying «Sin plazo». Both sentences were
-- true: the chip is decided by `getClientStatus`, and its last rung —
-- «Crítico» — needs `days_since_payment`, which `get_shared_balance` has
-- never returned. The client's side was judging with one fact less, so the
-- worst state it could ever reach was «Plazo vencido» or «Sin plazo».
--
-- It displaces nothing written before: this is the first time the question
-- «should the client read the same verdict as the shopkeeper?» was put to
-- him. The answer is yes, including the harsh word.
--
-- WHY NOT COMPUTED FROM THE PAYLOAD IT ALREADY HAS, which is the trap: the
-- shared movement list is capped at 50 rows, so «how long since the last
-- payment» could be answered from it only when a payment happens to be in
-- that window. A client with sixty fiados and no payments since would look
-- like one who paid recently. It is the same reason migration `144` exists.
--
-- A SEPARATE FUNCTION AGAIN, not a wider `get_shared_balance`: that one is
-- called by an unauthenticated page on every visit and changing its signature
-- means drop + create, so the deploy order decides whether every share link
-- 404s in between. This one cannot break the page that works, and a database
-- where it has not run yet simply draws the chip as it did yesterday.
--
-- `client_summary_all` AND NOT `client_summary`, deliberately: the filtered
-- view drops a client who is in the Papelera, and `get_shared_balance`
-- resolves a token with no such filter. Using the filtered one would leave a
-- trashed client's link showing its balance with a chip missing, which looks
-- like a bug and is really a mismatch between two queries.

begin;

drop function if exists public.get_shared_days_since_payment(text);

create function public.get_shared_days_since_payment(p_token text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  -- The same column the shopkeeper's screen reads, not a second computation
  -- of it. `client_summary_all` is `security_invoker`, so inside this definer
  -- function it resolves as this function's owner, which is what lets the
  -- token -- and nothing else -- authorize the read.
  select cs.days_since_payment
  from public.share_links sl
  join public.client_summary_all cs on cs.client_id = sl.client_id
  where sl.token = p_token;
$$;

-- Same audience as `get_shared_balance` and `get_shared_open_charges`, and
-- for the same reason: the page is unauthenticated and the token is the
-- credential. The number says nothing the client cannot already work out from
-- their own history -- it is the age of their own last payment.
revoke execute on function public.get_shared_days_since_payment(text) from public;
grant execute on function public.get_shared_days_since_payment(text) to anon, authenticated;

insert into public.schema_migrations (key, description)
values (
  '145_el_cliente_ve_el_mismo_estado',
  'get_shared_days_since_payment(token) devuelve los dias que lleva un cliente sin pagar nada, para que su propia pantalla pueda llegar al estado «Critico» igual que la del tendero. Hasta ahora no lo recibia, asi que el peor estado que podia ensenar era «Plazo vencido» o «Sin plazo»: el dueno borro un abono, su pantalla volvio a «Critico» y el enlace del cliente se quedo en «Sin plazo». Decision del dueno el 2026-10-23: las dos pantallas dicen lo mismo, porque la propuesta de valor del producto es cuentas claras. No se calcula desde el payload que ya tiene porque esa lista viene topada a 50 movimientos y un cliente con sesenta fiados sin pagar pareceria uno que acaba de pagar. Lee client_summary_all y no client_summary porque la vista filtrada deja fuera a un cliente en la papelera, y get_shared_balance resuelve el token sin ese filtro.'
)
on conflict (key) do nothing;

commit;
