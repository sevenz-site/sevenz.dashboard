# Registrar un pedido como venta — todos los bordes

Guía de regresión del flujo **«Pedidos → Registrar pedido»** del app del dueño.
Escrita el 2026-10-26 leyendo el código entero del flujo y midiendo contra la
rama **dev** (`vzqppwrwnmlbrxizskdh`).

**Qué es esto y qué no.** Es la lista de sitios por donde este flujo se rompe,
con su peor escenario y su salida. No sustituye al `qa-regression-checklist`
—que cubre toda la app— sino que es lo que ese checklist no tiene: el detalle
de UNA funcionalidad. Cada borde lleva un identificador (`PR-A1`) para poder
decir «falla el `PR-C3`» en vez de describirlo otra vez.

**Lo que mide cada etiqueta de cobertura:**

| | Qué significa |
|---|---|
| 🤖 | Lo vigila un `npm run qa:*`. Si se rompe, sale rojo sin que nadie mire |
| 👁 | Hay que abrirlo en el navegador. Ninguna suite lo ve |
| ⛔ | **Nadie lo comprueba hoy.** Ni suite ni paso manual escrito |
| ❌ | **Defecto medido el 2026-10-26.** Está roto ahora mismo en dev |

---

## Las tres que se midieron rotas, y se arreglaron el mismo día

Se escribieron aquí el 2026-10-26 al medir el flujo, y el dueño mandó
arreglarlas esa misma tarde. **Se dejan escritas con su avería entera**, no se
borran: lo que explica por qué el código es como es hoy es el fallo que tuvo, y
eso es justo lo que se pierde primero.

| Id | Qué pasaba | Qué hace hoy |
|---|---|---|
| **PR-A2** | Un pedido **descartado se registraba igual** si se llegaba por URL | Las seis pantallas redirigen al detalle y la acción lo rechaza. El detalle lo dice con su chip **«Descartado»**, no ofrece «Registrar pedido», y su «⋮» ofrece **«Restaurar»**. Y desde esa tarde se pueden ENCONTRAR: el chip de estado de la lista tiene un cuarto valor, **«Descartado»** |
| **PR-E6** | Un cliente **marcado «mala paga»** no se nombraba en ninguna de las cuatro pantallas | Diálogo **«‹Nombre› está marcado como Mala paga · ¿Fiarle de todas formas?»** antes de escribir, en **las dos** puertas que registran, y solo cuando queda algo debiendo. Y desde esa tarde, un chip **«Mala paga»** en las **tres** tarjetas de cliente del flujo |
| **PR-F6** | Registrar una moneda y **quitar la que falta** dejaba el pedido pendiente **para siempre** | Quitarla **cierra el pedido** cuando lo que queda vivo ya está vendido, y la pantalla lo dice: «Quitado. El pedido queda registrado» |
| **PR-F7** | **Borrar la venta** dejaba el pedido sellado para siempre, apuntando a una venta que ya no existe | El sello se **recalcula** al borrar y al **restaurar**: el pedido vuelve a estar pendiente de lo que se borró, y solo de eso |
| **PR-G3** | Empezar un segundo pedido **pisaba el borrador del primero**, en silencio | Una llave de almacenamiento **por pedido**, y el borrado del detalle acotado al suyo |

**Las dos últimas columnas de `PR-A2` y `PR-E6` crecieron esa misma tarde**, y
las dos por lo mismo: el dueño leyó este documento y pidió lo que faltaba. Es
para lo que está.

**Las dos últimas se arreglaron esa misma noche**, por encargo del dueño al
leer la lista de lo abierto: *«Arregla PR-F7 + PR-G3»*. Las dos estaban medidas
desde esa tarde, que es lo que hizo que arreglarlas costara horas y no días.

Las cinco tienen suite desde ese día: `qa:pedido-registro` 16a-16d, 17a-17e y
18a-18f, `qa:aviso-mala-paga` y `qa:sello-del-pedido`. Cada una con su CONTROL, que es la mitad que impide
«arreglarlas» de la forma fácil y equivocada — sellar siempre, avisar siempre.

---

## 1. El mapa: por dónde se entra y qué recorrido sale

Saber esto es lo que hace que los bordes se entiendan, porque **casi todos son
una pantalla contestando distinto que la de al lado**.

### Las puertas de entrada

| Desde | A dónde |
|---|---|
| Campana → aviso «te hizo un pedido» | Detalle del pedido |
| Inicio → tarjeta «Pedidos» → lista | Detalle del pedido |
| Detalle → **«Registrar pedido»** | El flujo (`/registrar`) |
| Una URL tecleada, un marcador, el historial del navegador | **Cualquier paso del flujo, en cualquier orden** |

Esa última fila es la razón de que cada pantalla repita sus guardias. No es
paranoia: es el caso normal en un teléfono donde el tendero vuelve atrás.

### Los tres recorridos, y por qué los números cambian

| Pedido | Pasos |
|---|---|
| **Una** moneda | `1/3 Confirmar` · `2/3 Pago` · `3/3 Información del cliente` |
| **Varias** monedas, primera pasada | `1/4 Pedido` · `2/4 Confirmar` · `3/4 Pago` · `4/4 Información del cliente` |
| **Varias** monedas, pasadas siguientes | `1/3 Pedido` · `2/3 Confirmar` · `3/3 Pago` (el cliente ya está puesto) |

Quien decide esto es **`unicaMonedaDelPedido`** (`lib/orders/pasos-del-registro.ts`),
y la contestan CINCO pantallas. **Si dos contestan distinto no sale un error:
sale un bucle** —el `2/x` vuelve al `1/x`, el `1/x` reenvía al `2/x`— y el
tendero se queda sin forma de retroceder. Es el fallo que esa función existe
para hacer imposible, así que cualquier cambio en el recorrido se prueba en los
tres.

### Dónde vive lo que el tendero teclea

**En el navegador, hasta el final.** `sessionStorage`, clave
`sevenz:pedido-registro`, caducidad **2 horas**. La base de datos no recibe
NADA hasta «Registrar y finalizar».

Eso es deliberado y tiene una consecuencia que conviene tener delante al probar:
**perder el borrador no pierde dinero** —no hay nada escrito a medias— pero
**sí pierde todo lo tecleado**, sin aviso.

---

## 2. Las paradas duras que ya existen

Antes de los bordes, lo que SÍ está defendido. Una prueba de regresión también
sirve para confirmar que esto sigue en pie.

| Guardia | Dónde | Qué impide |
|---|---|---|
| `.eq("owner_id", user.id)` explícito | Las 5 pantallas y las 5 acciones | Tocar el pedido de otro negocio con su id pegado en la URL |
| `registered_at != null` → redirige al detalle | Las 5 pantallas | Recorrer dos veces un pedido ya vendido |
| Monedas ya vendidas → «Esa parte del pedido ya se registró» | `registrarVenta` | El doble toque y la pestaña vieja: que el cliente deba el doble |
| `deleted_at is null` en toda lectura de líneas | 14 lecturas, vigiladas por `qa:lineas-borradas` | Cobrar una moneda que el tendero acaba de quitar |
| La última moneda no se quita | Pantalla **y** acción | Un pedido sin líneas, que no se puede registrar ni enseñar |
| `puedeEscribir` (cuenta pausada) | Las 5 acciones | Que una cuenta pausada escriba |
| El precio lo calcula el servidor, nunca viaja | `registrarVenta` | Que un precio pegado en la petición se cobre |
| La ficha recién creada se borra si la venta falla | `registrarPedidoComoVenta` | Dejar en la lista a alguien que nunca compró |

---

## 3. Los bordes, por zona

### A · La puerta de entrada y el estado del pedido

**`PR-A1` · El pedido ya está registrado** 🤖 `qa:pedido-registro` (4)
Las cinco pantallas redirigen al detalle y `registrarVenta` lo rechaza por
moneda. **Peor escenario si se rompe:** el cargo se escribe dos veces y el
cliente debe el doble, sin nada en pantalla que lo diga.
**Cómo probarlo:** registrar un pedido y volver a su URL de `/registrar`.

---

**`PR-A2` · El pedido está DESCARTADO** ❌ **DEFECTO MEDIDO**

Ningún guardia del flujo mira `status`. Medido en dev el 2026-10-26, con la
sesión del dueño, sobre un pedido descartado tal como lo deja el menú «⋮»:

```
GET /registrar                     → HTTP 307 → /registrar/confirmar?moneda=USD
GET /registrar/confirmar?moneda=USD → HTTP 200 · «Detalle del pedido»
GET /registrar/pago?moneda=USD      → HTTP 200 · «Registrar pago»
registrarPedidoComoVenta            → {"ok":true, saleId:…, clientId:…}
el pedido, después                  → status: registered · discarded_at: PUESTO
la campana lo leería como           → DESCARTADO (rojo, con «Restaurar»)
restaurarPedido sobre él            → {"ok":false,"error":"Ese pedido no está descartado."}
```

**En cristiano.** Doña Rosa descarta el pedido de Pedro: lo habló con él y no
va. Dos horas después toca el aviso de la campana —que sigue ahí, en rojo— o
vuelve con la flecha de atrás del navegador, y la app la deja recorrer el flujo
entero y cobrar. Ahora Pedro debe por un pedido que la app le dijo que estaba
descartado, la campana sigue diciendo «Descartaste el pedido de Pedro», y el
botón «Restaurar» de ese aviso no hace nada: contesta que el pedido no está
descartado.

**Peor escenario:** es dinero mal anotado **y es silencioso**. No hay error, no
hay rojo; lo único raro es un aviso que se contradice con la cuenta del cliente.

**ARREGLADO EL 2026-10-26.** `estaDescartado()` vive en un solo sitio
--`lib/orders/catalog-orders.ts`-- y lo preguntan las seis pantallas y la
acción. Una copia en cada una serían seis oportunidades de olvidarla, y la
olvidada sería una puerta sin cerradura.

**Y el arreglo necesitaba una segunda mitad, o creaba un fallo peor:** si el
detalle siguiera ofreciendo «Registrar pedido», el tendero entraría en un
**bucle** —el botón lleva al `1/x`, que ahora redirige al detalle— sin una
palabra que lo explique. Así que el detalle enseña el chip **«Descartado»**,
esconde ese botón, y su «⋮» pasa a ofrecer **«Restaurar»**.

**Eso cierra además un agujero que nadie había nombrado**: la campana enseña 20
avisos y un pedido descartado sale de la lista de Pedidos, así que cuando su
aviso se iba por abajo, el pedido **dejaba de tener puerta**. Ahora se devuelve
desde su propia pantalla.

**Y ENCONTRARLO YA TIENE PUERTA, desde el 2026-10-26 por la tarde**: el chip de
estado de la lista lleva un cuarto valor, **«Descartado»**, y es el único que
los enseña. Encargo del dueño al leer este mismo apartado: *«¿Esto sería en la
sección de "Pedidos" cierto? de ser así agrégalo»*.

**Los otros tres chips siguen sin enseñarlos, «Todos» incluido**, y eso no es un
descuido: el diálogo de descartar promete que el pedido «sale de tu lista de
pedidos». «Todos» es la vista que se abre sola, así que un descartado ahí
convertiría esa promesa en mentira el primer segundo. «Todos» quiere decir
«todos los que siguen en tu lista».

**La salida que NO se tomó**, por si alguien la reabre: que registrar restaure
el pedido solo. Cambia lo que el tendero quiso decir al descartarlo, así que es
decisión de producto y no técnica.

---

**`PR-A3` · El pedido es de otro negocio** 🤖 `qa:pedido-registro` (8, 15a)
`notFound()` en las pantallas, «No encontramos ese pedido» en las acciones.
**Peor escenario si se rompe:** un negocio ve y cobra el pedido de otro.

---

**`PR-A4` · El pedido no tiene ni una línea viva** 🤖 `qa:pedido-registro` (7) · 👁 la pantalla
El `1/x` dice «Este pedido no tiene líneas»; la acción lo rechaza sin crear
venta ni cliente. La campana lo cuenta con **cero productos** a propósito
(migración `161`: el filtro va en el embebido, no con `!inner`, para que el
pedido no desaparezca del aviso).
**Cómo probarlo:** un pedido cuyas líneas estén todas quitadas.

---

**`PR-A5` · Todos los productos del pedido salieron del catálogo** 🤖 `qa:pedido-registro` (5a-5c, 7)
La línea sin `product_id` se **excluye y se nombra** —decisión del dueño del
2026-10-24— y se avisa en el `2/x`, no tres pantallas después. Si no queda
ninguna viva, se rechaza.
**Peor escenario si se rompe:** la venta entera se cae por una línea, o se cobra
un producto que ya no existe a precio inventado.

---

**`PR-A6` · Descartar dos veces (doble toque, pestaña vieja)** ✅ arreglado el 2026-10-26
Antes volvía a sellar `discarded_at` y subía el aviso al principio de la
campana como si acabara de pasar algo nuevo. Ahora el guardia compartido
contesta «Ese pedido está descartado», y el «⋮» de un descartado ya no ofrece
descartarlo: ofrece devolverlo.

---

**`PR-A7` · Restaurar un pedido que no está descartado** ✅ medido hoy
«Ese pedido no está descartado.» Correcto — y es la mitad visible del `PR-A2`:
el botón existe en un aviso que no debería estar.

---

**`PR-A8` · La sesión se cae a mitad del flujo** ⛔
Las pantallas redirigen a `/login`. El borrador **sobrevive** mientras la
pestaña no se cierre, así que volviendo a entrar el tendero recupera lo
tecleado.
**Cómo probarlo:** borrar la cookie de sesión en el paso `3/x` y recargar.

---

**`PR-A9` · La cuenta está pausada** ⛔
Las cinco **acciones** lo rechazan con `MENSAJE_CUENTA_PAUSADA`. Las **pantallas
no**: se puede recorrer el flujo entero, teclear el pago y el cliente, y
enterarse al dar a «Registrar y finalizar».
**Peor escenario:** el tendero teclea tres pantallas con el cliente delante para
que la app le diga al final que no puede. No pierde dinero; pierde la venta
delante de alguien.

---

### B · Las monedas del pedido

**`PR-B1` · Una sola moneda: el paso `1/x` no existe** 👁
Encargo del dueño del 2026-10-25, renumerado a `1/3 · 2/3 · 3/3` por decisión
suya. Lo contestan cinco pantallas con la **misma** función.
**Peor escenario si se rompe:** el bucle de la sección 1 — sin forma de
retroceder.
**Cómo probarlo:** entrar y salir con la flecha de atrás en los tres pasos.

---

**`PR-B2` · Dos monedas son DOS ventas, con una sola ficha** 🤖 `qa:pedido-registro` (11a-11g)
Decisión del dueño del 2026-10-25. La ficha que crea la primera llamada viaja
como `fichaId` a la segunda. `catalog_orders.sale_id` guarda **la primera** y no
la pisa la segunda; las dos se enlazan por `sales.catalog_order_id`.
**Peor escenario si se rompe:** dos fichas para la misma persona, cuyo historial
nunca vuelve a juntarse. O la segunda venta rechazada por el índice único del
documento: el pedido del cliente, refusado a mitad.

---

**`PR-B3` · El orden de los bloques es fijo** 👁
`USD`, `EUR`, `COP`, y lo que no esté en esa lista al final. **No es estético:**
una lista que se reordena porque una línea cambió de moneda es una lista donde
el bloque que ibas a tocar está en otro sitio.

---

**`PR-B4` · Un bloque sin nada que cobrar** 👁
Todos sus productos salieron del catálogo. **Se dibuja a propósito** —es el
único sitio donde el tendero ve que media compra de su cliente no va a entrar—
pero **sin** botón «Registrar».
**Peor escenario si se esconde:** el tendero se entera cuando el cliente
reclama.

---

**`PR-B5` · Una sola moneda, y además descatalogada** ⛔
Se queda en el `1/x` a propósito: saltar llevaría al `2/x`, cuyo guardia rebota
al detalle, y el tendero daría a «Registrar pedido» para volver al sitio del que
salió, sin una palabra.

---

**`PR-B6` · Quitar una moneda entera** 🤖 `qa:pedidos` (7c-7e) · 👁 la tarjeta
Borrado suave (`deleted_at`, migración `161`) porque **esas filas las escribió
el cliente al pedir**. Queda la tarjeta «Quitaste lo de euros» con «Restaurar»,
en su sitio entre los bloques.
**Y el paso `1/x` sigue existiendo aunque quede una sola moneda** —si no, quitar
una echaría al tendero de la pantalla donde acaba de tocar un botón, que es lo
que el dueño reportó el 2026-10-26.
**Cómo probarlo:** quitar, comprobar que **no** se sale de la pantalla, y
restaurar.

---

**`PR-B7` · La última moneda no se quita** 🤖 `qa:pedidos` (7c…) · 👁
La pantalla no dibuja el botón y **la acción lo vuelve a comprobar**: «Es lo
único que queda en el pedido». Hace falta las dos veces porque la acción se
puede llamar desde una pestaña que todavía enseña dos bloques.

---

**`PR-B8` · Quitar una moneda que ya no está** ⛔
«Ese pedido ya no tiene esa moneda.» Pasa con dos toques seguidos.

---

**`PR-B9` · Quitar una moneda de un pedido YA registrado** ⛔
Rechazado: «Ese pedido ya está registrado.» Correcto — quitarle una línea
después de que su venta esté escrita dejaría el pedido diciendo una cosa y la
venta otra.

---

### C · «Editar pedido»

**`PR-C1` · Cambiar la cantidad recalcula el precio** 🤖 `qa:pedidos` (7f) · 👁
Decisión del dueño del 2026-10-26, preguntada con las dos salidas delante:
**«B) Manda la edición»**. Subir de 1 a 5 unidades **cobra al mayor**.
Lo que la decidió fue una medición: la hoja decía «Agregar $28,75» y la venta se
escribía por **$285,00**. El sello cede sólo cuando cambia la cantidad o la
moneda, y eso lo decide la base comparando lo que el cliente pidió con lo que se
va a cobrar — no una bandera que haya que acordarse de poner.
**Peor escenario si se rompe:** pantalla y venta vuelven a decir cifras
distintas, y la que manda es la que el cliente no vio.

---

**`PR-C2` · La cantidad baja del mínimo que se vende** ⛔
«La cantidad de X es menor que el mínimo que vendes.» Se rechaza al final del
flujo, no en la hoja.

---

**`PR-C3` · Mover una línea a otra moneda** ⛔ **el borde más fino de todo el flujo**
El sello no vale —un precio sellado existe en UNA moneda— así que el precio sale
del catálogo de hoy. Y si era la única línea de su bloque, **ese bloque
desaparece con un abono ya tecleado dentro**.
Lo sanea `fijarLineaEditada`, que EXIGE la lista de monedas vivas: el compilador
no deja editar una línea sin decir qué queda vivo después.
**Peor escenario si se rompe:** no hay error, la venta se guarda, y **el dinero
queda abonado a una moneda que no se debía**.
**Cómo probarlo:** teclear el pago en dólares, volver atrás, mover a euros la
única línea en dólares, y comprobar que el abono de dólares se fue.

---

**`PR-C4` · Mover una línea a una moneda que el pedido NO tenía** ⛔
El servidor agrupa por la moneda **sellada** porque no ve el borrador, así que
aparece un bloque que nadie ofrece registrar. **No lo empeoró el rediseño** —ya
pasaba— y está escrito en la cabecera de `bloques-de-moneda.ts`.

---

**`PR-C5` · Editar y salirse del flujo** 👁
El borrador se borra al volver al detalle (`OrderDraftReset`). Encargo del dueño
del 2026-10-26: *«toda la edición del pedido debería reiniciarse si me salgo del
flujo»*.
**Cómo probarlo:** editar una cantidad, salir al detalle, volver a entrar, y que
la cantidad sea la del cliente.

---

**`PR-C6` · No hay stock suficiente** 👁
**Avisa y NO bloquea**, instrucción del dueño del 2026-10-24: *«el stock puede
no estar actualizado pero sí podría tener el producto en la bodega»*. El chip
«Disponible: N» es el mismo dibujo en la tarjeta y en la hoja — dos dibujos de
la misma cifra se leen como dos cifras.
**Sin stock no hay chip**: un «Disponible: —» afirmaría que se midió.

---

**`PR-C7` · El producto de la línea ya no está en el catálogo** 👁
No se puede editar: la hoja no se dibuja y la ruta vieja da `notFound`.

---

**`PR-C8` · La pantalla de detrás no se entera de la edición** 🤖 `qa:suscripciones`
El fallo del 2026-10-26: *«Resultado: no se agregan»*. La cantidad SÍ se
guardaba —la venta se escribía con 4— y lo único que no pasaba era que la
tarjeta se enterara.
**Y es peor que un desajuste visual**: esa tarjeta es la última que el tendero
mira antes de cobrar. `qa:suscripciones` falla si alguien vuelve a escribir un
`subscribe` que no avisa, **sin lista de excepciones**.

---

### D · El pago

**`PR-D1` · El techo: no se cobra más de lo que suma el bloque** 🤖 `qa:pedido-registro` (14a) · 👁
«Estás cobrando más de lo que suma la venta en esa moneda.» **Y el total se
calcula en el navegador, no llega hecho del servidor**: el 2026-10-25 se midió
una tarjeta diciendo «€17,52» con su botón diciendo «Pagar €5,84» — y ese número
es el techo, así que el tendero no habría podido cobrar su propia venta.
**Cómo probarlo:** editar una cantidad y comprobar que el botón y la tarjeta
dicen lo mismo.

---

**`PR-D2` · Pagar en bolívares** ⛔ en este flujo (🤖 `qa:monto-bolivares` cubre la aritmética)
**La cifra que teclea el tendero se guarda tal cual y se vuelve a enseñar tal
cual** (`entry_currency` / `entry_amount`). Nunca se recalcula: Bs. 100.000
reconvertidos salen Bs. 100.001,87, y eso el dueño lo llamó *«crítico y
escandalosamente mal»* el 2026-10-24.
**Cómo probarlo:** teclear Bs. 100.000, registrar, y que la ficha de la
transacción y el historial digan **100.000**.

---

**`PR-D3` · No hay tasa del BCV** ⛔
Sin tasa, un pago en bolívares se rechaza —«Ahora mismo no tenemos la tasa del
BCV»— y un producto cuyo precio haya que convertir también: «No tenemos precio
de X en esa moneda».
**Peor escenario:** el flujo entero tecleado y refusado al final, por algo que no
tiene nada que ver con el tendero.

---

**`PR-D4` · Plazo y cuotas** 🤖 `qa:pedido-registro` (12a-12c), `qa:cuotas`
Plazo de 1 a 365 días. Cuotas de **2 a 36**: una sola cuota no es un plan de
pagos. **«Pago único» es el valor por defecto del desplegable y vale `1`**, así
que hay que convertirlo a `null` — si se manda tal cual, la venta se rechaza al
final del flujo con todo ya tecleado. Pasó el 2026-10-25 y las pruebas no lo
cazaron porque mandaban la cadena vacía, que es el otro camino.

---

**`PR-D5` · Cuotas sin plazo** 🤖 `qa:cuotas`
«Para pactar cuotas hace falta un plazo que repartir.»

---

**`PR-D6` · El plazo se pide UNA vez por moneda** 🤖 `qa:pedido-registro` (12a)
Es `CT-147` entero. Pedirlo por línea hacía que **uno de dos plazos se perdiera
en silencio**: la app guardaba un vencimiento que el tendero nunca aceptó, y el
chip de estado dejaba de avisar de un fiado vencido. El dueño: *«un error de
conceptualización de producto (…) no puede salir a producción así»*.

---

**`PR-D7` · Pagado entero: CERO filas en `movements`** 🤖 `qa:pedido-registro` (2)
Un contado no toca el saldo, ni el puntaje, ni las gráficas. **Es la mitad del
dinero que las comprobaciones de saldo no ven**, porque mirando `movements` una
venta de contado no existe.
**Cómo probarlo:** cobrar el pedido entero y comprobar que el cliente **no** debe
nada.

---

**`PR-D8` · Fiado: el cargo es por lo que QUEDA** 🤖 `qa:pedido-registro` (6)
Una compra de 10 con 5 abonados deja un fiado de **5**. Si deja uno de 10, el
cliente debe el doble de lo acordado.

---

### E · El cliente

**`PR-E1` · Ninguna ficha coincide** 👁
Formulario relleno con lo que el cliente tecleó en el carrito, con el aviso
ámbar «No hemos encontrado este cliente».

---

**`PR-E2` · Coincide exactamente una ficha** 👁
Tarjeta verde, de sólo lectura, con «Ver ‹cliente›» que abre una **hoja** y no
navega: el 2026-10-25 ese botón era el último que navegaba y rompía el camino de
vuelta —*«al seleccionar "<" me regresa al home»*—, perdiendo el registro a
medias en el paso 4 de 4.

---

**`PR-E3` · VARIAS fichas comparten los dígitos** ⛔
El emparejamiento es **por documento**, y los dígitos **no identifican a una
persona**: el índice de la migración `033` conserva la letra, así que
`V-21054832` y `E-21054832` son dos claves. **Dev tiene tres grupos así ahora
mismo, uno de tres personas.**
Con varias, el flujo contesta «ninguna» y abre el formulario: la tarjeta ámbar es
honesta y una verde nombrando a un Jesús concreto sería **confiadamente falsa**.
**Lo que se perdió el 2026-10-26** y está dicho en voz alta: el botón «Ver
clientes» desapareció del `1/x` al rehacerse el frame, así que hasta el `4/4` no
hay dónde mirarlas.

---

**`PR-E4` · La letra del documento** ⛔
Decide primero, y **su ausencia no descarta**: un pedido anterior a la migración
`155` o una ficha anterior a la `154` no tienen letra, y si eso descartara, cada
pedido viejo diría «no encontramos este cliente» sobre alguien que el tendero
tiene delante. Cuando a un lado le falta, **deciden los dígitos**.
**Y la dirección del error importa:** sobrar —ofrecer a quien no es— se ve en la
tarjeta y se puede rechazar; faltar parte el historial de una persona en dos
fichas que no vuelven a juntarse.

---

**`PR-E5` · «Registrar a cuenta separada»** 👁
El tendero dice «este no es ese Pedro» y se abre una ficha nueva con los datos
del pedido. Si el documento ya existe, el servidor contesta «Ya tienes un cliente
con ese documento. Vuelve atrás y elígelo» — **nunca el error crudo de Postgres**,
que no dice nada a un tendero y filtra el esquema.

---

**`PR-E6` · El cliente está marcado «MALA PAGA»** ❌ **DEFECTO MEDIDO**

**Ni una palabra, en ninguna de las cuatro pantallas.** Medido en dev el
2026-10-26 con un cliente `is_flagged = true` y un pedido con su documento:

| Pantalla | ¿dice «mala paga»? | ¿dice «ya existe»? |
|---|---|---|
| Detalle del pedido | **no** | SÍ |
| `2/3` Detalle (confirmar) | no | — |
| `3/3` Pago | no | — |
| Cliente (último paso) | **no** | SÍ |

Ningún archivo del flujo consulta `is_flagged`: ni las pantallas, ni las
acciones, ni la hoja de la cuenta del cliente.

**En cristiano.** Doña Rosa marcó a Luis como mala paga hace tres meses
justamente para que la app le avise. Luis le pide por el catálogo —que es un
enlace público, no hace falta permiso— y cuando ella registra el pedido, la app
le enseña una tarjeta **verde** que dice «El cliente ya existe en tu cuenta de
Sevenz». Eso no es silencio: es tranquilizarla sobre la persona a la que puso en
la lista negra. Y como un cliente marcado no sale en Cartera ni en Inicio, la
deuda nueva es además más difícil de ver después.

**Peor escenario:** dinero fiado a quien el tendero decidió no fiar, con el aval
visual de la app.

**ARREGLADO EL 2026-10-26**, y lo eligió el dueño: *«debería mostrar modal de
confirmación como el flujo anterior que menciona que esa persona está marcada
como mala paga y preguntarle si desea fiarle de todas maneras o no»*.

**Es el diálogo que ya existía, palabra por palabra.** Vivía en
`add-movement-dialog.tsx` y se fue con ese fichero el 2026-10-24, cuando él
mandó borrar aquel flujo. Nadie se dio cuenta de que con el formulario se iba
el ÚNICO aviso de mala paga que la app ha tenido: desde ese día y hasta este,
**ninguna pantalla de Sevenz lo mencionaba antes de fiar**. Así que esto no es
copiar un patrón de otro sitio — es devolver uno que se perdió sin que nadie lo
notara.

> ‹Nombre› está marcado como Mala paga
> Revisa el motivo en su historial. ¿Fiarle de todas formas?
> **Cancelar** · **Fiar de todas formas**

**SALE POR LAS DOS PUERTAS, y esa es la mitad que se olvida.** El registro se
escribe desde DOS pantallas: el paso del cliente, y el **Pago** --que es quien
registra en la segunda pasada de un pedido de dos monedas, cuando el cliente ya
está en el borrador y su pantalla no se vuelve a enseñar--. Un aviso montado
solo en la primera no saldría nunca justo en el caso de dos monedas. Es la
regla de `CLAUDE.md` sobre un campo que entra por todas las puertas de su
acción.

**SOLO CUANDO SE FÍA**, que es la condición del diálogo original
(`isFlagged && type === "charge"`). Una venta pagada entera no presta nada, y
avisar ahí sería una alarma que suena siempre — y una alarma que suena siempre
se deja de leer, que es exactamente lo que no le puede pasar a esta. Lo decide
`quedaFiado`, con la misma cuenta que dibuja las cifras de la pantalla.

**Y LA TARJETA VERDE YA LLEVA SU CHIP, desde el 2026-10-26 por la tarde.**
Este apartado decía que no, porque el dueño había pedido el diálogo; al leerlo
pidió la otra mitad: *«Un chip «Mala paga» en la tarjeta verde (…) agrégalo»*.

Y la mitad importa: **el diálogo avisa en el último toque, cuando el tendero ya
decidió; el chip avisa mientras lo está decidiendo.** Sin él, la única pantalla
que habla de esa persona antes de fiarle la presenta en VERDE con un «ya
existe», que es un aval.

Va en **tres** tarjetas, y la tercera es la que se habría olvidado: el recuadro
verde del paso del cliente, el del detalle del pedido, y la tarjeta del `1/x` —
que es la ÚNICA tarjeta de cliente de la segunda pasada de un pedido de dos
monedas, porque ahí el paso del cliente se salta. `qa:aviso-mala-paga` vigila
las tres por su token (`MALA_PAGA_BADGE_CLASS`) y no por el texto, que esos
ficheros ya llevan dentro del diálogo.

**CON VARIAS FICHAS SE DICE DE OTRA FORMA.** El pedido trae un documento que
varias comparten y nada dice cuál es: callarlo sería dejar al tendero fiando a
ciegas, y señalar a una sería acusar a quien quizá no es. Así que el chip sale
si alguna lo está, y una línea debajo dice que es una de ellas y manda a «Ver
clientes».

---

**`PR-E7` · La venta falla y la ficha recién creada se queda** 🤖 `qa:pedido-registro` (13)
Se deshace: **sólo** la ficha que esta llamada creó, nunca una que ya existía.
Encontrado por la propia suite el 2026-10-25, y **venía de antes del rediseño**:
cualquier rechazo del final dejaba una persona nueva en la lista del tendero que
nunca compró nada.

---

**`PR-E8` · Nombre o documento vacíos** 🤖 `qa:pedido-registro` (9a) · 👁
Validado en la pantalla **y** en el servidor.

---

**`PR-E9` · El permiso de WhatsApp es EVIDENCIA** 👁
«Confirmo que ‹nombre› autoriza recibirlas», con el nombre dentro de la frase:
es una afirmación, no una casilla. Meta exige un consentimiento demostrable, y
una casilla sin nombre no demuestra nada (`MS-4`).

---

**`PR-E10` · Segunda pasada: no se vuelve a pedir el cliente** 👁
Se rellena del borrador. Y si se llega por el **lápiz** de la tarjeta del `1/x`,
el botón dice **«Guardar»** y no hay contador: es una corrección, no un paso.
**Peor escenario si se rompe:** el tendero acaba de escribirlos, los ve vacíos,
y la lectura natural es que la app los perdió.

---

**`PR-E11` · Colombia** 🤖 `qa:pedido-registro` (15a-15e), `qa:colombia`
Documentos `CC`, `CE`, `TI`, `PAS`, `PEP`, `PPT`, `NIT`. Un tipo que no
corresponde al país **se descarta en vez de guardarse** (migración `125`). El
libro es único: `movements.currency` es **NULA**, no `'COP'` — cruzar en bruto
esa columna con `sale_lines.currency = 'COP'` es lo que casi dio a cada fiado
colombiano una fila fantasma de contado el 2026-10-20.

---

### F · El cierre

**`PR-F1` · El sello sólo cuando no queda ninguna moneda** 🤖 `qa:pedido-registro` (11b, 11b bis, 11f)
Y se pregunta **a la base**, no al borrador: sólo `sales` sabe lo que llegó a
escribirse. **No hay estado intermedio** —el dueño eliminó el concepto de
«pedido atendido» el 2026-10-25— así que un pedido a medias **sigue sonando en
la campana**, que es justo lo que le recuerda que tiene trabajo sin terminar.

---

**`PR-F2` · La segunda moneda falla después de que la primera se guardó** 🤖 `qa:pedido-registro` (14a-14d)
**La primera venta NO se deshace.** El dinero que el tendero ya tomó queda
anotado, el pedido no se sella, y el mensaje de error dice las dos cosas: lo que
falló **y** lo que sí quedó registrado. Sin esa segunda mitad el tendero vuelve a
empezar y **registra dos veces lo que ya está escrito**.
Deshacer la primera era la alternativa y es peor: borra un cargo del que ya se le
habló al cliente para dejar limpia una pantalla.

---

**`PR-F3` · Doble toque en «Registrar y finalizar»** 🤖 `qa:pedido-registro` (4)
La parada dura es **por moneda** desde la migración `158`: por pedido rechazaría
la segunda moneda, que es trabajo legítimo.

---

**`PR-F4` · La analítica falla** ⛔
Va dentro de un `try` y **después** de que la venta esté escrita. Un fallo cuesta
una fila en Mixpanel, nunca un registro.

---

**`PR-F5` · El sello falla después de la venta** ⛔
La venta ya está escrita. Queda un pedido que sigue ofreciendo «Registrar» en una
moneda vendida, y la parada dura lo rechaza al segundo intento.

---

**`PR-F6` · Registrar una moneda y quitar la que falta** ❌ **DEFECTO MEDIDO**

Medido en dev el 2026-10-26 sobre un pedido de dólares y euros:

```
1. registrar USD                 → ok · pendientes: ["EUR"]
2. el pedido, a medias           → status: new · registered_at: null
3. quitarMonedaDelPedido("EUR")  → ok
4. el pedido, tras quitarla      → status: new · registered_at: null   ← se queda así
5. GET /registrar                → HTTP 200 (el bloque de USD con su «Registrar»)
6. volver a darle a «Registrar»  → "Esa parte del pedido ya se registró."
7. la campana lo cuenta pendiente → SÍ
```

**En cristiano.** Doña Rosa cobra los dólares del pedido de Carmen. Para los
euros, Carmen se arrepiente, y Doña Rosa le da a «Eliminar» en ese bloque — que
es exactamente lo que ese botón está para hacer. Desde ese momento el pedido de
Carmen **no se puede cerrar nunca**: la campana lo sigue reclamando cada vez que
Doña Rosa la abre, y el único botón que su pantalla le ofrece le contesta que eso
ya está registrado.

**Peor escenario:** no pierde dinero —la venta de los dólares es correcta— pero
**la campana queda sonando para siempre por un pedido terminado**, y un aviso que
no se puede apagar es un aviso que se deja de leer. Es la misma avería que
`CLAUDE.md` describe para un contador que nunca baja.

**ARREGLADO EL 2026-10-26.** Quitar una moneda que deja todas las vivas ya
vendidas **cierra el pedido** en ese mismo momento, y la pantalla lo dice:
«Quitado. El pedido queda registrado».

**La cuenta es UNA y la usan las dos puertas.** `monedasPendientes()` se extrajo
de `registrarPedidoComoVenta` para que quitar una moneda y registrar una no
puedan contestar distinto sobre el mismo pedido — escrita dos veces, una de las
dos respuestas lo dejaría mal sellado.

**Y lleva una condición que parece de más y no lo es:** solo sella **si hay al
menos una venta**. Sin ella, un pedido cuya única moneda viva esté
descatalogada --que nunca puede venderse, así que nunca está «pendiente»-- se
sellaría como registrado sin haber producido nada. `qa:pedido-registro` 17e es
justo ese control.

**Lo que esto cambia en el diálogo de «Eliminar»**, y está dicho ahí: su
promesa pasó a ser *«Puedes devolverlo mientras quede algo del pedido por
registrar»*. Decía «mientras no registres el pedido» y en este caso dejó de ser
cierto — prometer de más en el diálogo que pregunta antes de destruir algo es
lo peor que puede hacer ese diálogo.

---

**`PR-F7` · Borrar la venta de un pedido ya registrado** ❌ **MEDIDO en dev el 2026-10-26**
`eliminarVenta` **no toca `catalog_orders`**. Así que el pedido se queda sellado
como registrado, apuntando a una venta borrada, y el flujo se niega a volver a
entrar —redirige al detalle—. **El pedido del cliente no se puede volver a
registrar.**

**Lo que se midió**, y ya no es una lectura del código: un pedido se registró de
contado desde la app, se borró su venta desde «⋮ → Eliminar venta», y después:
la fila de `sales` quedó con su `deleted_at` puesto, el cliente quedó con
«Todavía no hay transacciones registradas», y el pedido siguió enseñando
**«Registrado: 26 oct. 2026, 6:38 p. m.»** con su `sale_id` apuntando a la venta
borrada. Ninguna pantalla dice nada.

**Peor escenario:** el tendero borra una venta mal hecha para repetirla y
descubre que el pedido ya no le deja. Lo que le queda es registrar la venta a
mano por el asistente, sin los precios sellados que el cliente vio.

**Y hay un caso que ni siquiera se puede intentar:** si el pedido se registró
**fiado entero**, no hay venta que borrar — `/transacciones/venta/<id>/usd`
devuelve 404 porque no hubo cobro en esa moneda, y la ficha del fiado no ofrece
«Eliminar». O sea que el borde solo existía cuando hubo algo de contado.

---

#### ARREGLADO el 2026-10-26 por la noche

`eliminarVenta` **no sabía que existían los pedidos**. El enlace está en los
dos sentidos desde la migración `157`, pero solo el registro escribía el sello;
el borrado no lo deshacía.

**SE RECALCULA, NO SE «DESSELLA»**, y esa palabra es el arreglo entero. Un
pedido de dos monedas tiene DOS ventas: borrar la de dólares tiene que dejar
pendientes los dólares **y nada más**. `recalcularSelloDelPedido` vuelve a
preguntar con `monedasPendientes` —la misma función que ya usaban registrar y
quitar una moneda, movida a `lib/` para que la compartan los tres— y escribe lo
que salga. `sale_id` se repone con la venta viva más antigua, que es lo que esa
columna significa.

**LA MITAD QUE NO ERA OPCIONAL: RESTAURAR TIENE QUE VOLVER A SELLAR.**
`restoreMovement` revive la venta a propósito desde el 2026-10-20. Sin llamar
ahí también, restaurar devolvería la venta a la vida con el pedido diciendo
«pendiente» — y el flujo lo dejaría registrar otra vez. **Habría sido un fallo
peor que el arreglado, creado por el propio arreglo.**

**Y UN SEGUNDO FALLO, CAZADO EN EL NAVEGADOR Y NO POR LA SUITE.** La primera
versión sellaba escribiendo solo `status` y `sale_id`. Al restaurar, el pedido
volvía a `registered` con **`registered_at` en nulo** — y los guardias de las
seis pantallas miran la FECHA, no el estado. La pantalla volvía a ofrecer
«Registrar pedido» sobre un pedido ya cobrado. Se repone con la fecha de la
última venta viva, que es cuando de verdad se terminó de cobrar; `now()` diría
que el pedido se registró al pulsar «Restaurar», que es falso.

Las seis filas `18a-18f` de `qa:pedido-registro` cubren el borrado, y
**`qa:sello-del-pedido`** vigila que las dos llamadas sigan ahí — porque
restaurar se pulsa desde una hoja y eso ninguna suite de HTTP lo alcanza.

---

### G · El borrador

**`PR-G1` · Caduca a las dos horas** ⛔
Registrar un pedido es una conversación de mostrador: empieza y acaba con el
cliente delante. Pasado eso, lo guardado es mucho más probablemente una sesión
abandonada que algo que alguien quiera de vuelta. **Y volver de entre los
muertos es peor que perderse:** el borrador de ayer, sobre un pedido cuyos
precios han cambiado, dibuja una venta que nadie aceptó.

---

**`PR-G2` · iOS o una ventana privada borran el almacenamiento** ⛔ **y no se puede probar en el panel del navegador**
El acceso **lanza una excepción**, no devuelve vacío, así que toda lectura va
envuelta. Una pantalla que se cayera ahí sería inservible justo para los
teléfonos más estrictos, que en este producto son la mayoría.
**Si se pierde, no se pierde dinero**: mientras el borrador vive, la base no
tiene nada.

---

**`PR-G3` · Dos pedidos a la vez, EN LA MISMA PESTAÑA** ❌ **MEDIDO en dev el 2026-10-26**

**Este apartado decía «en dos pestañas» y eso era FALSO.** Estaba leído en el
código y no medido, que es justo contra lo que avisa `CLAUDE.md`. Medido: el
borrador vive en **`sessionStorage`**, que es **de cada pestaña**. Dos pestañas
sobre dos pedidos distintos guardan cada una el suyo y no se tocan — comprobado
con las dos abiertas a la vez, leyendo la clave en cada una.

**Lo que sí pasa, y es igual de silencioso, es en UNA pestaña.** Hay una sola
clave, así que empezar un segundo pedido **pisa el borrador del primero**.
`leerBorrador` filtra por id, así que el primero no se corrompe: deja de existir.

**Medido con un pedido de dos monedas a medias** —dólares ya puestos, cliente ya
elegido—: abrir otro pedido y teclear su pago devuelve al primero de **`1/3
Pedido` con la tarjeta del cliente y «Editar» en los dólares** a **`1/4 Pedido`,
sin tarjeta y con los dos bloques diciendo «Registrar»**. Sin un aviso.

**No se pierde dinero**: la base no tiene nada hasta el último paso, y el cliente
que el tendero había elegido se vuelve a emparejar solo por el documento, así que
tampoco se parte en dos fichas. **Lo que se pierde es lo tecleado**, y el contador
de pasos cambia de sitio sin explicar por qué.

---

#### ARREGLADO el 2026-10-26 por la noche, y eran DOS cosas

**1. Una llave por pedido.** Había UNA, `sevenz:pedido-registro`, con el
`pedidoId` dentro; ahora es `sevenz:pedido-registro:<id>`. Los dos borradores
conviven y el guardia lo da la llave, no una comparación.

**2. Y el borrado del detalle, acotado a SU pedido — que es la mitad que no
salta a la vista.** `OrderDraftReset` vive en la pantalla de detalle para que
salirse del flujo tire lo editado (encargo del dueño de esa misma mañana), y
llamaba a `borrarBorrador()` **sin id**. O sea que abrir el pedido de Luis
tiraba lo que había a medias en el de Pedro — y eso habría seguido pasando con
las llaves ya separadas. Ahora pide el `pedidoId`, así que cada pantalla tira
lo suyo y la instrucción del dueño se cumple igual.

**LO QUE CUESTA, dicho por delante:** ahora pueden convivir varios borradores,
uno por pedido empezado. Son ~400 bytes cada uno, `sessionStorage` muere con la
pestaña, y `barrerCaducados` tira los de más de dos horas en cada escritura.

**Y EL CONTROL que impide «arreglarlo» quitando el reinicio**: salirse del flujo
de un pedido a **su propio** detalle tiene que seguir reiniciándolo. Medido:
vuelve a `1/4` sin tarjeta de cliente, y las llaves de los otros dos pedidos
siguen ahí.

---

**`PR-G4` · El borrador no se borra si la venta falla** 🤖 `qa:pedido-registro` (14b)
Sólo después de que la venta aterrice. Borrarlo antes dejaría, ante un fallo, un
pedido que sigue diciendo «Registrar» y nada de lo tecleado.

---

**`PR-G5` · Toda escritura pasa por una función** 🤖 `qa:suscripciones`
Porque el repo ya pagó este fallo: una pantalla guardaba el borrador entero en
cada render y borraba lo que otra acababa de escribir. **La defensa no es
acordarse de arrastrar los campos: es que no haya forma de escribir sin
hacerlo.**

---

### H · La pantalla y el teléfono

**`PR-H1` · Con el teclado arriba no queda nada pegado al borde** 👁 **sólo en un teléfono real**
`StickyActions`, nunca sus clases copiadas. El dueño lo ha pedido **tres veces** y
cada vez falló por un motivo distinto: no existía el componente, una pantalla lo
había copiado a mano, y el detector se quedó ciego.
**Hay que entrar por CADA puerta con el teclado abierto** — la del 2026-10-21
entró por una navegación, y esa diferencia fue justo la que rompió el detector.
**No vale el panel del navegador:** su emulador desenfoca el campo al cambiar de
tamaño, o sea que apaga la condición que se quiere medir.

---

**`PR-H2` · El botón flotante «Registrar» pisando los botones** 👁 **se MIDE, no se mira**
Y sin desplazar la página: el flotante es fijo y el contenido no, así que **el
caso roto es siempre la pantalla corta**. Un `padding` abajo no lo arregla —se
probó el 2026-10-22 y no movió un píxel—.

---

**`PR-H3` · Doble cabecera** 👁
La barra oscura la pone `app-header.tsx` con su lista de rutas, no la pantalla.
**Ha pasado cuatro veces.** Una pantalla nueva del flujo entra en esa lista
**antes** de escribirla.

---

**`PR-H4` · 375px** 👁
Nada se corta ni se desplaza en horizontal. El 2026-10-26 la tarjeta de
«Restaurar» decía «1 producto que no entrarán en la ve…»: una frase truncada en
una tarjeta que avisa de algo que falta **no avisa de nada**.

---

**`PR-H5` · iPhone** ⛔ **nada de este flujo se ha probado en uno**
Es el hueco más grande de esta guía y no se puede cerrar desde aquí. Safari en
iPhone no es Chrome: hace zoom con una tipografía de menos de 16px, `100vh` no
cuenta la barra, `:hover` no significa nada, y los desplegables y las hojas se
portan distinto. El `⋮` del menú «Descartar» es un popover de Radix, que es
justo donde más se separan.

---

## 4. Qué de esto toca la vista del cliente

Pregunta obligatoria de `CLAUDE.md` para todo encargo del app del dueño, y aquí
la respuesta es casi toda la misma:

| Zona | ¿Va a la vista del cliente? |
|---|---|
| A, B, C, D, F — estado, monedas, edición, pago, cierre | **No aplica.** Registrar una venta es cosa del tendero; el cliente no registra nada |
| E — el cliente | **No aplica.** Quién es se decide en el app del dueño |
| G — el borrador | **No aplica.** Vive en el navegador del tendero |
| H — teclado, flotante, cabecera, 375px | **Las reglas sí aplican** a cualquier pantalla del cliente que se toque, pero este flujo no tiene ninguna |

**Y hay una ausencia que conviene tener escrita: el cliente NO tiene ninguna
pantalla donde ver el estado de su pedido.** Lo único que ve es la confirmación
de una vez —«¡Tu pedido quedó registrado!»— en el carrito. Así que **nunca se
entera** de que su pedido se descartó, de que le quitaron una moneda, ni de que
se registró. Lo único que le llega es el fiado, cuando aparece en su enlace.

Eso no es un defecto de este flujo —nadie ha pedido esa pantalla— pero es el
motivo de que el `PR-A2` sea tan silencioso: no hay nadie al otro lado que pueda
desmentirlo.

---

## 5. El guion de la regresión

En este orden. Los pasos 1 y 2 son minutos; el 3 es el que cuesta y es el que
encuentra las cosas.

### Paso 1 — Lo que no necesita a nadie mirando

```bash
npm run qa:guiones && npm run qa:lineas-borradas && npm run qa:suscripciones
```

### Paso 2 — Las suites del flujo (**necesitan `npm run dev` corriendo**)

```bash
npm run qa:pedidos && npm run qa:pedido-registro
```

Y si el cambio toca dinero, saldos o el chip de estado, también:

```bash
npm run qa:venta && npm run qa:venta-accion && npm run qa:colombia && npm run qa:saldos
```

**Una suite que falla con «1/2 pasan» casi siempre es el servidor apagado, no el
código roto.** Ha confundido dos veces el mismo día.

### Paso 3 — El navegador, a 375px, y los tres recorridos

Lo que ninguna suite ve. Por pedido:

1. **Un pedido de UNA moneda, de contado entero.** Que los pasos digan `1/3`,
   `2/3`, `3/3`; que la flecha de atrás del `1/3` lleve al detalle; que al
   terminar **el cliente no deba nada** (`PR-D7`).
2. **Un pedido de DOS monedas, una fiada y otra de contado.** Que la primera
   pasada sea `1/4 … 4/4` y la segunda `1/3 … 3/3` sin volver a pedir el
   cliente; que las dos ventas vayan a **una sola** ficha (`PR-B2`).
3. **Editar una cantidad** y comprobar que la tarjeta de detrás, el total y el
   botón «Pagar» dicen **lo mismo** (`PR-C1`, `PR-C8`, `PR-D1`).
4. **Mover una línea a otra moneda** con un abono ya tecleado en la de origen
   (`PR-C3`).
5. **Quitar una moneda y restaurarla**, comprobando que **no** se sale de la
   pantalla (`PR-B6`).
6. **Descartar un pedido** desde el `⋮` y restaurarlo desde la campana.
7. **Teclear en bolívares** y comprobar que la cifra que vuelve es la tecleada
   (`PR-D2`).
8. **Borrar la venta de un pedido registrado** y comprobar que el pedido vuelve
   a estar pendiente; **restaurarla** desde la campana y comprobar que vuelve a
   decir «Registrado: ‹fecha›» y que su `/registrar` vuelve a rebotar
   (`PR-F7`). La segunda mitad es la que ninguna suite alcanza.
9. **Empezar un pedido, dejarlo a medias, abrir OTRO y volver** (`PR-G3`): el
   primero tiene que seguir donde estaba. Y el control: salirse al detalle **de
   ese mismo pedido** sí lo reinicia.
10. **Con el teclado abierto**, en un teléfono de verdad, entrando por cada
    puerta (`PR-H1`).

### Paso 4 — Antes de producción

El `qa-regression-checklist` completo, que es otra cosa y cubre toda la app.

---

## 6. Lo que esta guía no puede cubrir

Dicho porque una guía que no nombra sus huecos se lee como si no los tuviera.

| Hueco | Por qué |
|---|---|
| **iPhone** (`PR-H5`) | Hace falta un teléfono real. El panel del navegador da falsos negativos |
| **El teclado** (`PR-H1`) | Lo mismo, y por la misma razón concreta: el emulador desenfoca el campo |
| **Producción** | Todo lo de aquí se mide en dev. Las dos bases ya han diferido en disparadores, buckets y permisos |
| **Fallos de red a mitad** | Lo que pasa si la petición se corta justo después de escribir la venta y antes del sello (`PR-F5`) no se puede provocar desde aquí |
| **Varios tenderos a la vez** | Un negocio con dos personas registrando el mismo pedido desde dos teléfonos. La parada dura por moneda debería bastar; nadie lo ha medido |

---

## 7. Lo que queda abierto de este flujo

Los tres defectos medidos se arreglaron el mismo día, así que **no llegaron a
ser fichas**. Lo que sigue abierto, por si merece una:

| Id | Qué | Por qué no se hizo |
|---|---|---|
| `PR-E3` | **Varias fichas con los mismos dígitos**: no hay dónde mirarlas desde el flujo, y las dos pantallas se CONTRADICEN | El detalle dice «ya existe en varias cuentas» y el paso del cliente, dos pantallas después, dice «no hemos encontrado este cliente» — con un formulario vacío que crearía una tercera ficha |
| `PR-H1` | **El teclado abierto** tapa la barra de abajo | Solo se puede medir en un teléfono real |
| `PR-H5` | **iPhone** | Lo mismo |

**Cuatro salieron de esta tabla el 2026-10-26**, todas por encargo del dueño al
leerla: el filtro **«Descartados»** (`PR-A2`), el chip **«Mala paga»**
(`PR-E6`), el sello reversible (`PR-F7`) y la llave por pedido (`PR-G3`). Están
construidas y sus apartados lo cuentan.

**Y una observación que no es de este flujo pero se vio aquí**: el paso del
cliente lanza un `Hydration failed` en desarrollo, porque el servidor pinta
«Registrar» (no ve el borrador, que vive en el navegador) y el cliente pinta
«Registrar y finalizar». React lo repara repintando y no se pierde nada, pero
es ruido en la consola justo en la pantalla que escribe la venta. No lo
introduce ninguno de estos arreglos: viene de que el rótulo del botón depende
de un dato que el servidor no puede ver.

---

**Cómo se mantiene esto.** Cada vez que el flujo cambie, el borde que ese cambio
toca se actualiza aquí **en la misma sesión**. Un documento de bordes que
describe el flujo de hace dos semanas es peor que no tenerlo: se lee con la misma
confianza y manda a probar cosas que ya no existen.
