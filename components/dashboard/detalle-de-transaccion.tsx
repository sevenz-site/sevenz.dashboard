import Image from "next/image";
import { ArrowUpRight, EyeOff, ImageOff, Percent } from "lucide-react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { Fila, Grupo, NOMBRE_DE_MONEDA } from "@/components/dashboard/detail-rows";
import { CuotasTable } from "@/components/dashboard/cuotas-table";
import { ProductosDelMovimiento } from "@/components/dashboard/productos-del-movimiento";
import { TarjetaDeFiado, type FiadoAbierto } from "@/components/dashboard/tarjeta-de-fiado";
import { TarjetaDeAbono, type AbonoDirigido } from "@/components/dashboard/tarjeta-de-abono";
import { formatBs, formatDisplayCurrency } from "@/lib/exchange-rate/format";
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
  abonosRecibidos?: (AbonoDirigido & { href: string })[];
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

  // LA OTRA CARA, con la tasa SELLADA en el movimiento — no con la de hoy. Las
  // tres filas de este grupo tienen que multiplicar entre sí; con la tasa del
  // día no cuadrarían y quien rehiciera la cuenta creería que la app se
  // equivocó. El valor de HOY vive abajo, en la tarjeta del saldo.
  const equivalente =
    currency && exchangeRateUsed != null
      ? monedaRegistrada === "VES"
        ? { texto: formatDisplayCurrency(amount, currency), moneda: currency as MovementCurrencyCode }
        : { texto: formatBs(amount * exchangeRateUsed), moneda: "VES" as MovementCurrencyCode }
      : null;

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
              // No es un color suelto: desde el 2026-10-18 el abono ES azul en
              // toda la app y el verde pasó a ser el de la venta de contado.
              // Este «%» se quedó en `text-money-in` al montar la pantalla, o
              // sea en el verde de antes, y era el único sitio donde un abono
              // seguía saliendo del color de otra cosa.
              //
              // `blue-600` y no `blue-500`: es el mismo par que ya usa la fila
              // del historial. Medido sobre ESTE icono el 2026-10-20 —no
              // copiado de otro comentario—: resuelve a `#155dfc` y da
              // **5,25:1** contra blanco, por encima del piso de 4,5:1 que
              // pide `DESIGN-SYSTEM.md`.
              <Percent className="size-4 text-blue-600 dark:text-blue-400" aria-hidden />
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
        {type === "charge" && abonosRecibidos && abonosRecibidos.length > 0 ? (
          <div className="flex flex-col gap-2 border-t pt-2">
            {/* «Abonos», EN PLURAL Y EN 14 REGULAR — frame `1489:10209`, nodo
                `1489:10230`. Decía «Abonó» hasta el 2026-10-20, que es el
                rótulo de la FILA de un fiado sin abonos dirigidos: la de
                arriba, con una sola cifra. Son dos cosas distintas y el frame
                las llama distinto. */}
            <dt className="py-1 text-sm leading-5">Abonos</dt>
            <dd className="flex flex-col gap-2">
              {abonosRecibidos.map((a, i) => (
                <TarjetaDeAbono
                  key={a.movementId}
                  abono={a}
                  href={a.href}
                  estado={estadoDeCadaAbono[i]}
                />
              ))}
            </dd>
          </div>
        ) : (
          <Fila nombre="Abonó">
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              {type === "payment"
                ? monto
                : formatLedgerAmount(abonoInicial ?? 0, currency, ledger).primary}
              {monedaDelMonto ? (
                <CurrencyFlagIcon currency={monedaDelMonto} className="size-4" />
              ) : null}
            </span>
          </Fila>
        )}

        {equivalente ? (
          <Fila nombre="Equivalencia">
            <span className="inline-flex flex-col items-end">
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                {equivalente.texto}
                <CurrencyFlagIcon currency={equivalente.moneda} className="size-4" />
              </span>
              <span className="text-xs text-muted-foreground">Al día de la transacción</span>
            </span>
          </Fila>
        ) : null}

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
        {acuerdo.cuotas != null && acuerdo.plazoDias != null ? (
          <CuotasTable
            createdAt={acuerdo.desde}
            plazoDias={acuerdo.plazoDias}
            cuotas={acuerdo.cuotas}
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
