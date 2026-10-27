---
name: qa-regression-checklist
description: Run a manual QA regression checklist across Sevenz's core money-path flows before launching anything to production — merging dev into main, or making any change (SQL, env vars, config) against the production Supabase project. Use whenever a production launch is being considered or requested, even if the user doesn't name this skill explicitly.
---

This is a manual checklist, not an automated test suite — this codebase
has no automated tests. Walk through each item below, actually verifying
it (read the code, check the diff since the last production release, ask
the user to run a read-only SQL query when direct DB access isn't
available), and report the result per item. Don't skip an item because it
"probably still works" — that's exactly the assumption this checklist
exists to catch.

**End state, always**: report the full checklist result to the user and
wait for their explicit confirmation before merging to `main` or touching
production. This skill never approves a launch on its own — it only
informs the user's decision. See CLAUDE.md's "dev-only by default" rule.

## 0. Cinco trampas que cuestan tiempo o decisiones falsas

Nada de esto es una comprobación: son las formas de equivocarse que ya han
pasado, puestas antes de la lista porque todas se pagan en mitad de un
despliegue. Las cinco salieron del lanzamiento del 2026-10-21.

**1. Varias suites necesitan `npm run dev` corriendo.** `qa:venta-accion`,
`qa:abono-accion`, `qa:venta-resumen` y `qa:colombia` llaman a acciones de
servidor por HTTP. Sin servidor fallan con «1/2 pasan», que **no se parece a
un problema de entorno**: parece que el código está roto. Pasó dos veces el
mismo día, la segunda después de haber parado el servidor para compilar.

**2. Las claves del ledger se comparan como TEXTO.** `key >= '122'` incluye
`2026-10-12_limpiar_whatsapp_inservibles`, porque `'2' > '1'`. Las claves con
fecha ordenan **detrás** de todas las numeradas. Esto costó dos errores el
mismo día: una ficha entera inventada (`DM-6`, que decía que producción tenía
apuntes que dev no, cuando los tres estaban en los dos lados) y una
verificación final que dio 16 donde debían ser 13. **Para contar un lote, usa
un patrón y no un rango**: `where key ~ '^1(2[2-9]|3[0-4])_'`.

**3. El editor de Supabase avisa de RLS en falso.** Si el `alter table …
enable row level security` va unas líneas más abajo que el `create table`
—que es como se escriben las migraciones de este repo— el analizador no lo ve
y ofrece «Run without RLS» / «Run and enable RLS». **La respuesta es «Run
without RLS»**: significa «no me añadas RLS tú», o sea ejecutar el SQL tal
como está, que ya la activa. Y después se verifica con `relrowsecurity`, sin
fiarse del botón. También marca como «destructivas» los `drop policy if
exists` que la propia migración necesita para poder re-ejecutarse.

**4. Lee TODAS las migraciones del lote antes de correr la primera.** Una
puede anular a otra. La `124` borra `movement_products`, la tabla que la `122`
crea dos migraciones antes, y su cabecera decía que en producción esa tabla
«nunca llegó a existir». Pasarlas de una en una según se van leyendo es cómo
se ejecuta algo que el propio lote deshace después.

**5. Verificar una página en vivo pide quitar las etiquetas primero.** Un
`grep` sobre el HTML crudo da falsos negativos: el JSX parte las frases entre
líneas y `grep` va línea a línea. Quita los tags, normaliza los espacios y
busca entonces. Y mide **los dos sitios por separado**: `npx wrangler deploy`
actualiza el worker al instante y **no publica el dominio** — eso lo hace el
push a `main`, y el 2026-10-21 tardó varios minutos, no los 45 segundos que
estaban escritos.

## 1. Scope the change

- `git diff origin/main origin/dev --name-only` (or equivalent) — what
  actually changed since the last production release. Read every touched
  file's diff, not just the commit messages.
- Identify which of the flows below are actually affected. Don't run the
  full checklist blindly if the diff only touches something narrow (e.g.
  the calculator's icon) — but do check anything that touches shared code
  (server actions, the `movements`/`client_summary` schema, RLS policies,
  auth) even if the change looks unrelated, since those are exactly the
  places a small change breaks something distant.
- **Run `npm run qa:guiones` — un segundo, sin base de datos.** Comprueba que
  todo guion de `qa/` se puede lanzar con un `npm run qa:*`, o bien lo importa
  otro guion. Va **aquí**, antes de decidir qué suites corren, porque esta lista
  se recorre leyendo `package.json`: un guion que no esté ahí no es un guion que
  se olvide correr, es uno que **no se puede elegir** — y su ausencia se lee como
  cobertura que nadie escribió, no como cobertura que se perdió.

  Pasó el 2026-10-23: `qa/monto-bolivares.mjs` y `qa/fixtures-venta-colombia.mjs`
  habían perdido su entrada. Los dos seguían pasando al invocarlos a mano, que es
  justo lo que lo hace silencioso — nada estaba roto, el archivo era invisible. Y
  el primero vigila la cuenta de bolívares a la moneda del libro, o sea la
  aritmética entre lo que teclea el tendero y lo que se guarda.

  No lleva lista de excepciones a propósito: un módulo compartido como
  `qa/plantillas-esperadas.mjs` se salva porque alguien lo importa, y eso se lee
  de los archivos. Una lista a mano habría que mantenerla, y una desactualizada
  falla en silencio — el mismo fallo que este control cierra.

## 2. Core money-path flows

Run these against a **CO owner and a VE owner**, not just whichever account
is handy. The only thing that genuinely differs between them is currency
resolution — a CO owner must resolve to `null` — but "only one thing differs"
is a reason to check it, not to skip it.

This used to say "(COP owners)" and in practice got run on whatever account
had a password to hand, which for a long stretch was the VE fixture. The
result was a caveat — *"this row was tested in VE"* — rewritten into several
consecutive launch reports and never closed. A caveat that repeats is a gap
with good manners. It was finally closed on 2026-10-03 by running the whole
path in both, in production (`CT-35`).

- Create a new client with a first movement (charge). Balance appears
  correctly.
- Add a charge to an existing client. Running balance increases correctly.
- Add a payment (abono). Running balance decreases correctly; payment
  can't exceed current debt.
- **Y el abono AHORA SE DIRIGE a un fiado concreto** — migración `126`, desde
  el 2026-10-19. La línea de arriba sigue siendo verdad y dejó de bastar:
  registrar un abono empieza por elegir qué fiado paga, y esa elección se
  guarda. Tres casos, y ninguno lo cubren los seis puntos de esta lista:
  - un abono dirigido baja **SU** fiado y no el más antiguo;
  - un abono dirigido a un fiado **borrado** cae en el reparto viejo, porque
    un fiado borrado no entra en la cola — el dinero va al más antiguo
    abierto en vez de desaparecer;
  - y al **restaurar** ese fiado, el abono vuelve a aterrizar donde el
    tendero dijo, sin que nada se reescriba.

  **`npm run qa:abono-dirigido`** cubre los tres y **`npm run qa:abono-accion`**
  los rechazos de la acción (monto cero o negativo, fiado ya saldado, fiado de
  otro dueño, dirigir un abono a otro abono). La segunda **necesita el
  servidor corriendo**.

  **Y `npm run qa:puntaje`**, que mira la otra mitad de la misma ficha: que el
  puntaje de crédito reparta cada abono entre los fiados **igual que la base**.
  No escribe nada salvo su propio caso de prueba, que borra.

  Hace falta porque la ficha enseña dos cosas calculadas en dos sitios: el
  saldo y el chip los hace Postgres (`get_open_charges_for_client`), y la
  «Puntualidad histórica» la hace TypeScript (`buildChargeLedger`). Estuvieron
  separadas desde la migración `126` hasta el 2026-10-23 —`CT-124`, ya
  cerrado—: la base respetaba el fiado que el tendero elegía y el puntaje
  pagaba el más viejo, así que le acreditaba pagos puntuales a fiados que nadie
  había pagado. **Si esta suite se pone roja, las dos mitades volvieron a
  separarse**, y eso no es cosmético: el puntaje existe para avisar de quién no
  paga.
- Delete a movement, then restore it. Balance recalculates correctly both
  times (`recalc_client_running_balance`).
- Mala paga flag/unflag cycle still works and affects status correctly.
- **Register a charge AND a payment on a client who is currently flagged as
  mala paga.** Flagging someone makes every new charge ask for an extra
  confirmation — a branch of its own, inside the money path, that the five
  checks above never walk. It breaks in two directions and both are bad: an
  owner who *cannot* lend to a flagged client, or one the app lets lend with
  no warning at all, which is the one thing the flag exists to prevent.

  Added 2026-10-03, and not by anyone reading this file. The user tested it
  on his own initiative while closing the gap that became `CT-35`, in VE and
  in CO, and it turned out the checklist had never asked for it. Every hole
  this section has ever had was found the same way — by someone touching the
  app, not by someone re-reading the list.

### A fiado agreed in cuotas — from the release that ships migration `118` on

**Run `npm run qa:cuotas` from `dashboard/`. It takes seconds, writes only to
dev and cleans up after itself.** Seventeen checks: that a charge with no
cuotas is judged exactly as before, that "3 cuotas en 30 días" falls due every
10, that **half a cuota does not refresh the deadline**, that the database
refuses cuotas without a plazo, that a Colombian owner (whose currency is
`null`) splits too, and that the owner's and the client's WhatsApp both count
the cuota's deadline rather than the end of the term.

Then, in a browser and **named by viewport in the report**:

- Register a fiado **in cuotas** from both forms. There are two, and they post
  to different server actions: "Agregar fiado" on a client's page, and
  "Registrar cliente nuevo" from Inicio → Agregar movimiento. The second one
  shipped without the field once already — see CLAUDE.md's rule about a field
  entering through every door of its action.
- Open the movement's card and confirm the **table of dates** is there, that
  the amounts add up to the charge, and that nothing scrolls sideways at 375px.
- Open the same movement from the **client's shared link** (`/s/[token]`). It
  reads `get_shared_balance()`, not `movements`, so it can show the cuotas only
  because migration `121` names the column — a release that ships `118` without
  `121` leaves the client's card silently missing them.

**Why this is its own block and not a line in the list above**: a fiado in
cuotas walks the same money path as any other, so every check above passes with
it broken. What cuotas change is *when* the ledger says somebody is overdue —
and that answer is read by the badge, by the owner's weekly WhatsApp and by the
client's reminder, each through a different function. They already drifted apart
once, on 2026-10-16, between `118` and the two WhatsApp functions; migration
`119` is that fix, and `qa:cuotas` check 10 is what would catch it next time.

## 2b. LA VENTA — la mitad del dinero que esta lista no conocía

Desde el lanzamiento del 2026-10-21 (migración `124`). **Toda la sección 2
verifica saldos mirando `movements`, y una venta pagada entera no escribe
nada ahí** — a propósito, para que el contado no toque el saldo, el puntaje
ni las gráficas. O sea que una venta de contado rota pasaría invisible por
los seis puntos de arriba.

Corre **`npm run qa:venta`** (el esquema: grants, políticas, cascadas, y que
un negocio no pueda tener dos mostradores), **`npm run qa:venta-accion`** (la
acción de servidor, con sus rechazos) y **`npm run qa:venta-resumen`** (la
pantalla del resumen). **Las dos últimas necesitan el servidor corriendo.**

Y después, en el navegador, **nombrando el viewport en el informe**:

- **Una venta de CONTADO entera.** Producto → carrito → pago → resumen. En la
  base tiene que quedar la venta con sus `sale_lines` y `sale_payments`, y
  **cero filas en `movements`**. Esa última es la comprobación: si aparece un
  movimiento, el contado ha entrado en el saldo del cliente.
- **Una venta A CRÉDITO.** El cargo se escribe por **lo que queda**, nunca por
  el total. Una compra de 10 con 5 abonados deja un fiado de 5 — si deja uno
  de 10, el cliente debe el doble de lo acordado.
- **Una venta MIXTA, en dos monedas.** Dólares cobrados y euros fiados en la
  misma venta: tiene que salir fila de contado en la moneda cobrada y cargo en
  la fiada. Excluir la venta entera fue un fallo real el 2026-10-20 — los diez
  dólares cobrados no aparecían en ninguna parte.
- **Borrar una venta.** Se lleva sus líneas, sus pagos y los movimientos que
  nacieron de ella, y el saldo del cliente vuelve a lo que era. **Ninguna
  suite cubre esto todavía** (`CT-123`): hay que montarlo a mano, y es la
  acción que ya tuvo un fallo de dinero silencioso (`CT-122`).
- **El MOSTRADOR no puede quedar fiado.** Es el cliente que la app crea sola
  para una venta sin cliente; si pudiera deber, habría una deuda a nombre de
  nadie. `qa:venta-accion` lo prueba, pero mira también la lista de clientes:
  «Mostrador» aparece ahí (`CT-125`), con saldo siempre cero.

### El PEDIDO que se vuelve venta — `npm run qa:pedido-registro`

**Y los bordes de ese flujo tienen su propia guía: `REGISTRO-DE-PEDIDO-BORDES.md`
en la raíz del repo.** Esta sección dice qué suite correr; esa guía dice qué
abrir en el navegador y qué puede salir mal, borde por borde, con su peor
escenario — incluido lo que ninguna suite ve. Si el diff toca el flujo de
registrar un pedido, se lee entera antes de tocar el navegador, y el paso 3 de su
sección 5 es el guion de lo manual.

Desde el 2026-10-25. **Necesita `npm run dev` corriendo.** Dieciséis controles,
escribe solo en dev y se limpia solo.

`registrarPedidoComoVenta` es el único sitio donde un pedido del catálogo se
convierte en dinero, y hasta que existió un pedido y el libro eran dos cosas sin
relación. Lo que vigila esta suite —y ninguna otra puede, porque viven en otras
tablas— es: que se cobre el **precio sellado** que el cliente vio y no el del
catálogo de hoy; que una línea cuyo producto ya no existe **se excluya y vuelva
nombrada**, no contada; que el pedido quede sellado con su `sale_id` y no se
pueda registrar **dos veces**; que el pedido de otro dueño **no se encuentre**; y
que el cliente que nace del flujo nazca con su documento en dígitos y marcado
como confirmado por el tendero.

**Corre como el DUEÑO**, con su propia cookie de sesión, no con la clave de
servicio — así que una política o un `grant` que falten salen aquí. Es la lección
de la migración `108`, que dejó `catalog_orders` sin grants mientras
`qa:pedidos` pasaba 14 de 14.

**Y es la red de `CT-147`**: ese rediseño cambia la ENTRADA de la acción —el
cobro pasa de ser por producto a ser por moneda—, no sus resultados. Cuando se
haga, lo que se actualiza es `pagoDeLinea()`, una función; si alguna de las
dieciséis filas se pone roja al terminarlo, el rediseño se llevó por delante algo
que no tenía que tocar.

**COLOMBIA TIENE SU PROPIA FIXTURE Y NO ES OPCIONAL.** `sale_payments` y
`sale_lines` escriben el libro colombiano como `'COP'` y `movements` lo
escribe como `NULL`. Cruzar esas dos columnas en bruto no casa nunca, no
excluye nada, y **le da a cada fiado colombiano con abono inicial una fila
fantasma de contado en la pantalla de su propio cliente** — su deuda listada
dos veces, una como debida y otra como ya pagada. Casi sale así el
2026-10-20, y **ninguna prueba de dev lo habría cazado**, porque no había ni
una venta de un negocio colombiano. Por eso existe **`npm run qa:colombia`**.

### Un dato NUEVO de una transacción se comprueba en una venta DE CONTADO

Añadido el 2026-10-24, después de entregarlo mal. Es la misma razón que abre
esta sección, llevada un paso más allá: **una venta pagada entera no escribe
ni un movimiento**, así que cualquier dato nuevo que se enseñe «de una
transacción» tiene que vivir en `sales`, no en `movements`.

Qué costó: el código de transacción se añadió a la pantalla de éxito leyéndolo
por el camino del abono. Funcionaba en una venta fiada y devolvía vacío en una
de contado — que es justo la mitad del dinero que esta sección existe para
cubrir. La columna estaba bien desde el primer día (la migración `147` la puso
en las dos tablas); lo que faltó fue probarlo en el caso sin movimiento.

**La comprobación, y son tres ventas, no una:**

| Caso | Qué lo hace distinto |
|---|---|
| Venta **fiada** | Escribe cargo. Es la que siempre se prueba |
| Venta **de contado** | **Cero filas en `movements`**. El dato sale de `sales` o no sale |
| Venta de **mostrador** | Sin cliente, así que sin ficha de comprador ni botón «Ver ‹nombre›» |

Vale para cualquier dato, no solo el código: una fecha, una etiqueta, un
importe. Si se enseña en la pantalla de una transacción, se abre una venta de
contado antes de darlo por puesto.

## 2c. El chip de estado del cliente

Desde la migración `134`. **`npm run qa:estado`**, trece controles.

Lo que hay que entender para leer sus resultados: el chip sale del fiado **más
vencido**, no del más antiguo, y entre vencidos manda uno **con** plazo si lo
hay. Antes salía del más antiguo, y un fiado pequeño todavía en plazo apagaba
la alarma de uno grande vencido hacía meses — medido con control, un cliente
de 100 días que nunca abonó, con $50 al día y $400 vencidos hacía 73, salía
«Dentro del plazo».

**La mitad de los controles de esa suite SON controles**, y esa es la parte
que no se puede quitar: que un fiado al día siga siendo «Dentro del plazo»,
que si ningún vencido tiene plazo la etiqueta siga siendo «Sin plazo», y que
un fiado al día no se cuele por delante de uno vencido. Sin ellos, «arreglar»
el chip poniendo a todo el mundo en rojo pasaría la prueba.

## 3. Per-currency (VE owner) flows

- New movement (manual entry, "Registrar movimiento"): `currency` actually
  gets set to USD or EUR — never silently null. This exact class of bug
  has shipped twice before (stale-session default, and the photo-import
  path never setting currency at all) — treat this as high-risk on every
  release that touches `resolveMovementRateSnapshot`,
  `app/(app)/dashboard/actions.ts`, or `app/(app)/import/actions.ts`.

  **Run `npm run qa:currency` — it asserts this invariant against real dev
  owners in seconds, and writes nothing.** It checks that a CO owner always
  resolves to a null currency whatever the form submits, that a VE owner
  with no currency is **rejected** rather than defaulted, and that no
  existing row sits in the wrong ledger. Added 2026-09-11 alongside the fix
  for the latent bug that made this possible: `getOwnerRateContext` returned
  the same `null` for "owner is CO" and "owner is VE but there is no stored
  rate", so a transient failure to read the BCV rate would have filed a
  Venezuelan owner's fiado in the COP ledger. Audited at the time in both
  environments — zero rows affected, the trap was armed and had not fired.
- **Rejection telemetry — only when the diff touches it, and once in
  production the first time `050_movement_rejections.sql` runs there.** Not
  every release: this is the "don't run the checklist blindly" rule applied to
  itself. Re-check whenever the diff touches
  `lib/movement-rejection.ts`, `record_movement_rejection()`,
  `admin_metrics_health()`, or either of the two rejection branches in
  `resolveMovementRateSnapshot`.

  `npm run qa:currency` CANNOT cover this. The function reads `auth.uid()`,
  which is null under the service-role key every `qa/` script uses, so it
  returns early without inserting and a broken function would look identical
  to a working one. Worse, `recordMovementRejection()` swallows its own errors
  on purpose — a failure to record a rejection must never break the owner's
  registration — so nothing surfaces anywhere. **Telemetry that has never
  fired is telemetry you don't know works**, and this is the one piece that
  tells us whether the currency guard is refusing real owners.

  Run this in the SQL editor of the environment being checked, with any real
  owner's uuid. It impersonates that owner's session, writes both rejection
  kinds, reads them back, and rolls the whole thing away:

  ```sql
  begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"<owner-uuid>","role":"authenticated"}';

  select public.record_movement_rejection('ve_sin_moneda', 'movimiento', null, 50, null, 1);
  select public.record_movement_rejection('pais_desconocido', 'import', null, null, 'USD', 23);

  reset role;   -- imprescindible: un dueño no puede hacer SELECT en esta tabla

  select owner_id, reason, source, amount, attempted_currency, rows_affected
  from public.movement_rejections
  order by created_at;

  rollback;
  ```

  Two rows, both carrying the uuid you passed in the claims — which is the
  point: `owner_id` comes from `auth.uid()` inside the function, never from a
  parameter, so an owner cannot forge another's telemetry. Zero rows means the
  chain is broken. And the `reset role` is not a detail: without it the SELECT
  fails with `42501 permission denied`, which is itself the proof that the
  table is unreachable to an owner — RLS on, zero policies, zero grants, both
  doors are SECURITY DEFINER functions.

  Verified this way in dev on 2026-09-11, alongside a full browser pass:
  manual movement writes `created_by` from code (not the 049 backfill), and a
  mixed libreta stamped USD rows at 832.4883 and the EUR row at 968.06734453 —
  the per-currency snapshot loop in `confirmImport`, which until then had never
  run with two entries.
- Photo-import ("libreta") flow: imported movements for a VE owner also
  get a real currency, not null.
- `client_summary.balance_usd` / `balance_eur` reflect the actual sum of
  each currency's movements — spot-check one client with real data.
- The exchange-rate strip and calculator render for a VE owner, and the
  "Calcular" drawer/popover opens correctly (mobile drawer vs. desktop
  popover, per screen size).
- Signup's "País" field: still defaults correctly, still syncs the
  WhatsApp dial code, "Mi negocio" still renders País/rate-mode disabled
  (not editable) post-signup.

## 3b. WhatsApp templates — run both scripts, they check different things

Only when the diff touches `lib/whatsapp/`, `app/api/cron/whatsapp*`, or a
`whatsapp_destinatarios_*` function — and **always** when a new Meta template
is approved, whether or not any code changed, because the template is the half
that lives outside this repo.

- **`npm run qa:pausados`** — the recipient and the routing. Who enters the
  list, which template they'd get, and that anon cannot call the functions.
  Writes nothing.
- **`npm run qa:plantillas`** — what goes *inside* the envelope: the body
  parameters Kapso would receive, by name and in order, for every owner
  template. It runs the real senders with `fetch` intercepted before Kapso,
  so zero messages leave. It **does write** reservation rows in dev — on
  purpose, so the 067 gate is exercised too — and deletes exactly the rows it
  created, by id.

**Both, not one.** On 2026-09-28 `qa:pausados` was green, 5 of 5, while a bug
would have left every paused owner with no message at all: the template was
chosen correctly and the recipient parameter carried the *other* template's
name. Meta rejects a parameter a template does not declare, so the send fails
whole — and silently, since nothing surfaces to the owner. It was found by
reading the diff against `../docs/WHATSAPP-PLANTILLAS.md`, not by running
anything. `qa:plantillas` exists so that stops depending on someone doing that
comparison by hand.

The expected parameter names live in that script's `ESPERADO` table, copied
from the templates Meta has approved. When a new template ships, add its row
there — the script's job is to notice when the code and the approved template
drift apart, which it cannot do for a template it has never heard of.

## 3c. El catálogo, el carrito del cliente y el pedido — el recorrido entero

Solo cuando el diff toca `app/c/`, `app/s/`, `components/public/`,
`lib/products/`, `lib/cart/`, `lib/orders/` o una migración de `products`,
`catalog_*` u `orders`.

**ESTO ES UN RECORRIDO DE UNA PERSONA, NO CUATRO SUITES SUELTAS.** El cliente
abre un enlace, mira productos, llena un carrito, manda un pedido, y el
tendero lo recibe en su pantalla. Cada tramo tiene su suite y además hay que
andarlo entero una vez: las suites prueban las reglas, el recorrido prueba que
los tramos se enganchan.

### Las suites, y qué cubre cada una

- **`npm run qa:orden`** — **la importante, y es de seguridad, no de
  producto.** `create_catalog_order` es la ÚNICA escritura de Sevenz que no
  tiene detrás ni una sesión ni una fila que ya existiera: la llama un
  visitante anónimo por un enlace hecho para circular. Le intenta colar
  productos de otro dueño, sin publicar y de la papelera; comprueba que el
  precio salga de la ficha y no de quien llama; que un pedido sin nombre o sin
  documento no entre; que una línea mala deshaga la orden entera; y que el
  tope por minuto frene.
- **`npm run qa:carrito`** — lógica pura. El caso que no existe en ninguna
  otra pantalla: fusionar dos veces el mismo producto **cambia su precio**,
  porque el escalón depende de la cantidad total. También que quitar una línea
  deje la otra y que el contador sume cantidades y no líneas.
- **`npm run qa:precio-publico`** — qué precio ve el cliente según cuánto
  pide. Lógica pura.
- **`npm run qa:catalogo-enlace`** — qué entra en el enlace y qué no: el
  publicado al detal, el publicado solo al mayor, el no publicado, el de la
  papelera, y el tope de 8 de la franja.
- **`npm run qa:catalogo`** y **`npm run qa:productos`** — el catálogo, el
  enlace único por negocio y los candados de precio.
- **`npm run qa:catalogo-regresion`** y **`npm run qa:catalogo-bordes`** — los
  bordes del catálogo público.
- **`npm run qa:pedidos`** — el lado del TENDERO: el contador de sin atender,
  que atender marque una sola fila, que atender dos veces no baje el contador
  dos veces, y que el pedido de un negocio no salga filtrando por otro dueño.
  **Lee como el DUEÑO, con su sesión**, que es lo que le faltaba a la `108` y
  costó la pantalla entera (ver más abajo).

### El recorrido, en el navegador y a 375px

Una vez por lanzamiento que toque esta zona, de punta a punta:

1. **El enlace del catálogo** (`/c/[token]`): salen los productos publicados y
   solo esos, con el precio del escalón que corresponde.
2. **Un producto**, con su foto y su precio.
3. **El carrito**: añadir, cambiar cantidad **escribiéndola con el teclado**,
   quitar una línea. Si el producto tiene escalón, la cantidad cambia el
   precio y eso tiene que verse.
4. **Mandar el pedido**: nombre, documento y WhatsApp. Sin nombre o sin
   documento no entra.
5. **La franja «Productos» del enlace de saldo** (`/s/[token]`): tocar una
   tarjeta abre el catálogo del mismo negocio. Los dos enlaces llevan **tokens
   distintos** —uno del cliente, otro del negocio— y el puente lo resuelve el
   servidor; si se rompe, el cliente se queda sin forma de llegar.
6. **La pantalla de Pedidos del tendero**: el pedido llegó, el contador lo
   cuenta, y se abre el detalle con sus líneas y su total.

   **«Marcar como atendido» YA NO EXISTE** --se borró el 2026-10-25 con el
   concepto de «pedido atendido», decisión del dueño: *«registrar lo da por
   atendido»*--. Lo que baja el contador es REGISTRAR el pedido, que es el
   recorrido de la sección siguiente.

### Dos cosas que ya fallaron aquí y conviene no redescubrir

**Una política correcta sin grant no se consulta siquiera.** La `108` creó
`catalog_orders` con RLS y una política perfecta y sin conceder nada a
`authenticated`: cada lectura del tendero murió con `42501`, la pantalla de
Pedidos decía «todavía no te ha llegado ningún pedido» con tres pedidos
dentro, y `qa:pedidos` pasaba 14 de 14 en ese mismo momento, porque corría con
la clave de servicio. Lo arregló la `116`. Por eso esa suite **lee como el
dueño** y por eso los grants se escriben al lado de la política.

**Y los fallos de `qa:orden` no se ven desde ninguna pantalla.** Una orden con
un precio manipulado le llega al tendero con la misma pinta que una buena. La
comprobación de que la regla del escalón de la base y la de TypeScript
coinciden es lo único que caza una divergencia que enseñaría un precio al
cliente y guardaría otro **sin un solo error en ninguna parte**.

**«Registrar pedido» YA ESTÁ CONSTRUIDO** desde el 2026-10-25, y esta línea
decía lo contrario hasta el 2026-10-26: *«no es un olvido: lo que haría es
`CT-70`, que no está construido»*. Era verdad y dejó de serlo, que es
exactamente como una lista de comprobación empieza a mandar a buscar cosas que
ya no son. Su recorrido es el de aquí abajo.

### REGISTRAR UN PEDIDO COMO VENTA — el happy path es el mínimo

**El criterio lo fijó el dueño el 2026-10-26**: *«como mínimo los del happy
path deberían ir, todos los happy paths de cada funcionalidad deberían ir como
mínimo»*.

Y la razón por la que un happy path merece sitio en una lista que por lo demás
está llena de bordes: **es lo único que un cambio no puede romper sin que
importe**. Un borde roto afecta a un caso raro; el camino bueno roto afecta a
todos los pedidos de todos los negocios, y es el primero que nadie prueba
porque se da por hecho que funciona. Los cuatro de abajo son los cuatro
recorridos que de verdad ocurren todos los días.

**Antes de esto corren las suites** --`qa:pedido-registro` (53 controles),
`qa:pedidos`, `qa:aviso-mala-paga`, `qa:sello-del-pedido`,
`qa:barra-de-abajo`, `qa:lineas-borradas`-- que están en la sección 2b y en
la 6b. Lo de aquí es lo que **ninguna suite puede ver**: la
pantalla.

**Y el detalle entero de los bordes vive en `REGISTRO-DE-PEDIDO-BORDES.md`**,
en la raíz del repo: 48 bordes con su peor escenario. Esta lista es el mínimo;
ese documento es lo que se lee cuando el diff toca el flujo.

#### Los cuatro happy paths, en el navegador y a 375px

1. **UNA moneda, de contado entero.** Pedido → «Registrar pedido» → `1/3
   Confirmar` → `2/3 Pago` (De contado) → `3/3 Información del cliente` →
   «Registrar y finalizar».
   - Los pasos dicen `1/3 · 2/3 · 3/3`, **no** `2/4`.
   - La flecha de atrás del `1/3` lleva al detalle del pedido.
   - Al terminar, **el cliente no debe nada**: una venta pagada entera no
     escribe ni una fila en `movements` (sección 2b).
   - El pedido queda «Registrado: ‹fecha›» y sale de la campana.

2. **DOS monedas, una fiada y otra de contado.** Es el recorrido más largo y
   el que más piezas toca.
   - Primera pasada: `1/4 Pedido · 2/4 · 3/4 · 4/4`.
   - Segunda: `1/3 · 2/3 · 3/3` **sin volver a pedir el cliente**, con su
     tarjeta arriba y el lápiz para corregirlo.
   - Al final, **DOS ventas y UNA sola ficha de cliente**. Dos fichas para la
     misma persona parten su historial en dos que no vuelven a juntarse.

3. **Editar la cantidad de una línea.** «Editar pedido» → cambiar la cantidad
   → «Agregar».
   - La tarjeta de detrás, el «Total a pagar» y el botón «Pagar $…» tienen que
     decir **lo mismo**. Es la cifra con la que se cobra.
   - Si la cantidad cruza el mínimo de mayoreo, el precio BAJA y eso se ve.

4. **Teclear el pago en BOLÍVARES.** La cifra que vuelve en el historial y en
   la ficha de la transacción es **la tecleada**, no una reconversión.
   Bs. 100.000 reconvertidos salen Bs. 100.001,87 (sección 6b).

#### Y las tres paradas duras que se arreglaron el 2026-10-26

Las tres eran defectos medidos en dev, las tres están cubiertas por suite, y
las tres se miran igualmente en pantalla una vez porque **lo que fallaba no era
la base: era la puerta**.

| Qué | Cómo se comprueba | Qué pasaba antes |
|---|---|---|
| Un pedido **descartado** no se registra | `qa:pedido-registro` 16a-16d · y abrir su URL de `/registrar` a mano | Se registraba entero. El cliente quedaba debiendo por un pedido que la app decía descartado |
| El aviso de **«Mala paga»** | `qa:aviso-mala-paga` · y fiarle a uno marcado | Ninguna de las cuatro pantallas lo nombraba, y dos enseñaban la tarjeta VERDE «el cliente ya existe» |
| Quitar la moneda que falta **cierra** el pedido | `qa:pedido-registro` 17a-17e · y hacerlo en pantalla | El pedido quedaba pendiente PARA SIEMPRE y su único botón contestaba «Esa parte del pedido ya se registró» |
| **Borrar la venta** devuelve el pedido a pendiente, y **restaurarla** lo vuelve a sellar | `qa:pedido-registro` 18a-18f · `qa:sello-del-pedido` · y el ciclo entero en pantalla | El pedido se quedaba «Registrado» apuntando a una venta borrada, y el flujo se negaba a volver a entrar |
| Un pedido a medias **sobrevive** a que se abra otro | hacerlo en pantalla | El segundo pisaba el borrador del primero y la pantalla volvía al paso 1 sin una palabra |
| Con **varias fichas** del mismo documento, el paso del cliente PREGUNTA cuál | hacerlo en pantalla · control con un `?ficha=` inventado | El detalle decía «ya existe en varias» y dos pantallas después «no lo encontramos», con un formulario que creaba una ficha más |

**Y LOS DESCARTADOS SE TIENEN QUE PODER ENCONTRAR**, desde el 2026-10-26: el
chip de estado de la lista de Pedidos tiene un cuarto valor, **«Descartado»**,
y es el ÚNICO que los enseña. Dos comprobaciones y las dos importan:

- con el chip en **«Descartado»**, el pedido descartado sale, con su chip rojo
  tenue en la columna de estado;
- con el chip en **«Todos»** --que es la vista que se abre sola-- **NO sale**.
  Si saliera, el diálogo de descartar estaría mintiendo: le promete al tendero
  que el pedido «sale de tu lista de pedidos».

**El detalle del descartado**, que es donde el arreglo se puede romper sin que
nada falle: el pedido tiene que enseñar su chip **«Descartado»**, **no** el
botón «Registrar pedido», y su «⋮» tiene que ofrecer **«Restaurar»**. Si el
botón reaparece, el tendero entra en un BUCLE --lleva al `1/x`, que redirige al
detalle-- y nada en pantalla le dice por qué.

**Y el de mala paga tiene DOS puertas y las dos escriben la venta**: el paso
del cliente, y el **Pago** --que es quien registra en la segunda pasada de un
pedido de dos monedas, cuando el cliente ya está puesto--. Un aviso que solo
salga en la primera no sale nunca justo en el caso de dos monedas.

**Y EL CHIP «Mala paga» VA EN TRES TARJETAS**, también desde el 2026-10-26.
`qa:aviso-mala-paga` las vigila, y en pantalla se mira la tercera, que es la
que se olvida: la del **`1/x`** de un pedido de dos monedas, porque ahí el paso
del cliente se salta y el recuadro verde no pasa por delante de nadie. Las
otras dos son ese recuadro verde y el del detalle del pedido.

**EL CICLO DE BORRAR Y RESTAURAR SE MIRA ENTERO, y la segunda mitad es la que
importa**: `eliminarVenta` dessella el pedido, así que si `restoreMovement`
dejara de volver a sellarlo, restaurar devolvería la venta a la vida con el
pedido diciendo «pendiente» -- y el flujo lo dejaría registrar otra vez.
Después de restaurar, el detalle tiene que decir **«Registrado: ‹fecha›»** (con
fecha, no vacío: los guardias de las seis pantallas miran esa columna y no
`status`) y su `/registrar` tiene que rebotar.

**Y EL BORRADOR DE UN PEDIDO ES SUYO**: dejar uno a medias, abrir otro y volver
tiene que devolver al primero donde estaba. El control, que impide «arreglarlo»
quitando el reinicio: salirse al detalle **de ese mismo pedido** sí lo
reinicia, que es lo que el dueño pidió el 2026-10-26.

**Los dos controles no son opcionales**, y sin ellos «avisar siempre» pasaría
la prueba: un cliente **sin marca** no ve el diálogo, y un cliente marcado cuyo
pedido se paga **entero** tampoco --no se le está fiando nada--. Una alarma que
suena siempre se deja de leer, y detrás de ella se dejan de leer las demás.

## 4. Public, unauthenticated surfaces

- The public client balance page (`/s/[token]`) — easy to forget since
  it's not behind login. Confirm it still renders for both a COP and a VE
  client, and that `get_shared_balance()`'s returned shape actually
  matches what the page destructures (a function signature change here is
  a silent breakage, not a build error).

**`npm run qa:parity` comprueba ese contrato en segundos**, para un cliente CO
y uno VE, y además que la página no filtre documento ni detalles de pago.
**`npm run qa:grants`** comprueba que `anon` siga sin poder leer las tablas
por su cuenta.

### Y desde el lanzamiento del 2026-10-21 esa pantalla enseña cuatro cosas más

Ya no basta con «sigue dibujándose». El cliente ve ahora lo mismo que el
dueño, y cada pieza llega por `get_shared_balance`, que es `security definer`
y arma su JSON campo a campo: **un valor que esa función no nombre no existe
para el cliente**. Por eso cada una de estas costó su propia migración, y por
eso un fallo aquí se ve como «falta un dato», nunca como un error.

- **Sus ventas de CONTADO** (migración `131`). Antes el cliente pagaba entero,
  se llevaba la mercancía, abría su enlace y su compra no estaba — mientras el
  tendero sí la veía. Dos personas mirando la misma cuenta y leyendo cosas
  distintas es justo lo que Sevenz existe para evitar.
- **Los abonos de cada fiado y lo que ese fiado todavía debe** (`128`). Se
  resuelven contra la tabla entera y no contra los 50 movimientos que viajan:
  una lista incompleta de los pagos de alguien no es un detalle que falta, es
  una acusación.
- **Lo abonado al comprar** (`129`), que vale **cero** cuando no hubo abono y
  el cero se dibuja.
- **La tasa sellada de cada abono** (`133`): «Bs. … al día del abono», la del
  día en que ese dinero cambió de manos y nunca la de hoy.

Comprueba también que **el cliente NO vea acciones de dueño**: ni el menú de
tres puntos, ni «Editar abono», ni «Eliminar abono». Y que el historial del
cliente enseñe lo mismo que el del dueño — sin abonos sueltos, con el «Por
cobrar» de cada fiado.

**EL CASO COLOMBIANO SE MIRA APARTE, SIEMPRE**: ver la sección 2b. El cruce de
`'COP'` contra `NULL` daba una fila fantasma de contado por cada fiado con
abono inicial, en la pantalla del propio cliente, y ninguna prueba de dev lo
habría visto.

## 4b. What this change makes false elsewhere

Ask one question, every release: **does this make something we already wrote
untrue?** Not "should we write a new page" — that is usually no, and it is a
different check. Only the first one catches contradictions.

Four surfaces, all in the `Web/` repo, which **deploys separately from the
dashboard**:

| Surface | Where | Re-read when the diff… |
|---|---|---|
| Preguntas frecuentes | `Web/components/landing/faq.tsx` | changes what the product does, costs, or requires |
| Soporte | `Web/lib/soporte.ts` | changes a screen, a button name, or the steps to do something |
| Términos y condiciones | `Web/app/terminos-y-condiciones/page.tsx` | changes limits, plans, prices, or what the owner may do |
| Política de privacidad | `Web/app/politica-de-privacidad/page.tsx` | stores something new, shares it with anyone, or keeps it longer |

The legal pair fails the most quietly and costs the most. Nothing in the
codebase complains when a feature starts storing client photos in a public
bucket, adds an analytics provider, or records who wrote each movement — but
each of those is a paragraph in the privacy policy, or should be. Check it
against what the feature actually does, not against what it was called.

**Added 2026-09-13, after it happened.** The dashboard began asking owners to
install Sevenz on their phone while the FAQ on the same product's home page
answered *"No tienes que instalar nada"*. Both sentences were written in good
faith, months apart, and the contradiction was caught by accident while adding
an unrelated FAQ entry — not by any check. That is the gap this section closes.

If a surface needs an edit, say so in the report and remember it is a **second
merge**: a dashboard release does not publish the website.

## 4c. El saldo es la suma de los movimientos — en los DOS entornos

**Parada dura. Si esto no cuadra, no se lanza.**

`client_summary` es una VISTA que lee el `running_balance` de la ÚLTIMA fila
viva de cada moneda. O sea que el saldo no se calcula al mirarlo: se arrastra
fila a fila desde la primera que se escribió. Cualquier escritura que rompa esa
cadena deja un número **plausible y falso** en la ficha del cliente, en Cartera
y en el enlace que el cliente abre — y nada falla, nada se pone rojo, nadie se
entera hasta que un cliente discute su cuenta.

**En dev**, desde `dashboard/`:

```sh
npm run qa:saldos
```

Recorre todos los clientes, suma sus movimientos vivos y lo compara con lo que
la app enseña. No escribe nada. Si falla, dice qué clientes y si tienen
repartos, que es la pista de por dónde empezar.

**En producción** (`rabmiyqodnvnrwiartuj`), con esta consulta de SOLO LECTURA:

```sql
with suma as (
  select m.client_id,
         coalesce(m.currency, 'COP') as libro,
         sum(case when m.type = 'charge' then m.amount else -m.amount end) as real_sum
  from public.movements m
  where m.deleted_at is null
  group by m.client_id, coalesce(m.currency, 'COP')
),
ensenado as (
  select client_id, 'COP' as libro, balance     as valor from public.client_summary_all
  union all
  select client_id, 'USD',          balance_usd       from public.client_summary_all
  union all
  select client_id, 'EUR',          balance_eur       from public.client_summary_all
)
select c.name,
       e.libro,
       e.valor                              as ensena,
       coalesce(s.real_sum, 0)              as suma_real,
       round(e.valor - coalesce(s.real_sum, 0), 2) as diferencia
from ensenado e
join public.clients c on c.id = e.client_id
left join suma s on s.client_id = e.client_id and s.libro = e.libro
where abs(e.valor - coalesce(s.real_sum, 0)) > 0.005
order by abs(e.valor - coalesce(s.real_sum, 0)) desc;
```

**Cero filas = todo cuadra.** Cualquier fila es un cliente al que la app le
está enseñando un saldo que no es.

**Si aparece alguna**, la reparación es recalcular la cadena de ese cliente.
Eso SÍ escribe, así que va con el permiso explícito del dueño y cliente a
cliente, nunca en bloque a ciegas:

```sql
select public.recalc_client_running_balance('<client_id>');
```

### De dónde salió esta sección, que es lo que explica su dureza

Añadida el 2026-10-23. El dueño preguntó si un cambio de SIGNO —el «+» de un
fiado pasando a «−»— podía alterar las cuentas. No podía: son dos caracteres
literales en JSX. Pero la comprobación que lo demostraba encontró **un saldo
real descuadrado en dev**: un cliente sumaba 0,00 en dólares y la app enseñaba
1,14.

La causa fue `registrar_abono_repartido` escribiendo varias líneas en una
transacción sin recalcular: dentro de una transacción `now()` es el instante de
la TRANSACCIÓN, así que todas las líneas comparten `created_at` y el desempate
del disparador cae en un uuid aleatorio. La migración `142` lo arregla.

**La lección que generaliza, y por eso esto es una parada y no un consejo:** el
fallo no era del reparto, era de **quien escribe varios movimientos en una
transacción y no llama a `recalc_client_running_balance`**. Hoy los escritores
así son dos —`import_libreta`, que sí recalcula desde la `075`, y el reparto,
que no lo hacía— y mañana habrá un tercero. Una comprobación del reparto habría
cazado ESTE caso; esta comprobación caza la REGLA.

Y se mira en producción **aunque el diff no toque nada de esto**: el síntoma no
es un error, es un número creíble, así que la única forma de saber que no está
pasando es preguntarlo.

## 4d. Lo que el dueño ve nuevo, ¿lo ve el cliente?

**Pregunta fija de todo lanzamiento que añada un dato a una pantalla del
dueño.** Añadida el 2026-10-24 después de que el mismo fallo costara **cuatro
migraciones en dos días**: `148`, `149`, `151` y `152`.

Las cuatro son la misma historia. Se añade algo del lado del tendero —el
código de la transacción, los bolívares que tecleó, el código del fiado
relacionado, el abono del momento de la compra—, se prueba en su pantalla, se
ve perfecto, y el cliente sigue viendo lo viejo.

**La causa es estructural y no se va a arreglar sola.** `get_shared_balance()`
es `security definer` y arma su JSON **campo a campo**: lo que esa función no
nombre, para el cliente no existe. No hay error, no hay hueco en la pantalla,
no falla ninguna suite. Simplemente dice menos — y la ficha que el cliente
abre deja de parecerse a la que el tendero tiene delante, que es lo único que
este producto promete.

**Cómo se comprueba, y abrir las dos seguidas no es opcional:**

1. Lista los campos que el diff añade a una pantalla del dueño.
2. Por cada uno, `grep` en `supabase/` por la **última** definición de
   `get_shared_balance` y confirma que lo nombra. Si no, falta migración.
3. Abre **la misma ficha** en las dos vistas, una detrás de otra, y compáralas
   cifra a cifra. `npm run qa:parity` comprueba la forma del contrato, no que
   los campos nuevos estén dentro.

**Y la respuesta no siempre es «igual».** Son tres, y es la regla de
`CLAUDE.md` sobre la vista del cliente aplicada aquí: *igual* (el código, los
bolívares tecleados), *con variante* (el chip de estado va en las dos, pero el
payload del cliente llega recortado a 50 movimientos, así que replicarlo tal
cual daría un estado falso en un historial largo) o *no aplica* (registrar una
venta, repartir un abono). Las tres se escriben en el informe; decirlo cuesta
una línea.

## 4e. Nada fijo puede tapar el último botón

**Se mide en toda pantalla que el diff toque y termine en botones.** Añadida el
2026-10-24, y el motivo de añadirla es más importante que la comprobación: la
regla ya existía en `CLAUDE.md` desde el 2026-10-22 y **no se corrió ni una vez
en los dos lanzamientos siguientes**, porque este checklist no la pedía. Lo que
se recorre es esta lista.

Al correrla por fin aparecieron **cuatro botones** en dos pantallas de éxito, y
tres de ellos no estaban tapados a medias: **no se podían pulsar**.

**Son DOS elementos fijos, no uno, y ese fue el fallo.** El flotante
«Registrar» se midió porque el dueño lo señaló con una captura; la barra de
navegación no, porque nadie la señaló. Ocupa 723-812 a 375px y se lleva por
delante cualquier botón que caiga ahí.

**Y no basta con comparar rectángulos: hay que preguntar quién está encima.**
Un botón puede no «solapar» por unos píxeles y aun así estar debajo de algo
pintado:

```js
const r = ultimoBoton.getBoundingClientRect();
const encima = document.elementFromPoint(
  Math.round(r.left + r.width / 2),
  Math.round(r.top + r.height / 2),
);
ultimoBoton.contains(encima) || encima === ultimoBoton   // ← false = botón muerto
```

**Sin desplazar la página.** Lo fijo no se mueve y el contenido sí, así que
bajar despeja los botones y esconde el fallo. El caso roto es el de reposo, que
es donde el tendero los encuentra.

**Y una pantalla cuyo alto depende de los datos se mide TRES veces, no una.**
Esto es lo que hizo que la medición anterior diera «limpio» y se escribiera
como verdad general: el resumen de una venta se midió con una venta **fiada**
—la más larga— y salió despejado, mientras la de **contado con comprador**
caía dentro de la banda. El que rompe es el caso de en medio, no un extremo:

| Forma | «Compartir» | Banda del flotante | |
|---|---|---|---|
| Venta fiada | 731-771 | 652-708 | limpio |
| Venta de contado | **667-707** | 652-708 | **solapa** |
| Venta de mostrador | 481-521 | 652-708 | limpio |

### Y SE MIDEN TODOS LOS BOTONES DE LA PANTALLA, no el último ni el señalado

**La tabla de arriba solo lista «Compartir», y por eso esta sección volvió a
dar «limpio» el 2026-10-25 mirando el botón equivocado.** La pantalla de venta
registrada tiene DOS botones propios, y el que estaba roto era el segundo:

| Botón | Rectángulo | Barra fija | |
|---|---|---|---|
| «Compartir» | 667-707 | 723-812 | vivo ✓ (es el que se arregló el 2026-10-24) |
| **«Ver ‹nombre›»** | **723-763** | 723-812 | **MUERTO** |

Tocarlo abre **Reportes, Catálogo o Clientes** según dónde caiga el dedo —
medido en tres puntos del botón. Es `CT-148`.

**Así que la comprobación es sobre el conjunto**, y el filtro es «propio de la
pantalla», no «el último»:

```js
const propios = [...document.querySelector('main').querySelectorAll('a,button')]
  .filter((b) => b.offsetParent !== null && !b.closest('nav'));
for (const b of propios) {
  const r = b.getBoundingClientRect();
  const e = document.elementFromPoint(
    Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
  console.log(b.textContent.trim(), b.contains(e) || e === b ? 'vivo' : 'MUERTO');
}
```

**Y un botón alcanzable desplazando sigue siendo un fallo.** El documento de
esa pantalla mide 938 con un viewport de 812, así que bajando 126px el botón
sale de debajo de la barra y funciona. No lo salva: en reposo no se ve **ni un
píxel** de él, la página parece terminar en el botón de arriba, y nadie se
desplaza buscando algo que no sabe que existe. Un botón escondido donde nadie
tiene motivo para mirar es, en la práctica, un botón que no está.

**Si hay que quitar algo fijo, antes se comprueba que quede salida.** Las dos
pantallas de éxito conservan la cabecera con «Abrir menú», así que quitarles la
barra no encierra a nadie. Importa sobre todo en la venta de mostrador: no hay
cliente, así que tampoco hay botón «Ver ‹nombre›», y sin menú el tendero se
quedaría sin ninguna salida.

**Por qué merece sección propia**: un botón medio tapado se lee como un
descuido estético y uno muerto como «le di y no hizo nada». Ninguno de los dos
síntomas se parece a la causa, y ninguna suite los ve.

## 5. Security checklist

From the full security audit done 2026-08-28. Two cadences: **re-check
every launch** (things new code can regress) vs. **stable** (structural
facts that only need re-checking if the diff actually touches that area).

### Re-check every launch

- **Ownership checks in the diff**: any new/changed server action that
  takes an ID from the browser (`clientId`, `movementId`, etc.) explicitly
  verifies it belongs to `auth.getUser()`'s owner — not just RLS. This is
  the exact bug class found and fixed in `getOrCreateShareLink` and
  `confirmImport` (see CLAUDE.md's "Explicit ownership checks" rule).
  Don't let it back in.
- **No secrets in the diff or in the client bundle**: grep the diff for
  anything key-shaped. If the diff touches build config or adds a new
  server-only env var, run `next build` and grep `.next/static` for that
  var's raw value (should be zero matches) — this is how
  `GEMINI_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/`CRON_SECRET` were verified
  clean.
- **RLS parity, dev vs. prod** — if the diff touches any table or policy,
  run this in both environments and confirm they match:
  ```sql
  select t.tablename, t.rowsecurity, count(p.policyname) as policy_count
  from pg_tables t
  left join pg_policies p on p.schemaname = t.schemaname and p.tablename = t.tablename
  where t.schemaname = 'public'
  group by t.tablename, t.rowsecurity
  order by t.tablename;
  ```
  For any table holding real customer data, also pull `pg_policies.qual`/
  `with_check` and confirm it scopes to `owner_id = auth.uid()` (directly
  or via a join) — a policy existing isn't the same as a policy being
  correct.
- **Table-grant parity, dev vs. prod.** RLS being identical says nothing
  about grants being identical, and the absence of this check is what let
  a 500 reach production on 2026-09-05: `/admin` read tables directly with
  the service-role client, which works in dev and cannot work in
  production, because production revokes `SELECT` from `service_role` on
  the customer tables and the dev branch never did. Supabase branch
  creation does **not** clone grants. Run in both and diff:
  ```sql
  select table_name, grantee,
         string_agg(privilege_type, ', ' order by privilege_type) as privileges
  from information_schema.role_table_grants
  where table_schema = 'public'
    and grantee in ('anon', 'authenticated', 'service_role')
  group by table_name, grantee
  order by table_name, grantee;
  ```
  A difference is not automatically a bug — production being *stricter* is
  the intended state. What it means is that **any code path using
  `createServiceClient()` to read a table directly cannot be validated in
  dev**. Either confirm the grant exists in production, or move the read
  behind a `SECURITY DEFINER` function, which needs no table grant at all
  (`supabase/039_admin_reads_without_table_grants.sql` is the worked
  example). Bypassing RLS is not the same as holding privileges.

  **Run `npm run qa:service-role` — it answers this in seconds and needs no
  database.** It fails if any file under `app/`, `lib/`, `components/` or
  `hooks/` reads a table directly with the service-role client, allowing only
  `bcv_exchange_rate_fetches` (the one table production grants it). Added
  2026-09-07 after the grant comparison kept catching this by hand; it was
  verified by reintroducing the 2026-09-05 outage, which it reports with the
  file and line. `qa/` and `analytics/` are excluded on purpose: `qa/` is
  dev-only fixture tooling, and `analytics/` now goes through
  `lib/admin/metrics.ts` like the dashboard does.
- **`Confirm email` is ON in production** (Auth → Sign In / Providers) —
  this gets toggled off in dev-branch test-signup sprints; confirm it
  never leaked into prod before a launch.
- **New API routes** authenticate the same way existing ones do (bearer
  secret for cron-style routes, session-based auth for owner-facing ones).
- **Mask raw errors on anything unauthenticated** — for any new or changed
  endpoint, ask "who can call this without logging in?" (see CLAUDE.md's
  rule of the same name). If the answer isn't "nobody," its error
  responses must be a generic message only — no raw upstream/third-party
  error text, no database error detail. An authenticated endpoint (session
  or bearer secret) may keep surfacing real error text for debugging —
  that's a deliberate, accepted tradeoff, not a gap.

### Stable — only re-check if the diff touches the relevant area

- `.env*` never committed (`git log --all -- .env*` across all refs) —
  re-check only if `.gitignore` changes.
- No SQL built by string concatenation anywhere — re-check only if a new
  Postgres function or raw query is added.
- IDs are `uuid`/`gen_random_uuid()`, and any public-facing token uses
  `gen_random_bytes` with real entropy — re-check only if a new table or
  public-facing identifier is added.
- No admin panel or route outside `(app)`'s session guard — re-check only
  if a new top-level route is added.
- No CORS header set on custom API routes (Supabase's own APIs don't need
  one — they're policy-gated, not origin-gated) — re-check only if a route
  sets response headers.

### Not yet formalized — tracked, not blocking

Some of the original audit's items haven't been closed out yet: output
HTML sanitization beyond the one `dangerouslySetInnerHTML` in
`components/ui/chart.tsx`, stack traces / raw third-party error bodies in
production responses, request-body logging depth, webhook signature
verification (relevant once Kapso/WhatsApp or any webhook integration
ships — pair with the `new-api-risk-review` skill then), dependency
freshness (`npm outdated`/`npm audit`), Supabase's leaked-password check
(HaveIBeenPwned toggle in Auth settings), and Storage bucket-level
MIME/size policies. Flag these as open follow-up in the launch report —
they don't block a launch unless the diff being reviewed touches one of
them directly.

## 6. Migration hygiene

- **Run `npm run qa:migrations` first — it takes a second and needs no
  database.** It asserts that every `.sql` file under `supabase/` still
  contains SQL: at least 100 bytes and at least one statement. It exists
  because on 2026-09-18 `064_client_feedback.sql` went from 5994 bytes to 5 —
  the word "listo", typed into an open editor instead of a chat box, and saved.
  Git still held the real file, but it survived several commits that way and
  any `git add -A` would have replaced the migration in history with one word.
  The dangerous part is what comes next: that file is exactly the one someone
  opens to paste into the Supabase SQL editor, so the failure would have
  surfaced as a migration that ran and "did nothing" in production.

  It deliberately does **not** check for the `schema_migrations` insert. 29 of
  the 66 numbered migrations predate `028`, which is what created that ledger,
  so the check would fire 29 false alarms on day one — and an alarm that always
  rings stops being read.

- **Hard blocking check — ledger parity.** Ask the user to run
  `select key from public.schema_migrations order by key;` in both the dev
  branch's SQL editor and production's, and paste both results.

  **DOS AVISOS, Y LOS DOS COSTARON ERRORES EL 2026-10-21.** Primero: el editor
  de Supabase **corta a 100 filas** por defecto, y las claves con fecha
  ordenan detrás de todas las numeradas, así que son las primeras en caerse
  del corte — comparar contra una lista truncada fue lo que hizo inventar una
  ficha entera que afirmaba que producción tenía apuntes que dev no. Segundo:
  **no cuentes un lote con `key >= '1xx'`**, que es comparación de texto y
  mete las fechadas; usa un patrón, `where key ~ '^1(2[2-9]|3[0-4])_'`. Diff the
  key sets. If dev has any key production doesn't, **stop — do not approve
  the launch**: tell the user exactly which key(s) are missing and that
  those SQL statements need to be run against production first (see
  CLAUDE.md's migration-ledger rule). This is the check that exists
  specifically to prevent a repeat of a deploy going out before its
  migrations ran — do not treat it as optional or skip it because the diff
  "looks small."
- Every new SQL migration is idempotent / safe to re-run (matches this
  project's established pattern: `if not exists`, `create or replace`,
  guard tables for one-time data conversions).
- If the migration touches existing data (not just schema), confirm
  there's a real rollback path — either a written reverse script, or an
  explanation of why one isn't needed.
- Every migration and every ad hoc SQL fix run against dev ends with an
  insert into `public.schema_migrations` recording it (see CLAUDE.md) — if
  a diff shows raw SQL without that insert, flag it before proceeding.

## 6b. El resto de suites, por lo que vigilan

Las secciones de arriba nombran las que se corren por su flujo. Estas existen
y no tienen sección propia, así que viven aquí: **cuando el diff toca su
zona, se corren.** Un barrido completo del lote son unos minutos y la mayoría
no escribe nada.

| Zona que toca el diff | Suites |
|---|---|
| Tasas y bolívares | `qa:rate-status`, `qa:rate-fetch`, `qa:bolivares`, `qa:prevista`, `qa:habitual` |
| **Cualquier campo donde se teclee dinero** | **`qa:agrupado`** |
| Papelera y restaurar | `qa:papelera` |
| Libreta por foto | `qa:import`, `qa:reconcile` |
| WhatsApp, más allá de las plantillas | `qa:puerta`, `qa:recibo`, `qa:recordatorio`, `qa:mensaje`, `qa:consent`, `qa:telefono` |
| Productos y precios | `qa:precio`, `qa:proveedor`, `qa:producto-rapido` |
| Documento del cliente | `qa:document-id`, `qa:documento`, `qa:documento-cliente`, `qa:orden-letra` |
| **Cualquier pantalla, PNG o mensaje que DIBUJE un documento** | Mirar que lleve su letra — ver abajo |
| `/admin` y métricas | `qa:multi-owner` |
| Maquetación y accesibilidad | `qa:bordes`, `qa:contraste` |
| **Registrar un pedido como venta** | `qa:pedido-registro`, `qa:pedidos`, **`qa:aviso-mala-paga`**, **`qa:sello-del-pedido`**, **`qa:barra-de-abajo`**, `qa:lineas-borradas`, `qa:suscripciones` |

**Las tres últimas de esa fila leen el CÓDIGO, no la base**, así que tardan un
segundo y no necesitan servidor. Cada una cierra una avería que no se ve: un
aviso de mala paga que desaparece porque alguien quitó una columna de un
`select`; una línea quitada por el tendero que vuelve a entrar en la venta; un
borrador que cambia y no avisa a la pantalla. Las tres fallan en silencio y las
tres ya pasaron.

### Un campo de dinero que se toca se mira TECLEÁNDOLO, no leyéndolo

Desde el 2026-10-24, cuando todos los campos de dinero de la app pasaron a
agrupar los miles mientras se teclean (`useGroupedAmount`).

**`npm run qa:agrupado`** es la parada barata: segundos, sin base de datos,
y vigila las dos mitades a la vez — lo que queda en pantalla al teclear, y el
número que sale de ese texto. Se corre **siempre que el diff toque un campo
donde se escriba un importe**, aunque el cambio parezca de maquetación.

**Por qué no basta con mirar la pantalla.** Agrupar cambia el TEXTO del campo,
y de ese texto sale lo que se guarda. Si el formateador y el lector se separan,
la pantalla se ve perfecta y el número es otro — la única clase de fallo que
este producto ya pagó dos veces con dinero de gente. El caso medido: `Number`
lee «1.000.000» como `NaN`, y `parseAmount` lee «1,234» como MIL DOSCIENTOS
TREINTA Y CUATRO.

**Y después, en el navegador, tecleando de verdad**, porque un campo controlado
puede verse bien y tener el cursor saltando al final en cada millar:

- escribir `1000000` tecla a tecla y confirmar que se lee `1.000.000`;
- corregir **un dígito del medio** y confirmar que el cursor se queda donde
  estaba;
- comprobar la cifra que la pantalla calcula de ese campo —la equivalencia en
  bolívares, el total, el resumen— y que **coincide con lo escrito**;
- a 375px, que ni el campo ni la página desbordan.

**Los campos, a 2026-10-24**: el monto del fiado/abono (`MontoCard`), el abono
dirigido (1/2 y 2/2), el «Abonó» de la venta, el precio y el alta rápida dentro
de un fiado, el costo y los precios del producto, el precio del alta rápida de
la venta, el monto de un movimiento de libreta y el saldo de apertura.

### Un documento dibujado lleva su letra, y se comprueba en el ORIGEN

Regla del dueño del 2026-10-23, escrita entera en `DESIGN-SYSTEM.md`:
«V-32.256.369», nunca «32256369», en toda la app.

**Se ha escapado dos veces y la segunda enseña dónde mirar.** La primera vez
fueron pantallas que pegaban la columna en crudo, y las cazó hacer obligatorio
el segundo parámetro de `formatDocumentId`. La segunda —«Tu pedido quedó
registrado», el 2026-10-24— TypeScript no podía cazarla: esa pantalla recibe
el documento como una cadena YA HECHA dentro de un objeto `comprador`, así que
el fallo estaba donde ese objeto se construye, cuatrocientas líneas antes.

**Así que el control no es «¿esta pantalla formatea?» sino «¿de dónde le llega
esta cadena?».** Y de un mismo valor cuelgan varias superficies: la pantalla,
el PNG que se queda en el chat del cliente y el mensaje de WhatsApp. Arreglar
la que se ve deja las otras diciendo otra cosa.

**Cuando el diff toque un documento, se abre UNA pantalla de cada familia y se
mira el dato, no el código**: una ficha de cliente, un comprobante que se
comparte (PNG incluido) y la confirmación del pedido del catálogo.

**`qa:currency` lleva un fallo conocido y hay que decidirlo, no ignorarlo.**
Desde el 2026-10-21 falla dos controles por dos movimientos sin autor de un
**dueño de fixture** en dev, escritos con la clave de servicio, donde
`auth.uid()` es null por definición. El código escribe autor; lo que falla es
basura de dev. Pero una alarma que suena siempre deja de leerse —la misma
razón por la que las migraciones de un solo entorno se registran como no-op en
el otro—, así que o se limpian esas dos filas o la suite las excluye
explícitamente. Mientras siga así, **esa suite en rojo no es señal de nada**,
que es exactamente el problema.

## 7. Final report format

Report as a table (see CLAUDE.md's "Report QA and verification work as a
table" rule) — one row per section above, not prose alone:

| Section | Skill/tool used | Result |
|---------|-----------------|--------|

Add a Notes column for anything skipped and why (e.g. "skipped — diff
doesn't touch this area"), or any caveat worth flagging. Follow the table
with a **Recommendations** section for every row that wasn't a clean pass
— the concrete next action, not just a restatement of the problem. Skip
that section if every row passed cleanly. End with a direct question:
does the user want to proceed with the launch, given these results.
