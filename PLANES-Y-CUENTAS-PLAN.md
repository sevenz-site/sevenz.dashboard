# Planes, demos y estado de las cuentas — plan de implementación

Estado: **borrador, sin empezar.** Escrito el 2026-09-15 contra producción:
23 negocios, 199 clientes, 615 movimientos.

Los planes, el precio, la retención y qué hacer con los 23 negocios actuales
se decidieron el 2026-09-15 y están recogidos abajo. **No queda ninguna
pregunta bloqueante**: la Fase 0 se puede empezar hoy.

---

## Lo que ya existe

`owners.plan`, un `text` con `check (plan in ('free', 'pro'))`, puesto por la
migración 015. Eso es todo.

**Lo único que ese plan controla hoy** es el límite mensual de fotos del
importador: 5 al mes en `free`, sin límite en `pro`
(`lib/import-usage.ts`, `FREE_PLAN_MONTHLY_IMPORT_LIMIT`). El control vive en
`/api/extract`, que es el sitio correcto — la ruta que hace el trabajo, no la
pantalla que lo pide.

No existe: fecha de vencimiento, estado de la cuenta, historial de cambios,
precio, forma de cobro, ni forma de bloquear a nadie.

---

## Fase 0 — cerrar el agujero ✅ HECHO

**Hoy un tendero puede ponerse `pro` él solo.** Esto no es una hipótesis sobre
el futuro: es el estado actual de producción.

```sql
grant select, insert, update, delete on public.owners to authenticated;

create policy "owners update own row" on public.owners
  for update using (id = auth.uid());
```

`UPDATE` sobre la tabla entera, sin lista de columnas. La política solo exige
que la fila sea suya; no tiene `WITH CHECK` ni distingue qué campo se toca. No
hay trigger que proteja `plan`. La clave `anon` viaja en el navegador por
diseño y el token de sesión está en las cookies del dueño, así que un `PATCH`
a `/rest/v1/owners?id=eq.<el suyo>` con `{"plan":"pro"}` pasa.

Hoy el premio es pequeño —fotos ilimitadas— y nadie lo ha hecho. Pero **todo
lo que se construya encima de esa columna es decorativo mientras siga abierta**:
bloqueas una cuenta y se desbloquea sola.

**HECHO el 2026-09-15**, migración `055_plan_solo_lo_cambia_sevenz`, corrida en
dev y en producción. Un trigger `BEFORE UPDATE` en `owners`:

```sql
create or replace function public.owners_bloquea_cambio_de_plan()
returns trigger
language plpgsql
-- SECURITY INVOKER a propósito. Ver abajo.
set search_path = public
as $$
begin
  if new.plan is distinct from old.plan
     and current_user in ('authenticated', 'anon') then
    raise exception
      'El plan de una cuenta solo lo cambia Sevenz, no la sesión del dueño.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;
```

**El primer borrador de este archivo lo escribió `security definer`, y así no
habría funcionado.** Dentro de una función SECURITY DEFINER, `current_user`
pasa a ser el dueño de la función —postgres—, no quien la llamó: la condición
sería siempre falsa y el trigger dejaría pasar todo **aparentando estar
puesto**, que es la peor forma de fallar. Va SECURITY INVOKER, el valor por
defecto, y eso es lo que lo hace funcionar.

**Comprobado, no deducido.** En dev se demostró primero el agujero —la sesión
de un dueño puso su propia cuenta en `pro`— y después que el mismo `UPDATE`
se rechaza con `42501`. En producción se comprobó lo mismo sobre Negocio Demo,
más que `service_role` sí puede y que "Mi negocio" no se rompió. Todo dentro
de transacciones con `rollback`: ningún negocio real cambió de plan.

**Trigger y no una política con `WITH CHECK`**, porque una política no puede
comparar el valor viejo con el nuevo en un `UPDATE` — `WITH CHECK` solo ve la
fila resultante, así que "no dejes que cambie esta columna" no se puede
expresar ahí. Tampoco basta revocar el `UPDATE` de la tabla: el dueño necesita
poder editar su nombre, su WhatsApp y su logo.

Se considera y se descarta mover las columnas de facturación a su propia tabla
sin `grant` para `authenticated` — es más limpio, y es exactamente lo que hace
la Fase 1. El trigger es el parche que se puede desplegar **hoy**, antes de la
tabla nueva, y se queda después como segunda cerradura.

---

## El modelo de datos

Tres tablas. El motivo de que sean tres y no una columna más:

### 1. `plans` — el catálogo

Los planes son **datos, no código**. Pediste "planes futuros que hoy no
existen": con un `check (plan in ('free','pro'))` cada plan nuevo es una
migración, un despliegue y un riesgo. Con una tabla, es una fila.

```
code            text primary key      -- 'pro' hoy; 'pro_anual', 'basico'… mañana
nombre          text                  -- "Pro", lo que ve el tendero
activo          boolean               -- false = no se puede contratar, los que ya lo tienen siguen
precio_usd      numeric               -- referencia, no se cobra desde aquí
limites         jsonb                 -- { "fotos_al_mes": 5, "clientes": null }
orden           int                   -- para pintarlos en orden
```

`limites` como `jsonb` y no como columnas: cada límite nuevo sería otra
migración. Empieza con la única llave que hoy significa algo,
`fotos_al_mes`, y se lee con un valor por defecto para que una llave que
falte no tumbe nada.

### 2. `subscriptions` — el estado de cada negocio

Una fila por dueño. **Separa QUÉ plan tiene de EN QUÉ estado está**, que es lo
que `owners.plan` confunde hoy: una cuenta `pro` bloqueada y una `free` activa
no son lo mismo, y con una sola columna no se distinguen.

```
owner_id            uuid primary key references owners(id)
plan_code           text references plans(code)
estado              text  -- 'demo' | 'activa' | 'por_vencer' | 'bloqueada' | 'cancelada'
demo_termina_el     timestamptz   -- null si no es demo
periodo_termina_el  timestamptz   -- hasta cuándo está pagada
limites             jsonb         -- COPIA de plans.limites al contratar. Ver abajo.
precio_pactado_usd  numeric       -- lo que ESTE negocio paga, no el de catálogo
notas               text          -- "3 meses, negociado con el primo de X"
proveedor           text          -- null hoy; 'stripe' | 'dlocal' mañana
proveedor_cliente_id    text      -- null hoy
proveedor_suscripcion_id text     -- null hoy
```

**`limites` y `precio_pactado_usd` se COPIAN, no se leen del catálogo.** Es la
práctica estándar (*grandfathering*) y evita el peor escenario nº 6: el día que
subas el precio de Pro o bajes el límite de fotos, quien ya pagaba no debe
verse afectado a mitad de periodo. Si la suscripción leyera el catálogo vivo,
cambiar una fila le cambiaría las condiciones a todo el mundo a la vez,
retroactivamente.

**Los tres campos `proveedor*` nacen vacíos y sin usar.** Es la respuesta a
"a mano ahora, pasarela después": el hueco está hecho, así que integrar Stripe
o dLocal no obliga a migrar filas vivas. Cuestan tres columnas nulas.

### 3. `subscription_events` — el historial, sin excepción

```
id, owner_id, ocurrido_el, actor_email, desde_estado, hasta_estado,
desde_plan, hasta_plan, motivo text, metodo_pago text, monto_usd numeric
```

**Esto no es opcional en un sistema que cobra.** El día que un tendero diga
"yo pagué y me bloqueaste", la respuesta no puede ser tu memoria. Y cuando
entre la pasarela, este historial es lo que permite cuadrar lo que dice el
proveedor con lo que dice Sevenz.

Se escribe **siempre desde la función que hace el cambio**, nunca a mano por
quien llama — si depende de acordarse, un día no se acuerda.

---

## El punto de control: dónde se bloquea de verdad

Decidido: una cuenta bloqueada **ve su cartera pero no registra nada**.

La tentación es poner el `if` en los formularios. **Sería un error**, y la app
ya tiene la prueba: el plazo de pago tenía su regla escrita en el servidor y
en la base de datos, se cambió una y no la otra, y el resultado fue un error
crudo de Postgres en la cara del tendero (migración 054, de ayer).

Hay muchos caminos de escritura —`addMovement`, `confirmImport`, crear
cliente, editar cliente, la importación por fotos— y cada camino nuevo es una
oportunidad de olvidarse.

**El bloqueo va en la base de datos, en las políticas de `INSERT`:**

```sql
create or replace function public.owner_puede_escribir(p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select estado <> 'bloqueada' from public.subscriptions where owner_id = p_owner),
    true)   -- sin fila de suscripción = cuenta vieja = puede escribir
$$;
```

y se añade `and public.owner_puede_escribir(auth.uid())` a las políticas de
`INSERT` de `movements` y `clients`.

Tres propiedades que importan:

- **No se puede olvidar.** Un camino de escritura nuevo hereda el bloqueo sin
  que nadie se acuerde de nada.
- **`coalesce(..., true)`** — sin fila, se escribe. Los 23 negocios de hoy no
  tienen suscripción, y el día del despliegue ninguno puede quedarse fuera por
  un dato que aún no existe.
- **Solo bloquea `INSERT`.** `SELECT` sigue intacto, que es justo lo que pediste:
  su cartera es suya y la ve.

Encima de eso, la app **explica**: el formulario dice por qué no puede guardar,
en vez de dejar salir un error de base de datos. La base es la cerradura; la app
es el cartel.

**El enlace del cliente NO se toca nunca.** Bloquear a un tendero que no paga es
razonable; dejar a su cliente sin poder consultar lo que debe es castigar a
quien no tiene nada que ver. `get_shared_balance` es `SECURITY DEFINER` y no
pasa por estas políticas, así que esto sale gratis — pero hay que escribirlo
para que nadie lo "arregle" después.

---

## Las pantallas de /admin

Una pestaña nueva, **Cuentas**, junto a Métricas:

1. **Tabla de negocios** — nombre, país, plan, estado, cuándo vence, días
   restantes, último pago. Filtrable por estado.
2. **Ficha de un negocio** — con las acciones:
   - *Dar demo* → elegir días (30 / 60 / 90 / **otro**, como el plazo de pago
     del formulario, y por el mismo motivo: la negociación real no cabe en
     cuatro botones)
   - *Cambiar de plan*
   - *Registrar pago* → monto, método, hasta qué fecha extiende
   - *Bloquear* / *Desbloquear* → **pide un motivo**, y el motivo va al historial
   - *Historial* → todo lo que le ha pasado a esa cuenta
3. **Demos por vencer** — los que vencen en los próximos 14 días y **los que ya
   vencieron y siguen andando**. Esa segunda lista es la que evita regalar
   meses sin enterarse.

Toda acción pasa por `requireSuperadmin()` y por una función `SECURITY DEFINER`,
nunca por un `UPDATE` directo desde el navegador.

---

## El aviso por correo, y sus dos obstáculos

Pediste que al acercarse el fin de una demo se avise al dueño y a
`sevenz.mvp@gmail.com`. Dos cosas lo bloquean hoy:

**1. No existe forma de mandar correos.** Nada en el repo: ni Resend, ni
SendGrid, ni SMTP. Supabase manda los de autenticación y punto; su API no sirve
para mandar un correo cualquiera. Hace falta un proveedor nuevo → **pasa por
`new-api-risk-review` antes de elegirlo.** El correo del dueño ya está en
`owners.email`, copiado desde `auth.users` al registrarse, así que el dato no
falta.

**2. El único cron diario de Vercel ya está ocupado.** `vercel.json` tiene uno
—la tasa BCV a las 13:00— y el plan Hobby no da más.

Tres salidas, en orden de preferencia:

| Salida | Coste | Pega |
|---|---|---|
| Colgarlo del cron que ya existe | 0 | Los avisos salen a las 13:00, con la tasa. Ninguna pega real |
| `pg_cron` dentro de Supabase | 0 | No toca el límite de Vercel, pero mandar correo desde Postgres necesita `pg_net` + una edge function |
| Vercel Pro | ~20 USD/mes | Resuelve esto y de paso [[sevenz-rate-refresh-followup]] |

**La recomendación es la primera.** La ruta ya corre todos los días; añadirle
una función más no cuesta nada ni añade infraestructura.

**Y el correo nunca es la única vía.** Un correo puede caer en spam o estar mal
escrito. El dueño también tiene WhatsApp en `owners.whatsapp`, y el aviso a
`sevenz.mvp@gmail.com` existe justamente para que tú te enteres aunque él no.

---

## Fases

| Fase | Qué | Se puede desplegar sola |
|---|---|---|
| **0** | El trigger que protege `plan` | ✅ **Hecho** — migración 055, en dev y producción |
| **1** | Las tres tablas + migrar los 23 negocios actuales | Sí. Nada las lee todavía |
| **2** | `/admin → Cuentas`: ver y cambiar a mano | Sí. Ya sirve para trabajar |
| **3** | El bloqueo real en las políticas + los mensajes en la app | Sí |
| **4** | Correos de aviso colgados del cron | Necesita elegir proveedor |
| **5** | Pasarela de pago | Muy después. Los huecos ya están hechos |

La 1 y la 2 juntas ya te resuelven lo que pediste: dar demos de la duración que
negocies, cambiar planes y ver quién vence. La 3 añade el bloqueo.

---

## Peores escenarios

| # | Qué puede salir mal | Qué lo evita |
|---|---|---|
| 1 | ~~**El tendero se pone `pro` él solo**~~ — cerrado por la 055 | Fase 0, el trigger. Y en la Fase 1 las columnas de facturación se van a otra tabla sin `grant` para `authenticated` |
| 2 | **Bloqueas a alguien que sí pagó.** La conversación más cara que existe | El historial dice quién, cuándo y por qué. Desbloquear es un clic. *Registrar pago* antes que *bloquear* en la ficha, para que el orden de los botones empuje al orden correcto |
| 3 | **Se te olvida mirar la lista y regalas meses.** El riesgo que aceptaste al elegir que las demos no bajen solas | La lista separa "por vencer" de "ya vencidas y andando", el correo a `sevenz.mvp@gmail.com` llega aunque no entres, y /admin lleva el contador a la vista |
| 4 | **Bloqueas al tendero y dejas tirado a su cliente** | El enlace del cliente no pasa por estas políticas. Escrito arriba para que nadie lo "arregle" |
| 5 | **El aviso no llega** — spam, correo mal escrito, buzón lleno | Nunca bloquear apoyándose solo en "se le avisó". WhatsApp como segunda vía. El historial guarda si el correo salió, no si se leyó |
| 6 | **Subes el precio de Pro y se lo cambias a quien ya pagaba** | `limites` y `precio_pactado_usd` se copian en la suscripción al contratar. El catálogo es una plantilla, no la verdad de cada cuenta |
| 7 | **Llega la pasarela y hay dos fuentes de la verdad** | Se decide ANTES quién manda en cada campo. Propuesta: la pasarela manda en `periodo_termina_el` cuando `proveedor` no es null; el panel sigue mandando en `estado` |
| 8 | **La demo vence a medianoche UTC y el tendero pierde el día** | Todo lo que sea fecha se evalúa en **America/Caracas**. Ya nos mordió con la tasa BCV: Vercel corre en UTC y el día cambia a las 8 de la noche de Caracas |
| 9 | **El bloqueo salta a mitad de un registro con un error crudo** | El mensaje lo pone la app antes de intentar guardar. La base rechaza, pero el tendero no debe ver nunca el texto de Postgres — pasó ayer con el plazo |
| 10 | **Alguien del equipo cambia un plan por error** | Motivo obligatorio para bloquear, historial de todo, y `requireSuperadmin()` en cada acción |
| 11 | **Una cuenta bloqueada sigue escribiendo por un camino que nadie revisó** | Por eso el control está en las políticas de la base y no en los formularios |
| 12 | **Los 23 negocios de hoy se quedan fuera el día del despliegue** | `coalesce(..., true)`: sin fila de suscripción, se escribe. La migración les crea su fila, pero el código no depende de que exista |
| 13 | **Un registro nuevo cae en `free` sin que nadie lo decida.** Es lo que pasa HOY: `plan` tiene `default 'free'` desde la 015, y free ahora es un regalo, no un suelo | La Fase 1 cambia el alta: quien se registra abre una demo con fecha de fin. Free solo se llega por decisión tuya |
| 15 | **Un dueño sube 500 fotos y deja el importador caído para los otros 22.** La cola compartida crece más que `maxDuration` y las peticiones de todos caducan | Tope por dueño y hora, más la guarda de cola profunda que rechaza al instante en vez de esperar a caducar |
| 16 | **Gemini pasa a ser de pago y te enteras por la factura** | El contador por negocio y su coste estimado en /admin, antes de que la factura llegue |
| 14 | **Negocias 15 USD con uno y 30 con otro, y alguien lo compara** | Nada técnico lo evita, pero el precio pactado vive en la suscripción y no en pantalla: el tendero nunca ve el precio de catálogo ni el de otro |

---

## Decisiones tomadas el 2026-09-15

**Tres planes, y el superadmin decide cuál tiene cada negocio.**

| | Qué es | Cuánto dura | Se revoca |
|---|---|---|---|
| **Demo** | Prueba del producto completo | X días, se negocia. 2 meses por defecto | Al vencer, tú decides |
| **Free** | Regalo deliberado a quien merece trato especial | Indefinido | En cualquier momento |
| **Pro** | Paga X cada X | Mensual, trimestral o anual | Al dejar de pagar |

La diferencia con lo que escribí antes: **`free` vuelve, pero como regalo, no
como suelo.** Nadie *cae* en free; se le *da*. Hoy es al revés — la columna
tiene `default 'free'` desde la 015, así que quien se registra aterriza en un
gratuito indefinido que nadie decidió.

**Por qué el plan y el estado siguen separados** aunque tú veas tres botones:
"bloqueada" no puede ser un plan. Un negocio Pro que deja de pagar se bloquea,
y hay que seguir sabiendo que era Pro y cuánto pagaba, para desbloquearlo sin
volver a negociar. Y un Free regalado también se puede revocar. Así que:

```
plan_code   'free' | 'pro'                              -- qué tiene
estado      'demo' | 'activa' | 'bloqueada' | 'cancelada'  -- cómo está
periodicidad 'mensual' | 'trimestral' | 'anual' | null   -- solo Pro
```

Los tres botones de /admin son combinaciones de eso: *Dar demo* pone
`estado='demo'` con fecha; *Regalar gratis* pone `plan_code='free'`,
`estado='activa'`, sin fecha; *Poner en Pro* pide periodicidad y precio.

**Precio: 20 USD de referencia, negociable entre 15 y 30.** Confirma el diseño:
`plans.precio_usd` es la plantilla y `subscriptions.precio_pactado_usd` es lo
que paga ESE negocio.

**Los datos se guardan indefinidamente.** Hecho: la política de privacidad ya
lo dice, con el motivo escrito.

---

## Las fotos: el límite de 5 al mes no protegía a Gemini

Tu temor —que alguien se tire la API de Gemini— es el correcto, pero **el
límite mensual nunca fue lo que lo evitaba**, y quitarlo no destapa nada.

**Lo que de verdad protege la API ya existe**, desde la migración 013:
`claim_rate_limit_slot` es un reloj compartido en Postgres. Cada foto, de
cualquier dueño y desde cualquier instancia del servidor, pide turno y espera
**4 segundos** desde la anterior. El techo es de unas 15 fotos por minuto para
toda la plataforma, haya 23 negocios o 2.300. Dos dueños importando a la vez no
suman: se ponen en fila.

O sea que la API está a salvo por diseño. Lo que el reloj compartido **no**
resuelve es otra cosa, y es lo que hay que cubrir:

**1. Que uno acapare la cola.** Un dueño subiendo 500 fotos mete 33 minutos de
espera a todos los demás. No rompe a Gemini; rompe a los otros 22 tenderos.

**2. Que la cola crezca más de lo que aguanta una petición.** Este es el fallo
agudo y el menos obvio. Cada petición se queda abierta esperando su turno, y
`maxDuration` son 90 segundos. Si la cola pasa de ahí, las peticiones empiezan
a caducar — y no solo las del que abusa: **las de todo el mundo**. Un dueño
subiendo fotos de más convierte el importador en un servicio caído para el
resto.

**3. El coste, cuando Gemini deje de ser gratis.** Hoy no cuesta dinero. El día
que cueste, la pregunta deja de ser "aguanta la API" y pasa a ser "cuánto llevo
gastado en este negocio".

### Las tres precauciones, en vez de un cupo mensual

**Por qué no un cupo mensual.** Es mala experiencia y mal control a la vez: el
tendero que digitaliza un año de libretas en una sentada lo agota el primer
día y se queda 30 días sin poder usar lo que paga; y quien quiera abusar
simplemente espera al día 1, cuando se reinicia.

| Precaución | Cómo | Reusa |
|---|---|---|
| **Tope por dueño y por hora** | `claim_rate_limit_quota` con clave `extract:<dueño>:<hora>`. Responde sí o no al instante, sin quedarse esperando | La 040, ya construida |
| **Guarda de cola profunda** | Si el turno que devuelve el reloj está más lejos de lo que la función puede esperar, se rechaza al momento con "inténtalo en unos minutos" en vez de quedarse abierta hasta caducar | La 013, ya construida |
| **Techo mensual blando** | No bloquea: **avisa en /admin**. Ves el abuso antes de que cueste dinero, y decides tú | Nada nuevo |

Las dos primeras son las que importan, y las dos se montan sobre funciones que
ya están en producción. La segunda es la que convierte un fallo en cascada
—todos los importadores caídos— en un mensaje claro para una sola persona.

**Cuando Gemini sea de pago**, se añade a /admin el contador de fotos por
negocio y su coste estimado. Eso no es una precaución técnica, es el dato que
te deja renegociar un precio con quien importa diez veces más que el resto.

---

## Los 23 negocios de hoy: uno por uno

Resuelto, y resuelto por el propio diseño. Son early adopters y no hay una
respuesta única: a algunos les quieres regalar el producto indefinidamente, a
otros cobrarles después de su demo, y a otros bloquearlos.

**Eso es exactamente lo que hacen los tres planes**, así que no hace falta
decidir nada el día de la migración. La Fase 1 les crea a todos su fila en el
estado en el que ya están —trabajando, sin límite— y la Fase 2 te da la
pantalla para ir cambiándolos de uno en uno cuando hables con cada uno.

La única regla que conviene fijar de antemano: **la migración no debe quitarle
acceso a nadie**. Nacen todos como están hoy; el cambio lo haces tú, con nombre
y apellido, y queda en el historial.

---

## Lo que NO entra en v1

Prorrateos, facturas, cupones, planes por equipo, cambios de plan a mitad de
periodo con ajuste de importe, y recordatorios automáticos de cobro. Todo eso
llega con la pasarela, si llega. Cobrar a mano con un panel decente resuelve
23 negocios y probablemente 200.
