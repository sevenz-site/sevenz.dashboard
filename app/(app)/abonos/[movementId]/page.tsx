import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { CheckCircle2, User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { getOwnerRateContextResult } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import { Button } from "@/components/ui/button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatDocumentId } from "@/lib/format";
import { telefonoLegible } from "@/lib/phone";
import { formatPriceAmount, priceIn, type PriceCurrency } from "@/lib/products/price";

export const metadata = { title: "Abono registrado — Sevenz" };

// LA PANTALLA DE ÉXITO DEL ABONO — frame `1434:15590`.
//
// ===========================================================================
// UNA SOLA TARJETA, LA DE LA MONEDA EN QUE SE ABONÓ
//
// El frame dibuja dos —«Resumen de transacción en Dólares» y «…en Euros»— y eso
// se leyó mal la primera vez. Aclaración del dueño el 2026-10-19: no son dos
// tarjetas a la vez, son **dos ejemplos de lo que esa tarjeta tiene que saber
// pintar**: un abono del 100 % que deja la deuda en cero, y uno parcial que
// deja saldo. Un abono dirigido va a UN fiado, y un fiado tiene UNA moneda.
//
// ===========================================================================
// SE RECONSTRUYE DESDE LA BASE, NO SE PASA POR LA URL
//
// Esta pantalla tiene dirección propia: el tendero puede recargarla o volver a
// ella con el teléfono en la mano para enseñársela al cliente. Un resumen
// armado con lo que la acción devolvió se queda en blanco en cuanto eso pasa —
// es la misma razón escrita en `resumenDeVenta`.
export default async function AbonoRegistradoPage({
  params,
}: {
  params: Promise<{ movementId: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { movementId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: abono } = await supabase
    .from("movements")
    .select(
      "id, client_id, type, amount, currency, entry_currency, entry_amount, applies_to_movement_id, clients!inner(id, name, document_id, whatsapp, owner_id)",
    )
    .eq("id", movementId)
    .is("deleted_at", null)
    .maybeSingle();

  const cliente = abono?.clients as unknown as {
    id: string;
    name: string;
    document_id: string | null;
    whatsapp: string | null;
    owner_id: string;
  } | null;
  if (!abono || !cliente || cliente.owner_id !== user.id || abono.type !== "payment") notFound();

  const moneda = (abono.currency ?? "COP") as PriceCurrency;

  // ── LO QUE QUEDA DEBIENDO EN ESTE LIBRO, DESPUÉS DEL ABONO ───────────
  //
  // De la misma función que todo el flujo. Es la suma de lo que siguen debiendo
  // sus fiados abiertos en ESTA moneda — cero cuando el abono lo saldó todo,
  // que es el primero de los dos casos que el frame enseña.
  const { data: abiertos } = await supabase.rpc("get_open_charges_for_client", {
    p_client_id: cliente.id,
  });
  const deudaTotal = ((abiertos ?? []) as { currency: string | null; pending: number }[])
    .filter((c) => (c.currency ?? null) === (abono.currency ?? null))
    .reduce((suma, c) => suma + Number(c.pending), 0);

  const resultado = await getOwnerRateContextResult(supabase, user.id);
  const rates = resultado.kind === "ve" ? await getBolivarRates(resultado.context.effectiveRate) : null;
  const deudaEnBs =
    rates && abono.currency
      ? priceIn("VES", { amount: deudaTotal, currency: moneda }, rates)?.amount
      : null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col items-center gap-4 pt-4">
        <CheckCircle2 className="size-20 text-foreground" aria-hidden="true" />
        <h1 className="text-center text-xl leading-7 font-normal">¡Abono registrado con éxito!</h1>
      </div>

      <section className="flex flex-col rounded-[10px] border p-4">
        <div className="flex items-center justify-between pb-2">
          <h2 className="text-base font-semibold">Datos del comprador</h2>
          <User className="size-6 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>
        {/* LA FILA SE QUEDA AUNQUE EL DATO FALTE, con un guion. Es la regla de
            `DESIGN-SYSTEM.md`: un dato ausente que desaparece no se distingue
            de uno que nunca se pidió. */}
        <Dato etiqueta="Nombre y apellido" valor={cliente.name} />
        <Dato etiqueta="Documento" valor={formatDocumentId(cliente.document_id)} />
        <Dato
          etiqueta="Teléfono"
          valor={cliente.whatsapp ? telefonoLegible(cliente.whatsapp) : "—"}
        />
      </section>

      <section className="flex flex-col rounded-[10px] border p-4">
        <h2 className="pb-2 text-base font-semibold">
          Resumen de transacción en {nombreDeMoneda(moneda)}
        </h2>

        <div className="flex items-center justify-between py-2">
          <span className="text-xs text-muted-foreground">Abonó en {nombreDeMoneda(moneda)}</span>
          <span className="flex items-center gap-1 text-sm tabular-nums">
            <CurrencyFlagIcon currency={moneda} className="size-3.5 shrink-0" />
            {formatPriceAmount(Number(abono.amount), moneda)}
          </span>
        </div>

        {/* SI PAGÓ EN BOLÍVARES, los que entregó. Son los TECLEADOS y no una
            conversión de hoy: el tendero escribió esa cifra y leer otra, aunque
            difiera en céntimos por el redondeo, no se explica. Misma decisión
            que la fila del historial. */}
        {abono.entry_currency === "VES" && abono.entry_amount != null ? (
          <div className="flex items-center justify-between py-2">
            <span className="text-xs text-muted-foreground">Entregó</span>
            <span className="text-sm tabular-nums">{formatBs(Number(abono.entry_amount))}</span>
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t pt-3">
          <span className="text-base font-semibold">Deuda total</span>
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-end">
              <span className="text-base font-semibold tabular-nums">
                {/* LOS DOS CASOS QUE EL FRAME ENSEÑA CON SUS DOS TARJETAS. Cero
                    no se escribe como «$0,00»: se dice que no debe nada, que es
                    lo que el tendero le va a leer en voz alta al cliente. */}
                {deudaTotal > 0.005 ? formatPriceAmount(deudaTotal, moneda) : "Sin deuda"}
              </span>
              {deudaEnBs != null && deudaTotal > 0.005 ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatBs(deudaEnBs)} hoy
                </span>
              ) : null}
            </div>
            {deudaTotal > 0.005 ? (
              <CurrencyFlagIcon currency={moneda} className="size-6 shrink-0" />
            ) : null}
          </div>
        </div>
      </section>

      {/* EL BOTON VA EN EL FLUJO, NO PEGADO ABAJO, y es a proposito: esta
          pantalla SI lleva barra de navegacion —vive en `/abonos/<id>`, fuera
          de `/abonos/nuevo`, que es lo que `mobile-nav.tsx` suprime— asi que
          una barra pegada encima de ella duplicaria el aire y se quedaria
          flotando a media altura al final del scroll. Es el mismo descuadre que
          `app-main.tsx` tiene medido en pantalla.
          El resumen de la venta hace exactamente esto por la misma razon. */}
      <Button asChild variant="outline" className="h-10 w-full text-base font-semibold">
        <Link href={`/clients/${cliente.id}`}>Ver cuenta de {cliente.name}</Link>
      </Button>
    </div>
  );
}

function nombreDeMoneda(c: string) {
  return c === "USD" ? "Dólares" : c === "EUR" ? "Euros" : c === "VES" ? "Bolívares" : "Pesos";
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1">
      <span className="text-xs text-muted-foreground">{etiqueta}</span>
      <span className="truncate text-sm">{valor}</span>
    </div>
  );
}
