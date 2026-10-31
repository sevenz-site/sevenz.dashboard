import { ZonaDelNegocioProvider } from "@/components/fecha";
import Link from "next/link";
import { CodigoDeTransaccion } from "@/components/dashboard/codigo-de-transaccion";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { Button } from "@/components/ui/button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { Fila, Grupo, NOMBRE_DE_MONEDA } from "@/components/dashboard/detail-rows";
import { ProductosDelMovimiento } from "@/components/dashboard/productos-del-movimiento";
import { formatBs } from "@/lib/exchange-rate/format";
import { Fecha } from "@/components/fecha";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { SharedVentaDeContado } from "@/components/public/movement-history-list";
import type { SaleLineRow } from "@/lib/sale-lines";
import type { ExchangeRateMode, LedgerCurrency, MovementCurrencyCode } from "@/lib/types";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { IconoVolver } from "@/components/dashboard/screen-chrome";

export const metadata = { title: "Detalle de transacción — Sevenz" };

// EL DETALLE DE UNA VENTA DE CONTADO, EN LA PANTALLA DEL CLIENTE — `CT-104`.
//
// Gemela de `/transacciones/venta/[saleId]/[moneda]`, la del tendero, y se
// parece mucho a propósito: los dos tienen que ver lo mismo. Lo que cambia es
// de dónde sale el dato --allí de las tablas con la sesión del dueño, aquí de
// `get_shared_balance`-- y que aquí no hay «⋮»: el cliente mira, no borra.
//
// ===========================================================================
// LA SEGURIDAD DE ESTA PANTALLA ESTÁ EN QUE NO CONSULTA NADA
//
// `saleId` viene de la URL, o sea del visitante. Pero esta página NO lo usa
// para consultar: lo busca dentro de lo que `get_shared_balance` ya devolvió,
// y esa función comprueba el token y solo entrega las ventas de ESE cliente.
// Una venta de otro no está en la lista, así que no se encuentra y la página
// responde 404 sin haber preguntado nada por ella.
//
// Es el mismo razonamiento que el comentario de la foto firmada en
// `/s/[token]/t/[movementId]`: lo que se puede tocar con un id de la URL es
// exactamente lo que la función ya autorizó.
//
// ===========================================================================
// PIDE MÁS DE 50
//
// `get_shared_balance` acota a 50 por defecto, que es lo que la lista enseña.
// Aquí se pide mucho más: una pantalla de detalle resuelve UNA fila, y un
// cliente con historia que abra la compra número 60 desde «Ver todo el
// historial» se encontraría un 404 sobre su propia compra. Es barato y evita
// el peor fallo de esta pantalla.
const LIMITE = 2000;

// `cop` en la ruta es el libro de un negocio colombiano, donde `currency` es
// nulo. Un segmento vacío no vale como URL, así que el código va escrito y se
// traduce aquí. Igual que en la pantalla del tendero.
const DEL_SEGMENTO: Record<string, LedgerCurrency | null> = {
  usd: "USD",
  eur: "EUR",
  cop: null,
};

export default async function VentaDeContadoDelClientePage({
  params,
}: {
  params: Promise<{ token: string; saleId: string; moneda: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { token, saleId, moneda: segmento } = await params;
  if (!(segmento in DEL_SEGMENTO)) notFound();
  const moneda = DEL_SEGMENTO[segmento];

  const supabase = await createClient();
  const { data } = await supabase.rpc("get_shared_balance", {
    p_token: token,
    p_limit: LIMITE,
  });
  if (!data) notFound();

  const shared = data as {
    client_name: string;
    // Opcional porque entre desplegar este código y correr la `131` la clave
    // no viene. Sin ella no hay nada que encontrar y la página responde 404,
    // que es la respuesta correcta mientras la migración no esté.
    ventas_de_contado?: SharedVentaDeContado[];
    owner_country?: string | null;
    rate_mode?: ExchangeRateMode | null;
    current_bcv_usd?: number | null;
    current_bcv_eur?: number | null;
    custom_rate_usd?: number | null;
    custom_rate_eur?: number | null;
  };

  const venta = (shared.ventas_de_contado ?? []).find(
    (v) => v.sale_id === saleId && (v.currency ?? null) === moneda,
  );
  if (!venta) notFound();

  // ── LA TASA, armada igual que en la pantalla de la que se viene ──────
  const effectiveRate =
    shared.owner_country === "VE" && shared.current_bcv_usd != null && shared.current_bcv_eur != null
      ? shared.rate_mode === "CUSTOM" && shared.custom_rate_usd && shared.custom_rate_eur
        ? { usd: shared.custom_rate_usd, eur: shared.custom_rate_eur }
        : { usd: shared.current_bcv_usd, eur: shared.current_bcv_eur }
      : null;
  const ledger: LedgerDisplay | null = effectiveRate ? { rate: effectiveRate } : null;
  const formatear = (n: number) => formatLedgerAmount(n, moneda, ledger).primary;

  const lineas: SaleLineRow[] = venta.lineas.map((l) => ({
    name: l.name,
    quantity: Number(l.quantity),
    unitPrice: Number(l.unit_price),
  }));

  const total = Number(venta.amount);
  const monedaTecleada = (venta.entry_currency ?? moneda) as MovementCurrencyCode | null;
  const entregado = venta.entry_amount != null ? Number(venta.entry_amount) : total;

  // «Al día de pago» y no «Hoy» — decisión del dueño el 2026-10-20: ese dinero
  // ya cambió de manos, así que su equivalente en bolívares es el del día en
  // que se pagó, no el de hoy. Misma regla que la pantalla del tendero, y aquí
  // importa el doble: si las dos pantallas sellaran distinto, el cliente y el
  // comercio leerían dos cifras para el mismo pago.
  // Y LO TECLEADO MANDA SOBRE LA CONVERSIÓN — regla crítica del 2026-10-24,
  // igual que en la pantalla del tendero. `entry_currency` es 'VES' solo
  // cuando TODOS los pagos de ese libro se teclearon así: lo decide la RPC,
  // que no lo rellena cuando mezclan formas.
  const enBs =
    venta.entry_currency === "VES" && venta.entry_amount != null
      ? Number(venta.entry_amount)
      : venta.rate_used != null
        ? total * Number(venta.rate_used)
        : null;

  return (
    <ZonaDelNegocioProvider country={shared.owner_country}>
    <div className="mx-auto flex min-h-screen w-full max-w-md flex-1 flex-col gap-4 px-4 pb-10">
      {/* LA FILA DE VOLVER. Esta pantalla no lleva cabecera de app --el
          cliente no tiene menú ni sesión-- así que la flecha es la única
          salida y tiene que salir a TODAS las anchuras. */}
      <div className="sticky top-0 z-20 -mx-4 flex items-center border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" asChild className="-ml-2">
          <Link href={`/s/${token}`} aria-label="Volver a mi cuenta">
            <IconoVolver className="text-primary" />
          </Link>
        </Button>
      </div>

      <ScreenTitle>Detalle de transacción</ScreenTitle>
      <CodigoDeTransaccion codigo={venta.transaction_code ?? null} />

      <dl className="flex flex-col gap-4">
        <Grupo>
          <Fila nombre="Fecha"><Fecha iso={venta.created_at} /></Fila>
        </Grupo>

        <div className="flex flex-col gap-1.5 rounded-xl border p-4">
          <p className="pb-1.5 text-base">
            Resumen de compra{moneda ? ` en ${NOMBRE_DE_MONEDA[moneda]}` : ""}
          </p>

          <Fila nombre="Tipo">
            <span className="inline-flex items-center gap-1.5">
              De contado
              {/* El visto verde, no la flecha del fiado. `emerald-700` y no el
                  `600`: medido contra blanco el 600 da 3,67:1 y el piso de
                  `DESIGN-SYSTEM.md` son 4,5. */}
              <Check className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
            </span>
          </Fila>

          {lineas.length > 0 ? (
            <ProductosDelMovimiento productos={lineas} formatearMonto={formatear} />
          ) : null}

          {/* ── «PAGÓ», UNA FILA — frame `1580:11620` ──────────────────
              La misma que la pantalla del tendero, y por eso se cambia aquí
              también: es LA MISMA VENTA mirada por el cliente. Dejarla con las
              dos filas viejas haría que el enlace que él recibe no se pareciera
              a lo que el tendero tiene delante, que es justo lo que este
              producto promete. */}
          <div className="border-t pt-1.5">
            <Fila nombre="Pagó">
              <span className="inline-flex flex-col items-end">
                <span className="inline-flex items-center gap-1 text-base font-semibold tabular-nums text-money-in">
                  +{formatear(total)}
                  {moneda ? <CurrencyFlagIcon currency={moneda} className="size-4" /> : null}
                </span>
                {monedaTecleada === "VES" ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatBs(entregado)} al día del pago
                  </span>
                ) : null}
              </span>
            </Fila>
          </div>

          {/* «Total» y no «Total por cobrar»: aquí no queda nada por cobrar, y
              es la diferencia que más importa de esta pantalla para quien la
              lee. */}
          <div className="flex items-center justify-between gap-4 border-t pt-3">
            <span className="text-base font-semibold">Total</span>
            <span className="flex items-center gap-2">
              <span className="flex flex-col items-end">
                <span className="text-base font-semibold tabular-nums">{formatear(total)}</span>
                {enBs != null ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatBs(enBs)} al día de pago
                  </span>
                ) : null}
              </span>
              {moneda ? <CurrencyFlagIcon currency={moneda} className="size-4 shrink-0" /> : null}
            </span>
          </div>
        </div>

        <Grupo>
          <dt className="text-xs leading-5 text-muted-foreground">Descripción</dt>
          <dd className="text-sm break-words">{venta.description || "—"}</dd>
        </Grupo>
      </dl>
    </div>
    </ZonaDelNegocioProvider>
  );
}
