import Image from "next/image";
import { ArrowUpRight, EyeOff, ImageOff, Percent } from "lucide-react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { Fila, Grupo, NOMBRE_DE_MONEDA } from "@/components/dashboard/detail-rows";
import { CuotasTable } from "@/components/dashboard/cuotas-table";
import { ProductosDelMovimiento } from "@/components/dashboard/productos-del-movimiento";
import { TarjetaDeFiado, type FiadoAbierto } from "@/components/dashboard/tarjeta-de-fiado";
import { TarjetaDeAbono, type AbonoDirigido } from "@/components/dashboard/tarjeta-de-abono";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatDate, formatPlazoDias } from "@/lib/format";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { BolivarRates } from "@/lib/products/price";
import type { SaleLineRow } from "@/lib/sale-lines";
import { estadosDelFiado, type AbonoParaEstado } from "@/lib/estado-del-plazo";
import type { LedgerCurrency, MovementCurrencyCode, MovementType } from "@/lib/types";

// EL CUERPO DEL DETALLE DE UNA TRANSACCIÓN — frames `1465:18349` (abono) y
// `1463:18100` (fiado).
//
// ===========================================================================
// ERA UN DIÁLOGO Y AHORA ES UNA PANTALLA
//
// El dueño entregó los dos frames como pantallas completas —con su barra de
// volver y su «⋮»— y durante un día siguieron siendo un diálogo porque yo
// decidí por mi cuenta que el cambio de contenido se podía hacer sin mover el
// contenedor. Él lo reportó: *«¿por qué los detalles de las transacciones
// siguen siendo dialogs si te pasé pantallas?»*. Queda escrito porque el fallo
// no fue de maquetación: fue decidir solo algo que no me tocaba decidir.
//
// LO QUE EL CAMBIO COMPRA, además de parecerse al frame: una transacción pasa
// a tener dirección propia. Se puede recargar, volver a ella con el teléfono
// en la mano para enseñársela al cliente, o mandarla por un enlace — y desde
// la tarjeta «Abonó a» se puede navegar al fiado que pagó, que dentro de un
// diálogo obligaba a intercambiar su contenido.
//
// ===========================================================================
// UN SOLO CUERPO PARA LAS DOS SUPERFICIES
//
// Lo pintan la pantalla del dueño (`/transacciones/[id]`) y la del cliente
// (`/s/[token]/t/[id]`). Lo que cambia entre ellas no es el cuerpo: es qué
// datos llegan —el cliente no ve la nota del dueño ni los productos— y qué
// acciones hay arriba, que las pone cada página.
//
// ES UN COMPONENTE DE SERVIDOR, sin estado. Todo lo interactivo —el menú, la
// confirmación de borrado, el compartir— vive en la cabecera de cada página.
export type DatosDelDetalle = {
  type: MovementType;
  amount: number;
  // El libro al que pertenece (USD/EUR), o `null` en un negocio colombiano.
  currency: LedgerCurrency | null;
  description: string | null;
  // La nota interna. La pantalla del cliente NO la pasa — ni podría:
  // `get_shared_balance` no la devuelve.
  ownerNote?: string | null;
  plazoDias: number | null;
  cuotas: number | null;
  productos?: SaleLineRow[];
  createdAt: string;
  runningBalance: number;
  balanceLabel?: string;
  // `undefined` quita la fila entera; `null` dibuja el hueco de «sin foto».
  photoUrl?: string | null;
  entryCurrency?: MovementCurrencyCode | null;
  entryAmount?: number | null;
  exchangeRateUsed?: number | null;
  ledger?: LedgerDisplay | null;
  // El fiado al que fue este abono, si fue a uno. Ver `TarjetaDeFiado`.
  fiadoAplicado?: FiadoAbierto | null;
  // A dónde lleva esa tarjeta. Cada superficie tiene su ruta.
  hrefDelFiado?: string | null;
  rates?: BolivarRates | null;
  // Ver `mostrarPendiente` en `TarjetaDeFiado`.
  mostrarPendienteDelFiado?: boolean;
  // EL ABONO PARCIAL QUE SE HIZO AL REGISTRAR EL FIADO, que es lo que el
  // frame llama «Abonó» en un cargo. Respuesta del dueño el 2026-10-20,
  // preguntado: *«Abonó corresponde al abono parcial que hizo al registrar el
  // fiado, sino hizo abono (= 0) al realizar el fiado entonces el valor de ese
  // campo será = 0 y se mostrará en 0»*.
  //
  // CERO SE DIBUJA, no se esconde: esa fue la instrucción literal. Una fila
  // ausente y una fila en cero contestan cosas distintas — la primera deja al
  // tendero sin saber si se abonó algo y no se guardó.
  //
  // Sale de `sale_payments` de la venta que originó el cargo: la migración
  // `124` escribe el movimiento por LO QUE QUEDA, nunca por el total, así que
  // lo pagado en el momento no está en `movements` y hay que ir a buscarlo.
  abonoInicial?: number | null;
  // LOS ABONOS DIRIGIDOS A ESTE FIADO, el reflejo de `fiadoAplicado`. Encargo
  // del dueño el 2026-10-20: *«Detalle de los fiados también deben mostrar la
  // lista de lo que se ha abonado (mismo patrón como abono muestra los
  // fiados)»*.
  //
  // CADA UNO TRAE SU `href` YA RESUELTO y no se pasa una función que lo
  // construya: este es un componente de cliente, y una función no cruza desde
  // un componente de servidor. Es la misma razón por la que `hrefDelFiado` es
  // una cadena y no un callback.
  //
  // Vacío NO es lo mismo que ausente: una lista vacía dibuja «Todavía sin
  // abonos», que es una respuesta; `undefined` es para una superficie que no
  // puede contestar la pregunta y entonces no la plantea.
  abonosRecibidos?: AbonoDirigido[];
};

export function DetalleDeTransaccion({
  type,
  amount,
  currency = null,
  description,
  ownerNote = null,
  plazoDias,
  cuotas,
  productos = [],
  createdAt,
  runningBalance,
  balanceLabel = "Total por cobrar",
  photoUrl,
  entryCurrency = null,
  entryAmount = null,
  exchangeRateUsed = null,
  ledger = null,
  fiadoAplicado = null,
  hrefDelFiado = null,
  rates = null,
  mostrarPendienteDelFiado = true,
  abonoInicial = null,
  abonosRecibidos,
}: DatosDelDetalle) {
  const ledgerAmount = formatLedgerAmount(amount, currency, ledger);
  const balance = formatLedgerAmount(runningBalance, currency, ledger);

  // En qué moneda se escribió este movimiento. Solo tiene sentido en un negocio
  // que lleva divisas; en uno colombiano hay una sola moneda y decirlo sería
  // responder una pregunta que nadie se hace.
  const monedaRegistrada: MovementCurrencyCode | null = currency ? (entryCurrency ?? currency) : null;

  // LO QUE SE TECLEÓ, no lo que se guardó. Son la misma cifra salvo cuando se
  // escribió en bolívares, y ahí la diferencia importa: un fiado tecleado como
  // Bs. 900 se guarda como $1,08, y $1,08 valen 899,09 porque los céntimos no
  // dan para más. Esos 91 céntimos son redondeo, pero sin ver el 900 al lado
  // parecen un error de la app.
  const monto =
    monedaRegistrada === "VES" && entryAmount != null ? formatBs(entryAmount) : ledgerAmount.primary;

  // LA BANDERA QUE ACOMPAÑA A ESA CIFRA, pedida por el dueño el 2026-10-20:
  // *«El valor del campo "Abonó" le falta la bandera»*. Importa más desde que
  // se fue la fila «Moneda registrada», que era la otra forma de saberlo.
  //
  // SE CALCULA CON LA MISMA CONDICIÓN QUE `monto` Y NO CON `monedaRegistrada`,
  // que es lo que parece a primera vista y falla en un caso real: un
  // movimiento tecleado en bolívares ANTES de que existiera `entry_amount`
  // tiene `monedaRegistrada === "VES"` y `entryAmount === null`, así que la
  // cifra que se enseña es la del libro —dólares— y una bandera de Venezuela
  // al lado estaría nombrando una moneda que no es la del número.
  //
  // `null` en un negocio colombiano, y entonces no se dibuja ninguna, igual
  // que en el resto de la app.
  const monedaDelMonto: MovementCurrencyCode | null =
    monedaRegistrada === "VES" && entryAmount != null ? "VES" : currency;

  // AQUÍ VIVÍA `seEnseñaAbonoEnCero`, con el comentario largo que explicaba
  // cuándo se enseñaba «Equivalencia» y por qué un fiado sin abonos no la
  // llevaba. Las dos cosas se fueron el 2026-10-21 con esa fila: ver el
  // comentario del hueco que dejó, más abajo, junto a «Abonos».

  // EL ACUERDO: de un fiado, el suyo; de un abono dirigido, el del fiado que
  // pagó. Un abono nunca tuvo plazo propio —son columnas del cargo y la
  // restricción de la base las rechaza en otra cosa— así que esto rellena tres
  // filas que en un abono salían vacías. Y la tabla de cuotas se cuenta desde
  // la fecha del FIADO: los vencimientos se pactaron el día de la compra.
  const acuerdo = fiadoAplicado
    ? {
        plazoDias: fiadoAplicado.plazoDias,
        cuotas: fiadoAplicado.cuotas,
        desde: fiadoAplicado.fecha,
        importe: fiadoAplicado.amount,
        // DESDE UN ABONO NO SE SABE LO QUE SE LLEVA ABONADO AL FIADO, y por
        // eso van en cero: esta pantalla trae el fiado para heredar su
        // acuerdo, no su reparto. La tabla dibuja entonces todas las cuotas
        // como pendientes, que es lo único que puede afirmar desde aquí.
        abonoInicial: 0,
        abonos: [] as AbonoParaEstado[],
      }
    : {
        plazoDias,
        cuotas,
        desde: createdAt,
        importe: amount,
        abonoInicial: abonoInicial ?? 0,
        abonos: (abonosRecibidos ?? []).map((a) => ({ fecha: a.fecha, amount: a.amount })),
      };

  // ── EL CHIP DE CADA ABONO ────────────────────────────────────────────
  //
  // Mide el estado de LA CUOTA QUE ESE ABONO CUBRIÓ, no el del fiado entero.
  // Es la respuesta del dueño el 2026-10-20, preguntada antes de construirlo
  // porque había dos lecturas: *«El chip mide el estado de la cuota que
  // cubrió, si está en el plazo de la fecha de la cuota que se estableció en
  // la sección de cuotas»*.
  //
  // Sin cuotas pactadas no hay ninguna fecha intermedia contra la que juzgar,
  // así que cada abono se mide contra el plazo entero: eso es un fiado de una
  // sola cuota, que es lo que se le pasa.
  const estadoDeCadaAbono =
    type === "charge" && plazoDias != null && abonosRecibidos
      ? estadosDelFiado({
          createdAt,
          plazoDias,
          cuotas: cuotas ?? 1,
          amount,
          abonoInicial: abonoInicial ?? 0,
          abonos: abonosRecibidos.map((a) => ({ fecha: a.fecha, amount: a.amount })),
        }).abonos.slice(abonoInicial && abonoInicial > 0.005 ? 1 : 0)
      : [];

  const colorSaldo =
    runningBalance > 0 ? "text-destructive" : runningBalance < 0 ? "text-money-in" : "";

  return (
    <dl className="flex flex-col gap-4">
      <Grupo>
        <Fila nombre="Fecha">{formatDate(createdAt)}</Fila>
        <Fila nombre="Tipo">
          <span className="inline-flex items-center gap-1.5">
            {type === "charge" ? "Fiado / Crédito" : "Abono"}
            {/* EL «%» DEL ABONO Y LA FLECHA DEL FIADO, como los frames. El
                abono llevaba una flecha hacia abajo hasta el 2026-10-19, y era
                la misma familia que la del fiado: dos flechas opuestas se
                distinguen mirándolas, no de un vistazo. Es el mismo par que ya
                usa la hoja de «Registrar». */}
            {type === "charge" ? (
              <ArrowUpRight className="size-4 text-destructive" aria-hidden />
            ) : (
              // AZUL Y NO VERDE, por instrucción del dueño el 2026-10-20.
              //
              // THE ABONO IS GREEN AGAIN since 2026-10-21, by the owner's
              // decision, and this icon follows the rest of the app. It was
              // blue for three days, between his 2026-10-18 decision and this
              // one; before that it was the old `text-money-in` green.
              //
              // `emerald-700` AND NOT THE `emerald-600` IT USED TO BE: that
              // one measured 3,65:1 against white, under the 4,5:1 floor in
              // `DESIGN-SYSTEM.md`. Restoring the previous green literally
              // would bring back a contrast defect that had always been
              // there. The 700 gives 5,36:1.
              <Percent className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
            )}
          </span>
        </Fila>
        {/* AQUÍ ESTUVO «Moneda registrada», retirada el 2026-10-20 a petición
            del dueño: *«Campo moneda registrada no va, eliminalo»*.

            POR QUÉ ESTABA, para quien se plantee devolverla: decía en qué
            moneda se tecleó el movimiento, que en un negocio venezolano puede
            no ser la del libro —se escribe en bolívares y se guarda en
            dólares—. Esa pregunta la siguen contestando las dos filas que
            quedan dentro del resumen: «Tasa del día» y «Equivalencia», que
            solo aparecen cuando hubo conversión, y ahora también la bandera
            pegada al monto. O sea que no se pierde el dato, se deja de decir
            dos veces.

            `monedaRegistrada` NO se borra: lo siguen usando `monto` y
            `equivalente` para decidir si enseñan bolívares o divisa. */}
      </Grupo>

      {/* LA TARJETA DEL RESUMEN. El frame la dibuja con su marco y su título:
          «Resumen de abono» cuando es un pago, «Resumen de compra en X» cuando
          es un fiado. */}
      <div className="flex flex-col gap-1.5 rounded-[10px] border p-2.5">
        <p className="py-2 text-sm leading-5">
          {type === "payment"
            ? "Resumen de abono"
            : `Resumen de compra${currency ? ` en ${NOMBRE_DE_MONEDA[currency]}` : ""}`}
        </p>

        {/* A QUÉ FIADO FUE ESTE ABONO. Pedido del dueño el 2026-10-19: *«dentro
            del resumen del abono se debe mostrar el card del fiado al que se le
            abonó, al seleccionar el card se debe abrir el detalle de ese
            fiado»*. Es la MISMA tarjeta de la pantalla 1/3. */}
        {type === "payment" ? (
          fiadoAplicado && hrefDelFiado ? (
            <TarjetaDeFiado
              fiado={fiadoAplicado}
              rates={rates}
              href={hrefDelFiado}
              mostrarPendiente={mostrarPendienteDelFiado}
            />
          ) : (
            // LOS CIENTOS QUE YA EXISTÍAN. Decisión del dueño el 2026-10-19: no
            // se deja en blanco, se dice qué pasó. La cola FIFO los repartió
            // sobre el saldo total y no hubo decisión del tendero que enseñar.
            <Fila nombre="Abonó a">Repartidos al saldo total</Fila>
          )
        ) : null}

        {productos.length > 0 ? (
          <ProductosDelMovimiento
            productos={productos}
            formatearMonto={(n) => formatLedgerAmount(n, currency, ledger).primary}
          />
        ) : null}

        {/* «Abonó» — UNA SOLA SECCIÓN, CON TARJETAS O CON CIFRA.
            Frames `1463:18100` (nodo `1463:18127`), `1465:18349` (nodo
            `1465:18372`) y `1479:9456` (nodo `1479:9479`).

            LOS TRES FRAMES TIENEN UN SOLO «Abonó», y eso es lo que decide la
            forma de este bloque. Estuvo dos veces --el rótulo de la lista y la
            fila del importe-- y se leía como un error de la app.

              · ABONO: la cifra es lo que se pagó, el monto del movimiento.
              · FIADO CON ABONOS DIRIGIDOS: las tarjetas, sin cifra. El frame
                `1479:9456` deja el rótulo solo y pone las tarjetas debajo.
              · FIADO SIN ABONOS DIRIGIDOS: la cifra del abono parcial que se
                hizo AL REGISTRARLO, y CERO SE DIBUJA -- instrucción del dueño
                el 2026-10-20: *«será = 0 y se mostrará en 0»*. El frame
                `1463:18100` enseña ahí un importe, no un texto.

            NO HAY FILA «Monto» EN NINGÚN FRAME: el importe del fiado no se
            repite, porque lo que queda vivo es «Total por cobrar». */}
        {/* «Abonos» EN TODO FIADO, tenga abonos dirigidos o no. Hasta el
            2026-10-21 esta sección solo salía si había alguno y, si no, caía
            en la fila «Abonó» de abajo. Ahora el frame `1510:9784` pone
            SIEMPRE una primera tarjeta —la de lo que se entregó al comprar— y
            esa tarjeta existe aunque valga cero: instrucción del dueño, *«si
            el abono fue 0 entonces tanto el valor de la moneda como la tasa
            serán 0»*.

            Un cero DIBUJADO y una sección ausente no dicen lo mismo: la
            primera contesta «no entregó nada al comprar» y la segunda deja al
            tendero sin saber si se abonó algo que no se guardó. Es la misma
            razón por la que la fila «Abonó» dibujaba su cero, y por eso esa
            fila se queda sin trabajo y desaparece. */}
        {type === "charge" ? (
          <div className="flex flex-col gap-2 border-t pt-2">
            {/* «Abonos», EN PLURAL Y EN 14 REGULAR — frame `1489:10209`, nodo
                `1489:10230`. Decía «Abonó» hasta el 2026-10-20, que es el
                rótulo de la FILA de un fiado sin abonos dirigidos: la de
                arriba, con una sola cifra. Son dos cosas distintas y el frame
                las llama distinto. */}
            <dt className="py-1 text-sm leading-5">Abonos</dt>
            <dd className="flex flex-col gap-2">
              {/* LA PRIMERA ES LA DE LA COMPRA, y va siempre. Su «movimiento»
                  no existe —ese pago vive en `sale_payments`, por la `124`—
                  así que lleva el id del propio fiado como clave y no ofrece
                  menú: no hay nada suyo que editar ni borrar.

                  SU TASA ES LA DEL FIADO (`exchangeRateUsed`), que es la que
                  se selló ese día. Con cero abonado los bolívares salen cero,
                  que es lo que el dueño pidió literalmente. */}
              <TarjetaDeAbono
                inicial
                abono={{
                  // CLAVE SINTÉTICA: este pago no tiene fila en `movements`,
                  // así que no tiene id. Solo la usa `AbonoAcciones`, que
                  // aquí no se dibuja.
                  movementId: "abono-inicial",
                  fecha: createdAt,
                  currency,
                  amount: abonoInicial ?? 0,
                  descripcion: null,
                  tasaSellada: (abonoInicial ?? 0) > 0.005 ? exchangeRateUsed : 0,
                }}
                // LO QUE QUEDÓ TRAS EL PAGO DE LA COMPRA, que es `amount` tal
                // cual: la migración `124` escribe el movimiento por lo que
                // queda, así que ese importe YA es «el fiado menos lo que
                // entregó». Añadido el 2026-10-21 a petición del dueño, para
                // que la primera tarjeta lleve el mismo rótulo que las otras.
                //
                // Con cero abonado dice lo mismo que el fiado entero, y es
                // correcto: no entregó nada, así que quedó debiendo todo.
                pendienteTras={amount ?? 0}
              />
              {/* ── LO QUE QUEDABA TRAS CADA ABONO, EN ORDEN ────────────
                  La lista llega del más NUEVO al más viejo, así que se recorre
                  al revés para ir restando: se parte del importe del fiado
                  menos lo que se entregó al comprar, y cada abono —de los
                  antiguos hacia los recientes— descuenta lo suyo.

                  SE CALCULA AQUÍ Y NO EN LA TARJETA porque cada tarjeta sola
                  no puede saberlo: necesita los abonos ANTERIORES a ella. */}
              {(() => {
                const porAbono = new Map<string, number>();
                // SE PARTE DE `amount` TAL CUAL, sin restarle el abono de la
                // compra. Ese pago YA está descontado: la migración `124`
                // escribe el movimiento por LO QUE QUEDA de la venta, no por
                // su total. Restarlo otra vez lo contaba dos veces.
                //
                // SE VIO PORQUE LA ÚLTIMA TARJETA NO CUADRABA CON «Total por
                // cobrar», que es la comprobación que esta cifra trae de
                // serie: en el fiado del Casco salía «Debe $22.09» sobre un
                // total de $23.23 — exactamente el $1.14 de la compra, restado
                // de más. Dos cifras de la misma pantalla que no cerraban, que
                // es justo el fallo que el dueño reportó hoy en otro sitio.
                let queda = amount ?? 0;
                for (const a of [...(abonosRecibidos ?? [])].reverse()) {
                  queda = Math.round((queda - a.amount) * 100) / 100;
                  porAbono.set(a.movementId, queda);
                }
                return (abonosRecibidos ?? []).map((a, i) => (
                  <TarjetaDeAbono
                    key={a.movementId}
                    abono={a}
                    estado={estadoDeCadaAbono[i]}
                    pendienteTras={porAbono.get(a.movementId) ?? null}
                  />
                ));
              })()}
            </dd>
          </div>
        ) : (
          /* EN UN ABONO la fila sigue siendo una cifra suelta: lo que se
             entregó. Las tarjetas son cosa de un fiado, que es el que tiene
             pagos que listar. */
          <Fila nombre="Abonó">
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              {monto}
              {monedaDelMonto ? (
                <CurrencyFlagIcon currency={monedaDelMonto} className="size-4" />
              ) : null}
            </span>
          </Fila>
        )}

        {/* AQUÍ ESTUVO «Equivalencia», retirada el 2026-10-21 por instrucción
            del dueño: *«el campo equivalencia se elimina»*, en el mismo encargo
            que añade la tarjeta del abono inicial (frame `1510:9784`).

            LAS DOS COSAS VAN JUNTAS Y POR ESO SE HACEN A LA VEZ. Esa fila
            decía los bolívares del fiado entero a la tasa sellada, pegada
            debajo de «Abonó» — y ya se había reducido el 2026-10-20 por leerse
            como la otra cara de ESA cifra. Lo que el dueño quería saber de
            verdad —cuántos bolívares entregó al comprar— no estaba en ninguna
            parte: ahora lo dice la primera tarjeta de «Abonos», con su propia
            tasa y su propio rótulo.

            SE VA TAMBIÉN SU CÁLCULO, que no lo usaba nadie más. Lo escribí
            primero diciendo que lo seguía usando la tarjeta del fiado; el lint
            lo desmintió en el acto. Queda anotado porque es la clase de frase
            que nadie vuelve a comprobar. */}

        {/* «TOTAL POR COBRAR», DENTRO DE LA TARJETA Y EN GRANDE — el frame lo
            pone ahí, separado por una línea. No es un dato más del movimiento:
            es en qué queda la cuenta después de él, y es lo que casi todo el
            mundo abre esta pantalla para mirar. */}
        <div className="flex items-center justify-between gap-4 border-t pt-3">
          <span className="text-base font-semibold">{balanceLabel}</span>
          <span className="flex items-center gap-2">
            <span className="flex flex-col items-end">
              <span className={`text-base font-semibold tabular-nums ${colorSaldo}`}>
                {balance.primary}
              </span>
              {balance.secondary ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {balance.secondary} hoy
                </span>
              ) : null}
            </span>
            {currency ? <CurrencyFlagIcon currency={currency} className="size-4 shrink-0" /> : null}
          </span>
        </div>
      </div>

      <Grupo>
        <Fila nombre="Plazo de pago">{formatPlazoDias(acuerdo.plazoDias)}</Fila>
        {/* UN PAGO ÚNICO TAMBIÉN ES UNA CUOTA, Y TIENE FECHA. Reportado por
            el dueño el 2026-10-21: *«cuando la cuota es "Pago único" no se
            está mostrando en el detalle del fiado la fecha de la cuota, esta
            debe mostrarse en función del plazo del pago»*.

            La puerta pedía `cuotas != null`, y «Pago único» guarda NULL: la
            acción solo admite de 2 a 36, así que el 1 no llega nunca a la
            base. O sea que el caso más corriente —un fiado a 7 días sin
            repartir— era justo el que se quedaba sin decir qué día vence.

            `?? 1` Y NO UNA RAMA APARTE: la fórmula de `calcularCuotas` ya da
            la respuesta correcta para una sola —`plazoDias * 1 / 1` es el
            final del plazo— y es la MISMA expresión que usan la migración
            `118` para pintar «Plazo vencido» y la `120` para decidir el día
            del aviso por WhatsApp. Calcular esta fecha aparte sería la cuarta
            copia de algo que ya está escrito tres veces de acuerdo. */}
        {acuerdo.plazoDias != null ? (
          <CuotasTable
            createdAt={acuerdo.desde}
            plazoDias={acuerdo.plazoDias}
            cuotas={acuerdo.cuotas ?? 1}
            amount={acuerdo.importe}
            formatearMonto={(n) => formatLedgerAmount(n, currency, ledger).primary}
            // LO ABONADO A ESTE FIADO, para la columna «Estado». Son las dos
            // cosas que lo pagan: el abono del momento de la venta (la `129`)
            // y los dirigidos que vinieron después.
            //
            // EN UN ABONO SE PASAN LOS DEL FIADO QUE PAGÓ, no los suyos, por
            // lo mismo que el plazo y las cuotas salen de ahí: la tabla
            // describe el acuerdo de ese fiado, no el de este movimiento.
            abonoInicial={acuerdo.abonoInicial}
            abonos={acuerdo.abonos}
          />
        ) : null}
      </Grupo>

      <Grupo>
        <dt className="text-xs leading-5 text-muted-foreground">Descripción</dt>
        <dd className="text-sm break-words">{description || "—"}</dd>

        {/* La nota del dueño, y se dice en voz alta que el cliente no la ve.
            Sin esa frase el dueño no tiene forma de saberlo, y la duda le quita
            al campo justo lo que lo hace útil. */}
        {ownerNote ? (
          <>
            <dt className="pt-2 text-xs leading-5 text-muted-foreground">Nota</dt>
            <dd className="flex flex-col gap-0.5">
              <span className="text-sm break-words">{ownerNote}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <EyeOff className="size-3" aria-hidden />
                Solo tú ves esto
              </span>
            </dd>
          </>
        ) : null}

        {photoUrl !== undefined ? (
          <>
            <dt className="pt-2 text-xs leading-5 text-muted-foreground">Foto</dt>
            <dd>
              {photoUrl ? (
                <a href={photoUrl} target="_blank" rel="noopener noreferrer">
                  <Image
                    src={photoUrl}
                    alt="Foto de la transacción"
                    width={640}
                    height={360}
                    unoptimized
                    className="h-[137px] w-full rounded-xl border object-cover"
                  />
                </a>
              ) : (
                // El hueco dibujado en vez de una raya. Un «—» se lee como
                // «este dato no aplica»; el recuadro dice que aquí cabe una
                // foto y este movimiento no la tiene, que es lo que hace falta
                // saber cuando se busca el respaldo de un fiado.
                <div className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed bg-muted/40 text-muted-foreground">
                  <ImageOff className="size-5" aria-hidden />
                  <span className="text-xs">Sin foto adjunta</span>
                </div>
              )}
            </dd>
          </>
        ) : null}
      </Grupo>
    </dl>
  );
}
