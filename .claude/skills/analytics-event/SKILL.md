---
name: analytics-event
description: Create, edit or retire a Mixpanel event in Sevenz, keeping the code and the event workbook (../docs/Sevenz-Eventos-Mixpanel.xlsx) in step. Use whenever a flow is added or changed, when qa-regression-checklist section 4i finds a missing or outdated event, or when the user asks to add, rename, change or remove an event, a property or a funnel, even if they don't name this skill.
---

# Crear, editar o retirar un evento

**Pedido por el dueño el 2026-11-04**: el `qa-regression-checklist` analiza cada
lanzamiento y, donde falte un evento o uno quede viejo, se crea o se actualiza
con este skill.

**Por qué es un skill y no una costumbre.** El 2026-10-24 se borró el diálogo
«Agregar transacción» y con él `Movement Added`, el único evento de fiados y
abonos. Las pantallas nuevas no lo sustituyeron. Durante dos semanas ninguna
venta, fiado ni abono llegó a Mixpanel, y nada avisó. Un evento que falta no
rompe nada: solo deja a alguien decidiendo sin dato.

## El sitio de cada cosa

| Qué | Dónde |
|---|---|
| El catálogo de eventos y sus funnels | `../docs/Sevenz-Eventos-Mixpanel.xlsx`, repo privado |
| Enviar desde una acción de servidor | `trackServer` en `lib/mixpanel-server.ts` |
| Enviar un gesto del dueño | `track` en `lib/mixpanel.ts`, que pasa por `/api/track` |
| Enviar desde la vista del cliente | Una ruta pública, ver «Dónde se dispara» |
| La pregunta de negocio | Comentario pegado al evento, regla de `CLAUDE.md` |

El libro y el código se actualizan **en la misma sesión**. Un evento que no está
en el libro no existe para el checklist, y uno que está y no se envía es peor.

## Antes de escribir nada: cuatro preguntas

1. **¿Qué decisión cambia según la respuesta?** Si no hay ninguna, no se crea. Se
   escribe en palabras del dueño cuando las haya, entre comillas y con su fecha.
2. **¿Ya existe?** Busca en el libro y con `grep`. Prefiere una propiedad nueva a
   un evento nuevo: `Search Performed` cubre trece buscadores con `screen`.
3. **¿Es un registro o un paso?** El registro concreta el valor, es P1 y va en el
   servidor. El paso solo arma el funnel, es P2 y puede ir en el navegador.
4. **¿Qué se cuenta si falla?** Un flujo con escritura lleva su evento de rechazo
   con `reason` como código. Sin eso, el drop-off no distingue «se fue» de «no lo
   dejamos».

## Crear un evento

### 1. Dónde se dispara

| Caso | Cómo | Por qué |
|---|---|---|
| Algo quedó guardado | `trackServer`, después de que la escritura termine bien | El navegador puede no cooperar. Regla de iPhone de `CLAUDE.md` |
| Un rechazo de una acción | `trackServer`, en cada `return` de error | El navegador solo ve el mensaje |
| Un gesto sin escritura: abrir, filtrar, avanzar un paso | `track`, en el manejador del gesto | No existe en el servidor. El número es un suelo |
| Un registro sin sesión: `signup`, `login` | `trackServer` con el id que devuelve Auth | `/api/track` responde 307 sin sesión |
| Un rechazo sin usuario todavía | `trackServer` con `distinct_id` fijo, como `anonymous-signup` | No hay a quién atribuirlo |
| El cliente en `/s/[token]` o `/c/[token]` | Acción de servidor, o ruta pública | `track` no funciona ahí |

**Ruta pública, y hay que hacer las tres cosas o el evento se pierde callado:**

1. Copiar el patrón de `app/api/share-contact/route.ts`: acepta solo el token,
   resuelve el dueño con `share_link_owner` o `catalog_link_owner`, y responde
   siempre 204.
2. **Eximirla en `lib/supabase/middleware.ts`.** Sin eso responde 307 a `/login`
   y nadie se entera. Así murió `Catalog Opened From Share Link`, en producción
   desde el 2026-10-17.
3. Comprobarla **sin sesión**: `curl -X POST` y esperar 204, no 307. Desde un
   navegador con sesión parece funcionar y no prueba nada.

Una ruta pública nueva es superficie sin autenticar: enmascara errores, usa
nombres de evento fijos en el servidor y pasa `qa:attack-coverage`.

### 2. Cómo se nombra

- **Evento**: inglés, `Objeto Verbo` en pasado, en Title Case: `Sale Completed`.
  El dueño de la frase va primero: `Payment Recorded`, no `Recorded Payment`.
- **Rechazo**: `<Objeto> Rejected`. **Fallo de sistema**: `<Objeto> Failed`.
- **Propiedad**: inglés y `snake_case`. Los valores son códigos en inglés, nunca
  texto libre ni frases en español. Las que ya existen en español no se renombran.
- **Un nombre no se cambia.** Rompe la serie en Mixpanel. Si el significado cambió,
  se crea otro y se retira el viejo.

### 3. Qué nunca se envía

Nombres de clientes, negocios, productos o proveedores. Teléfonos, documentos,
tokens, correos en `props`. El texto de una búsqueda, de un motivo o de un
comentario: se manda su longitud o su categoría. Solo identificadores internos.

Antes de añadir un dato nuevo, se mira si la Política de privacidad lo cubre
(`Web/app/politica-de-privacidad/page.tsx`). Si no, se dice al dueño.

### 4. Propiedades que casi siempre hacen falta

- `flow_id` en todo flujo de varios pasos: se crea al entrar y se pasa a la acción
  de servidor. Con él Mixpanel mantiene el mismo intento de punta a punta. En la
  libreta se llama `batch_id`.
- `entry_point`: **no se deduce en el servidor**. `?cliente=` no es único del
  perfil y no llega a la acción, así que se pasa explícito.
- `origin` o `source` si la acción tiene más de una llamada. `registrarVenta` la
  llama también el pedido, y `createProduct` también el alta rápida. Sin
  discriminador se cuenta doble.

### 5. El código

Pegado al evento va el comentario que exige `CLAUDE.md`, en inglés, con la
pregunta del dueño en español y entre comillas: qué decisión cambia, bajo qué
perfil se archiva, y si el número es un suelo.

`trackServer` nunca puede tumbar una escritura: ya protege lo suyo, pero lo que
se calcule para el evento va después de guardar y sin `throw`.

**Una vez por cosa, no por render.** Lo que depende de montar lleva una guarda
como la de `reportes-analitica.tsx`. Un buscador manda una vez por búsqueda, nunca
por letra. Una pantalla de éxito se puede recargar: el éxito se cuenta en la
acción, nunca al pintar.

### 6. El libro

Con `openpyxl`, en la pestaña `Eventos`: una fila por propiedad, y la primera de
cada evento lleva `Business question`, `Trigger`, `Event description` y `Code
location`. `Status` pasa a `Existe`. `Implementation date` es el día del commit.
Si arma un funnel, se añade su paso en `Funnels`, y se actualiza `Cobertura por
flujo`. Se abre después de guardar y se comprueba que no se perdió nada: con
`git diff --stat` en `docs`, y leyendo los totales de `Léeme`.

### 7. Probarlo

Un evento no está hecho hasta verlo salir. Para el navegador, mira la petición a
`/api/track` y su cuerpo. Para el servidor, añade un registro temporal o ejecuta
la acción y mira Live View de Mixpanel. Para una ruta pública, `curl` sin sesión.
Si no se pudo ver, la fila de QA dice «no probado».

## Editar un evento

- **Añadir una propiedad**: se puede. Se marca en el libro con su fecha.
- **Cambiar qué significa** o cuándo dispara: no se edita; ver «Un nombre no se
  cambia». Si es una corrección, se anota la fecha del cambio en `Implementation
  date`, porque la serie se parte en ese día.
- **Mover de navegador a servidor**: la cifra va a subir, y eso no es crecimiento.
  Se anota la fecha.
- **Al tocar uno viejo sin pregunta de negocio**, se le escribe entonces.

## Retirar un evento

Si se borra una pantalla o una acción, **se busca qué eventos se van con ella**.
Cada uno se sustituye en el mismo cambio, o se le dice al dueño que se pierde.
Después se pasa a `Eventos retirados` en la pestaña `Globales y retirados`, con
fecha, commit y qué lo sustituye. No se borra: explica por qué una serie termina.

## Cómo se reporta

Una fila por evento en la tabla de QA: evento, herramienta, resultado y si se vio
salir. Y una línea sobre el libro: qué filas cambiaron.
