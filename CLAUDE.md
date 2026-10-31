@AGENTS.md

# Sevenz working rules

## Dev-only by default

Every code change, SQL migration, and any git action that touches `main`
only happens when the user explicitly asks for it **in that specific
request**. A prior "go ahead" or a completed launch never carries forward
to the next batch of work — each production-facing action needs its own
explicit green light, no matter how many times it's been given before.

This covers, concretely:
- Writing or editing application code — always on `dev` unless told otherwise.
- Any SQL migration — write it, but do not tell the user to run it against
  production, and do not run it yourself, until they've said to launch.
- `git push` to `main`, or `git push origin dev:main` — never do this
  proactively. Merging `dev` into `main` is a production deploy.
- Anything that touches the production Supabase project directly (SQL
  editor scripts, env vars, dashboard settings).

As of 2026-08-27, dev is a **persistent Supabase branch** of the production
project (branch ref `vzqppwrwnmlbrxizskdh`), not a separate project — this
replaced the old standalone dev project (`ukufbludmpmcgdpqnvtm`, now retired
but left dormant, not deleted). Production is `rabmiyqodnvnrwiartuj`. A
migration still has to be run manually in both the branch and production —
branching only removed "two unrelated projects to remember," not "run every
migration twice."

**Gotcha if another branch is ever created**: branch creation clones
everything in the `public` schema (tables, functions, grants) correctly, but
a trigger defined on `auth.users` does not get cloned, even though the
function it calls does. Concretely, `handle_new_user()` existed on the new
branch but the `on_auth_user_created` trigger firing it didn't, so signups
silently created no `owners` row. A schema check that only verifies the
function exists won't catch this — only one that verifies a real signup
actually produced an owner row will. Fix, if it recurs:

```sql
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

**Second gotcha, found 2026-08-28: Storage buckets don't get cloned either.**
Branch creation clones the SQL schema (tables, policies, functions) but not
Storage buckets — the dev branch had zero buckets at all (`logos`,
`attachments` both existed only in production), meaning every logo/attachment
upload would fail outright until this was caught. A schema check that only
verifies `storage.objects` policies exist won't catch this either — the
policies can be perfectly correct while the buckets they apply to don't
exist. Fix, if it recurs (see `supabase/030_dev_storage_buckets.sql` for the
full version matching this project's actual buckets):

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('<bucket>', '<bucket>', <public bool>, <bytes>, array['<mime>', ...])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
```
Then recreate every policy on `storage.objects` for that bucket — they're
ordinary Postgres policies, droppable/creatable like any other.

## Deploy order, and keeping `dev` and `main` identical

`dev` is where work happens; `main` is production — pushing to it deploys.
Every deploy follows the same four steps, in this order, and step 4 is not
optional bookkeeping: skipping it is what makes step 2 stop working.

**1. Migrations into production first, code second.** Always. The code is
written against the new schema, so shipping it first means every request
hitting the changed function fails. On 2026-09-04, `app/s/[token]/page.tsx`
started passing `p_limit` to `get_shared_balance`; deploying that before
migration 036 would have made *every* share link 404 — Venezuelan as well as
Colombian — instead of fixing the Colombian ones. The reverse order degrades
gracefully instead: the old code's one-argument call still resolved against
the new function and simply defaulted. Prefer the order whose failure mode is
"slightly reduced" over the one whose failure mode is "everyone is down."

**2. Before merging, check for divergence.** Run:

```sh
git diff origin/dev...origin/main
```

Empty means `main` holds no code `dev` lacks, and the merge is safe. **Any
output means stop** — production contains something `dev` doesn't (typically
a hotfix applied straight to `main`), and merging `dev` over it would silently
revert that work. A successful-looking deploy that quietly reinstates a fixed
bug is the failure this check exists to prevent.

Do not substitute `git log origin/dev..origin/main` for this. Counting commits
is not the same question. On 2026-09-04 that log showed 6 commits on `main`
missing from `dev` — which looked alarming and was nothing: all six were
`Merge dev:` commits, the receipts `main` writes each time it takes work from
`dev`, and `dev` never receives back. The file diff was empty. **Commit counts
mislead; the file diff decides.**

**3. Merge with `--no-ff`** so `git log --first-parent origin/main` stays a
clean list of production versions, one line per deploy. That list is the
rollback menu.

**4. Merge `main` back into `dev` immediately after deploying**, so the two
branches are identical again. This changes no code — it only carries the merge
receipt across — and it's what keeps step 2's check meaningful. Without it the
gap grows by one every release, until "6 commits on main" is background noise
nobody reads, and a real hotfix eventually gets overwritten unnoticed.

### Cuando la rama de release NO sale de `dev`

A veces hay que desplegar una parte y dejar el resto en `dev` — porque `dev`
lleva trabajo a medias que no puede salir. La forma que funciona es **cortar una
rama de `main`**, poner ahí solo lo que se despliega, y mergearla a `main`. Se
hizo el 2026-10-15 para sacar WhatsApp dejando el catálogo dentro de `dev`, y
salió bien.

Lo que esa forma cuesta se paga **en el paso 4**, y conviene saberlo antes de
llegar: si `dev` ya tenía sus propias copias de ese mismo trabajo —porque se
construyó ahí primero y luego se rehízo en la rama— el back-merge **choca en
todos los archivos tocados**. Ese día fueron nueve a la vez. No es un merge que
traiga algo nuevo: es uno que reconcilia dos copias de lo mismo.

**Cómo resolverlo sin pisar trabajo, y no a ojo.** La tentación es resolver todo
a favor de `main` porque «es lo que está en producción», y normalmente es la
respuesta correcta — pero es una conclusión, no un punto de partida. Antes de
tomar un lado, **compara el código no comentado de los dos**, archivo por
archivo:

```sh
git show :2:<archivo>   # ours   = dev
git show :3:<archivo>   # theirs = main
```

Quitando las líneas de comentario de cada lado, si el resto sale **idéntico**,
quedarse con `main` no descarta ni una línea de lógica. Si sale distinto, `dev`
tiene trabajo que `main` no tiene y hay que mirarlo a mano. El 2026-10-15 los
nueve salieron idénticos y lo único que difería era la prosa: `dev` tenía los
comentarios en español y una cifra que resultó falsa.

**Por qué esto importa más que un conflicto normal**: resolver nueve archivos a
favor de un lado con `--theirs` tarda un segundo y no avisa de nada. Es la forma
exacta de revertir en silencio algo que `dev` tenía y nadie recordaba — que es el
mismo fallo que el paso 2 existe para prevenir, entrando por la puerta de atrás.

### The one exception: never back-merge a revert on autopilot

If production is ever rolled back by **reverting on `main`** (not a Vercel
rollback — see below), stop before step 4 and ask the user what `dev` should
do with it. A revert merged into `dev` removes the feature *there* too, and
because the revert stays in history, rebuilding on top can have a later merge
strip it out again. This is the one case where the routine is wrong.

### Rolling back

Reach for **Vercel first**: promote the previous deployment in the dashboard.
It takes seconds, needs no rebuild, and touches no git history — so nothing
propagates anywhere and step 4 stays safe. Then reconcile git deliberately
(revert or fix forward), because until you do, `main` still claims the broken
version is current and the next push redeploys it.

**Roll back code, keep migrations applied.** Migrations are written so the
previous code still works against them (see step 1). Undoing the database as
well reintroduces whatever the migration fixed — on 2026-09-04 that would have
restored the Colombian 404.

## Always name the environment when handing over a script to run

Every script, SQL query or command given to the user to run states **which
environment it belongs to, and its project ref**, before the code block — not
buried in a sentence after it, and never left to be inferred:

- **dev branch** — `vzqppwrwnmlbrxizskdh`
- **production** — `rabmiyqodnvnrwiartuj`

This applies to **read-only diagnostics too**, not just migrations. A `select`
run against the wrong database returns a perfectly plausible answer about the
wrong system, and the whole diagnosis proceeds from it. That is worse than an
error, because nothing looks wrong.

When something must run in both, say so explicitly **and give the order** —
production first for a fix to a live outage, dev first for anything being
tried out. When it must run in only one, say why, so the choice is checkable
rather than trusted.

Real example, 2026-09-04: `/admin` was failing in production with
`permission denied for table owners`. A grants query was handed over to
diagnose it and run against dev, which answered "service_role has SELECT" —
true of dev, unknown of production, and it sent the diagnosis down the wrong
path entirely. The two databases are not interchangeable even though dev is a
branch of production: `auth.users` triggers and Storage buckets have already
failed to clone between them, so their permissions cannot be assumed identical
either.

The same rule covers `npm run` commands and any CLI: name the directory they
run from. `npm run metrics` reads whichever project `.env.local` points at, so
"run this" without naming the environment can silently report dev's numbers as
if they were the business's.

### Y la consulta tiene que PODER correr donde dice que corre

Nombrar el entorno no basta si lo que se manda no existe allí. El 2026-10-24
se entregó una consulta «para producción» que pedía `movements.transaction_code`,
una columna que crea la migración `147` y que solo existía en la rama dev. En
producción habría fallado con `column does not exist`; se corrió en dev, que
contestó tranquilamente **sobre los datos de dev**, y el resultado se leyó como
si fuera de producción durante dos mensajes.

**Lo que lo delató no fue la consulta: fue que las cifras coincidían al dígito
con una medición que ya se había hecho en dev un rato antes.** Sin esa
casualidad habría pasado entero.

**Antes de mandar una consulta a producción, repasa qué columnas y funciones
toca y si alguna nació en una migración que allí no se ha corrido.** Si la
respuesta es sí, la consulta se reescribe con lo que los dos lados tienen —un
`id` en vez de un código nuevo— o se dice que esa pregunta todavía no se puede
hacer en producción. Las dos salidas son honestas; mandarla igual no.

### Every code block, every time — no back-references

The user is not a developer and does not track which environment a
conversation is "currently in". **Relative references are banned.** Each of
these was used on 2026-09-07 and each caused a real mistake:

- ❌ "confirm it landed, in the same project"
- ❌ "run it wherever you just ran the migration"
- ❌ "then these two, both read-only"
- ❌ "and now the verification"
- ❌ "run the identical block from my previous message"

Every one of them makes the reader reconstruct which database was meant from
earlier context. That is work being pushed onto the person least able to do it,
and getting it wrong is silent.

**The required form, on every single code block, including the second and
third in the same message:**

> Run this in **DEV** (`vzqppwrwnmlbrxizskdh`):
> ```sql
> ...
> ```
> Then run this in **DEV** (`vzqppwrwnmlbrxizskdh`) as well:
> ```sql
> ...
> ```

Repeating "dev" three times in one message is not clutter. It is the whole
point: the label must be readable without scrolling up, and without holding the
previous instruction in mind.

**Never point at a block earlier in the conversation.** If the same SQL needs
running again, paste it again in full, or send it as a file. A long thread with
four near-identical blocks is exactly how the wrong one gets run.

What this cost, 2026-09-07: migration `043` was handed over as "the identical
SQL block from my previous message", followed by a verification "in the same
project". It was run against dev — which already had it, so everything looked
correct — and production stayed unpatched and still leaking for another four
exchanges. Nothing errored. The only reason it surfaced was a count query that
distinguished the two databases by their row counts.

## A migration must survive being re-run

Not a style preference. The moment you need to re-run a migration is right
after correcting it — dev caught something, you fixed the file, you run it
again. If the file only works on a virgin database, the correction is the
run that fails, and in production that happens with the page already broken
and waiting on it.

The trap that is easy to miss is **changing a function's signature**. Postgres
overloads on argument types, so:

- `create or replace function` cannot change a parameter's type, its name, or
  a `returns table(...)` column list. It creates a *second* overload instead
  of replacing anything, and PostgREST then resolves calls to whichever one it
  likes. Use `drop` + `create`.
- A `drop function if exists` names one exact argument list. Dropping only the
  **old** signature makes the file work exactly once: on the second run the
  drop matches nothing and `create function` fails with
  `42723: function "x" already exists with same argument types`.

So drop **both** signatures — the one that exists before the migration and the
one it creates. `supabase/047_admin_metrics_multi_owner.sql` is the worked
example: twelve `drop function if exists` lines for six functions.

This cost a round trip on 2026-09-07, in dev, which is where it was supposed
to cost one.

## Record every dev SQL change in the migration ledger

`public.schema_migrations` (created by `supabase/028_schema_migrations_ledger.sql`)
tracks every schema change ever run against a database — not just numbered
migration files, and not just the one-time data conversions that
`applied_data_migrations` exists for. Its whole purpose is letting a
pre-launch check compare dev's and production's own copies of this table
and catch anything dev has that production doesn't, so a migration never
again gets forgotten before a production deploy.

Any SQL run against the dev branch — a numbered migration file **or** a
two-line manual fix typed directly into the SQL editor — must end with:

```sql
insert into public.schema_migrations (key, description)
values ('<key>', '<one-line description>')
on conflict (key) do nothing;
```

Use the migration file's own name as `<key>` when one exists (e.g.
`028_schema_migrations_ledger`); for an ad hoc fix with no file, use a short
dated slug (e.g. `2026-08-27_fix_stray_null_currency`). No exceptions for
"it's just a small fix" — an unlogged fix is exactly what this table exists
to prevent. When the same SQL is later run against production, insert the
same key there too — that match is what the parity check compares.

### Migraciones que solo existen en un entorno

Casi todas las migraciones corren en los dos lados. Unas pocas no: existen
para que un entorno se parezca al otro, y correrlas en el otro no tiene
sentido. `045_dev_grant_parity` es la primera — alinea los permisos del branch
dev con los que producción ya tiene, así que en producción sería un no-op en
el mejor caso y una caída si las listas se hubieran separado.

El problema es la parada dura del `qa-regression-checklist`: compara las claves
de `schema_migrations` de los dos entornos y bloquea ante cualquier diferencia.
Una migración que legítimamente vive en un solo lado la haría saltar **en todos
los lanzamientos futuros**, y una alarma que suena siempre deja de leerse — que
es peor que no tenerla, porque entrena a pasarla de largo.

**Regla: cuando una migración es de un solo entorno, se registra en el otro
como no-op**, con una descripción que diga exactamente eso y advierta que no
debe ejecutarse:

```sql
insert into public.schema_migrations (key, description)
values (
  '<clave>',
  'DEV-ONLY, registrada aquí como no-op para que la comparación de ledgers del checklist siga significando algo. NUNCA ejecutar este archivo contra producción: <razón en una línea>.'
)
on conflict (key) do nothing;
```

Los ledgers vuelven a coincidir, la parada dura recupera su sentido, y la fila
dice la verdad: no es "esto corrió aquí", es "esto existe y deliberadamente no
corre aquí". La alternativa —enseñarle al skill una lista de excepciones— exige
mantener esa lista, y una lista desactualizada falla en silencio.

Precedente: `033_client_document_id_unique` se registró así en producción el
2026-09-06 y desde entonces la comparación vuelve a ser útil.

## Explicit ownership checks in server actions

Any server action that reads or writes a row identified by an ID that comes
from the browser (`clientId`, `movementId`, etc.) must verify that row
actually belongs to the authenticated owner **explicitly in code** — e.g.
`.eq("owner_id", user.id)`, or a pre-check against `clients` when the table
doesn't carry `owner_id` directly — matching the pattern already used in
`app/(app)/clients/[id]/actions.ts`. RLS is the backstop, not the only line
of defense.

A security audit (2026-08-28) found two functions that had skipped this and
relied on RLS alone — `getOrCreateShareLink` and `confirmImport`. Neither
was actually exploitable (RLS held in both cases), but each was a single
point of failure: if a future migration ever loosened the relevant RLS
policy by mistake, these were the only two places with no second layer of
defense. Both were fixed. Don't reintroduce this pattern in new server
actions — every new one should get the same explicit check from the start.

## Mask raw errors on unauthenticated endpoints

Before shipping any endpoint — a new one, or a change to an existing one —
ask: "who can call this without logging in?" If the answer isn't "nobody,"
its error responses must never leak raw upstream/third-party error text,
database error detail, or anything else internal. Return a generic,
user-facing message instead; log the real detail server-side only
(`console.error`), never in the response body.

Endpoints that *do* require authentication (a session, or a bearer secret
like `CRON_SECRET`) may keep surfacing real error text for debugging
convenience — see `signup/actions.ts`, `/api/extract`,
`/api/cron/exchange-rate`, all deliberate, all gated by auth. That's an
accepted tradeoff for a narrow, authenticated audience, not a gap. The
rule is specifically about endpoints anyone can reach with no account at
all — e.g. `/s/[token]` and its `get_shared_balance()` RPC, or any future
public page or webhook receiver.

## Si lo pide dos veces, es una regla: dilo

**Pedido por el dueño el 2026-10-24**: *«deberás identificar cuando te pida de
manera repetida en más de una vez el mismo requerimiento y sugerirme agregarlo
como regla»*.

Su ejemplo: el día anterior pidió **tres veces** ajustar los paddings laterales
de una pantalla a 16px. A la segunda ya debería haber salido la frase.

**La regla, entera**: cuando un encargo se parece a otro que ya hizo —no
idéntico, *de la misma clase*— se le dice en una línea, con la cita de la vez
anterior, y se le ofrece escribirlo en este archivo. Se sigue haciendo el
trabajo igual; esto es una línea de más en el reporte, no una pausa.

> Esto ya me lo pediste el 2026-10-23 («los paddings laterales van a 16px»).
> Van dos. ¿Lo escribo como regla en `CLAUDE.md` para que no haya una tercera?

**Por qué merece una regla propia, y no es burocracia.** Un encargo repetido no
es el dueño siendo insistente: es la prueba de que el repo no lo sabe. La
primera vez es una petición; la segunda es un patrón que el siguiente que toque
esa pantalla va a romper otra vez, porque no hay nada escrito que se lo impida.
Lo que cuesta no es la repetición — es que **cada vez la tiene que cazar él**,
mirando pantallas, en vez de que el archivo lo impida solo.

**Qué cuenta como «la misma clase»**: el mismo valor de diseño (paddings,
tamaños, colores), la misma decisión de producto (qué manda cuando dos cifras
compiten), el mismo comportamiento (qué se esconde con el teclado, a dónde
vuelve una flecha). No cuenta un bug reportado dos veces en sitios distintos:
eso es una causa común sin arreglar, y lo que toca ahí es buscarla, no escribir
una regla.

**Y se ofrece, no se hace solo.** El archivo es suyo; lo que se hace sin pedir
permiso es notarlo y decirlo.

## Ask before assuming

For product/data-modeling decisions, currency or financial-logic choices,
or anything with more than one reasonable reading, ask a clarifying
question before implementing. Don't guess and bake the guess into code or
a migration — this is doubly true for anything touching real customer
balances or money.

## Todo encargo se evalúa por sus bordes antes de construirlo

**Pedido por el dueño el 2026-10-22, después de que un encargo suyo llegara
a pantalla roto por un caso que él no había nombrado**: *«todo lo que te pida
debes evaluar los casos bordes, peores escenarios y soluciones»*.

Antes de escribir una línea de cualquier encargo —suyo o salido de una
reseña— hay que contestar tres preguntas **por escrito, en el reporte**:

1. **¿Dónde se rompe?** Los bordes: cero, uno, muchos; el cliente que debe en
   dos monedas; el abono sin dirigir; la fila sin tasa; el negocio colombiano;
   el campo vacío. Los límites de la app ya han costado fallos reales —`CT-124`
   con el pendiente recalculado, la venta mixta del 2026-10-20 sumando dólares
   a euros— y todos eran bordes que nadie enumeró.
2. **¿Cuál es el peor escenario?** No «se ve raro», sino qué pierde el tendero:
   dinero mal anotado, un cliente al que se le cobra de más, un mensaje que no
   sale. Y si el peor caso es silencioso, decirlo: un fallo que no avisa vale
   más atención que uno que revienta.
3. **¿Qué se hace con cada uno?** Cubrirlo, o decir en voz alta que se deja
   fuera y por qué. Un borde identificado y no resuelto es una decisión; uno
   identificado y callado es una trampa.

**El ejemplo que la motivó**: se le quitó a la pantalla de abono su selector de
libro porque el desplegable del monto lo sustituía. El desplegable ofrecía
*el libro actual y bolívares* — suficiente con un cliente que debe en una
moneda, y sin salida para uno que debe en dólares Y en euros, que es justo el
caso que él tenía en pantalla. El borde existía desde el primer minuto; lo que
faltó fue enumerarlo.

**Esto no sustituye a «Ask before assuming», lo alimenta**: la lista de bordes
es de dónde salen las preguntas que merece la pena hacer. Un borde con una
sola lectura razonable se resuelve y se cuenta; uno con dos se pregunta.

## El botón flotante no puede pisar las acciones de una pantalla

**Antes de dar por terminada cualquier pantalla que acabe en botones —una
transacción exitosa, una ficha, un resumen— hay que medir si el botón
flotante «Registrar» cae encima de ellos.** Pedido por el dueño el
2026-10-22 tras encontrárselo sentado sobre «Ver cuenta de…».

**No se comprueba mirando: se mide.** Las dos cifras que hacen falta son el
rectángulo del flotante y el del último botón, y la pregunta es si se
cruzan:

```js
const fab = [...document.querySelectorAll('a,button')]
  .find((b) => /Registrar|Crear producto/.test(b.textContent)
    && getComputedStyle(b).position === 'fixed');
const f = fab.getBoundingClientRect();
const r = ultimoBoton.getBoundingClientRect();
r.bottom > f.top && r.top < f.bottom && r.right > f.left   // ← solapa
```

**Y se mide SIN desplazar la página**, que es donde falla: el flotante es
fijo y el contenido no. Una pantalla larga coloca sus botones fuera de la
pantalla y, al bajar para verlos, quedan despejados; una corta los deja
justo dentro de la banda del flotante y ahí se quedan. El caso roto es
siempre el corto.

**Un `padding` abajo NO lo arregla, y conviene saberlo antes de probarlo.**
`app-main.tsx` reserva 5,5rem en las pantallas que terminan un flujo, y eso
solo sirve cuando la página llega a desplazarse: un relleno por debajo
alarga la página pero no sube contenido que ya está colocado. `mt-auto`
tampoco, si con ese relleno ya no sobra espacio que repartir. Las dos cosas
se probaron el 2026-10-22 y ninguna movió un píxel.

**Cuando no hay arreglo de maquetación, es una decisión del producto, no
tuya**: o el flotante no se dibuja en esa pantalla, o sube. Las dos tienen
coste y las dos son suyas.

**Por qué merece regla propia**: un botón medio tapado se ve como un
descuido estético, y no lo es. El tendero le da a «Compartir» con el
cliente delante y lo que se abre es la hoja de registrar otra venta. El
síntoma —«le di y se abrió otra cosa»— no se parece en nada a la causa.

## Test every requirement before reporting it delivered

Nothing is reported as done, fixed, or verified until it has been **run and
observed**. Understanding why a change works is not evidence that it does.
"I reasoned it through" and "the types check" are not test results.

This is not the same as testing the reported symptom. A fix is delivered when:

1. **The reported case passes** — the exact thing the user described.
2. **Every path the change touches passes** — including the ones that already
   worked. A change that fixes one entry point and breaks its neighbour is not
   a fix. If a shared function, prop, or effect was edited, every caller of it
   is in scope.
3. **The requirement's own sub-cases pass.** If the request had four parts,
   four parts get tested — not the one that was hardest to build.

**Never write an untested claim into a commit message, a report, or a table.**
Saying "the create path had the same race and is fixed with it" when that path
was never run puts a false statement into the permanent record, which is worse
than saying nothing. If it wasn't run, the honest words are "not tested".

**Anything that could not be tested is named explicitly in the report**, with
the reason — no session to sign in with, needs a real inbox, needs a physical
device, needs production data. A requirement quietly missing from a report
reads as passed. State the gap and let the user decide whether it matters.

Real examples from 2026-09-04, all three reported as complete before they were:

- A phone-bar tier was reported as a clean pass after testing repeat taps on
  one of its four items and checking the other three only by their `href`.
- A dialog fix was reported "found, fixed, verified" while the commit sat
  unpushed on a local branch. The user tested production, which had never
  contained the fix, and reported the same bug back.
- That same fix shipped with three untested paths, one of which — whether the
  `?nuevo=1` marker still cleared on a normal close — could have re-broken a
  bug fixed earlier the same day.

### A `qa/` script runs as the service role. The owner does not.

Every script under `qa/` authenticates with `SUPABASE_SERVICE_ROLE_KEY`, which
**bypasses RLS and needs no table grant**. The shopkeeper's session has
neither privilege. So a suite built only on that key cannot see the two things
that most often break a screen: a policy that filters the owner's rows away,
and a missing `grant` that refuses the table outright.

This is not theoretical. On 2026-10-16 migration `108` created
`catalog_orders`, turned RLS on, wrote a correct `owner_id = auth.uid()`
policy — and never granted anything to `authenticated`. Every read the owner
made died with `42501`, the Pedidos screen said *«todavía no te ha llegado
ningún pedido»* with three real orders in the table, and **`qa:pedidos` was
passing 14 of 14 at that exact moment**. It was found by opening the screen in
a browser. Migration `116` is the fix.

**So: any suite covering a table the owner reads or writes directly gets at
least one check that runs as the owner.** The session is free — the magic-link
pattern in `qa/import-libreta.mjs` (`generateLink` + `verifyOtp`, no password
typed), then a client carrying `Authorization: Bearer <access_token>`.
`qa/pedidos.mjs` is the worked example: it reads as the owner, and its "mark
as attended" goes through that session too, because `update` is a separate
grant from `select` and a suite that writes with the service key would pass
with the button broken for everyone.

A table reached **only** through `security definer` functions needs none of
this — that is the deliberate design of `whatsapp_sends`, `usdt_p2p_rate` and
the catalogue's own `create_catalog_order`. The rule is about tables the app
queries directly with the owner's client.

### Una función puede estar redefinida más abajo: lee la ÚLTIMA

En este repo las funciones de Postgres se reescriben con `create or replace`
en migraciones sucesivas, así que **el mismo nombre está escrito varias veces
y solo la última cuenta**. `get_oldest_unpaid_charge` vive en la `017`, en la
`021` y en la `025`, y las tres son definiciones completas y distintas.

El problema es que `grep` las devuelve **en orden de archivo, con la más vieja
arriba**. Leer la primera y dar por hecho que es la que corre es un diagnóstico
que sale perfectamente razonado y perfectamente falso.

**Qué costó, el 2026-10-16**: se escribió la ficha `CT-78` —«el reparto de
abonos no mira la moneda, un fiado en dólares lo puede pagar un abono en
euros»— leyendo la `021`, donde es verdad. La `025` ya lo había arreglado un
año antes. La ficha entró en `PENDIENTES.md` con su explicación en cristiano,
su peor escenario y su «es un defecto de HOY, en producción», pasó a ser el
**paso 2** del orden de despliegues del día siguiente, y de ella colgaba la
dependencia que colocaba el USDT después. Nada de eso era cierto. Se cayó al
ir a construirlo y montar el caso contra dev, que tardó dos minutos.

**La regla, entonces:**

1. Antes de diagnosticar nada sobre una función, `grep` por **todas** sus
   definiciones y leer la de número más alto.
2. Y cuando el diagnóstico va a decidir trabajo —una ficha, un orden de
   despliegues, una migración— **comprobarlo contra la base**, no contra el
   repo. Montar el caso con datos de prueba en dev y mirar qué contesta cuesta
   minutos y es la única prueba que no depende de haber leído el archivo
   correcto. Es la misma regla que ya está más arriba para las suites de `qa/`:
   al menos un control tiene que mirar la realidad exterior.

### Un campo nuevo entra por TODAS las puertas de su acción

Antes de dar por puesto un campo de formulario, hay que buscar **quién más
escribe en la misma acción del servidor**. No «quién más tiene un formulario
parecido»: quién manda su `FormData` a la misma función.

El 2026-10-16 el campo de **cuotas** se añadió a `add-movement-dialog.tsx` y se
reportó el trabajo como terminado. Había un segundo formulario —«Registrar
cliente nuevo», en `client-search-dialog.tsx`— que manda a
`createClientWithMovement`, **y esa acción ya leía `cuotas` desde el primer
día**. O sea que el servidor estaba listo y la pantalla no: un cliente nuevo a
crédito se guardaba **siempre sin cuotas**, en silencio, sin error y sin que
nada se viera raro. Lo descubrió el dueño mirando la pantalla, no una prueba.

**Por qué este fallo no avisa, y por eso merece regla propia**: un campo que
falta no rompe nada. El formulario envía, el servidor acepta, la fila se
guarda. Lo único que pasa es que un dato que el tendero creía haber puesto no
está — y eso se descubre semanas después, cuando la app contradice lo que él
recuerda haber acordado con su cliente.

La comprobación cuesta un `grep` por el nombre de la acción:

```sh
grep -rn "createClientWithMovement\|createMovement" --include=*.tsx components/
```

Y vale igual al revés: **una acción que empieza a leer un campo nuevo tiene que
decir qué formularios se lo van a mandar**, porque los que no lo hagan van a
guardar `null` sin quejarse.

### Un valor visual que sale en más de una pantalla NACE en un componente

**Pedido por el dueño el 2026-10-29**, después de encargar dos barridos del
mismo tipo en un solo día: *«será el ícono que usaremos para todas las partes
del app (…) actualízalo en toda la app»* por la mañana, y *«aplica también para
el catálogo, pedidos, reportes, vista del cliente»* por la tarde.

**La regla**: un chip, un icono, una etiqueta de estado o cualquier cifra con
formato propio que vaya a aparecer en **dos pantallas o más** se escribe UNA vez
—componente para el dibujo, función en `lib/` para la decisión— y las pantallas
lo importan. Nunca se copian sus clases. Si al montarlo en la segunda pantalla
le falta algo, **se le añade al componente**, no a la copia.

**Por qué no basta con «hazlo consistente».** Copiado, cada sitio queda correcto
por separado y el conjunto se desalinea sin que nada avise:

| Qué | Qué costó |
|---|---|
| **`chip-de-estado.tsx`**, 2026-10-21 | «Plazo vencido» salía ROJO en el historial y ÁMBAR en la leyenda. Rojo estaba reservado a «Crítico», así que un fiado de un día de retraso se leía con la misma alarma que uno de mes y medio — en la pantalla donde se decide a quién cobrar primero |
| **Los iconos del dinero**, 2026-10-29 | El mismo glifo `%` marcaba el abono y el fiado. Cambiarlo fue un barrido por cinco pantallas en vez de una línea |
| **El chip «Disponible»**, 2026-10-29 | Ocho pantallas, **dos tonalidades de verde distintas** —cuatro usaban una pastilla rellena fuera de la paleta— y ninguna sabía del umbral. Además, dos enseñaban el dato **dos veces**: la pastilla con la cifra y, debajo, un «Disponible» que no añadía nada. Invisible mientras los dos dibujos eran distintos |

**La señal de que esto está pasando** es un `grep` por el texto de la etiqueta
que devuelve más de un fichero con las clases escritas a mano. Si sale eso,
**antes de tocar nada se recoge en un componente**, y luego se hace el cambio
pedido. Es más trabajo esa vez y menos todas las siguientes.

**Y la decisión va aparte del dibujo.** El componente pinta; la regla de cuándo
pinta cada cosa vive en `lib/` y la comparten las dos caras de la app.
`lib/products/availability.ts` es el ejemplo: el tendero y el cliente gradúan el
mismo producto con la misma función, así que no pueden contradecirse delante del
cliente. Calcularla en SQL para una cara y en TypeScript para la otra es la
trampa de `CT-124`, que estuvo meses acreditando pagos puntuales a fiados que
nadie había pagado.

**Es la hermana de la regla de arriba.** Aquella mira las puertas de ENTRADA de
un dato —qué formularios escriben en la misma acción—; esta mira las de SALIDA
—qué pantallas enseñan el mismo dato—. Las dos fallan igual de callado.

## Quien escribe varios movimientos de golpe, recalcula el saldo

**Toda función que inserte MÁS DE UN movimiento en la misma transacción tiene
que terminar llamando a `recalc_client_running_balance(client_id)`.** No es una
buena práctica: sin eso, el saldo que la app enseña queda mal.

`movements.running_balance` lo pone un disparador BEFORE INSERT que busca la
fila anterior con `order by created_at desc, id desc`. Dentro de una
transacción, `now()` es el instante de la TRANSACCIÓN — así que todas las filas
que se inserten ahí comparten `created_at` y el desempate cae en `id`, que es
un uuid aleatorio. **De la tercera fila en adelante, cada una encadena desde
una hermana cualquiera** en vez de desde la que de verdad le precede.

**Y no se queda en una fila rara.** `client_summary` es una VISTA que lee el
`running_balance` de la ÚLTIMA fila viva de cada moneda: una cadena rota es un
SALDO roto, en la ficha del cliente, en Cartera y en el enlace que el cliente
abre. No falla nada, no se pone nada en rojo — sale un número creíble y falso.

**Qué costó, el 2026-10-23**: `registrar_abono_repartido` (migración `137`)
escribía sus N líneas sin recalcular. Un cliente con cuatro repartos sumaba
0,00 en dólares y la app enseñaba 1,14. Lo arregla la `142`, y no llegó a
producción de milagro: el reparto entero seguía en `dev`.

**La otra mitad de la regla: también hay que recalcular si se inserta con fecha
HACIA ATRÁS.** El disparador toma como anterior la fila más nueva, así que un
movimiento con `created_at` viejo nace con el saldo equivocado y deja sin
actualizar todos los que van después. `import_libreta` lo hace bien desde la
`075` y es el ejemplo a copiar.

**Cómo se comprueba, y está en el `qa-regression-checklist` como parada dura**:
`npm run qa:saldos` en dev recorre todos los clientes y compara el saldo que la
app enseña con la suma de sus movimientos. Para producción hay una consulta de
solo lectura en la sección 4c del checklist. **Se mira aunque el diff no toque
nada de esto**: el síntoma no es un error, es un número creíble, así que la
única forma de saber que no está pasando es preguntarlo.

## Toda fila del historial lleva su pie «Por cobrar», menos «De contado»

**En los DOS historiales: el del dueño y el del cliente.** Pedido por el dueño
el 2026-10-23, y ampliado por él mismo esa misma tarde: *«toda transacción en
el historial de transacciones tanto en el dueño como en el cliente debe tener
ese pie "Por cobrar" a excepción de transacciones "De contado"»*.

Son dos componentes distintos y es justo lo que hace que esto se rompa:
`components/dashboard/movement-history-list.tsx` y
`components/public/movement-history-list.tsx`. **Lo que se toque en uno se
toca en el otro en la misma sesión**, o la pantalla que el cliente abre deja
de parecerse a la que el tendero tiene delante — que es lo único que este
producto promete.

**«De contado» es la única excepción**, y no por capricho: una venta pagada
entera no deja nada debiendo, así que su pie diría siempre cero.

### Qué cifra va ahí: el saldo del libro DESPUÉS de esa transacción

**Es `movements.running_balance`**, y la regla la fijó el dueño el 2026-10-23:
*«"Por cobrar" en el pie de cada card es el monto por cobrar total del libro
de esa moneda, no del fiado ni de otra transacción (…) es para que le diga al
cliente y dueño en cuánto le queda la deuda DESPUÉS DE ESA TRANSACCIÓN»*.

Y el criterio con el que lo cerró, que es el que vale como prueba: *«si el
cliente debe 100 y abonó 50, "Por cobrar" es 50 en la card principal de la
moneda y en la card de la última transacción. **Deben coincidir**»*.

**Esa invariante se cumple por construcción**, y conviene saber por qué:
`client_summary.balance_eur` ES el `running_balance` del último movimiento
vivo en euros. Así que la fila más nueva de un libro y la tarjeta de arriba no
pueden discrepar — no hay nada que sincronizar.

#### Esto DESPLAZA la regla del 2026-10-21, y las dos quedan escritas

`running_balance` estuvo en este pie y **se quitó** ese día porque, con los
abonos escondidos por el filtro, la fila de arriba decía «Por cobrar $89.72»
mientras la tarjeta del mismo cliente decía $68.59, y nada decía cuál cobrar.
**El peor caso es el que la condenó: el tendero le cobra 89,72 a quien debe
68,59.**

Lo que cambió entre una fecha y otra es la fila: el pie lo llevan **todas**,
así que las cifras se leen como una serie que baja y termina en la de la
tarjeta, en vez de como dos números sueltos que se contradicen.

**Lo que sigue costando, dicho para que nadie lo redescubra**: con un filtro
puesto —«Fiado», por ejemplo— la fila más nueva que quede en pantalla puede
ser vieja, y entonces su cifra NO es la de la tarjeta. Es inherente a enseñar
un dato histórico, y el dueño lo eligió avisado de ese caso por su nombre.

#### El chip de al lado habla de otra cosa

No confundirlos: el chip dice cómo va **ese fiado** —su propio plazo, su
propio pendiente— y el pie dice qué debía **el libro** después de esa fila. Un
fiado puede salir «Pagado» con un pie de €55,95: el fiado está saldado y el
libro sigue debiendo.

### Un saldo A FAVOR no se escribe con un menos

Un cliente que pagó de más tiene saldo negativo en la base. Escrito tal cual
bajo un rótulo que dice «por cobrar», sale **«Por cobrar −$178.00»** — que no
se lee como «te sobran 178» sino como un error de la app, o peor, como una
deuda con el signo al revés. Lo reportó el dueño el 2026-10-23 con la captura
de un abono antiguo.

**La cifra va en valor absoluto y lo que explica el signo es el chip «A
favor»**, debajo de la equivalencia en bolívares. El verde se queda: con el
chip al lado dice lo mismo que él, en vez de contradecir al rótulo.

Vale en los dos historiales **y en la ficha de la transacción**, que es donde
se vio. La tarjeta de saldo de `/s/[token]` ya lo hacía así desde antes —
`Math.abs` y «A favor» / «Debe»— y es el precedente que fija la forma.

## Una deuda antigua no tiene compra: ninguna pantalla le dibuja una

**Pedido por el dueño el 2026-10-31**, a la segunda vez que salió el mismo
asunto: el 2026-10-30 se le preguntó por la fila «+€0,00 al día de la compra»
que aparecía en una deuda antigua, y el 2026-10-31 la mandó quitar con el frame
`1894:15287` delante.

**La regla**: el fiado con que nace un cliente nuevo —la deuda que ya traía
antes de Sevenz— **no es una venta**. No se compró nada en ningún momento que
la app conozca. Así que en ninguna pantalla lleva nada que hable de una compra:

- **ni productos** («Qué se llevó»);
- **ni la tarjeta del pago «al día de la compra»**, que es la primera de
  «Abonos relacionados» en un fiado normal — en una deuda antigua dibujaba
  «+€0,00» por un momento que nunca pasó;
- **ni ninguna otra que se invente después**: un ticket, un «vendido por», un
  margen.

Su tipo es «Deuda antigua», no «Fiado / Crédito», en el detalle. **En el
historial sigue diciendo «Fiado»**, decisión del dueño ese mismo día.

### Cómo se sabe que lo es: la marca, nunca la ausencia de venta

`movements.is_old_debt` (migración `167`). **No vale «un fiado sin
`sale_id`»**: así son también todos los fiados escritos antes del flujo de venta
(2026-10-21) y los que entran por la foto de una libreta. En dev, el día que se
escribió esto, había **191 fiados sin venta y solo 4 eran deudas antiguas**.
Deducirlo de la ausencia de venta rotula como «Deuda antigua» los fiados de
septiembre y les quita sus abonos, en las dos vistas y sin que nada se vea raro.

**Y viaja por las dos caras**: la del dueño la lee de `movements`, la del
cliente de `get_shared_balance`, que construye su JSON campo a campo. Una
pantalla nueva que necesite saberlo del lado del cliente tiene que comprobar que
la función lo devuelve, no suponerlo.

### Lo que esto cuesta, y está aceptado

Los abonos dirigidos a una deuda antigua **no se listan en su detalle**, porque
se quitó la sección entera. Siguen contando —en «Total por cobrar» y en la
columna «Estado» de las cuotas— y el comentario de
`detalle-de-transaccion.tsx` lo dice. Quien quiera devolver la lista tiene que
devolverla **sin** la tarjeta de la compra, no la sección tal cual.

## Todo encargo del app del dueño se pregunta para la vista del cliente

**Pedido por el dueño el 2026-10-23**: *«todo requerimiento que te solicite
dentro del app del dueño debes preguntar si algo de ello se debe implementar
en la vista del cliente, si se implementa tal cual o si debe haber alguna
variante»*.

Son **tres** respuestas posibles, no dos, y por eso se pregunta en vez de
decidirlo solo:

1. **Igual** — el chip «A favor» y el pie «Por cobrar» del historial.
2. **Con variante** — la misma idea, distinta por lo que cada lado sabe o
   puede. El chip por libro va en las dos, pero la vista del cliente no recibe
   `days_since_payment`, así que nunca dice «Crítico».
3. **No aplica** — la pantalla no existe ahí. Registrar una venta, repartir un
   abono o elegir la moneda de un producto son cosas del tendero; el cliente
   no registra nada.

**Se contesta en el reporte, por escrito y antes de construir**, aunque la
respuesta sea «no aplica» en los cuatro puntos. Decirlo cuesta una línea y es
lo que deja constancia de que se miró.

**Por qué merece regla propia.** Las dos pantallas son dos componentes
distintos —`components/dashboard/movement-history-list.tsx` y
`components/public/movement-history-list.tsx`— así que lo que se arregla en
uno NO llega al otro, y nada avisa. El tendero mira su pantalla, la da por
buena, y la contradicción solo aparece cuando un cliente abre su enlace con él
delante. Eso no se lee como un detalle sin terminar: se lee como que la app le
está diciendo a su cliente otra cosa de la que le dice a él, que es lo único
que este producto promete no hacer.

Y el caso de arriba enseña la otra mitad: el chip de estado por libro **sí**
tenía que ir en la vista del cliente, pero su payload llega recortado a 50
movimientos, así que replicarlo «tal cual» habría dado un estado falso en
cualquier historial largo. La pregunta no es solo «¿va?», es «¿va igual?».

## Report QA and verification work as a table

Whenever a round of testing or verification wraps up — a security audit, a
live feature check, a full `qa-regression-checklist` run, anything where
something was actually tested rather than just written — report it as a
table, not prose alone. One row per specific test/check, minimum columns:

| Test | Skill/tool used | Result |
|------|-----------------|--------|

Add a **Notes** column whenever there's a caveat, a partial pass, or a
follow-up worth flagging. The point is to keep the work auditable and let
the user spot at a glance where confidence is real vs. where something
still needs scrutiny, and to give feedback on a specific row instead of
the effort as a whole.

After the table, add a short **Recommendations** section covering every
row that wasn't a clean pass (⚠️/❌/partial) — one line per row, naming the
concrete next action: what was already fixed and how, or what's still
open and the specific step to close it. Skip this section entirely if
every row is a clean pass — don't manufacture a recommendation where
there isn't a real one. This applies to the `qa-regression-checklist`
skill's own final report (see its section 7), to any security-audit pass
(e.g. the 2026-08-28 audit), and to any live verification of a new
feature (build checks, browser testing, etc.) — not just pre-launch runs.

## Follow the UI rules in DESIGN-SYSTEM.md

Any new screen, dialog or form follows `DESIGN-SYSTEM.md` at the repo root:
section titles, card styling, button heights, number and date formatting,
responsive breakpoints, and the specific traps that have already cost this
codebase real bugs (flex/hidden conflicts, unbounded popovers, Radix leaving
dialogs mounted, duplicate tour markers).

Read it before writing UI, and update it when a new rule is established —
it exists so the next screen doesn't have to rediscover the same failures.

## SI HAY FRAME, SE ABRE EL FRAME. SIEMPRE.

**Un enlace a un frame de Figma es una instrucción de leerlo, no una
referencia decorativa.** Nada de la pantalla se deduce, se recuerda de una
captura, ni se copia de una pantalla parecida: se replica **al detalle** desde
el frame — rótulo por rótulo, fila por fila, en el orden en que están.

Exigido por el dueño el 2026-10-20, literalmente: *«SIEMPRE DEBES LEER LOS
FRAMES Y REPLICARLOS AL DETALLE. SI TE LOS PASO ES PARA QUE LOS LEAS NO PARA
QUE LOS IGNORES»*.

**Cómo se leen**, porque «mirar la captura» no cuenta: los servidores de Figma
que responden en este proyecto son los de `mcp__plugin_figma_figma__*`.
`get_screenshot` da la imagen y **`get_design_context` da la estructura con los
textos exactos y los `data-node-id`**, que es lo único que distingue «Monto» de
«Abonó» o «#» de «N°». Si un servidor de Figma contesta que no puede acceder al
recurso, se prueba otro antes de darse por vencido — el 2026-10-20 uno fallaba
y otro respondía al mismo nodo.

**Qué pasó por no hacerlo.** El detalle de transacción se construyó deduciendo
la pantalla. Resultado, en una sola entrega: un campo inventado («Abonos a este
fiado», que en el frame es «Abonó»), un estado vacío inventado («Todavía sin
abonos», que en el frame es un importe), dos campos que no existen («Se llevó»
y «Tasa del día»), las cuotas sin su recuadro «Próximas cuotas» y con «#» en vez
de «N°», y una frase escrita por mí que nadie pidió. El dueño tuvo que pasar los
frames y enumerarlo.

**Y lo que de verdad cuesta no es el retrabajo**: es que cada invento se entrega
con la misma seguridad que lo que sí está en el frame, así que quien lo recibe no
puede distinguirlos sin abrir Figma él mismo. Eso convierte cada entrega en algo
que hay que auditar entero.

### ACCEDER a Figma no es leer el enlace. Y si no se puede, se dice

**Pedido por el dueño el 2026-10-23**: *«siempre que te entregue un frame debes
acceder al figma, no solo leerlo. Si no puedes acceder al figma debes
mencionarlo»*.

**Acceder** quiere decir una llamada a `get_design_context` sobre ese nodo, que
devuelve la estructura con los textos exactos, los tamaños y los `data-node-id`.
No cuenta nada de esto:

- deducir la pantalla del nombre del frame o de lo que diga el mensaje;
- mirar solo `get_screenshot`, que da la imagen pero no los rótulos;
- reutilizar lo que se leyó de un frame parecido en otra sesión.

**Y si no se puede acceder, se dice en la respuesta, antes de construir nada.**
No se construye «con lo que se entiende del enlace» y se avisa después: quien
recibe la entrega no puede distinguir lo replicado de lo inventado sin abrir
Figma él mismo, que es justo lo que esta sección entera existe para evitar.

**Los servidores de Figma de este proyecto fallan por separado**, así que
«no responde» casi nunca es «no hay acceso»: el 2026-10-23 el servidor `figma`
devolvía `ECONNREFUSED` durante toda la sesión mientras
`mcp__plugin_figma_figma__*` contestaba a los mismos nodos sin un fallo. Se
prueban los otros antes de decir que no se puede — y solo si ninguno responde
se dice, nombrando el error.

**La regla práctica, entonces:**

1. **Antes de escribir una línea de UI para la que hay frame, se abre el frame**
   con `get_design_context`, no solo la captura.
2. **Si algo del frame no se entiende** —un rótulo ambiguo, un estado que no se
   ve dibujado— se **pregunta**, y no se rellena con lo que parezca razonable.
   Una pregunta cuesta un mensaje; un invento cuesta la confianza en todo lo
   demás.
3. **Si hay frames de varios estados, se abren TODOS** antes de empezar. El
   2026-10-20 había uno del fiado sin abonos y otro con abonos, y el estado
   vacío inventado salió de no abrir el primero.
4. **Lo que se entregue y no esté en el frame se dice en voz alta** en el
   reporte, marcado como tal.

### UN SITEMAP SON FLECHAS, NO CAJAS

**Pedido por el dueño el 2026-10-24**, al preguntar por qué un botón dibujado
en su sitemap se entregó sin saber a dónde iba: *«debes leer los frames siempre
que te los entrego, debes leer las flechas para poder entender el flujo
completo, cada flecha dirige a un nuevo frame o una instrucción precisa, en el
recorrido de una flecha también puedes encontrar instrucciones»*.

**Las dos mitades hacen falta y son distintas:**

- **Los frames** dicen cómo se ve cada pantalla. Eso ya lo cubre todo lo de
  arriba, y vale **siempre que el dueño entregue un frame**, sin excepción.
- **Las flechas** dicen qué hace cada botón. Y son nodos **hermanos sueltos en
  la página, fuera de todos los frames**, así que `get_design_context` sobre un
  frame no las devuelve nunca — por muchos frames que se lean.

**Una flecha lleva dos cosas, y la segunda es la que se pierde**: a dónde va, y
**su rótulo**, que a veces es la instrucción entera. *«Al seleccionar producto
abre detalle en componente sheet»* no está dibujado en ninguna pantalla: está
escrito encima de una flecha.

**Cómo se leen**, con el puente de escritorio (`mcp__figma-console__figma_execute`),
y se hace **antes** de construir, sobre el contenedor del flujo:

```js
await figma.loadAllPagesAsync();
const page = figma.root.children.find((p) => p.name === '<página>');
const conectores = page.findAllWithCriteria({ types: ['CONNECTOR'] });
// Por cada uno: connectorStart.endpointNodeId, connectorEnd.endpointNodeId
// y text.characters — el rótulo, que es donde vive la instrucción.
```

**Qué costó, el 2026-10-24.** El botón «Registrar» de cada producto se entregó
sin construir, con la pregunta «¿a dónde lleva?» puesta al dueño — y la flecha
existía, rotulada, desde el primer día. Se leyeron los cinco frames y ni un
conector. Peor: «Editar» sí se construyó, apuntando a la ficha del catálogo,
cuando su flecha dice que lleva al mismo asistente en su paso de editar. O sea
que **no leer las flechas no solo deja trabajo sin hacer: entrega trabajo mal
hecho con la misma seguridad que el bien hecho.**

**Y la trampa de ese día, que conviene no redescubrir**: las flechas no salían
del frame que el dueño pasó. Había **cuatro frames con el nombre idéntico**
(«De contado V7») en la misma página, y las flechas salían de otro. Por eso los
conectores se enumeran **del contenedor del flujo entero** y no del frame suelto
que se esté mirando: así da igual de cuál de los gemelos salgan.

## CON EL TECLADO ARRIBA NO QUEDA NADA PEGADO AL BORDE DE ABAJO

**Botón, aviso, casilla, barra: si el teclado está arriba, se esconde.** El
dueño lo ha pedido TRES veces —2026-10-18, 2026-10-20 y 2026-10-21— y la
tercera fue así: *«te dije que ese comportamiento es invasivo... cómo debo
decírtelo... te lo he dicho mil veces»*. Tenía razón.

**Y lo que lo hace repetible es que cada vez falló por un motivo distinto**,
así que arreglar el caso no bastó ninguna de las dos primeras:

1. **No había componente.** Nació `StickyActions`.
2. **Una pantalla tenía sus clases COPIADAS a mano** en vez de montarlo. Eran
   casi idénticas —`gap-3` contra `gap-4`— así que a la vista no se
   distinguían, pero la copia no heredaba lo único que el original añade.
3. **El componente estaba bien montado y el DETECTOR se quedó ciego.**
   `useKeyboardOpen` calibraba una referencia al montar y solo la subía: una
   pantalla que nace con el teclado arriba, o con el viewport sin estabilizar
   tras una navegación, graba esa referencia mal y ya no detecta nada el resto
   de su vida.

**Las tres cosas que hay que hacer, y las tres hacen falta:**

1. **Montar `StickyActions`.** Nunca copiar sus clases; si le falta algo, se le
   añade a él.
2. **Meter dentro TODO lo que va pegado abajo** — el botón, el aviso de
   WhatsApp, la casilla del permiso, el error que los acompaña. La captura del
   2026-10-21 tenía el aviso tapando tanto como el botón.
3. **Probarlo entrando por CADA puerta con el teclado abierto.** La del
   2026-10-21 entró por una navegación (`Pagar` desde el detalle de un fiado),
   no por un cambio de paso, y esa diferencia fue justo la que rompió el
   detector.

**El detector mira dos señales y no es redundancia**: la referencia histórica
—que funciona en los Android que redimensionan la ventana— y la superposición
`documentElement.clientHeight − visualViewport.height`, que es la de iOS y **no
tiene memoria**, así que salva el caso de nacer mal calibrado. Basta con que
una diga que hay teclado.

**No se comprueba en el panel del navegador**: su emulador desenfoca el campo
al cambiar de tamaño, o sea que apaga justo la condición que se quiere medir.
La única prueba válida es un teléfono real, y hasta entonces la fila de QA dice
«no probado», no «pasa». El detalle entero está en `DESIGN-SYSTEM.md`.

## NUNCA añadas la cabecera de la app a una pantalla nueva

**La barra oscura con el menú y el logo de Sevenz NO se pone nunca en una
pantalla nueva, salvo que el dueño la pida.** Si el frame no la dibuja, no va.

**Ha pasado CUATRO veces**: papelera, catálogo, el asistente de venta y el
flujo del abono. La cuarta la reportó el dueño el 2026-10-19 con una captura y
el círculo en rojo: *«agregaste nuevamente un header que no estaba en el frame,
por favor elimina ese header, SIEMPRE lo agregas»*.

**Y lo que la hace tan repetible es que no es un olvido de quien escribe la
pantalla.** La barra no la pone la pantalla: la pone `app-header.tsx`, que
lleva una lista de rutas donde NO debe dibujarse. Quien construye una pantalla
nueva no tiene ninguna razón para abrir ese archivo, así que la barra aparece
sola y solo se ve abriendo la página en un navegador — que es justo lo que
suele quedar para el final.

**La regla, entonces, es de orden y no de criterio:**

1. **Antes de escribir una pantalla nueva, se añade su ruta a la lista de
   `components/dashboard/app-header.tsx`.** Antes, no después de que alguien la
   vea con dos barras.
2. **Y si la pantalla trae su propia fila de volver** —`ScreenBackRow` o una
   flecha propia— hay que mirar las dos listas de ese archivo: la que suprime
   la barra a TODAS las anchuras, y la que solo la suprime en el teléfono. Un
   flujo de pantalla completa va en la primera; si va en la segunda, a partir
   de `sm` salen las dos.
3. **`ScreenBackRow` por defecto solo sale en el teléfono.** En una pantalla
   sin cabecera de app a ninguna anchura hay que pasarle
   `soloEnTelefono={false}`, o desde `sm` no habrá forma de volver.

**Dos cabeceras no se leen como un bug de maquetación**: se leen como que la
app está rota, porque la marca sale dos veces en la misma pantalla.

## Todo evento de analítica documenta su pregunta de negocio

**Un evento sin una pregunta escrita al lado es una columna que nadie va a
mirar.** Pedido por el dueño el 2026-10-16, al encargar el primero que nació
así: *«documenta la business question en el código del evento, agrega como
norma en claude que todos los eventos deben documentar su business question»*.

La regla, entera: **cada `trackServer(...)` y cada `track(...)` nuevo lleva,
pegado en el código, la pregunta de negocio que contesta** — en las palabras
del dueño cuando las haya, entre comillas y con su fecha. No «qué mide», que
se deduce del nombre: **qué decisión cambia según la respuesta.**

El ejemplo es el primero que se escribió así, `Business Contacted On WhatsApp`
en `app/api/share-contact/route.ts`:

> *«¿Con cuál frecuencia los clientes contactan al dueño del negocio a través
> del botón de WhatsApp?»* — y debajo, lo que se hace con cada respuesta: si
> casi todos escriben, la pantalla no está contestando lo que venían a buscar
> y hay que ir a leer qué preguntan; si casi nadie escribe, está haciendo su
> trabajo y el botón es una red de seguridad.

**Por qué esto y no una hoja aparte.** Un documento de eventos envejece sin
avisar: el evento se renombra, se deja de enviar o cambia de propiedades, y la
hoja sigue describiendo el de antes. Pegado al código, lo lee quien lo va a
tocar, sin buscarlo — que es la misma razón que separa un comentario del
mensaje de un commit, más arriba en este archivo.

**Y vale igual para los que ya existen.** No hay que volver atrás a
documentarlos todos de golpe, pero el día que se toque uno —se renombre, se le
añada una propiedad, se mueva de sitio— se le escribe su pregunta entonces.

### Lo que la pregunta tiene que dejar claro, además de sí misma

- **Bajo qué perfil se archiva.** Mixpanel aquí guarda todo bajo el id del
  DUEÑO. Un evento que nace en una pantalla del cliente —`/s/[token]`,
  `/c/[token]`— no tiene a quién atribuirlo sin resolverlo en el servidor, y
  esa resolución es parte de la decisión, no un detalle de implementación.
- **Si se puede perder, y cuánto.** Un evento que manda el navegador del
  cliente es aproximado por diseño: hay un apartado entero más abajo sobre lo
  que iOS se niega a hacer. Decir «este número es un suelo, no un recuento» en
  el código evita que alguien lo presente como exacto en seis meses.

## Every requirement must account for iPhone

Sevenz owners work from their phones, and a large share of those are
iPhones. Any requirement, plan or fix has to be evaluated against iOS
before it's considered complete — on two separate fronts, because they
fail in different ways.

**What the browser may refuse to do.** iOS Safari blocks, restricts or
periodically erases things other browsers allow: requests to third-party
domains, `localStorage` and cookies (wiped after a period of inactivity,
which silently changes any ID stored there), background work after a tab
is closed, and notifications. Never make anything that matters depend on
the customer's browser cooperating. If a feature has to record something,
send something, or remember who someone is, the server does it — the
browser is treated as a convenience that may simply not happen.

This is not hypothetical. In September 2026 an owner used the app on eight
of nine days while Mixpanel showed him churned: Supabase held 31 movements
and Mixpanel held zero, because the events were being sent from his device
and never arrived. The instrumentation was correct the whole time. The fix
was moving the events to the server (`lib/mixpanel-server.ts`), which works
regardless of *which* iOS restriction was responsible — a diagnosis we
never actually confirmed, and didn't need to.

**How it looks and behaves.** Safari on iPhone is not Chrome on a laptop:
it zooms in when a font-size under 16px gets focus, `100vh` doesn't account
for the toolbar, safe areas need respecting on notched devices, `:hover`
has no meaning, date and file inputs render their own native UI, and
installed PWAs behave differently again. A layout verified only in the
desktop preview has not been verified.

When a change is previewable, check it at iPhone width before reporting it
done, and say in the QA table which viewport was actually tested — a row
that doesn't name the viewport reads as if it were tested everywhere.

## A change ships in four places, not one

Every release asks one more question before it goes out: **does this make
something we already wrote false?**

Sevenz explains itself in four surfaces outside the app, and all four live in
the `Web/` repo, which deploys separately from the dashboard:

| Surface | Where |
|---|---|
| Preguntas frecuentes | `Web/components/landing/faq.tsx` |
| Soporte | `Web/lib/soporte.ts` |
| Términos y condiciones | `Web/app/terminos-y-condiciones/page.tsx` |
| Política de privacidad | `Web/app/politica-de-privacidad/page.tsx` |

The question is not "should we write a new page for this" — usually no. It is
"is any sentence already published now wrong?" Those are different checks, and
only the second one catches contradictions.

**This is not hypothetical.** On 2026-09-13 the app started asking owners to
install Sevenz on their phone, while the FAQ on the same product's home page
answered *"No tienes que instalar nada"*. Both sentences were written in good
faith, months apart. Nobody had lied; nobody had looked either. It was caught
by accident while adding the new FAQ entry, not by any check.

The legal pair earns its own attention because it fails quietly and costs more:
a feature that starts storing something new, sharing something with a third
party, or keeping data longer makes the Política de Privacidad inaccurate the
day it ships, and nothing in the codebase will complain. Storing client photos
in a public bucket, adding an analytics provider, recording who wrote each
movement — each of those is a paragraph somewhere, or should be.

Two surfaces, two deploys: a dashboard merge does not publish the website. A
release that changes both has to merge both, and the checklist says which.

### `Web/` ships a BUILD, not a branch — build it, then verify the live page

`npx wrangler deploy` uploads whatever is sitting in `Web/out/`. It does not
build. Merging to `main` does not build either. So the sequence is **`npm run
build` and then `npx wrangler deploy`**, in that order, every time.

Skipping the build does not fail. It prints `No updated asset files to upload`
and `✨ Success`, redeploys the previous build, and exits 0 — a deploy that
looks exactly like a correct one and changed nothing. It happened on
2026-10-08: the merge was right, the text was right in git, and the live Ayuda
kept describing the old screen while the log said success. `out/index.html` was
five days old.

**Y `wrangler deploy` no basta: `main` hay que EMPUJARLO.** Medido el 2026-10-09. `npx wrangler deploy` subió 74 archivos y dijo
`✨ Success`; la URL del worker
(`sevenz-web.sevenz-mvp.workers.dev`) enseñaba lo nuevo al instante. **`sevenz.site`
siguió enseñando lo viejo durante más de dos minutos**, incluso pidiéndolo con un
`?cb=<timestamp>` que debería romper cualquier caché. Al empujar `main` —que
estaba 6 commits por detrás, porque el merge se había hecho solo en local— el
dominio se actualizó en menos de un minuto.

**CONFIRMADO EL 2026-10-16**, corriendo la prueba barata que este mismo
apartado proponía. Ya no es una hipótesis con una sola observación:

| Momento | `sevenz-web.sevenz-mvp.workers.dev` | `sevenz.site` |
|---|---|---|
| Tras `npx wrangler deploy` | frase **nueva** | frase **vieja** |
| +0s, +15s, +30s tras `git push origin main` | — | frase **vieja** |
| **+45s** tras el push | — | frase **nueva** |

Las peticiones iban con `Cache-Control: no-store` y un `?cb=<timestamp>`
distinto cada vez, así que **la caché queda descartada**: el dominio no
cambió en todo el rato que medió entre el despliegue y el push, y cambió
dentro de los 45 segundos siguientes al push. O sea que `sevenz.site` lo
sirve una compilación de Cloudflare conectada a la rama `main`, y el
`wrangler deploy` de la línea de comandos publica en el worker.

**Consecuencia práctica, y es la que importa**: `wrangler deploy` NO publica
el dominio. Los tres pasos son obligatorios y el que de verdad lo cambia es el
tercero. Seguir esta regla a medias —construir y desplegar— deja el sitio sin
cambiar con el log diciendo que todo fue bien.

Así que el orden completo es **`npm run build` → `npx wrangler deploy` →
`git push origin main`**, y la comprobación en vivo va después de las tres.

**And the live page is what gets checked, not the log.** Fetch it with
`cache: 'no-store'` and assert on both sides: the new sentence present AND the
old one absent. A normal page load can show a cached copy and send you looking
for a deploy problem that is not there — which also happened the same day,
one minute after the real one.

## Explain bugs in two languages: dev and plain

Whenever explaining a bug, a fix, or a technical finding — by default,
not only when asked — give both:

1. **Dev explanation**: precise, references the actual code/state/logic
   and the exact condition that triggers it.
2. **Plain-language explanation**: no jargon, told as a real, concrete
   scenario with a name — something a non-technical shop owner could
   follow without reading code.

Reason: whoever's reading the report might not be a programmer, and even
when they are, a concrete story makes real-world severity legible faster
than a code trace does.

Real example (the `openForPayment()` currency bug, 2026-08-28):

- **Dev**: `openForPayment()` only corrected `currency` toward `"EUR"`
  (`if (currentDebtUsd <= 0 && currentDebtEur > 0) setCurrency("EUR")`),
  never back toward `"USD"`. If `currency` was already `"EUR"` from a
  prior interaction while `currentDebtUsd > 0` and `currentDebtEur <= 0`,
  `type` got set to `"payment"` but the existing
  `type === "payment" && !canPay` guard (computed against the stale
  `"EUR"` selection) immediately reverted it to `"charge"` before paint.
- **Plain**: imagine a Venezuelan owner who was just looking at a
  different client's account in euros. They open Pedro's page — Pedro
  owes $50 in dollars, nothing in euros — and tap "Agregar abono" to log
  that Pedro just paid. Because the app still remembered "euros" from
  moments ago, it quietly flips the screen back to "register a new
  charge" instead, with zero explanation. The owner tapped a button that
  said "record a payment" and landed on "add a debt" instead.

## SIEMPRE MANDA EL MONTO QUE TECLEÓ EL TENDERO

**Regla crítica, pedida por el dueño el 2026-10-24 después de ver Bs. 100.001,87
donde él había escrito Bs. 100.000**: *«siempre deben mandar los montos
tecleados en toda la app»*. Sus palabras sobre el fallo: *«Eso es crítico y
escandalosamente mal»*.

**La cifra que el tendero escribió se guarda tal cual y se vuelve a enseñar tal
cual. Nunca se recalcula.** Si hace falta la misma cantidad en otra moneda, esa
conversión va DEBAJO y en pequeño, nunca en lugar de la suya.

### Por qué una reconversión no devuelve lo mismo

No es un fallo de redondeo que se pueda apretar: es aritmética.

```
Bs. 100.000 ÷ 886,2271 = $112,8381…   → el libro guarda céntimos → $112,84
$112,84 × 886,2271      = Bs. 100.001,87
```

Los 0,0019 $ que el redondeo añade valen 1,87 Bs. **Da igual cuántos decimales
se guarden**: mientras el libro tenga una precisión finita, la vuelta cae en
otro sitio. Por eso la única forma de que la pantalla repita la cifra del
tendero es **guardarla**, no recalcularla.

### Lo que costó, medido en dev el 2026-10-24

- Un reparto de **Bs. 200.000** entre dos libros guardaba 100.004,00 +
  100.001,87 = **Bs. 200.005,87**. Casi seis bolívares salidos de la nada.
- De **13** abonos tecleados en bolívares, **7 enseñaban una cifra distinta**
  en la fila del historial y en la tarjeta dentro del fiado. El peor, Bs. 3,48.
- **Nada de esto rompe nada.** No hay error, no hay rojo, el saldo del fiado es
  correcto. Lo único que pasa es que la app le enseña al tendero —y al cliente,
  con el teléfono en la mano— una cifra que nadie escribió.

### Qué hay que hacer, en concreto

1. **Guardar lo tecleado junto a lo convertido.** `movements.entry_currency` y
   `entry_amount` existen para eso. Un reparto necesita además la cifra POR
   LÍNEA: `aManoBs` en `lib/abonos/borrador.ts` es el precedente.
2. **Cuando un billete se reparte, las partes SUMAN el billete.** Se reparten
   proporcionalmente y **la última absorbe el resto**. Nunca se convierte cada
   parte por su cuenta: las conversiones no suman.
3. **Una parada dura donde se guarda**, no solo en la pantalla. En
   `registrarAbonoRepartido` hay una: si las partes no suman lo tecleado, se
   rechaza. Un descuadre de céntimos en dinero de gente no puede volver a pasar
   en silencio durante un día entero.
4. **Y la trampa que esto ya pisó**: cuando dos pantallas escriben el mismo
   borrador, la que no es dueña de un campo **tiene que arrastrarlo**. La
   pantalla del reparto guarda el borrador entero en cada render y borraba el
   `aManoBs` que la del monto acababa de escribir. La cifra se guardaba bien y
   se perdía un instante después.

### La auditoría se hace por TABLA, no por pantalla

El 2026-10-24, el mismo día que se escribió esta regla, se auditó la app
«entera» recorriendo pantallas: el reparto, las filas del historial, la venta
de contado. Se arreglaron las tres. Y el dueño encontró una cuarta a la media
hora —el abono del momento de la compra, que salía como Bs. 1.003,02 por unos
Bs. 1.000 tecleados—, porque **no era ninguna de las pantallas de la lista**:
ese pago no vive en `movements` sino en `sale_payments`, y se dibuja como la
primera fila de «Abonos relacionados» dentro de la ficha de un fiado.

**Una lista de pantallas nunca está completa**: la misma cifra se enseña en
sitios que no se parecen entre sí. Una lista de columnas sí lo está.

Son dos, y buscar sus lectores es un `grep`:

- `movements.entry_amount`
- `sale_payments.entry_amount`

Y el patrón que delata a un lector que no las usa es `amount * tasa` o
`* exchange_rate_used` / `* rate_used` junto a un `formatBs`. **Esa búsqueda
es la auditoría**; recorrer pantallas de memoria no lo es.

### Dónde aplica, que es en todas partes

Abonos, ventas, fiados, el comprobante PNG, el mensaje de WhatsApp, el enlace
del cliente. **Si una pantalla enseña un importe, la pregunta es siempre la
misma: ¿esto es lo que alguien escribió, o lo que yo calculé a partir de lo que
escribió?** Si es lo segundo y existe lo primero, está mal.

## Toda plantilla de WhatsApp lleva el pie antifraude

```
Sevenz no pide códigos ni pagos. Aquí solo ves tu saldo.
```

**56 de los 60 caracteres que admite un pie de Meta. Sin variables.** Decisión
del dueño el 2026-10-08, y aplica a **todas** de aquí en adelante — de cliente
y de dueño.

**No es cortesía legal.** Sevenz hace exactamente lo que hace un estafador:
manda un mensaje sobre dinero, con un enlace, desde un número que el
destinatario no tiene agendado. En Venezuela esa secuencia es la estafa más
corriente que existe. Una plantilla sin el pie enseña que los mensajes de
Sevenz a veces no lo llevan, y ese es el hueco por el que entra quien los
imita.

Va en el **pie** y no en el cuerpo: sale en gris y separado, así que se lee
como aviso del sistema y no como algo que escribió el tendero. Ese formato es
parte de la defensa — quien copie el texto no lo reproduce.

**Las aprobadas no se tocan solo por esto**, porque un pie no se añade sin
volver a pasar por Meta. Entra la próxima vez que cada una haya que rehacerla
por otro motivo.

**Y el pie no es la defensa principal.** Lo que hace que el mensaje parezca una
estafa es que sale de un número de EE. UU. (`MS-17`). El pie refuerza; lo que
resuelve es un número local, que es la oportunidad abierta en `MS-24`.

La especificación completa de cada plantilla vive en
`../docs/WHATSAPP-PLANTILLAS.md`, que es la fuente de verdad y se escribe
**antes** de enviar nada a Meta.

## Una plantilla no está lista hasta leer lo que Meta APROBÓ

La ficha de `../docs/WHATSAPP-PLANTILLAS.md` describe lo que **se envió** a
aprobación. Lo que Meta devuelve aprobado puede ser otra cosa, **sin que nada
avise**, y a partir de ese momento la ficha es una afirmación falsa escrita de
buena fe. Por eso, cuando Meta aprueba una plantilla:

1. **Se abre la plantilla aprobada** en Kapso o en el Administrador de Meta y
   se compara campo por campo con la ficha: cuerpo carácter a carácter,
   variables con su nombre **y su orden**, categoría, idioma, pie, y el botón
   con su tipo de URL.
2. **Se corrige la ficha con lo aprobado**, no al revés, y se anota la fecha.
3. **Su fila entra en `qa/plantillas-esperadas.mjs`**, con sus parámetros de
   cuerpo **y su botón**. Una suite no puede vigilar lo que no conoce.

### Qué costó no hacerlo, el 2026-10-15

`abono_confirmation_v2` se aprobó con el botón de URL **estático**: la URL
llevaba el texto literal `{{share_token}}`, que Meta no reconoce como variable.
El código le mandaba un parámetro y Meta devolvía `132018` —*«Button at index 0
of type Url does not require parameters»*— **rechazando el mensaje entero**.

**12 de 12 envíos fallidos en producción, cero recibos entregados, y el sistema
nunca funcionó ni una vez.** No se vio desde la app: el tendero registraba su
abono, la pantalla decía que todo bien, y el rechazo quedaba solo en una fila
de `whatsapp_sends` que nadie miraba. Lo descubrió el dueño preguntando por qué
sus clientes no recibían nada.

Tres controles debieron cazarlo y los tres dijeron que todo estaba bien:

| Control | Por qué no sirvió |
|---|---|
| `qa/plantillas-esperadas.mjs` | Solo listaba parámetros de **cuerpo**. Sin botones en la lista, no había nada que comparar |
| `qa/recibo-cliente.mjs` | Miraba que el token tuviera 16 caracteres. Pasaba en verde con el envío roto |
| La ficha del documento | Describía lo pedido, no lo aprobado — y nadie abrió lo segundo |

Los tres están arreglados. La lección que se generaliza: **tres controles que
se escriben mirándose entre sí coinciden perfectamente y pueden estar los tres
equivocados.** Al menos uno tiene que mirar la realidad exterior, y en una
plantilla la realidad exterior es lo que Meta tiene guardado.

### Dos cosas concretas que aprendimos y conviene no redescubrir

- **El sufijo de un botón de URL es POSICIONAL** (`{{1}}`) y al enviarlo va
  **sin `parameter_name`**, aunque el cuerpo use `parameter_format: NAMED` y
  sus parámetros sí lo lleven. Confirmado por Kapso por escrito.
- **Una plantilla aprobada NO se edita.** Para corregirla hay que crear una
  versión nueva (`_v3`, `_v2`…) y cambiar el nombre en el código. La anterior
  sigue aprobada y hay que dejar de usarla — y **sacarla de
  `qa/plantillas-esperadas.mjs`**, para que si alguien la vuelve a mandar, la
  suite no la reconozca y avise.

### Las que ya están aprobadas y todavía no se usan: dar por rota su URL

**Toda plantilla aprobada antes del 2026-10-15 con un botón de URL que lleve
una variable está presuntamente rota de la misma forma**, y eso **no** se
descubre leyendo su ficha: la ficha de `abono_confirmation_v2` describía un
botón dinámico que Meta había guardado como estático, y es la misma frase
copiada que llevan las demás.

Son seis, todas con `https://app.sevenz.site/s/{{share_token}}` escrito igual:
`abono_confirmation` (v1), `fiado_notification`, `fiado_notification_v2`,
`payment_due_today`, `pending_balance_weekly` y `overdue_payment`.

**Antes de conectar cualquiera de ellas**, lo primero —antes de escribir una
línea de código que la llame— es **abrir la plantilla aprobada y mirar el tipo
de URL del botón**. Si es estática, hay que crear una versión nueva con
`{{1}}`, porque una aprobada no se edita. Presupuestarlo desde el principio: no
es un retoque, es una plantilla nueva y su espera de aprobación.

Y la señal práctica, que ahorra abrir la documentación de Meta: **un botón
dinámico hace que el editor pida un ejemplo de URL completa.** Si no lo pide,
es estático.

### El mismo riesgo existe hacia el otro lado

Una plantilla cuyo botón **sí** sea dinámico y a la que **no** se le mande el
sufijo falla igual de entera y de silenciosa. Por eso
`qa/plantillas-esperadas.mjs` distingue tres estados —`null` (sin botones),
`"sin_parametros"` (los hay y ninguno toma valores) y `"url_suffix"`— aunque
los dos primeros se envíen igual: la tabla no es solo una comprobación, es el
único sitio del repo donde consta qué aprobó Meta.

## Toda decisión se documenta, y cada tipo tiene su sitio

**Si una decisión no está escrita, dentro de seis meses no se tomó: solo pasó.**
Y lo que se pierde primero no es qué se hizo —eso se ve en el código— sino
**por qué**, y sobre todo **qué se descartó y a cambio de qué**.

Esto ya se hacía en este proyecto. Lo que faltaba era la regla que dice cuál va
dónde, porque meterlo todo en el mismo sitio es la forma de que no se lea
ninguno.

| Qué estás documentando | Dónde va |
|---|---|
| Por qué este código es así, y qué pasa si se toca | **Comentario, pegado al código** |
| Una regla para la próxima pantalla | `DESIGN-SYSTEM.md` |
| Una regla de proceso, para cualquier trabajo futuro | este archivo |
| Algo que falta, o que se decidió NO hacer | `../docs/PENDIENTES.md` |
| La forma de algo que vive fuera del repo | su plan en `../docs` |
| Qué se probó y qué no | la tabla de QA en el chat, y el mensaje del commit |

### El comentario y el mensaje del commit NO son intercambiables

Es la confusión que hace que esto falle. **Los dos hacen falta y dicen cosas
distintas:**

- El **mensaje del commit** explica **el cambio**: qué había antes, qué hay
  ahora, por qué se movió. Se lee una vez, buscándolo a propósito, normalmente
  porque algo se rompió.
- El **comentario** explica **el estado**: por qué el código es así hoy. Lo lee
  quien abre el archivo, sin buscarlo, que es la única forma en que alguien se
  entera de algo que no sabía que tenía que preguntar.

Quien va a romper una decisión dentro de un año está editando el archivo, no
leyendo el historial. Si la razón solo está en el commit, no la va a ver.

### Qué merece un comentario y qué es ruido

No es «comentar más». Un comentario que repite lo que el código ya dice estorba
y envejece mal. **Se comenta lo que el código no puede decir:**

- ✅ **Lo que ya falló.** *«Era un borde de un solo lado hasta el 2026-10-08, y
  así se rompía la esquina»*. El código nuevo no puede contar el bug viejo.
- ✅ **Lo que se descartó y por qué.** *«Envolviendo este componente, la línea
  de bolívares quedaba sangrada»*. Sin eso, el siguiente lo intenta otra vez.
- ✅ **El límite de la decisión.** *«Sobre blanco es 2,17:1, este token es solo
  para la cabecera»*. Es lo que impide usarlo mal.
- ✅ **La medición.** *«38px de holgura, medido con la página al final del
  todo»*. Un número medido se puede comprobar; «se ve bien» no.
- ❌ Lo que el código ya dice literalmente.

### Una decisión del dueño se marca como suya, con fecha

*«Decisión del dueño el 2026-10-08»*, *«a petición»*. No es burocracia: separa
lo que es criterio del producto de lo que es criterio técnico. Lo segundo se
puede cambiar discutiéndolo con quien edite; lo primero hay que preguntarlo. Y
cuando una decisión del dueño va en contra de algo escrito antes —pasó con el
aviso de instalar y el contraste—, **se anotan las dos**: la decisión nueva y
la razón vieja que desplaza. Si algún día se revierte, la razón ya está ahí.

### Dos repos, una sesión

Ya está dicho más abajo y se repite aquí porque es donde esto se rompe: un
cambio que toca código y documento se commitea **en los dos, en la misma
sesión**. «Lo apunto luego» es como `PENDIENTES.md` acaba describiendo una app
que ya no existe.

## Antes de proponer un cambio, LEE la decisión que está escrita al lado

**Pedido por el dueño el 2026-10-25**, después de que le propusiera como arreglo
deshacer una orden suya del día anterior sin darme cuenta de que lo era.

Le ofrecí «arreglar» una pantalla **quitándole la barra de navegación**. Esa
barra estaba ahí porque él la había mandado poner el 2026-10-24 —*«Regresa el
navbar a todas las pantallas de registros exitosos de transacciones del lado del
dueño»*— y el comentario de `mobile-nav.tsx` dejaba escrito que la decidió
**sabiendo exactamente lo que costaba**: que la barra dejaba «tres botones sin
poder pulsarse» en reposo, que *«eso sigue siendo cierto y el dueño lo sabe»*, y
por qué le pesaba más que estas pantallas sean el final de un flujo.

O sea que la razón estaba escrita, con su cita y su medición, **en el mismo
archivo que yo proponía cambiar**. No lo abrí.

**La regla, entera**: antes de proponer que cambie un comportamiento, se abre el
sitio donde ese comportamiento vive y se leen sus comentarios. Si hay una
decisión escrita, **se nombra en la propia propuesta**, con su fecha y su razón:

> Ojo: esto deshace lo que decidiste el 2026-10-24 (devolver la barra a las
> pantallas de éxito), que tomaste sabiendo que dejaba botones tapados en
> reposo. ¿Lo reabrimos?

Él puede cambiar de opinión — la decisión es suya. Lo que no puede es cambiarla
**sin saber que la está cambiando**.

**Y vale igual para una ficha de `PENDIENTES.md`.** Una ficha que ofrece una
salida sin decir que esa salida ya se descartó no está incompleta: le pide al
que la lea dentro de seis meses que repita la discusión entera sin los datos que
ya se tenían.

**Por qué merece regla propia, y no es simplemente «leer más».** Proponer
deshacer una decisión del dueño **se parece exactamente a proponer un arreglo**:
las dos llegan con su medición y su coste delante, y lo único que las distingue
es un comentario que hay que ir a buscar. Lo caro es que **él no puede
detectarlo**: si no se lo digo, el único sitio donde consta que ayer decidió lo
contrario es su memoria — que es justo lo que este archivo existe para no
necesitar.

**Es la hermana de «Una función puede estar redefinida más abajo: lee la
ÚLTIMA»**, más arriba en este mismo archivo. Allí el riesgo es diagnosticar
leyendo una versión vieja del código; aquí, proponer leyendo una versión vieja
de una decisión. Las dos se cierran igual: mirando lo último escrito **antes** de
concluir, no después de que alguien lo desmienta.

## Los pendientes y los planes viven en `../docs`

**Este repo es público. Los documentos con cifras del negocio no están aquí.**

Viven en el repositorio **privado** `sevenz-site/sevenz.docs`, clonado como
carpeta hermana:

```
Sevenz/
├── dashboard/   ← este repo, público
├── Web/         ← público
└── docs/        ← privado
```

| Archivo | Ruta desde aquí |
|---|---|
| **`PENDIENTES.md`** — la lista única | `../docs/PENDIENTES.md` |
| `CLIENTES-AUTENTICADOS-PLAN.md` | `../docs/CLIENTES-AUTENTICADOS-PLAN.md` |
| `PLANES-Y-CUENTAS-PLAN.md` | `../docs/PLANES-Y-CUENTAS-PLAN.md` |
| `REPORTES-PLAN.md` | `../docs/REPORTES-PLAN.md` |
| `PAPELERA-PLAN.md` | `../docs/PAPELERA-PLAN.md` |
| `SUBIR-LIBRETA-PLAN.md` | `../docs/SUBIR-LIBRETA-PLAN.md` |
| `QA-PASO-8-PLAN.md` | `../docs/QA-PASO-8-PLAN.md` |

**Hay que abrirlos a propósito.** Ya no están en el working directory, así que no
aparecen solos: leer `../docs/PENDIENTES.md` es el primer paso de cualquier
planificación, no algo que se hace si sobra tiempo.

### Sobre `PENDIENTES.md`

**Lista única. Si un pendiente no está ahí, no existe.** No en la memoria de
Claude, no en un hilo de conversación, no en la cabeza de nadie. Está agrupado por
**vertical** (la iniciativa a la que pertenece), cada pendiente en **una sola**,
con un ID estable que no se reutiliza.

Tres obligaciones, y ninguna cuesta nada:

1. **Consultarlo** al planificar trabajo, y **antes de cada despliegue a
   producción**, junto al `qa-regression-checklist`.
2. **Añadir** ahí cualquier pendiente que salga — de una prueba, de una reseña, de
   una conversación. Con su vertical y su fecha. Sin vertical no entra.
3. **Cerrar** moviendo la fila a la sección *Hecho* con la fecha y una línea de
   qué pasó. **Nunca borrar**: un pendiente cerrado explica por qué el código es
   como es, y esa es justo la información que se pierde primero.

### La regla que impide que los dos repos diverjan

**Dos repositorios no pueden commitear atómicamente.** Un cambio que toca el
código y su documento se commitea **en los dos, en la misma sesión** — nunca "lo
apunto luego". Es el costo conocido de la separación y la única defensa es el
hábito: si una migración sale y la tabla de fases del plan sigue diciendo
"pendiente", el plan miente a partir de ese día.

Los cinco nombres están en el `.gitignore` de este repo, así que si alguno se
recrea aquí por costumbre, git lo ignora y no se puede subir por accidente.

### El porqué de todo esto

Hasta el 2026-09-18 la lista vivía solo en conversaciones. Se escribió al
comprobar que la memoria del proyecto estaba **vacía** y que pendientes dados por
guardados no lo estaban.

Y se separó en un repo aparte el mismo día: poner los repos de código en privado
bloqueó **todos los despliegues de Vercel en segundos** —el plan Hobby no admite
repos privados— así que volvieron a público, y las cifras se mudaron a un repo que
no despliega nada y por tanto sí puede ser privado. Ver `PL-3` en
`../docs/PENDIENTES.md`.

## Skills that apply automatically

- Before merging `dev` into `main`, or making any change to the production
  Supabase project: run the `qa-regression-checklist` skill first, and
  wait for the user's explicit confirmation before actually launching.
- Before adding any new third-party dependency, SDK, or external API: run
  the `new-api-risk-review` skill first, and wait for explicit approval
  before installing or integrating anything.

## Code is written in English. Always.

**Identifiers, filenames, function names, table and column names, and code
comments are in English — no matter what language the conversation is in.**
The user writes in Spanish; that is a conversation preference and says nothing
about the code.

This rule exists because it was broken. Spanish naming entered the codebase on
2026-09-13 — `tasa-prevista.ts`, then `monto-en-bolivares.ts`,
`moneda-habitual.ts`, `cuenta-pausada.tsx`, `comprobante-input.tsx` — four days
BEFORE the conversation switched to Spanish. It was drift, not translation, and
nobody noticed until the codebase read as Spanglish.

### What stays Spanish, deliberately

- **Anything the user reads**: UI copy, error messages shown to a shopkeeper or
  a client, toasts, dialog titles.
- **Routes**, because a URL is user-facing: `/malas-pagas`, `/papelera`,
  `/clients/[id]`. Do not rename these.
- **Domain words already in the product's vocabulary** when quoted inside an
  English sentence in a comment — fiado, abono, mala paga, bodega.

### Comments included, and that is not obvious — so it is written down

**"Code comments" above means comments. All of them, from now on.** Confirmed
by the user on 2026-10-03, after a delivery shipped with English identifiers and
Spanish comments, and the question was put to them instead of decided alone.

It needed confirming because the pull is real and it is not laziness: the file
you are editing is usually commented in Spanish, and "write code that reads like
the surrounding code" is otherwise good advice. It does not win here.

The boundary is the same as for names: **existing Spanish comments are not
translated.** A file keeps whatever prose it already has, and what you add to it
is English. So a mixed file is the expected outcome of editing an old one, not a
mistake to go back and fix. What is NOT acceptable is writing a NEW Spanish
comment because the ones around it are Spanish — exactly the rule for names, for
exactly the same reason.

Strings the user reads are unaffected: `console.log` output in a `qa/` script is
read by the user, so it stays Spanish, in the same file whose comments are
English. That is the rule working, not a contradiction.

#### SQL migrations are comments too, and that needed saying

**A `.sql` file under `supabase/` is code. Its comments are English, same as
every other file's.** Confirmed by the user on 2026-10-15: *"Idioma de
comentarios en inglés siempre"*, asked as a straight choice between converting
and writing migrations down as the exception. There is no exception.

It needed saying because migrations are where this rule has been broken the
most and the hardest to notice. `104` through `111` were all written with
Spanish comments, none of them flagged, and by the time anyone looked it read
as the house style rather than as drift — which is exactly how `tasa-prevista.ts`
got in on 2026-09-13.

Two things make a migration pull harder than a `.ts` file toward Spanish, and
knowing them is the defence:

- **Its comments are the longest in the repo.** A migration carries the whole
  decision, its cost and what it displaces, so it is the most expensive prose
  to write — and the point at which "the surrounding files are Spanish" is most
  tempting.
- **It quotes the owner.** His words are Spanish and stay Spanish, verbatim and
  in quotes. An English comment carrying a Spanish quotation is correct and is
  what these files should look like, not a reason to write the whole thing in
  Spanish.

The ledger's `description` is NOT a comment — it is a value stored in
`public.schema_migrations` that the user reads during a parity check, so it
follows the same rule as `console.log` in `qa/` and stays Spanish.

The boundary is unchanged: migrations already written keep their prose. `111`
was converted on 2026-10-15 because it had not reached production yet; `104`
to `110` were left alone.

### The boundary, because the codebase is now mixed

Existing Spanish names are NOT renamed. The cost of touching
`owner_puede_escribir` or `MENSAJE_CUENTA_PAUSADA` — both live in production —
is far higher than the inconsistency. Decided 2026-09-17.

So new code will call old Spanish names, and that is fine:

```ts
// Correct: an English name calling the existing Spanish one.
const canWrite = await puedeEscribir(supabase, user.id);
```

What is NOT fine is adding a new Spanish name because the ones around it are
Spanish. That is how the drift happened in the first place.

### The one place to be careful

**Values stored in the database outlive the code.** A string like `'dueno'` in a
column with a check constraint is far more expensive to rename after it reaches
production than a variable is. New enum-like values go into the database in
English from the start.

## Dependencias de las que ya sabemos que hay que salir

Una dependencia no se juzga solo al entrar. Cuando una reseña deja algo
pendiente, se escribe aquí, porque el que la instaló no va a ser el que se
encuentre el problema.

### `@tanstack/react-table` v8 — NO añadir más sitios que la usen

Hoy la usa **un solo archivo**, `components/admin/cuentas-tabla.tsx`, al que
solo llega `/admin/cuentas`. Ninguna pantalla del tendero la carga.

La v9 ya está publicada y es una **reescritura**: `useReactTable` pasa a
`useTable`, los row models se declaran en `tableFeatures()`, el estado sale de
`getState()`. Todo lo que importamos cambia. Y la v9 existe justamente porque
**la v8 se rompe con el React Compiler**, que `next.config.ts` todavía no tiene
encendido.

Las dos consecuencias, y ninguna es urgente:

- **Si hace falta otra tabla, no se añade un segundo sitio a la v8.** Ese es el
  momento de decidir entre migrar a la v9 o hacerla a mano — no de atar una
  pantalla más a una versión que ya se quedó atrás.
- **Encender el React Compiler obliga a migrar `/admin/cuentas` primero.** Si no,
  el síntoma será una tabla portándose raro y la causa parecerá un bug de
  maquetación.

Se dejó a propósito: quitarla cuesta un día y no compra nada, y el radio del
daño es una pantalla interna de 24 filas que solo ve el dueño de Sevenz.

Esto salió de correr `new-api-risk-review` **después** de instalarla, el
2026-09-15 — al revés de como lo pide la regla de arriba. La lección no es que
la librería fuera mala: es que la reseña sí tenía algo que decir, y saltársela
fue decidir de antemano que no lo tendría.

## Después de cada liberación: la lista de lo abierto, y la ficha cerrada sin preguntar

**Pedido por el dueño el 2026-10-24**: *«luego de cada liberación debes
presentar lista de lo que queda abierto y debes cerrar la ficha de pendientes
con lo liberado sin preguntármelo. Si algo de lo que queda abierto va a
pendiente yo te lo diría para que lo anotes luego»*.

Son **dos obligaciones y una prohibición**, y la prohibición es la que de
verdad cambia algo:

1. **El informe de la liberación termina con lo que QUEDA ABIERTO**, nombrado.
   No «hay algunas cosas pendientes»: qué cosas, y por qué siguen abiertas.
2. **Las fichas de `../docs/PENDIENTES.md` se cierran EN LA MISMA SESIÓN**, con
   su nota entera, en cuanto lo que describen está en producción.
3. **Y eso NO se pregunta.** Cerrar una ficha de algo que acaba de salir no es
   una decisión suya; es apuntar un hecho.

**Qué decide él, entonces, y qué no.** Lo que queda abierto se le PRESENTA, y
si alguna de esas cosas merece ficha propia, él lo dirá. Abrir fichas nuevas a
discreción por cosas que no pidió es lo contrario de esto: llena la lista de
ruido y la lista solo vale si se lee entera.

**Por qué merece regla.** Preguntar «¿cierro las fichas?» después de un
despliegue parece prudente y no lo es: la ficha ya está obsoleta en cuanto el
código sale, y el hueco entre el despliegue y el cierre es exactamente donde
la lista empieza a mentir. El 2026-10-24 se cerraron siete fichas que llevaban
días diciendo «falta producción» cuando no faltaba, y **ninguna se cerró
porque alguien terminara el trabajo** — se cerraron porque por fin alguien fue
a desmentirlas. Una lista que miente deja de servir para decidir, que es lo
único para lo que existe.

## "Merge it" is not permission to skip the checklist

**"Merge", "push to prod", "go to prod", "launch it", "deploy", "ship it"
and every synonym mean: do the agreed process, then launch. They never
mean: skip the agreed process.**

The order is not negotiable and not reorderable:

1. Run the checklist.
2. Show the user the result.
3. Ask.
4. Launch only after they answer.

A "merge" that arrives before step 2 is an instruction to start at step 1,
not permission to jump to step 4. The user cannot be confirming a result
they have not been shown, so treating their word as that confirmation
puts words in their mouth.

**Never decide on the user's behalf that a rule does not apply this time.**
If a step looks unnecessary — the diff is narrow, the area is untouched,
it was run an hour ago — that is a case to put to them in one sentence,
not a conclusion to act on:

> The rule says run `qa-regression-checklist` before merging. The diff only
> touches `/admin`. Run it in full, scope it down, or skip it this time?

Then wait. Any of those three answers is fine. Deciding it alone is not,
even when the decision would have been right, because the user loses the
chance to disagree and does not know they lost it.

**Scoping happens inside the checklist, in front of the user, never
instead of it.** The skill's own first step is *Scope the change* — that
is where "this diff doesn't touch the money paths" gets said out loud and
written into the report. Reaching that conclusion privately and using it
to skip the whole skill inverts the tool: the skill exists precisely to
make that judgement visible and reviewable.

This rule was written on 2026-09-06 after seven consecutive merges to
`main` went out with no checklist run. Each skip had a plausible reason.
None of them was ever said out loud, and the summary report afterwards
described the pattern as "a reasonable call made seven times in a row" —
which is what a broken agreement looks like once it has been rationalised.
The cost is not one missed test; it is that the user can no longer trust
that an agreed step actually ran unless they ask.

**The same applies to every rule in this file, not just the checklist.**
Dev-only by default, explicit ownership checks, naming the environment,
the migration ledger, testing before reporting delivered: if there is a
reason to depart from one, the departure is proposed and approved before
it happens, never explained afterwards.
