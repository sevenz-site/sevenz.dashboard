import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { MetricCharts } from "@/components/admin/metric-charts";
import { MetricFilters } from "@/components/admin/metric-filters";
import { MetricTabs } from "@/components/admin/metric-tabs";
import { ServiceHealth } from "@/components/admin/service-health";
import { getSaludDelCronWhatsapp } from "@/lib/admin/whatsapp-cron";
import { getSaludDelAsistente } from "@/lib/admin/asistente-salud";
import { requireSuperadmin } from "@/lib/admin/guard";
import { seccionDe } from "@/lib/admin/secciones";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import {
  getAverageCreditScore,
  getByOwner,
  getByOwnerMoney,
  getCurrencySummary,
  getHealth,
  getOrders,
  getOwnerOptions,
  getTotals,
  getTransactions,
  getTrend,
  type Bucket,
  type MetricFilters as Filters,
  type TransactionRow,
} from "@/lib/admin/metrics";

// MetricCharts is imported directly rather than through next/dynamic, unlike
// components/dashboard/balance-card.tsx. Two reasons: ssr:false is not allowed
// from a Server Component, and the deferral would buy nothing here. Recharts
// only reaches this route's own bundle, so it cannot creep back onto the
// owner-facing critical path it was removed from — and on a page whose whole
// purpose is the charts, deferring them just trades content for a spinner.

const money = (n: number | null) =>
  n === null || n === undefined
    ? "—"
    : Number(n).toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Spelled out in the country summary, where there are two rows and room for it.
// The "Por negocio" table keeps the code, because it is one column among six.
// Falls through to the raw value for anything unexpected rather than rendering
// a blank cell.
const COUNTRY_LABEL: Record<string, string> = { CO: "Colombia", VE: "Venezuela" };

// The four origins of a fiado, in the order they are asked about. The owner
// chose on 2026-10-31 that all four count as fiado; the breakdown is what lets
// a reader tell new lending from debt that already existed before Sevenz.
const ORIGENES_DE_FIADO = [
  { clave: "venta", etiqueta: "De venta" },
  { clave: "deuda_antigua", etiqueta: "Deuda antigua" },
  { clave: "libreta", etiqueta: "Libreta por foto" },
  { clave: "manual", etiqueta: "Manual antiguo" },
] as const;

// Several amounts, one per currency, in one cell -- never added together.
function PorMoneda({ items }: { items: { currency: string; amount: number }[] }) {
  const conDinero = items.filter((i) => Number(i.amount) !== 0);
  if (conDinero.length === 0) return <>—</>;
  return (
    <span className="flex flex-col items-end">
      {conDinero.map((i) => (
        <span key={i.currency} className="whitespace-nowrap">
          {i.currency} {money(i.amount)}
        </span>
      ))}
    </span>
  );
}

// `alert` no es decoración: estas dos tarjetas viven entre métricas de producto
// pero no lo son, y en cero no dicen nada. Solo se tiñen cuando hay algo que
// mirar, para que la diferencia se note sin necesidad de una sección aparte.
function Stat({
  label,
  value,
  hint,
  alert = false,
  explica,
}: {
  label: string;
  value: string;
  hint?: string;
  alert?: boolean;
  // Qué cuenta esta cifra exactamente, y sobre todo qué NO cuenta.
  //
  // Una etiqueta de dos palabras no puede decir que "Movimientos" excluye los
  // borrados, que "Malas pagas" sale del historial de marcas y no de quién
  // está marcado hoy, o que el puntaje se calcula al mirarlo y no se guarda.
  // Sin eso, dos personas leen el mismo número y entienden cosas distintas —
  // y estos números se usan para decidir y para responderle a un inversor.
  explica?: string;
}) {
  return (
    <div className={`relative flex flex-col gap-0.5 rounded-lg border p-3 ${alert ? "border-destructive/40" : ""}`}>
      <span className="pr-5 text-xs text-muted-foreground">{label}</span>
      <span className={`text-2xl font-semibold tabular-nums ${alert ? "text-destructive" : ""}`}>
        {value}
      </span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      {explica ? (
        <Popover>
          {/* size-4, apagado hasta el hover y con aria-label: la regla de
              DESIGN-SYSTEM.md para los iconos-botón dentro de una card. */}
          <PopoverTrigger
            className="absolute top-2.5 right-2.5 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
            aria-label={`Qué cuenta ${label}`}
          >
            <Info className="size-4" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 text-sm leading-snug">
            {explica}
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
  );
}

function Tabla({ titulo, nota, children }: { titulo: string; nota?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{titulo}</h2>
      {nota ? <p className="-mt-1 text-sm text-muted-foreground">{nota}</p> : null}
      {/* overflow-x-auto on the table's own container, never the page — a
          wide table must scroll inside itself. */}
      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">{children}</table>
      </div>
    </div>
  );
}

const th = "px-3 py-2 text-right font-medium whitespace-nowrap";
const td = "px-3 py-2 text-right tabular-nums";

export default async function AdminMetricsPage({
  searchParams,
}: {
  searchParams: Promise<{
    country?: string;
    currency?: string;
    owner?: string;
    from?: string;
    to?: string;
    bucket?: string;
    seccion?: string;
  }>;
}) {
  // Repeated here even though app/admin/layout.tsx already calls it. Next
  // renders a layout and its page IN PARALLEL — a layout cannot block the
  // page's data fetching. Without this, a non-admin's request would still run
  // all six service-role queries below before notFound() replaced the render.
  // Nothing would reach them, but the work would happen, and any future admin
  // page with a side effect would perform it for someone unauthorised.
  await requireSuperadmin();

  const sp = await searchParams;

  const filters: Filters = {
    country: sp.country === "CO" || sp.country === "VE" ? sp.country : null,
    currency:
      sp.currency === "COP" || sp.currency === "USD" || sp.currency === "EUR" ? sp.currency : null,
    // Comma-separated, written by the multi-select. An empty list and a
    // missing param are the same thing — no filter — so a cleared selector
    // shows the whole platform rather than an empty report.
    ownerIds: (sp.owner ?? "").split(",").filter(Boolean),
    // Two calendar days, both inclusive. Since migration 169 the functions read
    // them as days and compare each row's day IN THE ZONE OF ITS BUSINESS
    // (Caracas / Bogotá), so a sale at 9 p.m. in Caracas is in its own day,
    // not the next one. The old `${to}T23:59:59.999Z` is still read the same
    // way, which is what lets the migration go out before this code.
    from: sp.from || null,
    to: sp.to || null,
  };
  const bucket: Bucket = sp.bucket === "day" || sp.bucket === "month" ? sp.bucket : "week";
  const seccion = seccionDe(sp.seccion);

  const owners = await getOwnerOptions();

  // Qué parte de la plataforma se está mirando, en una frase. Se arma de los
  // filtros que de verdad recortan el conjunto: país, moneda y negocio. Las
  // fechas quedan fuera a propósito — acotan CUÁNDO, no A QUIÉN, y meterlas
  // aquí haría una frase larguísima para la pregunta que esta línea responde.
  const recortes: string[] = [];
  const negociosElegidos = filters.ownerIds ?? [];
  if (negociosElegidos.length > 0) {
    recortes.push(
      negociosElegidos.length === 1
        ? (owners.find((o) => o.id === negociosElegidos[0])?.business_name ?? "1 negocio")
        : `${negociosElegidos.length} negocios`,
    );
  }
  if (filters.country) recortes.push(filters.country === "VE" ? "Venezuela" : "Colombia");
  if (filters.currency) recortes.push(filters.currency);
  const alcance = recortes.length === 0 ? "Todos los negocios" : `Filtrado: ${recortes.join(" · ")}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <ScreenTitle>Métricas de producto</ScreenTitle>
        {/* Dice lo que hay en pantalla, no lo que suele haber.
            Ponía "Todos los negocios" siempre, también con tres seleccionados,
            así que el encabezado afirmaba una cosa y las cifras eran otra — y
            "Registros rechazados: 0" con un filtro puesto no quiere decir que
            nadie se quedó sin registrar, solo que ninguno de esos tres. Un
            número filtrado bajo un título que dice "todos" es como se lee mal
            un panel. */}
        <p className="text-sm text-muted-foreground">
          {alcance}. Los montos nunca se suman entre monedas.
        </p>
      </div>

      <MetricFilters owners={owners} />
      <MetricTabs activa={seccion} />

      {seccion === "transacciones" ? <SeccionTransacciones filters={filters} bucket={bucket} /> : null}
      {seccion === "pedidos" ? <SeccionPedidos filters={filters} /> : null}
      {seccion === "clientes" ? <SeccionClientes filters={filters} /> : null}
      {seccion === "negocios" ? <SeccionNegocios filters={filters} /> : null}
      {seccion === "salud" ? <SeccionSalud filters={filters} filtrado={recortes.length > 0} /> : null}
    </div>
  );
}

// ── TRANSACCIONES ─────────────────────────────────────────────────────────
//
// The owner's metrics 1 and 2 of 2026-10-31: how MANY transactions of each
// kind (1) and how much MONEY each kind moved (2). Counts add up across
// currencies; amounts never do.
async function SeccionTransacciones({ filters, bucket }: { filters: Filters; bucket: Bucket }) {
  const [tx, trend] = await Promise.all([getTransactions(filters), getTrend(filters, bucket)]);

  const cuantas = (kind: TransactionRow["kind"]) =>
    tx.filter((r) => r.kind === kind).reduce((s, r) => s + Number(r.tx_count), 0);
  const contado = cuantas("contado");
  const fiado = cuantas("fiado");
  const abono = cuantas("abono");

  const monedas = [...new Set(tx.map((r) => r.currency))].sort();
  const monto = (currency: string, kind: string, origin?: string) =>
    tx
      .filter((r) => r.currency === currency && r.kind === kind && (!origin || r.origin === origin))
      .reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Transacciones"
          value={String(contado + fiado + abono)}
          hint="contado + fiado + abono"
          explica="Todas las transacciones del periodo, sumando monedas: aquí sí se puede, porque cuenta operaciones y no dinero. Una venta mixta —una parte pagada y otra fiada— cuenta una vez como contado y otra como fiado, igual que sale en el historial del cliente."
        />
        <Stat
          label="Ventas de contado"
          value={String(contado)}
          explica="Ventas pagadas enteras, una por moneda: una venta que se pagó en dólares y en euros cuenta como dos. Incluye las del Mostrador. No escriben nada en el saldo del cliente, y por eso antes no salían en este panel."
        />
        <Stat
          label="Fiados"
          value={String(fiado)}
          explica="Todo lo que quedó debiendo: la parte fiada de una venta, la deuda antigua con la que nace un cliente, los fiados leídos de una foto de libreta y los anotados a mano antes del flujo de venta. El desglose de abajo los separa. Los fiados borrados no cuentan."
        />
        <Stat
          label="Abonos"
          value={String(abono)}
          explica="Pagos a una deuda. Un abono repartido entre varios fiados cuenta una vez (por moneda), porque es una sola transacción. También cuenta lo que el cliente pagó en el momento de una venta fiada, que no escribe un abono aparte."
        />
      </div>

      <Tabla
        titulo="Monto por tipo"
        nota="Lo que movió cada tipo de transacción, una fila por moneda."
      >
        <thead className="border-b bg-muted/30">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Moneda</th>
            <th className={th}>Contado</th>
            <th className={th}>Fiado</th>
            <th className={th}>Abono</th>
          </tr>
        </thead>
        <tbody>
          {monedas.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                No hay transacciones en este rango.
              </td>
            </tr>
          ) : (
            monedas.map((c) => (
              <tr key={c} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{c}</td>
                <td className={td}>{money(monto(c, "contado"))}</td>
                <td className={td}>{money(monto(c, "fiado"))}</td>
                <td className={td}>{money(monto(c, "abono"))}</td>
              </tr>
            ))
          )}
        </tbody>
      </Tabla>

      {monedas.length > 0 ? (
        <Tabla
          titulo="Fiado por origen"
          nota="La libreta por foto lleva la fecha de la libreta, no la del día en que se subió: con un filtro de fechas cae en su fecha original."
        >
          <thead className="border-b bg-muted/30">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Moneda</th>
              {ORIGENES_DE_FIADO.map((o) => (
                <th key={o.clave} className={th}>
                  {o.etiqueta}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monedas.map((c) => (
              <tr key={c} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{c}</td>
                {ORIGENES_DE_FIADO.map((o) => (
                  <td key={o.clave} className={td}>
                    {money(monto(c, "fiado", o.clave))}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </Tabla>
      ) : null}

      {monedas.length > 0 ? (
        <Tabla titulo="Abono por origen">
          <thead className="border-b bg-muted/30">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Moneda</th>
              <th className={th}>Abonos</th>
              <th className={th}>Al vender a fiado</th>
            </tr>
          </thead>
          <tbody>
            {monedas.map((c) => (
              <tr key={c} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{c}</td>
                <td className={td}>{money(monto(c, "abono", "abono"))}</td>
                <td className={td}>{money(monto(c, "abono", "al_vender"))}</td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      ) : null}

      <MetricCharts trend={trend} bucket={bucket} />
    </div>
  );
}

// ── PEDIDOS ───────────────────────────────────────────────────────────────
//
// The owner's metric 3 of 2026-10-31, and his answer to which orders count:
// the registered ones, split contado / fiado, and the pending ones apart.
async function SeccionPedidos({ filters }: { filters: Filters }) {
  const orders = await getOrders(filters);
  const registrados = orders.filter((r) => r.status === "registrado");
  const pendientes = orders.filter((r) => r.status === "pendiente");
  const monedas = [...new Set(orders.map((r) => r.currency))].sort();
  const monto = (currency: string, status: string, kind?: string) =>
    orders
      .filter((r) => r.currency === currency && r.status === status && (!kind || r.kind === kind))
      .reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Pedidos registrados"
          value={String(registrados.reduce((s, r) => s + Number(r.orders), 0))}
          explica="Pedidos del catálogo que el negocio convirtió en venta en el periodo, por la fecha de la venta. Un pedido en dos monedas da dos ventas y cuenta una vez por moneda; uno que mezcló contado y fiado en la misma moneda no existe, porque cada moneda se cobra de una sola forma."
        />
        <Stat
          label="Pedidos pendientes"
          value={String(pendientes.reduce((s, r) => s + Number(r.orders), 0))}
          explica="Pedidos que llegaron en el periodo y siguen sin registrar ni descartar, por la fecha del pedido. Es la misma regla que la campana del tendero, con una diferencia: si una moneda del pedido ya se registró, esa parte ya no cuenta como pendiente, para no sumarla dos veces."
        />
      </div>

      <Tabla
        titulo="Monto procesado por pedidos"
        nota="Registrado: lo vendido en cada venta que vino de un pedido. Pendiente: lo que suman los pedidos sin registrar; sus monedas pueden incluir USDT o bolívares, y se enseñan tal cual."
      >
        <thead className="border-b bg-muted/30">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Moneda</th>
            <th className={th}>De contado</th>
            <th className={th}>A fiado</th>
            <th className={th}>Total registrado</th>
            <th className={th}>Pendiente</th>
          </tr>
        </thead>
        <tbody>
          {monedas.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                No hay pedidos en este rango.
              </td>
            </tr>
          ) : (
            monedas.map((c) => (
              <tr key={c} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{c}</td>
                <td className={td}>{money(monto(c, "registrado", "contado"))}</td>
                <td className={td}>{money(monto(c, "registrado", "fiado"))}</td>
                <td className={td}>{money(monto(c, "registrado"))}</td>
                <td className={td}>{money(monto(c, "pendiente"))}</td>
              </tr>
            ))
          )}
        </tbody>
      </Tabla>
    </div>
  );
}

// ── CLIENTES Y CRÉDITO ────────────────────────────────────────────────────
async function SeccionClientes({ filters }: { filters: Filters }) {
  const [summary, totals, credit] = await Promise.all([
    getCurrencySummary(filters),
    getTotals(filters),
    getAverageCreditScore(filters),
  ]);

  const plazoRows = summary.filter((r) => r.plazo_average !== null);
  // Weighted by how many charges actually set a plazo, so a currency with three
  // charges cannot pull the average as hard as one with three hundred.
  const plazoWeighted =
    plazoRows.length > 0
      ? plazoRows.reduce((s, r) => s + Number(r.plazo_average) * Number(r.charges_with_plazo), 0) /
        plazoRows.reduce((s, r) => s + Number(r.charges_with_plazo), 0)
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Clientes creados"
          value={String(totals.clients_created)}
          explica="Clientes que los negocios dieron de alta en el periodo filtrado. Cuenta por fecha de creación, así que un cliente creado en agosto no aparece aquí aunque siga activo hoy. Incluye los que después fueron a la papelera."
        />
        <Stat
          label="Malas pagas"
          value={String(totals.mala_paga_labelled)}
          hint={`${totals.mala_paga_unlabelled} desmarcadas · ${totals.clients_flagged_now} activas`}
          explica="Veces que un dueño marcó a un cliente como mala paga en el periodo, no cuántos están marcados ahora. Sale del historial de marcas, así que un cliente marcado y desmarcado cuenta en los dos números. 'Activas' sí es el total marcado hoy, y ese no depende del periodo."
        />
        <Stat
          label="Plazo promedio"
          value={plazoWeighted === null ? "—" : `${plazoWeighted.toFixed(1)} d`}
          explica="Días que los dueños dan de plazo al fiar, en promedio. Solo cuenta los fiados donde se puso un plazo; los que se dejaron en blanco no entran. Está ponderado por cantidad de fiados, así que una moneda con tres no pesa igual que una con trescientos."
        />
        <Stat
          label="Puntaje crediticio"
          value={credit.average === null ? "—" : String(credit.average)}
          hint={`de 1000 · ${credit.clients} clientes`}
          explica="Promedio del puntaje de los clientes con historial suficiente para calcularlo; los demás quedan fuera y por eso el número de clientes es menor que el total. El puntaje no se guarda: se calcula al mirarlo, con los mismos datos que ve el dueño en la ficha."
        />
      </div>

      <Tabla
        titulo="Fiados y abonos por moneda"
        nota="Solo lo que escribe el libro del cliente: no incluye las ventas de contado ni lo pagado al vender a fiado. Para eso está la pestaña Transacciones."
      >
        <thead className="border-b bg-muted/30">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Moneda</th>
            <th className={th}>Fiados</th>
            <th className={th}>Total fiado</th>
            <th className={th}>Promedio</th>
            <th className={th}>Abonos</th>
            <th className={th}>Total abonado</th>
            <th className={th}>Promedio</th>
          </tr>
        </thead>
        <tbody>
          {summary.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                No hay movimientos en este rango.
              </td>
            </tr>
          ) : (
            summary.map((r) => (
              <tr key={r.currency} className="border-b last:border-0">
                <td className="px-3 py-2 font-medium">{r.currency}</td>
                <td className={td}>{r.charges_count}</td>
                <td className={td}>{money(r.charge_total)}</td>
                <td className={td}>{money(r.charge_average)}</td>
                <td className={td}>{r.payments_count}</td>
                <td className={td}>{money(r.payment_total)}</td>
                <td className={td}>{money(r.payment_average)}</td>
              </tr>
            ))
          )}
        </tbody>
      </Tabla>
    </div>
  );
}

// ── NEGOCIOS ──────────────────────────────────────────────────────────────
async function SeccionNegocios({ filters }: { filters: Filters }) {
  const [byOwner, dinero] = await Promise.all([getByOwner(filters), getByOwnerMoney(filters)]);

  // THE MONEY COMES FROM `getByOwnerMoney`, one row per (business, currency).
  // `byOwner.charge_total` adds dollars to euros when no currency filter is
  // set, and this table printed it as «Total fiado» under a page that says
  // amounts are never added across currencies (fixed 2026-10-31, migration
  // 169). `byOwner` still gives the counts and the last activity.
  const dineroDe = (ownerId: string) => dinero.filter((d) => d.owner_id === ownerId);
  const paisDe = new Map(byOwner.map((o) => [o.owner_id, o.country]));

  // Rolled up from the same rows the "Por negocio" table prints, so a reader
  // can add that table up by hand and get this. Money stays per currency.
  const byCountry = [...byOwner
    .reduce((acc, o) => {
      const row = acc.get(o.country) ?? { country: o.country, owners: 0, clients: 0, movements: 0 };
      row.owners += 1;
      row.clients += Number(o.clients);
      row.movements += Number(o.movements);
      acc.set(o.country, row);
      return acc;
    }, new Map<string, { country: string; owners: number; clients: number; movements: number }>())
    .values()].sort((a, b) => a.country.localeCompare(b.country));
  const dineroDelPais = (country: string, campo: "charge_total" | "payment_total") => {
    const porMoneda = new Map<string, number>();
    for (const d of dinero) {
      if (paisDe.get(d.owner_id) !== country) continue;
      porMoneda.set(d.currency, (porMoneda.get(d.currency) ?? 0) + Number(d[campo]));
    }
    return [...porMoneda.entries()].sort().map(([currency, amount]) => ({ currency, amount }));
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Summarises the table directly below it, from the same rows, so the two
          cannot disagree. That is why it is built from byOwner rather than by
          asking admin_metrics_totals once per country: `clients_created` there
          counts clients created INSIDE the date window, while this column counts
          every client the business has. Both are right; putting them side by
          side under similar labels is what would be wrong.

          Hidden when a country filter is on — every figure above is already
          that country, so a one-row breakdown of it says nothing. */}
      {byCountry.length > 1 ? (
        <Tabla titulo="Por país">
          <thead className="border-b bg-muted/30">
            <tr>
              <th className="px-3 py-2 text-left font-medium">País</th>
              <th className={th}>Negocios</th>
              <th className={th}>Clientes</th>
              <th className={th}>Fiados y abonos</th>
              <th className={th}>Total fiado</th>
              <th className={th}>Total abonado</th>
            </tr>
          </thead>
          <tbody>
            {byCountry.map((c) => (
              <tr key={c.country} className="border-b align-top last:border-0">
                <td className="px-3 py-2">{COUNTRY_LABEL[c.country] ?? c.country}</td>
                <td className={td}>{c.owners}</td>
                <td className={td}>{c.clients}</td>
                <td className={td}>{c.movements}</td>
                <td className={td}>
                  <PorMoneda items={dineroDelPais(c.country, "charge_total")} />
                </td>
                <td className={td}>
                  <PorMoneda items={dineroDelPais(c.country, "payment_total")} />
                </td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      ) : null}

      <Tabla titulo="Por negocio">
        <thead className="border-b bg-muted/30">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Negocio</th>
            <th className="px-3 py-2 text-left font-medium">País</th>
            <th className={th}>Clientes</th>
            <th className={th}>Fiados y abonos</th>
            <th className={th}>Total fiado</th>
            <th className={th}>Total abonado</th>
            <th className={th}>Última actividad</th>
          </tr>
        </thead>
        <tbody>
          {byOwner.map((o) => (
            <tr key={o.owner_id} className="border-b align-top last:border-0">
              <td className="px-3 py-2">{o.business_name || "(sin nombre)"}</td>
              <td className="px-3 py-2">{o.country}</td>
              <td className={td}>{o.clients}</td>
              <td className={td}>{o.movements}</td>
              <td className={td}>
                <PorMoneda
                  items={dineroDe(o.owner_id).map((d) => ({ currency: d.currency, amount: d.charge_total }))}
                />
              </td>
              <td className={td}>
                <PorMoneda
                  items={dineroDe(o.owner_id).map((d) => ({ currency: d.currency, amount: d.payment_total }))}
                />
              </td>
              <td className="px-3 py-2 text-right whitespace-nowrap text-muted-foreground">
                {o.last_activity
                  ? new Intl.DateTimeFormat("es-VE", { day: "numeric", month: "short" }).format(
                      new Date(o.last_activity),
                    )
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </Tabla>
    </div>
  );
}

// ── SALUD ─────────────────────────────────────────────────────────────────
//
// Not product metrics: the health of the money writes and of the pipelines.
async function SeccionSalud({ filters, filtrado }: { filters: Filters; filtrado: boolean }) {
  const [health, cronWhatsapp, asistente] = await Promise.all([
    getHealth(filters),
    // SIN `filters` a propósito: el filtro de fechas acota el negocio, y esto
    // no es una métrica de negocio sino el pulso de una tubería. Preguntarle
    // "¿corrió el cron en septiembre?" no significa nada útil; la única
    // pregunta es si corrió HOY.
    getSaludDelCronWhatsapp(),
    // SIN `filters`, por lo mismo que el cron: esto no es una métrica de
    // negocio sino el pulso de una tubería, y «¿se cayó el asistente en
    // septiembre?» no se puede hacer nada con ello. La ventana la fija la
    // propia función en 7 días.
    getSaludDelAsistente(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {/* Movimientos que el dueño intentó registrar y no se escribieron. En
            cero no significa "no pasa nada": significa que el guardarraíl no ha
            tenido que actuar. Cualquier número distinto de cero es un dueño que
            se quedó sin registrar una venta. */}
        <Stat
          label="Registros rechazados"
          explica="Ventas que un dueño intentó anotar y no se pudieron guardar, porque faltaba saber la moneda o no se pudieron leer los datos de su negocio. Cada una es un fiado que no entró. Existe porque el guardarraíl de moneda prefiere rechazar antes que adivinar, y sin este contador esos rechazos serían invisibles para nosotros."
          value={String(health.rejections_total)}
          hint={
            health.rejections_total === 0
              ? "ningún dueño se quedó sin registrar"
              : `${health.rejected_rows} transacciones perdidas · ${health.rejections_sin_moneda} sin moneda · ${health.rejections_pais_desconocido} sin leer el negocio`
          }
          alert={health.rejections_total > 0}
        />
        {/* Un aviso no es una venta perdida: el dueño lo vio y pudo recargar.
            Importa sobre todo para los negocios colombianos — hasta ahora, no
            poder leer el país se resolvía asumiendo Colombia, que para ellos
            acertaba siempre. Si este número se queda en cero, quitarlo les
            salió gratis. */}
        <Stat
          label="Avisos en pantalla"
          value={String(health.screen_warnings)}
          hint="no pudimos leer el negocio al abrir"
          alert={health.screen_warnings > 0}
          explica="Veces que la app no pudo leer los datos de un negocio al abrir una pantalla y le tapó la vista con el aviso de recargar. Ya reintenta sola antes de rendirse, así que lo que se cuenta aquí es lo que el dueño llegó a ver. En cero significa que el reintento basta."
        />
        {/* Sin `alert`, y no por descuido. Producción arranca con 172: los
            movimientos que la 025 marcó como dólares el 2026-08-24 sin poder
            inventarles una tasa que ya nadie sabía. Ese número no baja nunca,
            así que pintarlo en rojo dejaría el panel con una alarma encendida
            desde el primer día y para siempre — y una alarma que suena siempre
            deja de leerse, que es peor que no tenerla.

            Es un número que se vigila, no uno que avisa; para verlo moverse
            está el filtro de fechas. La tarjeta de rechazos sí conserva el rojo
            porque esa arranca en cero: si se enciende, acaba de pasar algo. */}
        <Stat
          label="Fiados sin tasa sellada"
          value={String(health.movements_without_rate)}
          // La base son 172 y no baja nunca — pero eso solo es cierto mirando
          // la plataforma entera. Con un filtro puesto la cifra es un trozo de
          // esos 172, y la pista decía "172 son anteriores" al lado de un 141:
          // el número que no puede bajar, bajando. Ahora la pista se calla
          // cuando no está hablando del conjunto completo.
          hint={
            filtrado
              ? "se registraron bien, sin guardar la tasa del día"
              : "se registraron bien; 172 son anteriores al 24 ago 2026"
          }
          explica="Fiados correctos, en su moneda correcta, pero sin guardar a cuánto estaba el dólar ese día. Arranca en 172: son los de antes del 24 de agosto de 2026, que se marcaron como dólares sin poder inventarles una tasa. Ese número no baja nunca. Solo importa si empieza a subir, y eso querría decir que el BCV está fallando."
        />
        {/* EL PULSO DEL CRON DE WHATSAPP, y lo que se enseña es CUÁNTO HACE
            DE LA ÚLTIMA CORRIDA, no cuántos mensajes salieron.

            El número de enviós no sirve como alarma: `whatsapp_sends` solo
            escribe cuando se reserva un envió, así que una tanda en la que
            nadie tenía los avisos activos y un cron que lleva tres semanas sin
            dispararse son las dos cero filas. Y la segunda es la que pasa,
            porque los crons de Vercel Hobby son de mejor esfuerzo. La
            migración 071 escribe una fila por ejecución, siempre, y esta
            tarjeta la lee.

            En rojo a las 26 h: margen para que Vercel se retrase un par de
            horas sin encender nada, y aun así caza el día entero perdido. */}
        <Stat
          label="Cron de WhatsApp"
          value={cronWhatsapp.horasDesdeUltima === null ? "—" : `${cronWhatsapp.enviados7d}`}
          hint={cronWhatsapp.detalle}
          alert={cronWhatsapp.estado === "fail"}
          explica="Cuándo corrió por última vez la tanda de avisos por WhatsApp a los dueños, y cuántos mensajes salieron en los últimos 7 días. La cifra grande son los envíos de la semana; lo que hay que mirar es la línea de abajo. Se pone en rojo cuando pasan más de 26 horas sin una corrida, porque el cron va una vez al día: eso significa que dejó de dispararse, y nadie se entera por otra vía hasta que un dueño dice que no le llega nada. Un cero en envíos NO es una alarma por sí solo — puede que ningún dueño tenga los avisos activos, o que sea lunes y solo toque el resumen."
        />

        {/* LAS CAÍDAS DEL ASISTENTE — encargo del dueño el 2026-10-29.
            Va al lado del cron y no en el panel de salud de abajo a
            propósito: aquello son SONDAS, que llaman al servicio y dicen si
            contesta ahora. Esto es un RECUENTO, y la diferencia importa
            porque el asistente está hecho para que su caída sea invisible —
            al tendero le sale un texto escrito a mano, sin ningún error en
            pantalla. Una sonda puede decir «Gemini responde» todos los días y
            tapar que a treinta negocios les falló esta mañana. */}
        <Stat
          label="Caídas del asistente"
          value={asistente.total === 0 ? "—" : `${asistente.caidas}`}
          hint={asistente.detalle}
          alert={asistente.alarma}
          explica="Cuántos resúmenes del asistente de Reportes se tuvieron que resolver con el texto escrito a mano en lugar de con la IA, en los últimos 7 días. La cifra grande son las caídas; la línea de abajo dice de cuántos resúmenes y por qué motivo, que es lo que decide qué hacer: «cuota agotada» significa que el nivel gratuito de Gemini tocó techo y toca pasar a pago; «Gemini falló» es de Google y no hay nada que tocar aquí; «se agotó el tiempo» es que nuestro presupuesto de 12 segundos se quedó corto; «cifra inventada» es que el modelo escribió un número que no estaba en los datos y la app lo rechazó —el fallo funcionó—; y «sin clave» es que falta la variable de entorno. Se pone en rojo cuando más de un tercio de la semana se cayó, y solo con cinco resúmenes o más: con menos, un único fallo daría porcentajes que no significan nada."
        />
      </div>

      {/* Last, and inert until clicked. It is a tool you come looking for when
          something seems wrong, not a number to read alongside the metrics. */}
      <ServiceHealth />
    </div>
  );
}
