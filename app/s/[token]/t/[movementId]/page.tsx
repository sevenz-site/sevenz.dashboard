import Link from "next/link";
import { notFound } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { Button } from "@/components/ui/button";
import { DetalleDeTransaccion } from "@/components/dashboard/detalle-de-transaccion";
import { getBolivarRates } from "@/lib/products/catalog";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { FiadoAbierto } from "@/components/dashboard/tarjeta-de-fiado";
import type { AbonoDirigido } from "@/components/dashboard/tarjeta-de-abono";
import type { BolivarRates } from "@/lib/products/price";
import type { ExchangeRateMode, LedgerCurrency, MovementCurrencyCode } from "@/lib/types";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { IconoVolver } from "@/components/dashboard/screen-chrome";

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
  // Y el de la `129`: lo que se abonó EN EL MOMENTO de registrar el fiado.
  // Opcional porque durante un despliegue el código y la base no coinciden en
  // un sentido o en el otro; ausente cae a 0, que es también lo que vale para
  // todo lo que no tiene venta detrás.
  abono_inicial?: number | null;
};

// LA TARJETA DE UN FIADO, tal y como la entrega la migración `128`: todo lo
// que `TarjetaDeFiado` dibuja, más `pending` — lo que ese fiado TODAVÍA debe.
//
// `pending` SE CALCULA EN SQL Y NO AQUÍ porque la única implementación de «qué
// debe este fiado» es `get_open_charges_for_client`, que corre como quien la
// llama y por tanto es inalcanzable desde una página sin sesión. Rehacerla en
// TypeScript sería una tercera copia de la cola FIFO, y la cifra de esta
// tarjeta tiene que ser la misma que ve el dueño o los dos lados de la misma
// deuda no coinciden.
type FiadoAbonadoJson = {
  movement_id: string;
  sale_id: string | null;
  fecha: string;
  currency: LedgerCurrency | null;
  amount: number;
  pending: number;
  plazo_dias: number | null;
  cuotas: number | null;
  description: string | null;
};

// Un abono dirigido a un cargo. Lo mínimo que la tarjeta necesita: no lleva
// plazo ni cuotas porque un abono no tiene acuerdo propio — lo hereda del
// fiado, que es lo que se enseña en la ficha del abono.
type AbonoDirigidoJson = {
  movement_id: string;
  fecha: string;
  currency: LedgerCurrency | null;
  amount: number;
  description: string | null;
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
    // LOS DOS MAPAS DE LA MIGRACIÓN `128`, los dos indexados por el id del
    // CARGO. Opcionales porque durante un despliegue el código y la base no
    // coinciden en un sentido o en el otro, y una clave ausente tiene que
    // degradar a «no se enseña» y no reventar la página.
    fiados_abonados?: Record<string, FiadoAbonadoJson>;
    abonos_por_fiado?: Record<string, AbonoDirigidoJson[]>;
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
  // SALE DEL MAPA QUE ARMA `get_shared_balance`, no de buscar en la lista que
  // viajó. Esa búsqueda es lo que arreglan la migración `128` y `CT-110`: esta
  // página solo recibe 50 movimientos y la del dueño los carga todos, así que
  // un fiado más viejo que la ventana no aparecía y la ficha decía
  // «Repartidos al saldo total» — cierto para un abono sin dirigir, FALSO para
  // este. El mapa se resuelve en SQL contra la tabla entera.
  //
  // Y TRAE `pending`, que es `CT-109`: lo que ese fiado todavía debe. Hasta la
  // `128` llegaba a cero y la tarjeta se dibujaba sin esa línea, porque un
  // «Debe $0.00» de un fiado vivo es peor que no decir nada.
  let fiadoAplicado: FiadoAbierto | null = null;
  if (m.type === "payment" && m.applies_to_movement_id) {
    const f = (shared.fiados_abonados ?? {})[m.applies_to_movement_id];
    if (f) {
      fiadoAplicado = {
        movementId: f.movement_id,
        saleId: null,
        fecha: f.fecha,
        currency: f.currency,
        amount: Number(f.amount),
        pending: Number(f.pending),
        plazoDias: f.plazo_dias,
        cuotas: f.cuotas,
        // Sin nombres de producto, que conserva la decisión de la migración
        // `122`: el inventario del negocio no viaja a esta pantalla. La
        // tarjeta cae en la descripción del fiado, que es justo lo que el
        // cliente ya lee en la fila del historial de la que vino.
        productos: [],
        descripcion: f.description,
      };
    }
  }

  // ── LO QUE SE HA ABONADO A ESTE FIADO ────────────────────────────────
  //
  // El reflejo del bloque de arriba, encargo del dueño el 2026-10-20. También
  // del mapa y por la misma razón, que aquí pesa más: una lista de los propios
  // pagos a la que le falta uno no se lee como un detalle que falta, se lee
  // como dinero perdido.
  const abonosRecibidos: AbonoDirigido[] | undefined =
    m.type === "charge"
      ? ((shared.abonos_por_fiado ?? {})[m.id] ?? []).map((a) => ({
          movementId: a.movement_id,
          fecha: a.fecha,
          currency: a.currency,
          amount: Number(a.amount),
          descripcion: a.description,
        }))
      : undefined;

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-4 px-4 pb-10">
      {/* LA BARRA DE ARRIBA, SOLO CON LA FLECHA. El «⋮» del frame es del dueño;
          aquí no hay ninguna acción que ofrecer. */}
      <div className="sticky top-0 z-20 -mx-4 flex items-center border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" asChild className="-ml-2">
          <Link href={`/s/${token}`} aria-label="Volver a mi saldo">
            <IconoVolver className="text-primary" />
          </Link>
        </Button>
      </div>

      <ScreenTitle>Detalle de transacción</ScreenTitle>

      {/* «Total por cobrar» TAMBIÉN EN LA PANTALLA DEL CLIENTE, igual que en
          la del dueño. Decisión del dueño el 2026-10-20, preguntada: los
          frames `1463:18100`, `1465:18349` y `1479:9456` son de SU pantalla,
          así que se le planteó si el cliente debía llevar el mismo rótulo.
          Dijo que sí, y por eso aquí no se pasa `balanceLabel`: el valor por
          defecto del componente ya es ese.

          Y DESPLAZA UNA DECISIÓN ANTERIOR, que queda escrita: esta pantalla
          usaba `getBalanceLabel`, que dice «Debe», «A favor» o «Sin deuda»
          según el signo del saldo. Era el rótulo del cliente desde que existe
          su enlace, y estaba pensado para no decirle «debes −$20.00» a quien
          ha pagado de más.

          LO QUE CUESTA, para quien se plantee devolverlo: un cliente con saldo
          a favor ahora lee «Total por cobrar −$20.00». `getBalanceLabel` sigue
          existiendo y la tarjeta de saldo de `/s/[token]` lo sigue usando, así
          que volver es pasar la prop otra vez. */}
      <DetalleDeTransaccion
        type={m.type}
        amount={Number(m.amount)}
        currency={m.currency}
        description={m.description}
        plazoDias={m.plazo_dias}
        cuotas={m.cuotas}
        createdAt={m.created_at}
        runningBalance={Number(m.running_balance)}
        photoUrl={photoUrl}
        entryCurrency={m.entry_currency}
        entryAmount={m.entry_amount}
        exchangeRateUsed={m.exchange_rate_used}
        ledger={ledger}
        fiadoAplicado={fiadoAplicado}
        hrefDelFiado={fiadoAplicado ? `/s/${token}/t/${fiadoAplicado.movementId}` : null}
        abonosRecibidos={abonosRecibidos}
        abonoInicial={Number(m.abono_inicial ?? 0)}
        rates={rates}
      />
    </div>
  );
}
