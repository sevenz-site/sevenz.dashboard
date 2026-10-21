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

  LO QUE ESTAS SUITES NO MIRAN, y hay que saberlo: el puntaje de crédito
  **ignora la dirección** y sigue repartiendo por antigüedad, así que puede
  acreditarle a un cliente un pago puntual que no hizo. Está medido y abierto
  como `CT-124`; mientras siga abierto, una discrepancia entre el chip y la
  puntualidad histórica del mismo cliente **no es un fallo nuevo**.
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

**COLOMBIA TIENE SU PROPIA FIXTURE Y NO ES OPCIONAL.** `sale_payments` y
`sale_lines` escriben el libro colombiano como `'COP'` y `movements` lo
escribe como `NULL`. Cruzar esas dos columnas en bruto no casa nunca, no
excluye nada, y **le da a cada fiado colombiano con abono inicial una fila
fantasma de contado en la pantalla de su propio cliente** — su deuda listada
dos veces, una como debida y otra como ya pagada. Casi sale así el
2026-10-20, y **ninguna prueba de dev lo habría cazado**, porque no había ni
una venta de un negocio colombiano. Por eso existe **`npm run qa:colombia`**.

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
   cuenta, se abre el detalle con sus líneas y el total, y «Marcar como
   atendido» baja el contador.

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

**El botón «Registrar pedido» NO está en la pantalla** desde el 2026-10-21, y
no es un olvido: lo que haría es `CT-70`, que no está construido. Si reaparece
en una captura, es una regresión.

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
| Papelera y restaurar | `qa:papelera` |
| Libreta por foto | `qa:import`, `qa:reconcile` |
| WhatsApp, más allá de las plantillas | `qa:puerta`, `qa:recibo`, `qa:recordatorio`, `qa:mensaje`, `qa:consent`, `qa:telefono` |
| Productos y precios | `qa:precio`, `qa:proveedor`, `qa:producto-rapido` |
| Documento del cliente | `qa:document-id` |
| `/admin` y métricas | `qa:multi-owner` |
| Maquetación y accesibilidad | `qa:bordes`, `qa:contraste` |

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
