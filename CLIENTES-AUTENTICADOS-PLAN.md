# Clientes autenticados — plan

Borrador del 2026-09-17. **Nada construido.** Escrito después de medir el repo
y la base de dev, no de estimar.

**Actualizado el 2026-09-17, misma noche**, con el diseño de emparejamiento ya
decidido y medido contra producción. En una frase: **un mecanismo (KYC), tres
puertas (enlace, QR, por decisión propia), un rescate (presencia + confirmación
del dueño), y una pieza pendiente de medir (la consulta al CNE en el registro).**
El emparejamiento por posesión del enlace se diseñó y se descartó — está en la
sección 5 con el porqué, para que no se vuelva a proponer. Lo que queda por
decidir está al final.

**2026-09-18**: Didit confirma **validación también contra la Registraduría
colombiana** y que **la verificación es reutilizable** entre comercios. Lo primero
completa la cobertura de la fase B y sube su costo; lo segundo cierra la última
incógnita técnica del QR genérico. Construir un KYC propio se evaluó y se
descartó — está en la sección 5.

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
  identity_id   -> client_identities.id
  client_id     -> clients.id           (ÚNICA: una ficha, una identidad)
  confirmed_by  'kyc' | 'owner'         -- el mecanismo
  entry_door    'link' | 'qr' | 'direct'  -- por qué puerta entró (informativo)
  confirmed_at
```

**Los valores van en inglés desde el principio.** No es estética: un valor
guardado sobrevive al código. Renombrarlo después no es un `alter`, son cuatro
pasos y **dos despliegues** — ensanchar la constraint para aceptar ambos,
desplegar el código nuevo, actualizar las filas viejas, apretar la constraint —
porque entre el `update` y el despliegue el código viejo sigue escribiendo el
valor antiguo y esas filas violarían la constraint nueva. Hoy la tabla no existe,
así que cuesta cero. Y `'owner'` es **la misma cadena** que ya usa
`document_source` para el mismo concepto.

`confirmed_by` y `entry_door` son lo que el dueño ve como "quién, cuándo y cómo",
y lo que le dice cuánta confianza merece cada vínculo.

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

### Cómo se empareja — DECIDIDO el 2026-09-17

**Un mecanismo, tres puertas.**

El mecanismo es **KYC**: el cliente se autentica, escanea su documento y pasa una
prueba de vida. Sevenz busca después las fichas que coincidan con el documento
**que acaba de demostrar que es suyo**. El cliente nunca teclea un documento para
buscar.

Ese orden —**verificar primero, buscar después**— es lo que cierra el sondeo. Sin
campo de entrada no hay oráculo, y solo puedes encontrar tu propia ficha porque no
puedes falsificar la cara de otro. Es también lo que hace viable un QR genérico,
que sin KYC sería un buscador nacional de deudas por cédula.

| Puerta | Qué trae consigo | Qué permite diagnosticar |
|---|---|---|
| **Enlace compartido** (`/s/[token]`) | Un `client_id` concreto | Si el documento verificado no coincide, sabemos **qué ficha** está mal y se lo decimos al dueño |
| **QR del negocio** (en "Mi negocio") | Un `owner_id` | En qué negocio buscar, y a quién avisar |
| **Por decisión propia** (sin contexto de negocio) | Nada | El fallo es mudo. De ahí la salida del silencio, más abajo |

Las tres desembocan en el mismo flujo. No son equivalentes: las dos primeras
llevan contexto, y ese contexto es lo que convierte un fallo en un aviso
accionable en vez de en un silencio.

### El QR genérico entra por la puerta 3, no es una cuarta

Un QR genérico —en un volante, un afiche, una publicación— **no lleva `owner_id`**,
así que no aporta contexto. Es una forma física de llegar a la misma página a la
que llegas escribiendo la dirección. **No es una puerta nueva: es un atajo a la
tercera.**

Por eso añadirlo cuesta casi nada: ni flujo nuevo, ni código de emparejamiento
nuevo, ni análisis de seguridad aparte del que la puerta 3 ya tiene.

**Y por eso deja de ser peligroso.** Se descartó antes, cuando emparejar
significaba *teclear una cédula* — ahí un QR genérico era un buscador nacional de
deudas por documento. Con KYC nadie teclea nada: la objeción murió con el diseño
que la causaba.

**Precisión que importa**: empareja con **fichas** cuyo documento guardado
coincida con el verificado, no con negocios. Quien deba en tres tiendas pero
tenga el documento bien anotado en dos, **verá dos** — y no sabrá que falta una.

#### Lo que se pierde con el genérico

| | QR por negocio | QR genérico |
|---|---|---|
| Lleva `owner_id` | ✅ | ❌ |
| Si un documento está mal, **se le puede avisar al dueño** | ✅ | ❌ El fallo es mudo |
| Sirve para el camino de presencia (el dueño confirma mirando) | ✅ | ❌ No identifica negocio |
| Se puede rotar si se filtra | ✅ | ❌ Está impreso en todas partes |
| Sirve de superficie de marketing | ❌ | ✅ |

**No son sustitutos, son complementos.** El de negocio es el único que habilita el
diagnóstico y el rescate por presencia. El genérico es distribución.

#### Tres condiciones para añadirlo

1. **Que no lleve token, o que el token no conceda nada.** Como no da ninguna
   capacidad —solo lleva a una página pública— lo limpio es una URL fija tipo
   `sevenz.site/soy-cliente`: nada que revocar porque no hay nada que robar. Si
   hace falta medir de qué campaña vienen los escaneos, un parámetro de
   atribución, **nunca una credencial**.
2. **Tope de consumo.** Es el **único punto de entrada cuyo volumen no está
   acotado**: los enlaces están acotados a 171, los QR de negocio a 24 negocios,
   y un volante no está acotado por nada. Es el único sitio donde una campaña
   puede disparar el gasto de verificaciones.
3. **Dejar autoseleccionarse antes de la fricción.** En un volante lo escanea
   quien pasaba por ahí; hace el KYC y no encuentra nada. La página tiene que
   decir de entrada *"Si una tienda te fía y usa Sevenz, aquí puedes ver tu
   saldo"*, para que quien no está en ese caso se vaya antes de sacar la cédula.

**Depende de la puerta 3.** Si se decide no abrir la puerta fría, el QR genérico
no tiene adónde llevar; si se abre, viene gratis con ella. Ver la decisión 2 de
las abiertas.

**La incógnita técnica se cerró el 2026-09-18.** Quedaba por saber si una persona
verificada una vez podía emparejarse después con varios comercios sin repetir la
verificación — sin eso, el genérico obligaría a un KYC por tienda y no tendría
sentido. **Didit confirma que la verificación es reutilizable.** Lo que queda es
solo la decisión de producto sobre la puerta fría.

### Por qué NO se empareja por posesión del enlace

Se diseñó, se atacó y se descartó el mismo día. `share_links.token` se crea una
vez y **no caduca, no rota, no se revoca y no cuenta usos**: nació para *ver*, no
para *reclamar*. Convertirlo en credencial de emparejamiento lo volvía
irreversible y exclusivo —`client_id` es único, así que **el primero que reclama
deja fuera al real para siempre**— sobre un valor que viaja por WhatsApp y se
reenvía con dos toques.

Los parches que lo sostenían eran cuatro (vale de un solo uso, ventana, "¿eres
tú?" contra los últimos 4 dígitos, botón de reenvío), y el tercero **filtraba a
los honestos, no a los mentirosos**: si el dueño tecleó mal el número, el cliente
real contesta la verdad y se queda fuera de su propia ficha.

**El enlace recupera su único trabajo: mostrar el saldo y ser la entrada de PLG.**
Eso es la decisión 1, intacta. El KYC no blinda una credencial reutilizada — le
quita el trabajo que no le tocaba.

### Esto deroga la regla "NUNCA emparejar solo por documento"

La regla se escribió cuando *por documento* significaba **que alguien teclee un
número que puede saberse**. Con KYC significa **que alguien demuestre, con su cara
y su documento, que ese número es suyo**. Son cosas distintas, y la regla tal como
estaba ya no aplica.

Lo que sí sobrevive de ella, y es lo que no arregla ninguna tecnología:
**el KYC verifica a la persona, no al registro.** Si el dueño tecleó mal, el
cliente pasa la verificación impecablemente y no aparece su tienda — o peor, ese
número equivocado es la cédula real de otro, y a ese otro le aparece una bodega
donde nunca compró. De ahí la consulta al CNE, más abajo.

### Para quien ninguna puerta sirve: presencia + confirmación del dueño

No es una cuarta puerta. Es el mecanismo de rescate, y hace falta porque las tres
puertas emparejan por documento y hay gente que no tiene ninguno contra el que
emparejar:

- **56 clientes sin documento**, de las 144 altas de agosto (medido 2026-09-17).
- Quien falle el KYC.
- Quien no tenga un teléfono capaz de escanear y hacer prueba de vida.
- Los 43 que nunca recibieron enlace, que se solapan con los anteriores.

El cliente está en el local, escanea el QR, el dueño lo mira y confirma. Con tres
salvaguardas que no son adorno: **tope de solicitudes vivas por identidad** (~3),
**caducidad en minutos** —lo que prueba es la presencia, y una petición de hace
tres días ya no prueba nada—, y una pantalla que **compara** (nombre y documento
que el dueño tecleó, junto a la petición) en lugar de preguntar sí/no. Un dueño
que recibe peticiones de gente que no conoce aprende a confirmar sin mirar, y ahí
se acaba la seguridad de este camino.

**Aviso honesto: el QR impreso no prueba presencia.** Se fotografía y se comparte,
y entonces "presencia" es una suposición. Lo compensan la caducidad corta y la
pregunta explícita al dueño ("¿está esta persona frente a ti ahora?"). Se arregla
de verdad con un QR rotativo en la pantalla del dueño, si el abuso aparece.

**Limitación conocida**: con un empleado en el mostrador esto no funciona bien —
la presencia existe pero la autoridad está en otro teléfono. Se acepta hasta que
exista el papel de empleado.

### El lado del dueño: quién reclamó, cuándo, cómo, y desvincular

En cada ficha, una línea: **quién** se vinculó, **cuándo** y **por qué puerta**.
Y un botón de **desvincular**.

El "cómo" es lo que decide cuánta confianza merece: no es lo mismo *"lo confirmé
yo con la persona delante"* que *"verificó su cédula desde su casa"*.

Desvincular no borra al cliente ni la deuda: **corta la conexión entre esa cuenta
y esa ficha**. Es la lista de dispositivos conectados de WhatsApp, aplicada a
fichas — ves quién está dentro y puedes sacarlo.

**Es la única defensa que queda en un caso concreto**: si el dueño anotó mal un
dígito y ese número resulta ser el de una persona real, esa persona se empareja de
buena fe con la ficha de otro. Nadie hizo trampa. El único que puede notarlo es el
dueño, porque es el único que sabe quiénes son sus clientes — y solo si la app se
lo cuenta.

**Transferir no; solo desvincular.** Transferir obligaría al dueño a elegir una
identidad de una lista, y eso significa enseñarle personas que no son sus
clientes. Se desvincula, y el correcto reclama por su cuenta.

### La salida del silencio

Quien verifica su identidad y **no ve aparecer ninguna tienda** hizo el paso caro
en fricción y se fue con las manos vacías. Y quien ve dos de sus tres tiendas ni
siquiera sabe que falta una: **el silencio es peor que un error visible.**

Dos salidas, las dos gratis:

- **"¿Falta alguna tienda?"** → petición al dueño de ese negocio, por el mecanismo
  de presencia.
- **"Esta no es mía"** → un toque para rechazar una ficha mal vinculada, que avisa
  al dueño.

**El cliente sabe en qué tiendas compra. Es el mejor detector que vamos a tener de
los dos tipos de error, y no cobra nada.**

### La procedencia del documento: hecha

`clients.document_source` (`'owner'` | `'client'` | `null`) está en **dev y en
producción** desde el 2026-09-17, migración `063_document_source`. Ya no hace
falta pedirla: existe.

Con KYC como mecanismo deja de decidir emparejamientos, pero sigue sirviendo para
lo que de verdad importa — **decirle al dueño cuánto vale el número** en la
pantalla de confirmación del camino de presencia: `'client'` lo escribió el
cliente mismo; `'owner'` o `null` lo escribiste tú, verifica que sea él.

### PENDIENTE DE DECIDIR: validar la cédula contra el CNE al registrar

Es la única pieza que ataca el problema **donde nace**: que el dato contra el que
emparejan las tres puertas sea bueno. No necesita identidades, ni login, ni
emparejamiento — se puede construir sin nada del resto de este plan.

Cuando el dueño teclea la cédula, se consulta contra el CNE/SAIME (Didit
`ven_cedula`, **$0,20**, no entra en la capa gratuita) y se le devuelve el nombre
registrado.

**El diseño que evita la alarma.** No comparar nombres: hay fichas llamadas
"Chancho", "Don Pedro" y "Señora María", y una comparación automática gritaría en
falso casi siempre, hasta que nadie la lea. En vez de eso, **ofrecer** el nombre:

> *"El CNE dice María González. ¿Lo guardamos?"*

Deja de ser un policía y pasa a ser autocompletado — y así **vale la pena aunque
la tasa de error sea cero**, porque ahorra teclear y estandariza el dato. La
contrapartida es que guardaríamos el nombre que devuelve el registro, que es
justo el dato que en otro contexto habría que descartar. Es un cambio de postura
consciente.

**Peores escenarios de añadirla**

| Escenario | Solución |
|---|---|
| Latencia en el formulario, con un cliente delante del mostrador | **Nunca bloqueante.** El registro se guarda siempre; si Didit está caído se registra igual |
| El hueco de cobertura (90-95%) se lee como fraude y **el tendero le niega el fiado a un cliente real** | Redacción: *"No pudimos confirmarla"*, nunca *"no existe"*. Informativo, jamás acusatorio |
| ~~Colombia se queda fuera~~ | **Resuelto el 2026-09-18**: Didit valida también contra la Registraduría colombiana. No hace falta un segundo proveedor. Sube el costo porque ahora se valida todo, pero la cobertura es completa |
| Flujo de datos nuevo sin beneficio visible para el cliente, que ni está presente | Línea en la política de privacidad. Interés legítimo (mantener el dato exacto es una obligación), pero se decide a propósito |
| El costo se dispara **por implementación**: enganchado a cada guardado en vez de a cada cambio, o a cada fila del importador en vez de a cada cliente | El patrón ya está escrito en `app/(app)/clients/[id]/actions.ts`: comparar el documento anterior antes de escribir |

**Peores escenarios de no añadirla**

1. Las tres puertas heredan el dato malo, y nadie se entera.
2. El fallo llega en el peor momento: el cliente hace el KYC —el paso caro en
   fricción— y no aparece nada.
3. Los duplicados siguen acumulándose. Ya hay 4 dentro de una misma bodega.
4. Seguimos sin saber la tasa de error, así que cada decisión de arquitectura se
   queda en intuición.

**Cómo se decide: midiendo, no opinando**

1. **Gratis**: contar cuántos de los ~158 nombres son nombres reales y cuántos
   apodos. Si dominan los apodos, la comparación automática no es interpretable y
   el autocompletado es el único diseño viable.
2. **$32, una vez**: pasar los documentos venezolanos por `ven_cedula` y contar
   los desajustes.
3. **Error alto** → entra en el registro, ~$27/mes bien gastados.
   **Error bajo** → se salta, coste recurrente **$0**, y se reconsidera al crecer.

### Costos medidos (2026-09-17)

Altas reales: **144 en agosto**, **77 en los primeros 17 días de septiembre** —
un ritmo plano de ~4,5 al día, **~136 al mes**. El 100% de las altas de
septiembre traen documento, contra el 61% de agosto: **la regla de documento
obligatorio funciona**, y está medida.

| Concepto | Coste |
|---|---|
| **KYC** (las tres puertas) | **$0** — 500/mes gratis, para siempre. Aunque los 221 clientes existentes **y** las 136 altas nuevas verificaran el mismo mes, son 357 < 500 |
| **Consulta al registro** al dar de alta | **≥ $27,20/mes** — 136 altas × $0,20. Pendiente el precio de la consulta colombiana |
| **Auditoría** única | **~$32**, y ahora cubre los 158 documentos, no solo los venezolanos |
| **Liveness activo**, si se usa | **+$0,15 por verificación**. Estructura de cobro por confirmar |

**Actualizado el 2026-09-18 con la respuesta de Didit.** Antes este cuadro decía
$14–27/mes porque se asumía que la mitad colombiana no se podía validar. **Sí se
puede** — Didit cubre también la Registraduría — así que la cobertura se completa
y el costo sube al techo del rango. Cuánto exactamente depende del precio de la
consulta colombiana, que no está publicado.

El gasto real de esta decisión no es el dinero: es el capítulo nuevo de la
política de privacidad, el segundo despliegue en `Web/`, y una dependencia
externa que mantener.

### Proyecciones, para no decidir con el número de hoy

Las altas van a ~136/mes y planas en dos meses. La consulta al registro es lo
único que escala; el KYC no se mueve hasta rebasar 500 verificaciones mensuales.

| Altas/mes | Consulta al registro | ¿KYC sigue gratis? |
|---|---|---|
| 136 (hoy) | **$27** | Sí, con muchísimo margen |
| 250 | $50 | Sí |
| 500 | $100 | Sí, justo en el límite si **todas** verifican |
| 1.000 | $200 | **No**: ~500 de las verificaciones se pagarían a $0,33 ≈ +$165 |

**El punto de inflexión está en 500 emparejamientos al mes, no en 500 altas.** Y
solo una fracción de las altas acaba emparejándose, así que el techo real queda
bastante más lejos de lo que sugiere la tabla.

**Proveedor: Didit.** Descartados con datos el 2026-09-17: Truora (no cubre
Venezuela), Sumsub ($149/mes de mínimo ≈ $15 efectivos por verificación a este
volumen), Cleardil (no declara cobertura ni precios), Persona (gratis atado a un
plan de $250/mes, cobertura VE sin confirmar), Verifik (sin precios públicos).
**KYC propio: evaluado y descartado el 2026-09-18.** Son cuatro problemas
distintos y solo uno es abordable. La comparación facial 1:1 es fácil y gratis
(InsightFace y similares); el OCR es fastidioso pero posible —las cédulas
venezolanas no tienen MRZ, así que serían parsers por formato, y hay décadas de
formatos—; **la autenticidad del documento no es viable** sin un corpus grande de
documentos reales y falsos que solo tienen los proveedores; y **la prueba de vida
es una carrera armamentística** con ataques por inyección de cámara y deepfakes
que Didit señala como activos en Venezuela. La única pieza construible —la
comparación facial— no sirve de nada sin la que no se puede construir. A eso se
suma recibir y almacenar biometría (dato sensible bajo la Ley 1581 en Colombia),
asumir la responsabilidad entera, y montar inferencia fuera de Vercel. Y el
argumento que cierra: **el KYC de Didit cuesta $0 a este volumen**, así que serían
meses del único desarrollador para sustituir algo gratuito. El riesgo de
proveedor ya está cubierto por la integración fina y sustituible. Se reconsidera
si el volumen llega a miles al mes o si aparece una exigencia regulatoria de
mantener los datos en el país.

También descartados los scrapers del CNE de GitHub: uno sin licencia usable, otro
sin tocar desde 2017, el tercero es un sitio web completo con pasarela de pagos —
y los tres cuelgan de un portal que el CNE cambió en 2026.

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

**RESUELTO el 2026-09-17, y se disolvió solo.** Este escenario existía porque el
enlace hacía dos trabajos: enseñar el saldo **y** dar acceso. Separarlos lo
deshace.

Hoy el enlace **solo enseña el saldo**, sin cuenta y para siempre — decisión 1. Lo
que se revoca al desvincular es **el emparejamiento**, no la vista. Que Pedro siga
abriendo su enlace de hace seis meses no revoca nada porque no concedía nada: ve
su propio saldo, que es exactamente lo que podía ver antes de autenticarse.

`get_shared_balance` **no** tiene que consultar el estado del enlace, y la única
ruta pública del producto se queda como está.

**Lo que sigue pendiente, y es otra cosa**: poder **rotar el token** cuando el
enlace fue a parar a quien no debía — un dígito mal en el WhatsApp, un reenvío a
un grupo. Eso ya está en el backlog como "revocar enlace compartido" y no depende
de nada de este plan.

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
| **1** | ✅ Esquema base — `035`, en los dos ambientes | — |
| **2** | ✅ Medir producción — 2026-09-17 | — |
| **3** | ✅ `document_source` — `063`, en dev **y producción**, 2026-09-17 | — |
| **4** | Limpiar las 4 fichas duplicadas dentro de una misma bodega | — |
| **5** | Recordarle al tendero los **43 clientes sin enlace**. El arreglo más grande y más barato que salió de la medición, y no necesita login | — |
| **5b** | **QR por negocio**, generado en "Mi negocio", que el dueño expande o imprime. En esta fase es solo **canal de entrega** para los 43: lleva al enlace, sin identidad ninguna | — |
| **A** | **Auditoría de documentos** contra el CNE, $32 una vez. Decide la fase B | — |
| **B** | **Consulta CNE al registrar** un cliente, como autocompletado del nombre. Solo si A lo justifica | A |
| **6** | `client_identity_links` + el papel activo en el JWT | 3 |
| **7** | Integración de **Didit KYC**, fina y sustituible · `app/(cliente)` con su layout y su guardián | 6 |
| **8** | **Las tres puertas**: enlace, QR del negocio y por decisión propia. Verificar primero, buscar después | 7 |
| **8b** | **QR genérico** — atajo físico a la puerta 3, sin token. Viene casi gratis con la 8, pero **solo si se abre la puerta fría** | 8 |
| **9** | **Presencia + confirmación del dueño**, para quien ninguna puerta sirve — los 56 sin documento y los que fallen el KYC | 8 |
| **10** | **El lado del dueño**: quién reclamó, cuándo, por qué puerta, y desvincular | 8 |
| **11** | **La salida del silencio**: "¿falta alguna tienda?" y "esta no es mía" | 8 |
| **12** | Avisar que pagó + comprobante — **la razón para entrar** | 8 |
| **13** | Ver todos los saldos · Puntaje visible al cliente | 12 |

**Las fases 4, 5, 5b y A no necesitan nada de lo demás.** Se pueden hacer esta
semana, arreglan cosas medidas, y la 5 —43 clientes que nunca recibieron su
enlace, de 214— probablemente valga más hoy que todo el proyecto de identidad.

**Las fases 10 y 11 no son opcionales si se hace la 8.** La 10 es la única
defensa contra un emparejamiento de buena fe con la ficha equivocada; la 11 es lo
que impide que un error del dueño se vuelva invisible para todos. Construir las
puertas sin ellas es construir la parte que se ve y dejarse la que avisa.

## Lo que queda por decidir

### Resueltas el 2026-09-17

- ~~**¿El enlace anónimo muere al emparejar la ficha?**~~ **No.** Sigue vivo y
  sigue mostrando el saldo sin cuenta. No expone datos sensibles del cliente ni
  del dueño, tampoco en el payload que llega al navegador — la migración `042` ya
  sacó de ahí el documento y el `payment_info`. Lleva cues de PLG para invitar a
  autenticarse. *Excepción deliberada a confirmar: el WhatsApp completo del dueño
  sí viaja, porque lo necesita el botón de "Escribir a…".*
- ~~**¿Quién confirma un emparejamiento por documento?**~~ **Nadie: lo confirma el
  KYC.** Y cuando el KYC no es posible o falla, el dueño, en persona, con la
  pantalla de comparación.

### Abiertas

0. **¿Vale la pena el proyecto de identidad ahora mismo?** Con cero personas
   debiendo a dos negocios —número medido cruzando documentos, así que es un piso
   y no un techo— la respuesta honesta sigue siendo "no todavía, y sí las fases
   4, 5, 5b y A". Es una decisión de producto, no técnica.
1. **¿Entra la consulta al CNE en el registro?** Depende de la auditoría de $32.
   Ver la sección 5.
2. **¿Se permite la puerta fría** (sin contexto de negocio)? Es la que hace
   valioso el KYC, pero también la única donde un error del dueño se vuelve mudo.
   Se puede arrancar solo con las dos puertas con contexto. **De esta decisión
   cuelga el QR genérico**: es un atajo físico a esta puerta, así que si no se
   abre, no tiene adónde llevar.
3. **Menores de edad.** Nunca se ha hablado, y el KYC obliga a tener postura.
4. **¿El cliente ve su puntaje tal cual**, o una versión suya? El mismo número
   que usa el tendero para decidir si le fía, enseñado al que lo sufre, cambia
   de significado.
5. **¿Qué pasa con los avisos de pago que el tendero nunca responde?**
6. **Política de privacidad y Términos**: el cliente pasa de ser alguien cuyos
   datos mete un tercero a ser usuario con cuenta propia. Eso es un capítulo
   nuevo, no un párrafo — y con KYC crece otra vez, porque la biometría es **dato
   sensible** bajo la Ley 1581 de 2012 en Colombia. Son **dos despliegues**:
   `Web/` va aparte.
7. **¿Quién paga pasadas las 500 verificaciones gratuitas al mes?** Hoy sobran de
   largo; conviene decidirlo antes de necesitarlo, no después.

### Didit: lo confirmado y lo que falta (2026-09-18)

**Respondido:**

- **Las 500 gratuitas cubren** documento + **liveness pasivo** + face match +
  análisis de IP. Todo lo demás se factura.
- **`ven_cedula` se factura siempre**, nunca entra en la capa gratuita.
- ✅ **Sí hay validación contra la Registraduría colombiana**, y "también
  migración". La fase B cubre las dos mitades de la plataforma.
- ✅ **La verificación es reutilizable**: una persona verificada se empareja
  después con varios comercios sin repetirla. **Cierra la incógnita del QR
  genérico.**

**Se deduce, pero conviene confirmarlo por escrito**: el **liveness activo** queda
fuera de la capa gratuita. No está claro si suma $0,15 al bundle gratuito o si
usarlo saca toda la verificación de la capa gratuita — son dos facturas muy
distintas. *Decisión provisional: empezar con el pasivo. En la fase 1 lo que está
en juego es ver un saldo, y pasar a activo es configuración, no reconstrucción.*

**Aplazado por Didit a un segundo correo:** cobro por consulta o por consulta
exitosa · cédulas E- y laminadas · precio y detalle del registro colombiano ·
detección de sintéticas · límites por lotes para la auditoría · retención
configurable.

**Se cayó de las dos listas y hay que volver a preguntarlo:**

1. **¿Las sesiones de KYC abandonadas o fallidas cuentan contra las 500?** Pesa
   más que antes: el KYC es el mecanismo principal, y un 50% de abandono duplica
   el consumo.
2. **¿Restricciones por sanciones** para atender usuarios finales venezolanos?
3. **Menores de edad**: ¿soportados, excluidos, prohibidos?
4. Aclarar qué significa **"también tenemos migración"** — si son registros
   migratorios, cubriría las cédulas **E-** de extranjeros.


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
  una cédula, se guarda, y la ficha queda con `document_source = 'client'`.
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
declarado el cliente, la procedencia baja a `'owner'`.** Es un dato peor y hay
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

**4.2** Comprobar a los pocos días que aparecen filas con `'client'`. Si a las
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

---

# Anexo — El flujo de KYC, paso a paso

Decidido el 2026-09-17/18. **Sin construir** — es `CA-7` en
[`PENDIENTES.md`](PENDIENTES.md).

Esto es el último recurso dentro del mecanismo: si el cliente está en el local,
manda el camino de presencia; el KYC es para lo remoto.

**Paso 0 — De dónde viene.** *Entrada tibia*: abrió un enlace, sabemos el
`client_id`. *Entrada fría*: QR genérico o web, no sabemos nada.

**Paso 1 — Se autentica** en Sevenz. El KYC se ata a una identidad; sin identidad
no hay a qué atarlo.

**Paso 2 — Comprobaciones gratis.** ¿La ficha tiene documento? ¿Es legacy, con
letras? Si no hay contra qué comparar, se va al camino de presencia. Descarta un
porcentaje alto sin gastar nada: **82 fichas no tienen origen conocido y 56 no
tienen documento**.

**Paso 3 — Validar el REGISTRO antes que a la PERSONA.** Consulta al registro
(CNE/SAIME o Registraduría) con el documento de la ficha, ~$0,20.

**Este orden es el corazón del diseño.** Si verificas primero a la persona y el
registro está mal, has pagado un KYC para certificar un emparejamiento
equivocado — con más confianza que antes, que es exactamente el riesgo de falsa
confianza que tiene una herramienta fuerte.

| Resultado | Qué significa | Qué hace la app |
|---|---|---|
| Coincide con el nombre de la ficha | El registro es bueno | Sigue al paso 4 |
| Devuelve **otro nombre** | El dueño tecleó mal | **Para.** Avisa al dueño; no se manda al cliente al selfie |
| No encontrado | Hueco de cobertura (5-10%) o dato basura | Sigue, **marcado**. Ver paso 7 |

**Paso 4 — Sesión de KYC alojada en Didit.** Sevenz **nunca toca las imágenes**:
no pasan por nuestro servidor, no se guardan, no existen para nosotros. No es
opcional — es lo que mantiene manejable el capítulo de privacidad. Liveness
**pasivo** en v1; el activo cuesta $0,15 y se sube solo si aparece abuso.

**Paso 5 — El webhook.** Dos reglas: **verificar la firma**, y **no fiarse del
cuerpo** — reconsultar la sesión contra la API de Didit. El webhook es un aviso,
no una fuente de verdad. Se guarda id de sesión, estado y documento verificado.
Nada más.

**Paso 6 — El cruce.** *Entrada tibia*: ¿el documento verificado es el de la
ficha? *Entrada fría*: **primero verificas, después buscas** — la persona no
teclea ningún documento; el sistema busca fichas que coincidan con el que acaba de
demostrar que es suyo. **Sin campo de entrada no hay oráculo**: solo puedes
encontrar tu propia ficha, porque no puedes falsificar la cara de otro.

**Paso 7 — La decisión.**

| Registro | KYC | Qué pasa |
|---|---|---|
| Coincide | Coincide | **Emparejamiento automático.** `confirmed_by = 'kyc'` |
| No encontrado | Coincide | **No empareja solo.** Va al dueño *con la verificación como prueba*: "esta persona verificó su identidad como María González. ¿Es tu clienta?" |
| Cualquiera | **No** coincide | No empareja. Y no se le dice de quién es la ficha |

La fila del medio es la que importa: cuando algo no cuadra, **el KYC no decide —
le hace la decisión fácil al dueño.** El sistema degrada bien en vez de romperse.

**Paso 8 — Siempre.** El dueño ve quién reclamó, cuándo y por qué puerta, y puede
desvincular.

**Minimización de datos**: si el KYC no coincide, se descarta todo menos "no
coincide". No se guarda el número real de esa persona — aprender un dato que no
necesitábamos es un coste, no un beneficio.

## Los topes, que no son adorno

- **Tope por identidad y por día** de sesiones de KYC: cada una cuesta dinero.
- **Tope duro en nuestro código** sobre las 500 gratuitas, no en el panel de
  Didit. Nunca se deja correr el contador de un tercero.
- **La caducidad se evalúa en Postgres**, dentro de la función `security definer`,
  comparando `timestamptz`. Nunca en el navegador — si se calcula en JavaScript
  hereda el bug de zona horaria de `PL-1`.

---

# Anexo — Didit, el proveedor

Elegido tras correr `new-api-risk-review` el 2026-09-17. **Nada integrado.**
Aprobada la **integración fina y sustituible**: un módulo con interfaz propia,
ningún tipo de Didit filtrándose al resto de la app, resultados guardados en
formato nuestro. Cambiar de proveedor = tocar un archivo.

- Panel: `business.didit.me` — **la cuenta la crea el usuario, no Claude**
- Precios: https://didit.me/pricing/
- Venezuela: https://didit.me/solutions/countries/venezuela/
- Cédula VE contra CNE: https://docs.didit.me/api-reference/database-validation/venezuela/cedula

## Precios

Bundle KYC completo **$0,33** · documento $0,15 · liveness pasivo $0,10 · liveness
**activo $0,15** · face match $0,05 · `ven_cedula` (CNE/SAIME) **$0,20**.

**Capa gratuita: 500 verificaciones al mes, para siempre**, sin tarjeta. Cubren
documento + **liveness pasivo** + face match + análisis de IP. Todo lo demás se
factura, incluido `ven_cedula`, que **nunca** entra en la capa gratuita.

## Confirmado por Didit el 2026-09-18

- ✅ **Validan también contra la Registraduría colombiana**, y "también
  migración". Completa la cobertura de la plataforma y sube el costo de la fase B,
  porque ahora se valida todo.
- ✅ **La verificación es reutilizable**: una persona verificada se empareja
  después con varios comercios sin repetirla. Era la condición del QR genérico.

## Sin aclarar

El **liveness activo** queda fuera de la capa gratuita, pero no se sabe si suma
$0,15 al bundle gratuito o si usarlo saca la verificación entera de la capa. Son
dos facturas muy distintas. *Decisión provisional: empezar con el pasivo.*

Y el **precio de la consulta colombiana** no está publicado — su documentación
avisa de que la validación contra bases de datos varía por país.

## Descartados, con datos

| Proveedor | Por qué |
|---|---|
| **Truora** | No cubre Venezuela |
| **Sumsub** | $149/mes de mínimo ≈ **$15 efectivos por verificación** a este volumen |
| **Cleardil** | No declara cobertura ni precios |
| **Persona** | Gratis atado a un plan de $250/mes; cobertura VE sin confirmar |
| **Verifik** | Sin precios públicos |
| **Scrapers del CNE** (3 repos de GitHub) | Uno sin licencia usable, otro sin tocar desde 2017, el tercero es un sitio web completo con pasarela de pagos — y **los tres cuelgan de un portal que el CNE cambió en 2026** |

## KYC propio: evaluado y descartado el 2026-09-18

Son cuatro problemas distintos y solo uno es abordable:

| Pieza | Viabilidad |
|---|---|
| Comparación facial 1:1 | ✅ Fácil y gratis (InsightFace y similares) |
| OCR del documento | ⚠️ Fastidioso: las cédulas VE no tienen MRZ, serían parsers por formato, y hay décadas de formatos |
| **Autenticidad del documento** | ❌ **No viable** sin un corpus grande de documentos reales *y falsos* que solo tienen los proveedores |
| **Prueba de vida** | ❌ **Carrera armamentística**: inyección de cámara y deepfakes, que Didit señala como activos en Venezuela |

**La única pieza construible no sirve sin la que no se puede construir**: face
match sin liveness se derrota sosteniendo una foto.

A eso se suma recibir y almacenar biometría —dato sensible bajo la Ley 1581 en
Colombia—, asumir la responsabilidad entera sin nadie con quien compartirla, y
montar inferencia fuera de Vercel. Y el argumento que cierra: **el KYC de Didit
cuesta $0 a este volumen**, así que serían meses del único desarrollador para
sustituir algo gratuito. El riesgo de proveedor ya está cubierto por la
integración fina y sustituible.

**Se reconsidera** si el volumen llega a miles de verificaciones al mes, o si
aparece una exigencia regulatoria de mantener los datos en el país. Y si Sevenz
llega a tocar dinero y entrar en regulación financiera, una verificación casera
difícilmente satisfaría a un regulador: sería trabajo para tirar.
