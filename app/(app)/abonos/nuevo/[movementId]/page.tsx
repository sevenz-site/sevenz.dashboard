import Link from "next/link";
import { CodigoDeTransaccion } from "@/components/dashboard/codigo-de-transaccion";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { getOwnerRateContextResult } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import { Button } from "@/components/ui/button";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { CuotasTable } from "@/components/dashboard/cuotas-table";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatPlazoDias } from "@/lib/format";
import { Fecha } from "@/components/fecha";
import type { ReactNode } from "react";
import { formatCantidad } from "@/lib/products/cantidad";
import { formatPriceAmount, priceIn, type PriceCurrency } from "@/lib/products/price";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";

export const metadata = { title: "Detalle de transacción — Sevenz" };

// PASO 2/2 DEL ABONO REPARTIDO — frames `1457:16568` y `1536:11006`.
//
// Es el detalle del fiado que el tendero acaba de elegir, para que confirme que
// es ese antes de escribir el monto. Un abono mal dirigido no se nota: el saldo
// total del cliente queda igual, y lo que cambia es QUÉ fiado se considera
// saldado — o sea, su estado y su etiqueta de plazo. Por eso hay un paso de
// confirmación en medio y no se salta del listado al monto.
//
// ===========================================================================
// LA MISMA PÁGINA TIENE DOS CONTEXTOS, Y ESTE ES EL DEL FLUJO
//
// Suelta, abierta desde el historial, esta pantalla lleva el menú `more` con
// Compartir / Eliminar / Pagar y sus dos botones al pie. Dentro del flujo del
// abono lleva barra de progreso, NO lleva `more` —decisión del dueño el
// 2026-10-19: a mitad de registrar un pago, «eliminar transacción» no tiene
// sentido— y su único botón dice «Continuar».
//
// Hoy existe esta mitad. La suelta llega con el paso 3 del plan.
//
// ===========================================================================
// ERA 2/3 Y PASÓ A 2/2 EL 2026-10-22, y «Confirmar» pasó a «Continuar»
//
// Frame `1536:11006`. El flujo cambió de forma: ya no se elige UN fiado y se
// paga, sino que se escribe cuánto pagaron y se reparte. Esta pantalla dejó
// de ser el segundo de tres pasos hacia un pago para ser el segundo de dos
// hacia FIJAR lo que le toca a un fiado.
//
// Y «Continuar» en vez de «Confirmar» por lo mismo: lo que viene detrás ya no
// es el final. Con `?reparto=1` ni esta pantalla ni la del monto escriben
// nada; lo único que guarda en este flujo es «Pagar y finalizar».
//
// LA FILA «Moneda de pago» DEL FRAME NO SE DIBUJA, y es a conciencia: se
// retiró el 2026-10-19 por decisión del dueño —«es redundante, ya abajo
// especifica la moneda en la que abonó y la equivalencia»— y además estaba
// mal. Ver la nota larga más abajo, donde estaba.
export default async function ConfirmarFiadoPage({
  params,
  searchParams,
}: {
  params: Promise<{ movementId: string }>;
  // `?reparto=1` LO PONE EL BOTÓN «Pagar» DE 1/2. Cambia a dónde vuelve y a
  // dónde lleva, para que el monto sepa que no debe guardar.
  searchParams: Promise<{ reparto?: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { movementId } = await params;
  const { reparto } = await searchParams;
  const enReparto = reparto === "1";
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // EL MOVIMIENTO, Y LA PROPIEDAD COMPROBADA A TRAVÉS DEL CLIENTE. `movements`
  // no lleva `owner_id` —la RLS lo deriva por el cliente— así que el candado
  // explícito va donde ya lo pone `app/(app)/clients/[id]/actions.ts`.
  const { data: mov } = await supabase
    .from("movements")
    .select(
      "id, client_id, type, amount, currency, description, plazo_dias, cuotas, created_at, sale_id, photo_path, entry_currency, entry_amount, exchange_rate_used, transaction_code, clients!inner(id, name, owner_id)",
    )
    .eq("id", movementId)
    .is("deleted_at", null)
    .maybeSingle();

  const cliente = mov?.clients as unknown as { id: string; name: string; owner_id: string } | null;
  if (!mov || !cliente || cliente.owner_id !== user.id) notFound();

  // SOLO SE ABONA A UN CARGO. Un abono no tiene a qué abonar, y llegar aquí con
  // el id de uno solo puede ser una dirección escrita a mano.
  if (mov.type !== "charge") notFound();

  // ── LO QUE TODAVÍA DEBE, DE LA MISMA FUENTE QUE EL LISTADO ───────────
  //
  // No se recalcula aquí: se le pregunta a `get_open_charges_for_client`, la
  // misma función de la migración `126` que alimenta la pantalla 1/3. Dos
  // aritméticas para la misma cifra es como la pantalla acaba ofreciendo un
  // número con el que el resto de la app no está de acuerdo.
  const { data: abiertos } = await supabase.rpc("get_open_charges_for_client", {
    p_client_id: cliente.id,
  });
  const abierto = (abiertos ?? []).find(
    (c: { movement_id: string }) => c.movement_id === mov.id,
  ) as { pending: number } | undefined;

  // UN FIADO YA SALDADO NO SALE EN LA LISTA, así que llegar a su detalle por el
  // flujo del abono significa que se saldó entre que la lista se dibujó y el
  // tendero tocó. Devolverlo al listado es más honesto que enseñarle una
  // pantalla que le va a dejar escribir un monto que la acción rechazará.
  if (!abierto) redirect(`/abonos/nuevo?cliente=${cliente.id}`);

  const moneda = (mov.currency ?? "COP") as PriceCurrency;
  const pendiente = Number(abierto.pending);

  // ── LO QUE SE LLEVÓ, Y LO QUE YA PAGÓ EN SU MOMENTO ──────────────────
  const [{ data: lineas }, { data: pagos }] = await Promise.all([
    mov.sale_id
      ? supabase
          .from("sale_lines")
          .select("name, quantity, unit_price, currency")
          .eq("sale_id", mov.sale_id)
      : Promise.resolve({ data: [] as never[] }),
    mov.sale_id
      ? supabase
          .from("sale_payments")
          .select("currency, amount, entry_currency, entry_amount, rate_used")
          .eq("sale_id", mov.sale_id)
      : Promise.resolve({ data: [] as never[] }),
  ]);

  // El abono del día de la venta, en la moneda de ESTE libro. Una venta en dos
  // monedas tiene un pago por cada una; aquí solo interesa la que se está
  // mirando.
  const pagoDeEseDia = (pagos ?? []).find(
    (p: { currency: string }) => p.currency === moneda,
  ) as
    | { amount: number; entry_currency: string | null; entry_amount: number | null }
    | undefined;

  const resultado = await getOwnerRateContextResult(supabase, user.id);
  const rates = resultado.kind === "ve" ? await getBolivarRates(resultado.context.effectiveRate) : null;
  const pendienteEnBs =
    rates && mov.currency ? priceIn("VES", { amount: pendiente, currency: moneda }, rates)?.amount : null;

  const plazo = formatPlazoDias(mov.plazo_dias as number | null);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <ScreenBackRow
        href={`/abonos/nuevo?cliente=${cliente.id}`}
        label="Elegir otro fiado"
        soloEnTelefono={false}
      />

      <div className="flex flex-col gap-2">
        <ScreenTitle>Detalle de transacción</ScreenTitle>
        <CodigoDeTransaccion codigo={(mov.transaction_code as string | null) ?? null} />
        <p className="text-sm text-muted-foreground">2/2 Confirma transacción a abonar</p>
        <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-full rounded-full bg-foreground transition-all" />
        </div>
      </div>

      {/* ── LA CABECERA DE TRES FILAS ───────────────────────────────── */}
      <div className="flex flex-col">
        <Fila etiqueta="Fecha" valor={<Fecha iso={mov.created_at as string} />} />
        <Fila etiqueta="Tipo" valor="Fiado / Crédito" />
        {/* AQUÍ HABÍA UNA FILA «Moneda de pago» Y SE RETIRÓ EL 2026-10-19.
            Decisión del dueño: *«es redundante, ya abajo especifica la moneda
            en la que abonó y la equivalencia»*.

            Y ADEMÁS ESTABA MAL, que es la razón de dejar esto escrito y no
            borrarlo en silencio: leía `movements.entry_currency` del FIADO —la
            moneda en que se registró la deuda— y la etiquetaba «moneda de
            pago». En la captura del dueño decía «Dólares» mientras la tarjeta
            de abajo decía «Abonó Bs. 1.000,00». La moneda en que se pagó vive
            en `sale_payments.entry_currency`, que es otra fila y otra tabla.

            Así que la fila correcta ya existía debajo desde el principio, con
            su equivalencia al lado. Quien vuelva a echarla de menos: lo que
            falta no es esta fila, es mirar la tarjeta. */}
      </div>

      {/* ── EL RESUMEN DE LA COMPRA ─────────────────────────────────── */}
      <section className="flex flex-col rounded-[10px] border p-2.5">
        {/* SIN BANDERA EN EL TITULO, y es decision del dueno el 2026-10-19:
            «es muy redundante». El titulo ya dice «en Euros» con todas sus
            letras — la bandera al lado repite el mismo dato en el mismo
            renglon. Donde si va es pegada a cada CIFRA, que es donde distingue
            un libro de otro de un vistazo. */}
        <h2 className="py-2 text-sm">Resumen de compra en {nombreDeMoneda(moneda)}</h2>

        {/* SIN LÍNEAS NO SE INVENTA NINGUNA. Un fiado de la libreta importada, o
            uno registrado a mano antes de que existieran las ventas, no tiene
            productos — y una tarjeta vacía dice la verdad mejor que una fila
            con un guion. */}
        {(lineas ?? []).map((l, i) => (
          <Fila
            key={`${l.name}-${i}`}
            etiqueta={l.name as string}
            valor={`${formatCantidad(Number(l.quantity))} x ${formatPriceAmount(Number(l.unit_price), l.currency as PriceCurrency)}`}
          />
        ))}

        {pagoDeEseDia ? (
          <>
            <div className="border-t">
              <Fila
                etiqueta="Abonó"
                valor={
                  pagoDeEseDia.entry_currency === "VES" && pagoDeEseDia.entry_amount != null
                    ? formatBs(Number(pagoDeEseDia.entry_amount))
                    : formatPriceAmount(Number(pagoDeEseDia.amount), moneda)
                }
                bandera={pagoDeEseDia.entry_currency === "VES" ? "VES" : moneda}
              />
            </div>
            {/* «AL DÍA DE LA TRANSACCIÓN» Y NO DE HOY, y es la frase del frame:
                lo que esos bolívares valieron cuando se entregaron. Se lee de
                `sale_payments.amount`, que ya viene convertido con la tasa
                sellada ese día — recalcularlo con la de hoy diría otra cifra y
                reescribiría el pasado. */}
            {pagoDeEseDia.entry_currency === "VES" ? (
              <Fila
                etiqueta="Equivalencia"
                valor={formatPriceAmount(Number(pagoDeEseDia.amount), moneda)}
                pie="Al día de la transacción"
                bandera={moneda}
              />
            ) : null}
          </>
        ) : null}

        <div className="flex items-center justify-between border-t py-2">
          <span className="text-base font-semibold">Total por cobrar</span>
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-end">
              <span className="text-base font-semibold tabular-nums">
                {formatPriceAmount(pendiente, moneda)}
              </span>
              {pendienteEnBs != null ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatBs(pendienteEnBs)} hoy
                </span>
              ) : null}
            </div>
            <CurrencyFlagIcon currency={moneda} className="size-6 shrink-0" />
          </div>
        </div>
      </section>

      {/* ── EL CRÉDITO ──────────────────────────────────────────────── */}
      <div className="flex flex-col">
        <Fila etiqueta="Plazo de pago" valor={plazo} />
        <Fila
          etiqueta="Cuotas"
          valor={mov.cuotas ? `${mov.cuotas} cuotas` : "Pago único"}
        />
      </div>

      {mov.plazo_dias != null && mov.cuotas && mov.cuotas > 1 ? (
        <section className="flex flex-col rounded-[10px] border p-2.5">
          <h2 className="py-2 text-sm">Próximas cuotas</h2>
          {/* LA MISMA TABLA DE LA FICHA DEL MOVIMIENTO, no una copia. Es la que
              el dueño pidió ver también en la pantalla del cliente el
              2026-10-16, «mismo componente». */}
          <CuotasTable
            createdAt={mov.created_at as string}
            plazoDias={mov.plazo_dias as number}
            cuotas={mov.cuotas as number}
            amount={Number(mov.amount)}
            // EL FORMATEADOR VIENE DE FUERA, que es como esta tabla se
            // mantiene igual en las tres pantallas que ya la montan sin saber
            // de libros ni de monedas.
            formatearMonto={(monto) => formatPriceAmount(monto, moneda)}
          />
        </section>
      ) : null}

      {mov.description ? (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Descripción</span>
          <p className="text-sm">{mov.description as string}</p>
        </div>
      ) : null}

      {/* EL PIE CON SU AIRE DE 40px, el mismo del resto del flujo de registrar.
          Un solo botón: dentro del flujo esta pantalla confirma, no comparte ni
          elimina. */}
      <div className="sticky bottom-0 -mx-4 mt-auto border-t bg-background px-4 pt-6 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
        <Button asChild className="h-10 w-full">
          <Link href={`/abonos/nuevo/${mov.id}/monto${enReparto ? "?reparto=1" : ""}`}>
            Continuar
          </Link>
        </Button>
      </div>
    </div>
  );
}

function nombreDeMoneda(c: string) {
  return c === "USD" ? "Dólares" : c === "EUR" ? "Euros" : c === "VES" ? "Bolívares" : "Pesos";
}

// LA FILA ETIQUETA/VALOR DEL FRAME: etiqueta de 12 en gris a la izquierda, valor
// de 14 a la derecha, y la bandera fuera de la fila cuando la hay.
function Fila({
  etiqueta,
  valor,
  pie,
  bandera,
}: {
  etiqueta: string;
  valor: ReactNode;
  pie?: string;
  bandera?: PriceCurrency | "VES";
}) {
  return (
    <div className="flex items-center gap-1 py-2">
      <span className="min-w-0 flex-1 text-xs text-muted-foreground">{etiqueta}</span>
      <div className="flex flex-col items-end">
        <span className="text-sm tabular-nums">{valor}</span>
        {pie ? <span className="text-xs text-muted-foreground">{pie}</span> : null}
      </div>
      {bandera ? <CurrencyFlagIcon currency={bandera as never} className="size-6 shrink-0" /> : null}
    </div>
  );
}
