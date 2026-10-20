import Image from "next/image";
import { ArrowUpRight, EyeOff, ImageOff, Percent } from "lucide-react";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { Fila, Grupo, NOMBRE_DE_MONEDA } from "@/components/dashboard/detail-rows";
import { CuotasTable } from "@/components/dashboard/cuotas-table";
import { ProductosDelMovimiento } from "@/components/dashboard/productos-del-movimiento";
import { TarjetaDeFiado, type FiadoAbierto } from "@/components/dashboard/tarjeta-de-fiado";
import { formatBs, formatDisplayCurrency, formatRateEquivalence } from "@/lib/exchange-rate/format";
import { formatDate, formatPlazoDias } from "@/lib/format";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { BolivarRates } from "@/lib/products/price";
import type { SaleLineRow } from "@/lib/sale-lines";
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
  balanceLabel = "Por cobrar",
  photoUrl,
  entryCurrency = null,
  entryAmount = null,
  exchangeRateUsed = null,
  ledger = null,
  fiadoAplicado = null,
  hrefDelFiado = null,
  rates = null,
  mostrarPendienteDelFiado = true,
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

  const tasa =
    currency && exchangeRateUsed != null ? formatRateEquivalence(currency, exchangeRateUsed) : null;

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
      }
    : { plazoDias, cuotas, desde: createdAt, importe: amount };

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
              <Percent className="size-4 text-money-in" aria-hidden />
            )}
          </span>
        </Fila>
        {monedaRegistrada ? (
          <Fila nombre="Moneda registrada">
            <span className="inline-flex items-center gap-1.5">
              {NOMBRE_DE_MONEDA[monedaRegistrada]}
              <CurrencyFlagIcon currency={monedaRegistrada} />
            </span>
          </Fila>
        ) : null}
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
            amount={amount}
            formatearMonto={(n) => formatLedgerAmount(n, currency, ledger).primary}
          />
        ) : null}

        <Fila nombre={type === "payment" ? "Abonó" : "Monto"}>
          <span className="tabular-nums">{monto}</span>
        </Fila>
        {tasa ? (
          <Fila nombre="Tasa del día">
            <span className="tabular-nums">{tasa}</span>
          </Fila>
        ) : null}
        {equivalente ? (
          <Fila nombre="Equivalencia">
            <span className="inline-flex flex-col items-end">
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                {equivalente.texto}
                <CurrencyFlagIcon currency={equivalente.moneda} />
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
            {currency ? <CurrencyFlagIcon currency={currency} className="size-6 shrink-0" /> : null}
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
