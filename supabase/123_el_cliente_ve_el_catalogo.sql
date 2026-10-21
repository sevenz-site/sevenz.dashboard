-- THE CLIENT'S BALANCE PAGE LEARNS THAT THE SHOP HAS A CATALOGUE.
--
-- Owner's commission of 2026-10-17, frame `1378:7916`: `/s/[token]` gains a
-- "Productos" strip, and tapping any card -- or "Ver todo" -- opens the
-- catalogue that already exists at `/c/[token]`.
--
-- THE PROBLEM THIS SOLVES IS A TOKEN, NOT A QUERY. The two public pages are
-- reached by two DIFFERENT tokens: `/s/` carries a `share_links.token`, which
-- belongs to one client, and `/c/` carries a `catalog_share_links.token`,
-- which belongs to the business. A client holding the first has no way to
-- learn the second, so the link between the two screens cannot be built on
-- the page. It has to be resolved here, where the owner is known.
--
-- WHY A FUNCTION OF ITS OWN AND NOT A FIELD IN `get_shared_balance`, which is
-- the obvious-looking place: that function is called by an unauthenticated
-- page on EVERY visit, and changing its shape means drop + create. On
-- 2026-09-04 adding an argument to it would have 404ed every share link in
-- production. `117_de_quien_es_un_enlace_compartido.sql` made exactly this
-- call for exactly this reason, and `client_whatsapp_consent_state` before
-- it. A separate function cannot break the page that works.
--
-- GRANTED TO `service_role` ONLY, same as 117. The anon key travels to the
-- browser, and this function turns a client's token into the business's
-- catalogue token. That is not a secret the client is being kept from -- they
-- are about to be handed a link to it -- but a public RPC that maps one
-- token to another is a door, and this one does not need to be open.

begin;

drop function if exists public.get_shared_catalog_preview(text);

create function public.get_shared_catalog_preview(p_token text)
returns json
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  -- EIGHT, NOT THE THREE THE FRAME DRAWS. The frame's third card is clipped
  -- by the screen edge on purpose -- that is the "there is more, scroll me"
  -- affordance -- so the strip was always going to hold more than it shows.
  -- Eight fills it without turning the balance page into a second catalogue;
  -- "Ver todo" is what the rest is for.
  c_max constant int := 8;
  v_owner_id uuid;
  v_catalog_token text;
  v_products json;
begin
  -- THE SAME JOIN `share_link_owner` MAKES, including `trashed_at is null`:
  -- a client in the bin must not keep resolving to a live business. Written
  -- out rather than calling that function because this one is `stable` and
  -- needs the owner id, not the email -- and because a second call would be a
  -- second place for the two to disagree about what a valid token is.
  select c.owner_id into v_owner_id
  from public.share_links sl
  join public.clients c on c.id = sl.client_id
  where sl.token = p_token
    and c.trashed_at is null;

  -- An unknown token is null, never an error: the same contract as
  -- `get_shared_balance`, `client_whatsapp_consent_state` and
  -- `share_link_owner`. The caller renders nothing, which is right -- a
  -- "Productos" heading over an empty strip is worse than no heading.
  if not found then
    return null;
  end if;

  select token into v_catalog_token
  from public.catalog_share_links
  where owner_id = v_owner_id;

  -- NO LINK MEANS NO SECTION, and no link is the NORMAL state: the catalogue
  -- is opt-in, so most businesses have never created one. Nothing is created
  -- here -- this is reached from a page with no session, and a page anybody
  -- can open must not write. The screen hides the whole block instead.
  if v_catalog_token is null then
    return json_build_object('catalog_token', null, 'products', '[]'::json);
  end if;

  -- THE SAME ROWS, THE SAME PRICES AND THE SAME ORDER AS `get_shared_catalog`.
  --
  -- That is the whole requirement, and it is easy to get subtly wrong. The
  -- client taps a card and lands on the catalogue; if this strip ordered
  -- differently, or priced differently, the product they tapped would not be
  -- where they expect it, or would cost something else when they got there.
  -- A price that changes between two screens of the same shop reads as a
  -- trick, not as a bug.
  --
  -- So the lateral join below is copied from `get_shared_catalog` in
  -- migration 114, including its comment: THE TIER CARRIES ITS OWN BASE OUT
  -- OF THE LATERAL. Recomputing the base with a `case` at each use is how one
  -- tier ends up priced in the other's currency -- a silent ~8% error that
  -- nothing would catch.
  select json_agg(x.card order by x.name asc) into v_products
  from (
    select
      p.name,
      json_build_object(
        'id', p.id,
        'name', p.name,
        'photo_path', p.photo_path,
        'price', pr.amount,
        'base_currency', pr.base,
        -- THE TIER TRAVELS EVEN THOUGH THE FRAME DOES NOT DRAW IT, and that
        -- is deliberate. A product published only at wholesale shows its
        -- wholesale price here, and a bare figure would read as the price of
        -- one unit. The catalogue card says "precio al mayor" underneath for
        -- that exact reason; the strip says "al mayor" in its own way. The
        -- alternative -- leaving the tier out and showing the number alone --
        -- is the only version of this screen that can mislead about money.
        'tier', pr.tier
      ) as card
    from public.products p
    join lateral (
      select c.tier, c.amount, c.base
      from (
        select 'retail'::text as tier, p.price_retail as amount,
               p.base_currency_retail as base, 1 as prioridad
        where p.published_retail and p.price_retail is not null
        union all
        select 'wholesale'::text, p.price_wholesale,
               p.base_currency_wholesale, 2
        where p.published_wholesale and p.price_wholesale is not null
      ) c
      order by c.prioridad asc
      limit 1
    ) pr on true
    where p.owner_id = v_owner_id
      and p.trashed_at is null
      and (p.published_retail or p.published_wholesale)
    order by p.name asc
    limit c_max
  ) x;

  return json_build_object(
    'catalog_token', v_catalog_token,
    'products', coalesce(v_products, '[]'::json)
  );
end;
$fn$;

revoke execute on function public.get_shared_catalog_preview(text) from public, anon;
grant execute on function public.get_shared_catalog_preview(text) to service_role;

comment on function public.get_shared_catalog_preview(text) is
  'Takes a CLIENT share token (share_links) and returns the business catalogue token (catalog_share_links) plus up to 8 published products, so /s/[token] can show a "Productos" strip that opens /c/[token]. The two public pages are reached by two different tokens and the client only holds one of them, which is why this resolution cannot happen on the page. Rows, prices and ordering are copied from get_shared_catalog so a product does not move or change price between the strip and the catalogue it opens. A business with no catalogue link returns catalog_token null and an empty list -- nothing is created here, because the caller is a page with no session. service_role only: the anon key reaches the browser and this maps one token to another.';

insert into public.schema_migrations (key, description)
values (
  '123_el_cliente_ve_el_catalogo',
  'get_shared_catalog_preview(token): a partir del enlace de UN CLIENTE devuelve el token del catalogo del negocio y hasta 8 productos publicados, para la franja «Productos» de /s/[token] que encargo el dueno el 2026-10-17 (frame 1378:7916). Hacia falta porque las dos paginas publicas se abren con tokens DISTINTOS -- /s/ lleva uno de share_links y /c/ uno de catalog_share_links -- y el cliente solo tiene el primero, asi que el puente no se puede construir en la pantalla. Funcion aparte y no un campo nuevo en get_shared_balance: esa la llama la pagina publica en cada visita y cambiarle la firma obliga a drop+create con el riesgo de 404ear todos los enlaces, que es justo lo que casi pasa el 2026-09-04. Las filas, los precios y el orden estan copiados de get_shared_catalog para que un producto no cambie de sitio ni de precio entre la franja y el catalogo que abre. Un negocio sin enlace de catalogo devuelve token nulo y lista vacia: aqui no se crea nada, porque quien llama es una pagina sin sesion. Concedida SOLO a service_role, igual que la 117.'
)
on conflict (key) do nothing;

commit;
