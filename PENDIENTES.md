# Pendientes de Sevenz

Lista única y viva. **Si un pendiente no está aquí, no existe.**

## Cómo se usa

- **Vertical = iniciativa.** Cada pendiente pertenece a **una sola**, la
  principal. Los casos mixtos se resuelven con una nota, no con dos filas.
- **El ID es estable** (`CA-1`, `CT-3`...). No se reutiliza cuando algo se cierra,
  para que una referencia vieja nunca apunte a otra cosa.
- **Al cerrar**, la fila se mueve a [Hecho](#hecho) con su fecha y una línea de
  qué pasó. No se borra: un pendiente cerrado es historia, y la historia explica
  por qué el código es como es.
- **Al añadir**, hay que nombrar su vertical y su fecha. Sin vertical no entra.
- **`Desde`** es cuándo se registró. Un pendiente que lleva meses sin moverse es
  una señal, no un olvido.
- **El historial fino lo da git**: `git log -p PENDIENTES.md`.

`pre-09-18` marca los que ya existían antes de que esta lista se creara y cuya
fecha de origen no quedó registrada. No se inventan fechas.

---

## Clientes autenticados

Incluye el KYC, que es el **mecanismo** de esta vertical, no un frente aparte.
Diseño completo en [`CLIENTES-AUTENTICADOS-PLAN.md`](CLIENTES-AUTENTICADOS-PLAN.md).

| ID | Pendiente | Desde | Objetivo | Costo | Nota |
|---|---|---|---|---|---|
| CA-2 | Verificación 4.2 de la migración 063 | 2026-09-17 | **~2026-10-01** | $0 | Si `document_source = 'client'` sigue en cero no es un bug: es que nadie pasa por el modal público |
| CA-3 | Segundo correo de Didit | 2026-09-18 | — | — | Precio de la consulta colombiana, cédulas E- y laminadas, cobro por consulta o por éxito, sintéticas, lotes, retención |
| CA-4 | Pre-chequeo de apodos | 2026-09-18 | — | **$0** | Contar cuántos de los 158 nombres son reales. Si dominan los apodos, CA-5 no es interpretable |
| CA-5 | Auditoría de documentos contra el registro | 2026-09-17 | — | **~$32** | Resuelve la decisión 1. Hacer después de CA-4 |
| CA-6 | Crear la cuenta en `business.didit.me` | 2026-09-18 | — | $0 | La crea el usuario, no Claude |
| CA-7 | Construir el flujo de KYC en 8 pasos | 2026-09-18 | — | — | Diseñado, sin construir. Ver el anexo del plan |
| CA-8 | Las 13 fases del plan | 2026-09-17 | — | ~$27/mes | Gated por la decisión 0 |
| CA-9 | Las 8 decisiones abiertas | 2026-09-17 | — | — | La 1 la resuelve CA-5 |

## Cartera

El producto del tendero. **Nada de aquí necesita identidad ni login.**

| ID | Pendiente | Desde | Objetivo | Costo | Nota |
|---|---|---|---|---|---|
| CT-1 | **Los 43 clientes sin enlace**, de 214 | 2026-09-17 | — | — | 🥇 Lo más valioso que salió de medir producción, y no depende de nada |
| CT-2 | Rotar / revocar el enlace compartido | pre-09-18 | — | — | Hoy `getOrCreateShareLink` crea el token una vez y lo devuelve para siempre: no caduca, no rota, no se revoca, no cuenta usos |
| CT-3 | Notificaciones push | pre-09-18 | — | — | Suben de prioridad con CA-8: el camino de presencia depende de avisar al dueño |
| CT-4 | La segunda pregunta del registro | pre-09-18 | — | — | |
| CT-5 | Refresco del BCV | pre-09-18 | — | — | |
| CT-6 | Más tasas en la calculadora | pre-09-18 | — | $0 | El paralelo ya viene gratis en la misma API que se consulta |
| CT-7 | Informes | pre-09-18 | — | — | Plan escrito en [`REPORTES-PLAN.md`](REPORTES-PLAN.md), sin construir |

## Datos y mantenimiento

| ID | Pendiente | Desde | Objetivo | Costo | Nota |
|---|---|---|---|---|---|
| DM-1 | Limpiar las 4 fichas duplicadas | 2026-09-17 | — | — | Dentro de una misma bodega |
| DM-2 | Purgar `movement_rejections` | pre-09-18 | — | — | |

## Plataforma

| ID | Pendiente | Desde | Objetivo | Costo | Nota |
|---|---|---|---|---|---|
| PL-1 | 🐛 **Bug de zona horaria en las fechas** | 2026-09-17 | — | — | Confirmado en producción. Detalle abajo |
| PL-2 | `@tanstack/react-table` v8 | 2026-09-15 | — | — | No añadir más sitios que la usen. Bloquea encender el React Compiler. Ver `CLAUDE.md` |
| PL-3 | **El plan de Vercel no da para repos privados** | 2026-09-18 | — | ~$20/mes si se sube a Pro | Detalle abajo. Los dos repos están públicos por esto |

---

## Detalle

### PL-1 — Bug de zona horaria en las fechas

Encontrado el 2026-09-17 en producción, durante la prueba de regresión de la ruta
del dinero.

**Síntoma.** En la ficha de un cliente, a la vez y en la misma pantalla:

- "Historial de movimientos": *17 de sept de 2026*
- "Historial de mala paga": *Marcado: **18** de sept de 2026, 00:55*

Los cuatro eventos fueron la misma noche, con minutos de diferencia. Nadie marcó
nada a las 00:55.

**Causa.** En `lib/format.ts`, `formatDate` (línea 15) y `formatDateTime`
(línea 21) construyen `Intl.DateTimeFormat("es-CO", {...})` **sin pasar
`timeZone`**. Intl usa entonces la zona del runtime: UTC en Vercel, la del dueño
en el navegador. Lo que pinta el servidor sale en UTC; lo que hidrata el cliente,
en local. Entre las 19:00/20:00 y medianoche hora local, las dos difieren en un
día.

**Evidencia.** Un `fetch` del HTML servido por producción para `/clients/<id>`
devuelve únicamente "18 de sept de 2026"; el mismo documento ya hidratado muestra
"17 de sept de 2026" en el historial de movimientos. El movimiento se creó en
`2026-09-18T00:53:42Z`, que son las 19:53 del 17 en America/Bogota.

**Precedente en el repo.** `lib/lending-charts.ts` **sí** fija la zona
(`const BOGOTA_TZ = "America/Bogota"`, usada como `timeZone` en el formateador de
la línea 24). El arreglo de los gráficos nunca llegó a los formateadores de texto.

**Hay que preguntar antes de codificar** qué zona es la correcta: los dueños son
de Venezuela (UTC−4) y de Colombia (UTC−5), y no son la misma. Opciones: zona
según `owners.country`; la del navegador, que reintroduce la discrepancia salvo
que todo se formatee en cliente; o `America/Bogota` para todos, como ya hace
`lending-charts`.

**Alcance.** Buscar todos los usos de `formatDate`/`formatDateTime` y cualquier
otro `Intl.DateTimeFormat` o `toLocaleDateString` sin `timeZone`. Verificar que la
corrección no rompa el bucketing de `lending-charts.ts` ni las consultas con
`created_at::date` — Vercel corre en UTC y el día cambia a las 8pm Caracas.

---

### PL-3 — El plan de Vercel no da para repos privados

El 2026-09-18 se pusieron los dos repositorios en privado y **los despliegues se
bloquearon en el acto**:

> *The deployment was blocked because the commit author did not have contributing
> access to the project on Vercel. The Hobby Plan does not support collaboration
> for private repositories.*

El autor del commit era el de siempre —`JesusDelgadoProductDesign`, el mismo de
los commits que desplegaron bien el día anterior—, así que no era configuración de
git: era la visibilidad. **Se revirtió a público para recuperar los despliegues.**

**Por qué sigue abierto**: el motivo para cerrarlos no era el código, eran las
cifras que viven en los `.md` — 24 negocios, 214 clientes, el ritmo de altas, los
precios de Didit, la estrategia entera. Eso sigue expuesto.

**Y hay algo que conviene confirmar de todos modos**: el plan Hobby de Vercel es
para **uso no comercial**, y Sevenz cobra planes. Visto así la pregunta no es
"¿pago $20 por tener el repo privado?", es "¿estoy en el plan que corresponde?".

**Dos salidas:**

1. **Vercel Pro**, ~$20/mes. Desbloquea repos privados y alinea el plan con lo que
   Sevenz es.
2. **Separar la documentación a un repo privado aparte** (`sevenz.docs` o
   similar), que **no despliega nada**, así que el plan Hobby ni se entera de que
   es privado. Se llevaría `PENDIENTES.md` y los cuatro `*-PLAN.md`; se quedarían
   públicos `README.md`, `AGENTS.md`, `DESIGN-SYSTEM.md` y `CLAUDE.md`, que son
   reglas de ingeniería y no números. **Coste cero.**

**Lo que ninguna de las dos arregla**: los planes llevan desde el 2026-09-17 en el
historial público. Cerrar ahora limita lo que se expone en adelante; no recupera
lo que ya salió. Para eso haría falta reescribir el historial, que rompe clones.

---

## Hecho

| Cerrado | Qué | Nota |
|---|---|---|
| 2026-09-17 | Migraciones **059, 060, 061, 062** en producción | Cuenta pausada, comprobantes de admin |
| 2026-09-17 | **Cuenta pausada**: diálogo en las 8 acciones de escritura | Un `UPDATE` rechazado por RLS no da error, afecta cero filas — de ahí el `puedeEscribir()` antes de escribir |
| 2026-09-17 | **Migración 063** `document_source` en dev y producción | Registra quién tecleó el documento. Verificación de seguimiento en CA-2 |
| 2026-09-17 | **Campo de documento: solo dígitos**, con la señal `V-` fuera del input | Release `f49846a`. Verificado vivo en producción |
| 2026-09-17 | **Prueba de regresión en producción** de la ruta del dinero | 17 comprobaciones: fiado, abono, mala paga, enlace, importación, papelera. Una falló y abrió PL-1 |
| 2026-09-18 | **Decidido el diseño de emparejamiento** | Un mecanismo (KYC), tres puertas, un rescate. Descartado emparejar por posesión del enlace, y descartado construir KYC propio |
| 2026-09-18 | `CA-1` — **Esta lista existe** | Commit `da81daf`. Se escribió al descubrir que la memoria del proyecto estaba vacía y que pendientes dados por guardados no lo estaban |
