# Clientes autenticados — plan

Borrador del 2026-09-17. **Nada construido.** Escrito después de medir el repo
y la base de dev, no de estimar.

---

## 1. Dónde estamos

### Lo que ya corrió

`035_client_identity_foundations`, en **dev y en producción**. Es la fase 1 de
este mismo plan, hecha hace semanas para no retocar esquema sobre datos vivos
después:

- `clients.document_country` — porque una cédula colombiana y una venezolana
  pueden ser los mismos dígitos y ser dos personas. Estos usuarios viven en la
  frontera: la colisión es real, no teórica.
- `client_identities` — `auth_user_id` (único, referencia a `auth.users`),
  `document_country`, `normalized_document_id`, `whatsapp`, `verified_at`.
  Con `unique (document_country, normalized_document_id)`.

**Esa tabla está huérfana a propósito.** Nada la enlaza con `clients`. Sin RLS
para `authenticated`, sin grants, sin camino de lectura. Existe y no se alcanza.

### Lo que el cliente ya hace hoy

En `/s/[token]` el cliente **ya escribe su documento** (`submit_shared_document_id`)
y ya existe `/s/[token]/perfil`. O sea: el flujo donde el cliente dice quién es
ya está en producción. Lo que falta no es el concepto — es la prueba de que es
él.

### Lo que mide el repo

De la investigación de multicuenta (2026-09-11), medido y no estimado:

| | |
|---|---|
| `owners.id` **es** `auth.users.id` | Clave primaria que la referencia. El 1:1 está en el esquema |
| `auth.uid()` en políticas RLS | **52** usos, en 11 tablas |
| Políticas de Storage | **~54**, todas con `(storage.foldername(name))[1] = auth.uid()::text` |
| `get_shared_balance` | `SECURITY DEFINER` — el enlace del cliente no pasa por RLS |

### Lo que mide la base — PRODUCCIÓN, 2026-09-17

| | Producción | Dev |
|---|---|---|
| Clientes vivos | **214** | 36 |
| Con documento | 156 (**73%**) | 83% |
| Con WhatsApp | 189 (**88%**) | 64% |
| Con `document_country` | 214 (**100%**) | — |
| Con enlace creado | 154 (**72%**) | — |
| **Personas que le deben a más de un negocio** | **0** | 3 |
| Máximo de negocios por persona | **1** | — |
| Documentos repetidos dentro de una misma bodega | 4 | — |

### Tres hallazgos que cambiaron el plan

**1. "Ver todos tus saldos" tiene hoy CERO usuarios.** Ninguna persona en
producción le debe a más de un negocio. Era la justificación principal del
proyecto y no la sostiene ningún dato: se construiría para alguien que todavía
no existe. Empezará a valer cuando Sevenz tenga varias bodegas en el mismo
pueblo; hoy no las tiene.

**2. Pedir el documento en el enlace NO consigue identidad.** El diálogo
obligatorio existe desde el 2026-08-31 (`components/public/document-id-dialog.tsx`
+ `submit_shared_document_id`), no se puede cerrar —sin botón, sin Escape, sin
clic fuera— y tapa el saldo. De los 58 clientes sin documento:

- **43 nunca tuvieron enlace creado.** Su bodeguero jamás les mandó nada. Ningún
  modal alcanza a quien no llega a la pantalla.
- 15 sí tienen enlace y **13 lo abrieron**, con aperturas desde el 2026-08-21
  hasta **hoy mismo** y 20 días de apertura en total: vuelven, les sirve.
- De esos, **8 abrieron con el modal ya vivo. Ninguno dio su documento.**

Cero de ocho es muestra pequeña, pero es cero en el escenario más favorable que
se puede montar. La lectura honesta: el cliente entra a ver cuánto debe, se topa
con un peaje y se va. **No tiene ningún motivo propio para dar ese dato.**

**3. Los datos de contacto no son de fiar, y no sabemos cuáles.** El dueño
observa que hay tenderos que rellenan el WhatsApp con lo que sea para pasar el
formulario. Eso descalifica al WhatsApp como prueba — y también al documento
*cuando lo tecleó el dueño*. El agujero real: **`clients` no guarda quién puso
ese dato**, así que un documento autodeclarado por el cliente y uno inventado por
el tendero viven en la misma columna, indistinguibles. De los 156 con documento,
hoy no sabemos cuáles son de fiar.

### El problema que este plan hereda

`getOrCreateShareLink` crea un token que **no caduca, no rota y no se revoca**.
Hoy el token *es* la autenticación: tenerlo equivale a ser el cliente. Por eso
se decidió no arreglarlo suelto: con esa forma, "revocar" solo puede significar
"rota el token y vuelve a mandarlo", que rompe el enlace que el cliente ya tiene
guardado y no distingue entre quitarle el acceso a un extraño y quitárselo al
cliente.

Cuando el cliente tenga identidad, revocar pasa a ser una operación sobre
**quién** puede ver. Que es lo que el tendero quiere de verdad.

---

## 2. Qué gana el cliente

Lo pedido: ver todos sus saldos, avisar que pagó, subir comprobantes, ver su
puntaje, y más adelante finanzas personales, préstamos, tiendas.

**Eso no es una función: es un segundo producto.** Y conviene decirlo en voz
alta al principio del plan, porque cambia las decisiones de arquitectura de la
sección 6. Sevenz deja de ser "una app para tenderos con una página pública de
consulta" y pasa a ser dos productos sobre una misma cartera.

**Y el orden cambia por lo medido.** La versión de ayer ponía "ver todos los
saldos" como fase A. Con cero usuarios para eso y cero documentos conseguidos a
la fuerza, el motivo para que un cliente se identifique no puede ser lo que él
ve: tiene que ser algo que él **quiera hacer**.

| Fase | Qué | Por qué en ese orden |
|---|---|---|
| **A** | **Avisar que pagó + subir comprobante** | Es lo único con lo que el cliente gana algo por identificarse: que su abono no se pierda. Es la puerta de entrada, no el postre |
| **B** | Revocar acceso | Cierra el agujero del enlace eterno. Le sirve al tendero desde el primer día y no depende de que ningún cliente entre |
| **C** | Ver todos sus saldos | Cae solo una vez hay identidad. Hoy no le sirve a nadie; servirá cuando haya densidad |
| **D** | Puntaje visible al cliente | Barato de construir, caro de equivocar. Ver sección 7 |
| **E** | Finanzas, préstamos, tiendas | Fuera de alcance de este plan |

**La fase A es también la más peligrosa**: es la primera vez que alguien que no
es el dueño escribe algo en la cartera. Ver 8.2. Ese riesgo se paga a cambio de
ser lo único que da un motivo real para identificarse.

**A es un proyecto en sí mismo.** No se mezcla con nada: es escritura de un
tercero sobre la cartera de un tendero.

---

## 3. Cómo entra: correo y contraseña

Decidido. La consecuencia, dicha una vez y no más: es una contraseña más que
recordar para ver cuánto debes, y eso se paga en abandono. Mitigación barata,
dentro de la fase A: **añadir código de un solo uso por correo como segunda
puerta**, sin quitar la contraseña. Supabase soporta las dos sobre la misma
cuenta y no cuesta un proveedor nuevo.

Lo que NO hay que hacer: reutilizar `handle_new_user()`. Ese trigger crea una
fila en `owners` para todo el que se registra. Un cliente que se registre con él
tal cual **se convierte en tendero silenciosamente**. La 035 ya le puso un
guardián de correo; la fase A tiene que revisarlo con la forma nueva.

---

## 4. Cómo coexisten los papeles

### La buena noticia: el esquema ya lo permite

- `owners.id` → `auth.users.id` (clave primaria que la referencia)
- `client_identities.auth_user_id` → `auth.users.id` (única)

Nada impide que **el mismo `auth.users.id` tenga fila en las dos**. No hace
falta migración para que una persona sea dueño y cliente a la vez. Ya se puede.

### Qué es cada cosa, y por qué no se confunden

| Objeto | Qué es | De quién es |
|---|---|---|
| `auth.users` | La persona | De ella |
| `owners` | Su papel de dueño | De ella |
| `client_identities` | Su papel de cliente | De ella |
| `clients` | **La ficha que un tendero escribió sobre alguien** | **Del tendero** |

La distinción de la última fila es la que evita el desastre. Cuando el bodeguero
B le fía al bodeguero A, esa fila en `clients` es **el registro de B sobre A**.
No es la identidad de A, no le pertenece a A, y A no la edita. Lo único que pasa
después es que esa fila se *empareja* con la identidad de A, y entonces A la ve.

**Por eso "un bodeguero registrado como cliente por otro" no es un caso
especial.** Es el caso normal, y el esquema ya lo soporta: A tiene fila en
`owners`, y B tiene una fila en `clients` que apunta a A una vez emparejada.

### Qué falta: la tabla del medio

Una identidad ve N fichas, de N tenderos distintos. Hace falta:

```
client_identity_links
  identity_id    -> client_identities.id
  client_id      -> clients.id          (única: una ficha, una identidad)
  confirmado_por 'enlace' | 'tendero' | 'documento'
  confirmado_el
```

`client_id` **único** es la regla que impide que dos personas reclamen la misma
ficha. Sin eso, dos primos con la cédula mal escrita ven la deuda del otro.

### El papel activo va en el JWT

De la investigación de multicuenta, y sigue siendo la decisión correcta: el
papel activo viaja en el token por un **Auth Hook**, para que las políticas
sigan siendo una igualdad (`owner_id = (auth.jwt() ->> 'active_owner')::uuid`) y
no se conviertan en una subconsulta **en 52 sitios**. Eso preserva lo que hace
que el RLS de hoy sea obviamente correcto.

Y deja la puerta abierta a empleados, que es el tercer papel que ya está en el
horizonte.

---

## 5. El registro por cuenta propia, y el emparejamiento

Esta es la parte difícil de todo el plan.

### Sí, hay que permitirlo

Un cliente que llega solo a `sevenz.site` y quiere registrarse debe poder. Lo
contrario condena el producto de cliente a crecer solo por invitación de
tenderos.

### Pero produce una cuenta vacía

Pedro se registra por su cuenta. Sevenz tiene una persona autenticada y **cero
conexión con ninguna ficha**. Las fichas las escribieron los tenderos, con el
nombre y el documento que a ellos les dio la gana teclear. En dev, **17% no
tiene documento**.

### Tres caminos para emparejar, en orden de fuerza

| # | Camino | Evidencia | Confirma |
|---|---|---|---|
| 1 | **Por enlace** | El tendero mandó ese enlace a ese teléfono. No es un número tecleado: es un acto | Automático |
| 2 | **Documento autodeclarado** | Lo escribió el propio cliente en el modal, para ver su deuda. Mentir ahí solo le perjudica | **El tendero** |
| 3 | **Documento tecleado por el dueño** | Puede ser relleno, igual que el WhatsApp | **El tendero**, siempre |
| 4 | **WhatsApp** | 88% lo tiene y el dueño avisa que muchos son de relleno | **Nunca es prueba.** Solo señal de apoyo |

**Hace falta una columna de procedencia.** Hoy los niveles 2 y 3 son
indistinguibles: misma columna, sin rastro de quién la escribió. Una columna en
`clients` que diga si el documento vino del modal público o del formulario del
dueño hace que el dato nazca con su origen. Hacia atrás no se reconstruye: esos
156 quedan como "origen desconocido", que es la verdad.

Es barata y vale la pena **aunque el login se retrase**.

**Regla que no se negocia: NUNCA emparejar solo por documento.** El documento lo
tecleó el tendero, puede estar mal, puede repetirse entre países, y emparejar mal
significa enseñarle a alguien la deuda de otro. Y eso no es un error de pantalla:
es contarle a un desconocido cuánto debe tu vecino.

El único emparejamiento automático es el del enlace, porque ahí la evidencia no
es un número tecleado: es que el tendero mandó ese enlace a ese teléfono.

### Qué pasa con los que ya existen

Nada, hasta que alguien se autentique. Las 199 fichas de producción siguen
exactamente como están y sus enlaces siguen funcionando. El emparejamiento es
incremental y voluntario: cada cliente que entra se empareja con lo suyo y el
resto sigue igual. **No hay migración de datos de clientes.** Eso es
deliberado — una migración masiva de identidades sobre documentos tecleados a
mano es exactamente el error de la regla anterior, multiplicado por 199.

---

## 6. ¿Una app o dos?

### La respuesta corta

**Un repo, un despliegue, dos áreas separadas por ruta y por layout.** No dos
aplicaciones.

### Por qué, en términos de mantenimiento

Lo que comparten las dos caras no es la maquetación: es **la cartera**. Saldos
por moneda, conversión, tasa sellada, puntaje, formato de dinero. Todo eso vive
en `lib/` y ya está probado. Partirlo en dos aplicaciones significa una de dos
cosas, y las dos son malas:

- **Duplicarlo** — y ya sabemos cómo termina eso: `Web/` tiene su propia copia
  de la calculadora y de `share-card.ts`, y cada arreglo hay que hacerlo dos
  veces. Con la calculadora es molesto. Con el cálculo de un saldo sería un
  cliente y un tendero viendo cifras distintas de la misma deuda.
- **Extraerlo a un paquete compartido** — que es la respuesta correcta a escala
  grande y una carga desproporcionada aquí: monorepo, versionado, dos pipelines,
  para un equipo de una persona.

La práctica de la industria para este caso —dos audiencias, un dominio de datos,
un equipo pequeño— es **un solo despliegue con separación por rutas**. Next.js
lo resuelve con grupos de rutas, que es el mecanismo que este repo **ya usa**:
`app/(app)` para el tendero, `app/admin` para la plataforma. La tercera cara
sería `app/(cliente)`, con su propio layout, su propia navegación y su propio
guardián. Cero infraestructura nueva.

### Cuándo dejaría de ser cierto

Tres señales, y ninguna se ha dado:

1. Las dos caras empiezan a desplegarse a ritmos distintos y una bloquea a la
   otra.
2. El bundle del cliente arrastra tanto código de tendero que penaliza el móvil.
3. Hay dos equipos y pisarse el código cuesta más que coordinar dos repos.

Hasta entonces, dos apps es pagar el costo de escalar sin tener la escala.

### Lo que sí hay que separar de verdad

No el despliegue — **la sesión y las políticas**:

- Layout y guardián propios en `app/(cliente)`, igual que `app/admin` hoy.
- **Ninguna acción de servidor compartida entre las dos caras.** Una acción es
  un endpoint POST que cualquiera puede llamar; compartirla entre un tendero y
  un cliente es pedir que un día uno pase por la puerta del otro.
- Políticas nuevas para la lectura del cliente, sin tocar las 52 existentes.

---

## 7. Casos borde

| Caso | Qué pasa hoy | Qué tiene que pasar |
|---|---|---|
| El tendero manda a la papelera a un cliente autenticado | La ficha se oculta de la vista del tendero; el enlace sigue vivo | El cliente deja de verla. Su historial no se borra |
| El tendero edita el documento de una ficha ya emparejada | — | **El enlace NO se rompe.** El emparejamiento es una fila propia, no una coincidencia recalculada. Si se recalculara, corregir un dedazo le quitaría el acceso a alguien |
| Dos fichas del mismo tendero para la misma persona | Pasa: el tendero la registró dos veces | La identidad puede enlazar las dos. Es el tendero quien las fusiona o no — son sus registros |
| La persona cambia de cédula (nacionalización, corrección) | — | Se re-verifica la identidad. Los enlaces existentes no se tocan |
| El cliente quiere borrar su cuenta | — | **Se borra su identidad, NO las fichas.** La deuda es el registro del tendero y no desaparece porque el deudor se dé de baja. La política de privacidad ya dice algo parecido de los datos del Comercio |
| El tendero se da de baja | `on delete cascade` borra sus clientes | Las identidades sobreviven; pierden ese enlace |
| Un cliente sin documento en su ficha | 17% en dev | Solo puede emparejarse por enlace o por petición. Nunca automáticamente |
| Dos personas, misma cédula, distinto país | `unique (document_country, normalized_document_id)` ya lo contempla | Por eso existe `document_country` desde la 035 |
| El cliente es también tendero y se fía a sí mismo | Nada lo impide | Que funcione. Es raro, no es peligroso |
| El enlace viejo sigue circulando después del login | Sigue funcionando | **Decisión pendiente**: ¿el token muere cuando la ficha se empareja? Ver sección 8 |

---

## 8. Peores escenarios y soluciones

### 8.1 Emparejar mal — el peor de todos

**Qué pasa:** Pedro entra y ve la deuda de otro Pedro. Sevenz le contó a un
desconocido cuánto debe alguien.

**Por qué es el peor:** no hay vuelta atrás. El dato ya se vio. Y es
silencioso — nadie reporta "vi una deuda que no era mía", simplemente la ve.

**Solución:** ningún emparejamiento automático salvo el del enlace. Documento y
petición pasan por el tendero. `client_id` único en la tabla de enlaces. Y cada
enlace guarda **por qué** se creó, para poder auditar después.

### 8.2 El cliente escribe en la cartera (fase C)

**Qué pasa:** el cliente marca "pagué 50$" sobre una deuda de 30$, o lo marca
tres veces, o lo marca y no pagó.

**Solución:** lo que el cliente crea **no es un movimiento**. Es un *aviso*, en
su propia tabla, que no toca saldos hasta que el tendero lo acepta. El saldo lo
sigue escribiendo solo el tendero. Un aviso pendiente por ficha; el segundo
reemplaza al primero.

**Y la trampa que ya nos mordió esta semana:** un `update` que una política
rechaza **no da error**, afecta a cero filas. Cualquier escritura de cliente
comprueba el permiso ANTES, como hacen ahora las ocho acciones del tendero.

### 8.3 Una política nueva abre una vieja

**Qué pasa:** al añadir la lectura del cliente sobre `clients` y `movements`, se
toca una política que hoy protege a 24 negocios.

**Por qué es realista:** acaba de pasar. La 061 tuvo que partir la política
única `for all` en cuatro, y la comprobación que importaba era *"un tendero
normal sigue viendo sus 142 clientes"*.

**Solución:** políticas **nuevas y separadas** para el papel de cliente, nunca
editar las del tendero. Y la misma verificación de la 061, contra un negocio
real con cartera de verdad, antes y después.

### 8.4 El enlace viejo sobrevive al login

**Qué pasa:** Pedro se autentica, el tendero le revoca el acceso, y Pedro sigue
entrando por el enlace de WhatsApp de hace seis meses.

**Solución:** revocar la identidad **tiene que** matar el token. Si no, la fase B
no revoca nada. Esto obliga a que `get_shared_balance` consulte el estado del
enlace — lo cual toca la única ruta pública del producto, con la regla de
enmascarar errores de `CLAUDE.md` encima.

**Decisión pendiente:** ¿el enlace anónimo desaparece para las fichas
emparejadas, o conviven? Conviven es más amable y deja la puerta trasera
abierta. Yo mataría el token al emparejar.

### 8.5 La cara de cliente crece y frena la del tendero

**Solución:** rutas separadas desde el primer día, y la señal de alarma escrita
en la sección 6.

### 8.6 Nadie se registra

**Qué pasa:** se construye todo y los clientes no entran, porque una contraseña
para ver una deuda es mucho pedir.

**Por qué importa más que los demás:** es el único escenario donde el trabajo se
pierde entero.

**Solución:** la fase A tiene que poder medirse. Cuántos abren el enlace, cuántos
empiezan el registro, cuántos lo terminan. Y **el enlace anónimo sigue
funcionando durante toda la fase A**: si nadie se registra, nadie se queda fuera.

---

## 9. Rendimiento

| Dónde | Riesgo | Solución |
|---|---|---|
| Pantalla del cliente con N negocios | Una consulta por negocio | Una función `SECURITY DEFINER` que devuelve todo de una vez, como `admin_cuentas_lista` |
| Puntaje del cliente | `computeCreditScore` necesita **todos** los movimientos de la ficha y se calcula al dibujar, sin guardarse | Es el techo conocido del sistema. Para el cliente, calcularlo bajo demanda y cachearlo. Persistirlo al escribir es el arreglo de verdad, y es otro proyecto |
| Políticas con subconsulta | El papel activo en una subconsulta se evalúa por fila | Va en el JWT. Sección 4 |
| El enlace público | Ya tiene límite de peticiones (`040`) | Reutilizarlo, no inventar otro |

---

## 10. Fases propuestas

| | Qué | Depende de |
|---|---|---|
| **1** | ✅ Esquema base — `035`, ya corrida en los dos ambientes | — |
| **2** | ✅ Medir producción — hecho el 2026-09-17, arriba | — |
| **3** | Columna de procedencia del documento. Barata, independiente, útil aunque todo lo demás se pare | — |
| **4** | Limpiar las 4 fichas duplicadas dentro de una misma bodega | — |
| **5** | Recordarle al tendero los **43 clientes sin enlace**. Es el arreglo más grande y más barato que salió de la medición, y no necesita login | — |
| **6** | `client_identity_links` + el papel activo en el JWT | 3 |
| **7** | Registro y login del cliente, `app/(cliente)`, emparejamiento por enlace | 6 |
| **8** | Avisar que pagó + comprobante — **la razón para entrar** | 7 |
| **9** | Revocar, y matar el token al revocar | 7 |
| **10** | Emparejamiento por documento y por petición, con confirmación del tendero | 8 |
| **11** | Ver todos los saldos · Puntaje visible al cliente | 10 |

**Las fases 3, 4 y 5 no necesitan nada de lo demás.** Se pueden hacer esta
semana, arreglan cosas medidas, y la 5 —43 clientes que nunca recibieron su
enlace, de 214— probablemente valga más hoy que todo el proyecto de identidad.

## Lo que queda por decidir

0. **¿Vale la pena el proyecto de identidad ahora mismo?** Con cero personas
   debiendo a dos negocios y cero documentos conseguidos por la fuerza, la
   respuesta honesta es "no todavía, y sí las fases 3, 4 y 5". Esa es una
   decisión de producto, no técnica.
1. **¿El enlace anónimo muere al emparejar la ficha?** (8.4)
2. **¿Quién confirma un emparejamiento por documento** — el tendero siempre, o
   automático cuando coinciden documento *y* WhatsApp?
3. **¿El cliente ve su puntaje tal cual**, o una versión suya? El mismo número
   que usa el tendero para decidir si le fía, enseñado al que lo sufre, cambia
   de significado.
4. **¿Qué pasa con los avisos de pago que el tendero nunca responde?**
5. **Política de privacidad y Términos**: el cliente pasa de ser alguien cuyos
   datos mete un tercero a ser usuario con cuenta propia. Eso es un capítulo
   nuevo, no un párrafo. Y son **dos despliegues** — `Web/` va aparte.


---

# Anexo — Plan de implementación del paso 1

Escrito el 2026-09-17 a partir de los peores escenarios analizados. Cada paso
dice contra cuál se defiende, y ninguno se da por bueno sin comprobarlo.

## Qué es el paso 1, en una frase

Anotar **quién escribió** el documento de cada ficha —el bodeguero o el propio
cliente— para que el día que haya que emparejar a una persona con su ficha se
sepa qué números se pueden creer.

**No crea roles. No empareja a nadie. No se ve en ninguna pantalla.** Compra una
comodidad futura, no un cimiento: sin esto, el emparejamiento por documento
simplemente pide siempre la confirmación del bodeguero.

## Los cinco peores escenarios y dónde se atajan

| # | Escenario | Se ataja en |
|---|---|---|
| 1 | El modal público deja de funcionar | Pasos 1.2 y 1.3 |
| 2 | **Un valor mal escrito impide registrar clientes** | Pasos 2.1 y 2.3 |
| 3 | Ventana sin etiquetar entre migración y código | Paso 4.1 |
| 4 | Marcar mal por un fallo histórico de `link_opens` | Asumido: el error va hacia desconfiar |
| 5 | Bloqueo de `clients` por el `alter table` | Paso 3.1 |

El **2 es el único que juega en la liga de la 061**: puede dejar a un bodeguero
sin poder dar de alta un cliente. Vive en el código, no en la migración.

---

## Fase 1 — La migración, en dev

**1.1** Correr `supabase/063_procedencia_del_documento.sql` en **DEV**
(`vzqppwrwnmlbrxizskdh`). Esperado: `Success. No rows returned`.

**1.2** Las tres verificaciones del final del archivo. La tercera es la que
importa: **ninguna ficha sin documento puede quedar marcada**. Si sale distinto
de 0, el predicado está mal y se para aquí.

**1.3 — Contra el escenario 1.** Probar el modal público a mano en dev:

- Abrir el enlace de un cliente **sin** documento → sale el diálogo, se escribe
  una cédula, se guarda, y la ficha queda con `document_source = 'cliente'`.
- Abrir el enlace de un cliente **con** documento → NO sale el diálogo.
- Abrir un enlace inválido → "Link inválido.", sin rastro de error interno.

Esa es la única escritura sin autenticar del producto. Si algo falla aquí, se
para todo.

**Revertir la fase 1:** `alter table public.clients drop column document_source;`
y volver a correr el bloque `create or replace function` de la `031`.

---

## Fase 2 — El código

**2.1 — Contra el escenario 2.** El valor vive en **un solo sitio**, tipado:

```ts
// lib/types.ts
export const DOCUMENT_SOURCE = { DUENO: "dueno", CLIENTE: "cliente" } as const;
export type DocumentSource = (typeof DOCUMENT_SOURCE)[keyof typeof DOCUMENT_SOURCE];
```

Ningún sitio escribe la cadena a mano. El `check` de la base convierte un
dedazo en "no se puede registrar un cliente"; la constante hace que ese dedazo
no exista.

**2.2** Los cuatro sitios donde el dueño escribe el documento pasan a marcar
`DOCUMENT_SOURCE.DUENO`:

| Archivo | Qué es |
|---|---|
| `app/(app)/dashboard/actions.ts` | Alta de cliente con su primer movimiento |
| `app/(app)/clients/[id]/actions.ts` | Editar cliente |
| `app/(app)/import/actions.ts` (×2) | Importar: rellenar ficha existente y crear nueva |

Regla incómoda pero correcta: **si el dueño sobrescribe un documento que había
declarado el cliente, la procedencia baja a `'dueno'`.** Es un dato peor y hay
que decirlo.

**2.3 — Contra el escenario 2, otra vez.** Probar **los cuatro** caminos en dev,
no uno. Un cliente nuevo, una edición, una importación que rellena y una que
crea. Cada uno tiene que terminar con la ficha guardada y `document_source`
puesto. Si alguno falla, el síntoma será "no se puede registrar", que es una
caída de la ruta del dinero.

**2.4** `tsc`, `eslint`, `next build`.

**Revertir la fase 2:** revertir el commit. La columna se queda y no molesta.

---

## Fase 3 — A producción

**3.1 — Contra el escenario 5.** Correr la `063` en **PRODUCCIÓN**
(`rabmiyqodnvnrwiartuj`) **fuera de hora punta**. El `alter table` y el
`add constraint` toman ACCESS EXCLUSIVE sobre `clients`; con 214 filas son
milisegundos, pero si hay una consulta larga en marcha, todo se encola detrás.

Antes: `qa-regression-checklist`, porque el diff toca `clients` y tres acciones
de la ruta del dinero.

**3.2** Las tres verificaciones, ahora en producción. Esperado: `dueno` ≤ 74,
`cliente` = 0, y **0 fichas marcadas sin documento**.

**3.3** Merge de `dev` a `main`.

---

## Fase 4 — Cerrar

**4.1 — Contra el escenario 3.** Entre la migración y el despliegue del código
hay una ventana en la que las fichas nuevas nacen sin etiqueta. Desplegar los
dos el mismo día la reduce a minutos. Si se alarga, **volver a correr el bloque
`update` de la `063`**: es re-ejecutable y solo toca lo que está en null.

**4.2** Comprobar a los pocos días que aparecen filas con `'cliente'`. Si a las
dos semanas siguen siendo cero, no es que el código falle: es que ningún cliente
está pasando por el modal — que es exactamente lo que midió la sección 1.

---

## Lo que este plan NO hace, a propósito

**No rellena a mano las 82 fichas sin origen.** No es cuestión de trabajo: son
justamente los casos donde la respuesta no existe en ningún sitio. El relleno
automático ya se quedó con todo lo que era demostrable. Preguntarle a 24
bodegueros qué tecleaeron en agosto produce recuerdos, y un recuerdo marcado
como certeza es peor que un hueco honesto.

Esas 82 se resuelven solas el día que su cliente entre y confirme su propia
cédula — que es mejor evidencia que cualquier reconstrucción de hoy.

**No construye identidad, ni login, ni emparejamiento.** Eso sigue esperando a
la decisión 0 de la sección "Lo que queda por decidir".
