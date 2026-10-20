import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { Button } from "@/components/ui/button";
import { DetalleDeTransaccion } from "@/components/dashboard/detalle-de-transaccion";
import { getBolivarRates } from "@/lib/products/catalog";
import { getBalanceLabel } from "@/lib/types";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { FiadoAbierto } from "@/components/dashboard/tarjeta-de-fiado";
import type { BolivarRates } from "@/lib/products/price";
import type { ExchangeRateMode, LedgerCurrency, MovementCurrencyCode } from "@/lib/types";

export const metadata = { title: "Detalle de transacción — Sevenz" };

type SharedMovement = {
  id: string;
  type: "charge" | "payment";
  amount: number;
  currency: LedgerCurrency | null;
  description: string | null;
  running_balance: number;
  plazo_dias: number | null;
  cuotas: number | null;
  exchange_rate_used: number | null;
  entry_currency: MovementCurrencyCode | null;
  entry_amount: number | null;
  created_at: string;
  // Los dos que trae la migración `127`.
  applies_to_movement_id: string | null;
  photo_path: string | null;
};

// EL DETALLE DE UNA TRANSACCIÓN, PARA EL CLIENTE — mismos frames que la del
// dueño, `1465:18349` y `1463:18100`.
//
// ===========================================================================
// LA MISMA PANTALLA, CON MENOS DENTRO
//
// El cuerpo es `DetalleDeTransaccion`, el mismo componente. Lo que cambia es de
// dónde salen los datos y qué NO se le enseña al cliente:
//
//   · NO hay «⋮». Decisión del dueño el 2026-10-18: *«Cliente no ve ninguna
//     opción ni el botón more»*. Ni compartir, ni borrar, ni pagar.
//   · NO hay nota del dueño. Ni podría: `get_shared_balance` no la devuelve, y
//     ese es justo el campo donde el tendero apunta algo que no debe llegar a
//     la otra parte.
//   · NO hay productos. Quién se llevó qué es una conversación entre los dos,
//     pero el inventario del negocio no lo es.
//
// ===========================================================================
// ESTA PÁGINA NO LEE `movements`
//
// Lee `get_shared_balance(token)`, que es SECURITY DEFINER y comprueba el token
// ella misma. Un movimiento que no esté en lo que esa función devolvió NO se
// enseña — y ahí está toda la autorización: no hace falta comprobar de quién es
// la fila, porque la única forma de llegar a ella es que la función la haya
// entregado para ese token.
export default async function DetalleDelClientePage({
  params,
}: {
  params: Promise<{ token: string; movementId: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { token, movementId } = await params;
  const supabase = await createClient();

  const { data } = await supabase.rpc("get_shared_balance", { p_token: token });
  if (!data) notFound();

  const shared = data as {
    client_name: string;
    movements: SharedMovement[];
    owner_country?: string | null;
    rate_mode?: ExchangeRateMode | null;
    current_bcv_usd?: number | null;
    current_bcv_eur?: number | null;
    custom_rate_usd?: number | null;
    custom_rate_eur?: number | null;
  };

  const movimientos = shared.movements ?? [];
  const m = movimientos.find((x) => x.id === movementId);
  if (!m) notFound();

  // ── LA TASA, armada igual que en la pantalla de la que se viene ──────
  const effectiveRate =
    shared.owner_country === "VE" && shared.current_bcv_usd != null && shared.current_bcv_eur != null
      ? shared.rate_mode === "CUSTOM" && shared.custom_rate_usd && shared.custom_rate_eur
        ? { usd: shared.custom_rate_usd, eur: shared.custom_rate_eur }
        : { usd: shared.current_bcv_usd, eur: shared.current_bcv_eur }
      : null;
  const ledger: LedgerDisplay | null = effectiveRate ? { rate: effectiveRate } : null;
  const rates: BolivarRates | null = effectiveRate ? await getBolivarRates(effectiveRate) : null;

  // ── LA FOTO ──────────────────────────────────────────────────────────
  //
  // HASTA HOY EL CLIENTE NO VEÍA NINGUNA, a propósito: un adjunto puede ser un
  // recibo, una factura o una cédula. Se le planteó así al dueño el 2026-10-19
  // y eligió que sí la vea.
  //
  // SE FIRMA CON LA CLAVE DE SERVICIO, Y ESO ES SEGURO AQUÍ POR UNA RAZÓN
  // CONCRETA: la ruta que se firma NO viene de la URL ni de nada que el
  // visitante controle. Viene de `get_shared_balance`, que ya comprobó el token
  // y solo devuelve los movimientos de ESE cliente. Firmar un `photo_path` que
  // llegara por parámetro sería otra cosa completamente, y no se hace.
  //
  // El bucket `attachments` es privado y esta página no tiene sesión, así que
  // no hay otra forma: la clave anon no puede firmar nada ahí.
  let photoUrl: string | null = null;
  if (m.photo_path) {
    const { data: firmada } = await createServiceClient()
      .storage.from("attachments")
      .createSignedUrl(m.photo_path, 60 * 60);
    photoUrl = firmada?.signedUrl ?? null;
  }

  // ── EL FIADO AL QUE FUE ESTE ABONO ───────────────────────────────────
  //
  // Sale de la MISMA lista que ya se trajo, sin una segunda consulta: si ese
  // fiado es de este cliente, está ahí. Si no está —porque se borró, o porque
  // cae fuera del límite de movimientos que la función devuelve— la tarjeta no
  // se dibuja y la ficha dice «Repartidos al saldo total», que para un abono
  // sin dirección es la verdad.
  let fiadoAplicado: FiadoAbierto | null = null;
  if (m.type === "payment" && m.applies_to_movement_id) {
    const f = movimientos.find((x) => x.id === m.applies_to_movement_id);
    if (f) {
      fiadoAplicado = {
        movementId: f.id,
        saleId: null,
        fecha: f.created_at,
        currency: f.currency,
        amount: Number(f.amount),
        // LO QUE ESE FIADO TODAVÍA DEBE NO SE PUEDE SABER AQUÍ, y por eso va a
        // cero en vez de a una cifra inventada: el reparto lo calcula
        // `get_open_charges_for_client`, que la página del cliente no puede
        // llamar — necesita el id del cliente y la clave anon no lo tiene. Con
        // cero, la tarjeta dice «Debe $0.00», que es falso para un fiado vivo.
        //
        // Por eso la tarjeta del cliente se dibuja SIN esa línea: ver
        // `mostrarPendiente` en `TarjetaDeFiado`.
        pending: 0,
        plazoDias: f.plazo_dias,
        cuotas: f.cuotas,
        productos: [],
        descripcion: f.description,
      };
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pb-10">
      {/* LA BARRA DE ARRIBA, SOLO CON LA FLECHA. El «⋮» del frame es del dueño;
          aquí no hay ninguna acción que ofrecer. */}
      <div className="sticky top-0 z-20 -mx-4 flex items-center border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" asChild className="-ml-2">
          <Link href={`/s/${token}`} aria-label="Volver a mi saldo">
            <ChevronLeft className="size-5" aria-hidden="true" />
          </Link>
        </Button>
      </div>

      <h1 className="text-2xl leading-8 font-normal">Detalle de transacción</h1>

      <DetalleDeTransaccion
        type={m.type}
        amount={Number(m.amount)}
        currency={m.currency}
        description={m.description}
        plazoDias={m.plazo_dias}
        cuotas={m.cuotas}
        createdAt={m.created_at}
        runningBalance={Number(m.running_balance)}
        balanceLabel={getBalanceLabel(Number(m.running_balance))}
        photoUrl={photoUrl}
        entryCurrency={m.entry_currency}
        entryAmount={m.entry_amount}
        exchangeRateUsed={m.exchange_rate_used}
        ledger={ledger}
        fiadoAplicado={fiadoAplicado}
        hrefDelFiado={fiadoAplicado ? `/s/${token}/t/${fiadoAplicado.movementId}` : null}
        rates={rates}
        mostrarPendienteDelFiado={false}
      />
    </div>
  );
}
