import Link from "next/link";
import { CodigoDeTransaccion } from "@/components/dashboard/codigo-de-transaccion";
import { redirect, notFound } from "next/navigation";
import { Check } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { SetupNotice } from "@/components/setup-notice";
import { Button } from "@/components/ui/button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { Fila, Grupo, NOMBRE_DE_MONEDA } from "@/components/dashboard/detail-rows";
import { ProductosDelMovimiento } from "@/components/dashboard/productos-del-movimiento";
import { VentaAcciones } from "@/components/dashboard/venta-acciones";
import { getOwnerRateContextResult } from "@/lib/exchange-rate/owner-rate";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatDate } from "@/lib/format";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { SaleLineRow } from "@/lib/sale-lines";
import type { LedgerCurrency, MovementCurrencyCode } from "@/lib/types";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { IconoVolver } from "@/components/dashboard/screen-chrome";

export const metadata = { title: "Detalle de transacción — Sevenz" };

// LA PARTE DE UNA VENTA QUE SE PAGÓ DE CONTADO — frame `1487:9875`.
//
// ===========================================================================
// POR QUÉ ESTA PANTALLA NO EXISTÍA
//
// Una venta pagada entera **no escribe nada en `movements`**, y eso es
// deliberado: el saldo, el puntaje de crédito y las gráficas leen esa tabla, y
// un cobro de contado no es una deuda. La consecuencia era que ese dinero no
// tenía ficha ninguna — salía como una fila gris en el historial que no se
// podía tocar.
//
// ===========================================================================
// SE IDENTIFICA POR (VENTA, MONEDA), no por un id
//
// Decisión del dueño el 2026-10-20: una venta mixta produce **dos filas
// independientes**, una por moneda, y *«no se muestra ninguna dentro de la
// otra»*. Así que lo que esta pantalla enseña no es «una venta»: es la parte
// de una venta que se pagó en UNA moneda. De ahí la ruta.
//
// `cop` en la ruta es el libro de un negocio colombiano, donde `currency` es
// nulo en las filas. Un segmento vacío no vale como URL, así que el código va
// escrito y se traduce aquí.
const DEL_SEGMENTO: Record<string, LedgerCurrency | null> = {
  usd: "USD",
  eur: "EUR",
  cop: null,
};

export default async function VentaDeContadoPage({
  params,
}: {
  params: Promise<{ saleId: string; moneda: string }>;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { saleId, moneda: segmento } = await params;
  if (!(segmento in DEL_SEGMENTO)) notFound();
  const moneda = DEL_SEGMENTO[segmento];

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // LA PROPIEDAD, EN CÓDIGO Y NO SOLO POR RLS. Es la regla de `CLAUDE.md` para
  // toda fila que se toca por un id del navegador. `sales` lleva `owner_id`
  // directo --la `124` lo decidió así-- y aun así se compara aquí.
  const { data: venta } = await supabase
    .from("sales")
    .select("id, owner_id, created_at, client_id, transaction_code, clients!inner(id, name)")
    .eq("id", saleId)
    .maybeSingle();

  const cliente = venta?.clients as unknown as { id: string; name: string } | null;
  if (!venta || !cliente || venta.owner_id !== user.id) notFound();

  const [{ data: lineasCrudas }, { data: pagosCrudos }] = await Promise.all([
    supabase.from("sale_lines").select("name, quantity, unit_price, currency").eq("sale_id", saleId),
    supabase
      .from("sale_payments")
      .select("amount, currency, entry_currency, entry_amount, rate_used, description")
      .eq("sale_id", saleId),
  ]);

  const lineas: SaleLineRow[] = (lineasCrudas ?? [])
    .filter((l) => (l.currency ?? null) === moneda)
    .map((l) => ({
      name: l.name as string,
      quantity: Number(l.quantity),
      unitPrice: Number(l.unit_price),
    }));

  const pagos = (pagosCrudos ?? []).filter((p) => (p.currency ?? null) === moneda);

  // SIN PAGOS EN ESTA MONEDA NO HAY NADA QUE ENSEÑAR. Pasa si alguien escribe
  // la ruta a mano con la moneda equivocada, y también si la parte de contado
  // se borró: en los dos casos la respuesta correcta es que no existe.
  if (pagos.length === 0) notFound();

  const total = pagos.reduce((suma, p) => suma + Number(p.amount), 0);

  // ── LO QUE EL CLIENTE ENTREGÓ, y en qué ──────────────────────────────
  //
  // No es lo mismo que el total: puede haber pagado en bolívares un libro en
  // dólares. Se suman los `entry_amount` solo si TODOS los pagos de esta
  // moneda se tecleraron igual; si se mezclaron formas --unos en bolívares y
  // otros en dólares-- no hay una sola cifra honesta que enseñar y la fila
  // «Pagó» cae a lo guardado, que siempre es cierto.
  const monedasTecleadas = new Set(pagos.map((p) => (p.entry_currency ?? moneda) as string));
  const unaSolaForma = monedasTecleadas.size === 1;
  const monedaTecleada = (unaSolaForma ? [...monedasTecleadas][0] : moneda) as MovementCurrencyCode | null;
  const entregado = unaSolaForma
    ? pagos.reduce((suma, p) => suma + Number(p.entry_amount ?? p.amount), 0)
    : total;

  // ── LA TASA SELLADA EL DÍA DEL PAGO ──────────────────────────────────
  //
  // «Al día de pago» y no «Hoy» — decisión del dueño el 2026-10-20, y va
  // contra lo que dibuja su propio frame, que dice «Hoy». Su razón: ese dinero
  // ya cambió de manos, así que su equivalente en bolívares es el del día en
  // que se pagó. El frame iba atrasado respecto a la decisión.
  //
  // Se toma la del primer pago que la tenga: los pagos de una misma venta son
  // del mismo momento, así que o la tienen todos igual o no la tiene ninguno.
  const tasaSellada = pagos.map((p) => p.rate_used).find((r) => r != null);
  // ── Y LOS BOLÍVARES TECLEADOS MANDAN SOBRE ESA CONVERSIÓN ───────────
  //
  // Regla crítica del 2026-10-24. Solo si TODOS los pagos de este libro se
  // teclearon en bolívares: con uno en bolívares y otro en divisa no hay una
  // cifra tecleada que describa el total, y entonces vale más la conversión,
  // que al menos es coherente.
  const tecleadoEnBs =
    pagos.length > 0 && pagos.every((p) => p.entry_currency === "VES" && p.entry_amount != null)
      ? Math.round(pagos.reduce((s, p) => s + Number(p.entry_amount), 0) * 100) / 100
      : null;
  const enBs =
    tecleadoEnBs != null ? tecleadoEnBs : tasaSellada != null ? total * Number(tasaSellada) : null;

  // El libro, solo para formatear. Un negocio colombiano no lo necesita.
  const resultado = await getOwnerRateContextResult(supabase, user.id);
  const ledger: LedgerDisplay | null =
    resultado.kind === "ve" ? { rate: resultado.context.effectiveRate } : null;
  const formatear = (n: number) => formatLedgerAmount(n, moneda, ledger).primary;

  const descripcion = pagos.map((p) => p.description).find((d) => d != null && d !== "") ?? null;

  // ── LO QUE SE LLEVA POR DELANTE «ELIMINAR VENTA» ─────────────────────
  //
  // El menú vive aquí, en UNA moneda, pero el borrado es de la venta entera
  // (ver `eliminarVenta`). Así que la confirmación tiene que nombrar todo lo
  // que desaparece, y eso se arma aquí porque aquí es donde se sabe de
  // monedas: cobros de contado de cada moneda y fiados que nacieron de ella.
  //
  // LOS FIADOS SON LO QUE DE VERDAD IMPORTA DE ESTA LISTA. Un tendero que
  // entra a quitar un cobro de contado y se lleva por delante una deuda viva
  // sin que nadie se lo dijera es el peor resultado de esta pantalla.
  const { data: fiados } = await supabase
    .from("movements")
    .select("amount, currency")
    .eq("sale_id", saleId)
    .eq("type", "charge")
    .is("deleted_at", null);

  const porMoneda = new Map<string, number>();
  for (const p of pagosCrudos ?? []) {
    const clave = (p.currency ?? "") as string;
    porMoneda.set(clave, (porMoneda.get(clave) ?? 0) + Number(p.amount));
  }

  const loQueSeLleva = [
    ...[...porMoneda].map(
      ([c, total]) =>
        `Cobro de contado de ${formatLedgerAmount(total, (c || null) as LedgerCurrency | null, ledger).primary}`,
    ),
    ...(fiados ?? []).map(
      (f) =>
        `Fiado de ${formatLedgerAmount(Number(f.amount), (f.currency ?? null) as LedgerCurrency | null, ledger).primary}`,
    ),
  ];

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* LA BARRA DEL FRAME: flecha a la izquierda, «⋮» a la derecha. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 flex items-center justify-between border-b bg-background px-4 py-3">
        <Button variant="ghost" size="icon" asChild className="-ml-2">
          <Link href={`/clients/${cliente.id}`} aria-label={`Volver a ${cliente.name}`}>
            <IconoVolver className="text-primary" />
          </Link>
        </Button>
        <VentaAcciones saleId={venta.id as string} clientId={cliente.id} loQueSeLleva={loQueSeLleva} />
      </div>

      <ScreenTitle>Detalle de transacción</ScreenTitle>
      <CodigoDeTransaccion codigo={(venta.transaction_code as string | null) ?? null} />

      <dl className="flex flex-col gap-4">
        <Grupo>
          <Fila nombre="Fecha">{formatDate(venta.created_at as string)}</Fila>
        </Grupo>

        {/* LA TARJETA SE SEPARA CON UNA LÍNEA, no con un recuadro — frame
            `1487:9948`. Y su título va en 16 semibold. */}
        <div className="flex flex-col gap-1.5 border-t py-2.5">
          <p className="py-2 text-base leading-6 font-semibold">
            Resumen de compra{moneda ? ` en ${NOMBRE_DE_MONEDA[moneda]}` : ""}
          </p>

          <Fila nombre="Tipo">
            <span className="inline-flex items-center gap-1.5">
              De contado
              {/* EL VISTO VERDE, no la flecha del fiado — frame `1487:9953`.
                  `emerald-700` y no el `600`: medido contra blanco, el 600 da
                  3,67:1 y el piso de `DESIGN-SYSTEM.md` son 4,5. Es la misma
                  corrección que ya lleva la fila de contado del historial. */}
              <Check className="size-4 text-emerald-700 dark:text-emerald-400" aria-hidden />
            </span>
          </Fila>

          {lineas.length > 0 ? (
            <ProductosDelMovimiento productos={lineas} formatearMonto={formatear} />
          ) : null}

          {/* ── «PAGÓ», UNA SOLA FILA — frame `1580:11620` ──────────────
              Encargo del dueño el 2026-10-23. Eran DOS filas, «Pagó» con los
              bolívares entregados y «Equivalencia» con lo que valían en el
              libro, y el frame las funde en una.

              LO QUE CAMBIA DE VERDAD ES CUÁL MANDA. Antes la cifra grande era
              la de bolívares y el libro iba debajo; ahora es al revés: arriba
              lo que entra en el libro —que es lo que mueve la cuenta— y
              debajo, en gris, los bolívares que el cliente puso en la mano.

              LOS BOLÍVARES SOLO SI SE PAGÓ EN BOLÍVARES. Pagando en la moneda
              del libro serían la misma cifra dos veces; el frame dibuja el
              caso venezolano porque es el que tiene dos. */}
          <div className="border-t pt-1.5">
            <Fila nombre="Pagó">
              <span className="inline-flex flex-col items-end">
                <span className="inline-flex items-center gap-1 text-base font-semibold tabular-nums text-money-in">
                  +{formatear(total)}
                  {moneda ? <CurrencyFlagIcon currency={moneda} className="size-4" /> : null}
                </span>
                {/* «al día del pago» PEGADO A LA CIFRA, no en su propia línea.
                    Antes era un «Al día de pago» suelto debajo de la
                    equivalencia y se leía como un rótulo más; aquí califica a
                    los bolívares, que es lo único que esa fecha explica: esa
                    cantidad valió eso ESE día, no hoy. */}
                {monedaTecleada === "VES" ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatBs(entregado)} al día del pago
                  </span>
                ) : null}
              </span>
            </Fila>
          </div>

          {/* «Total» Y NO «Total por cobrar»: aquí no queda nada por cobrar.
              Es la diferencia que el frame `1487:9972` marca contra el del
              fiado, y es la que importa de toda esta pantalla. */}
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
          <dd className="text-sm break-words">{descripcion || "—"}</dd>
        </Grupo>
      </dl>
    </div>
  );
}
