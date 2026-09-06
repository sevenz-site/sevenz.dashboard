import { MetricCharts } from "@/components/admin/metric-charts";
import { MetricFilters } from "@/components/admin/metric-filters";
import { ServiceHealth } from "@/components/admin/service-health";
import { requireSuperadmin } from "@/lib/admin/guard";
import {
  getAverageCreditScore,
  getByOwner,
  getCurrencySummary,
  getOwnerOptions,
  getTotals,
  getTrend,
  type Bucket,
  type MetricFilters as Filters,
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

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border p-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-2xl font-semibold tabular-nums">{value}</span>
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

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
    ownerId: sp.owner || null,
    // A date input gives YYYY-MM-DD. "to" is exclusive in every RPC, so the
    // day the user picks would otherwise be missing from their own range.
    from: sp.from || null,
    to: sp.to ? `${sp.to}T23:59:59.999Z` : null,
  };
  const bucket: Bucket = sp.bucket === "day" || sp.bucket === "month" ? sp.bucket : "week";

  const [summary, totals, trend, byOwner, owners, credit] = await Promise.all([
    getCurrencySummary(filters),
    getTotals(filters),
    getTrend(filters, bucket),
    getByOwner(filters),
    getOwnerOptions(),
    getAverageCreditScore(filters),
  ]);

  const movementsTotal = summary.reduce((s, r) => s + Number(r.movements_total), 0);
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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Métricas de producto</h1>
        <p className="text-sm text-muted-foreground">
          Todos los negocios. Los montos nunca se suman entre monedas.
        </p>
      </div>

      <MetricFilters owners={owners} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Clientes creados" value={String(totals.clients_created)} />
        <Stat label="Movimientos" value={String(movementsTotal)} />
        <Stat
          label="Malas pagas"
          value={String(totals.mala_paga_labelled)}
          hint={`${totals.mala_paga_unlabelled} desmarcadas · ${totals.clients_flagged_now} activas`}
        />
        <Stat
          label="Plazo promedio"
          value={plazoWeighted === null ? "—" : `${plazoWeighted.toFixed(1)} d`}
        />
        <Stat
          label="Puntaje crediticio"
          value={credit.average === null ? "—" : String(credit.average)}
          hint={`de 1000 · ${credit.clients} clientes`}
        />
      </div>

      <MetricCharts trend={trend} bucket={bucket} />

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Dinero por moneda</h2>
        {/* overflow-x-auto on the table's own container, never the page — a
            wide table must scroll inside itself. */}
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Moneda</th>
                <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Fiados</th>
                <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Total fiado</th>
                <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Promedio</th>
                <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Abonos</th>
                <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Total abonado</th>
                <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Promedio</th>
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
                    <td className="px-3 py-2 text-right tabular-nums">{r.charges_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.charge_total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.charge_average)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.payments_count}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.payment_total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{money(r.payment_average)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Por negocio</h2>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30">
              <tr>
                <th className="px-3 py-2 text-left font-medium">Negocio</th>
                <th className="px-3 py-2 text-left font-medium">País</th>
                <th className="px-3 py-2 text-right font-medium">Clientes</th>
                <th className="px-3 py-2 text-right font-medium">Movimientos</th>
                <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Total fiado</th>
                <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Última actividad</th>
              </tr>
            </thead>
            <tbody>
              {byOwner.map((o) => (
                <tr key={o.owner_id} className="border-b last:border-0">
                  <td className="px-3 py-2">{o.business_name || "(sin nombre)"}</td>
                  <td className="px-3 py-2">{o.country}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{o.clients}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{o.movements}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{money(o.charge_total)}</td>
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
          </table>
        </div>
      </div>

      {/* Last, and inert until clicked. It is a tool you come looking for when
          something seems wrong, not a number to read alongside the metrics. */}
      <ServiceHealth />
    </div>
  );
}
