import { ChartColumn } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { OwnerUnavailableDialog } from "@/components/owner-unavailable-dialog";
import { ScreenHeader } from "@/components/dashboard/screen-header";
import { ReporteCard } from "@/components/dashboard/reporte-card";
import {
  ReportesClientSearch,
  ReportesPeriodChips,
} from "@/components/dashboard/reportes-controls";
import { readWeeklyLending, hasAnyMovement } from "@/lib/weekly-lending-read";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { readOwnerCountry } from "@/lib/owner-country";
import type { LendingPeriod } from "@/lib/lending-charts";
import type { ClientSummary, OwnerCountry } from "@/lib/types";

// REPORTES — rebuilt to the Figma spec of 2026-10-04 (frame `1074:30167`).
//
// It used to be two bare charts. Now it is one card per ledger, each carrying
// that currency's capital on top and its own chart underneath, because a chart
// means something different next to the figure it explains: "fiaste 300 esta
// semana" reads one way beside "te deben 4.000" and another way alone.
//
// `CT-7` ("Informes", planned in `../docs/REPORTES-PLAN.md`) is still a bigger
// thing that will eventually own this route and rewrite this page. Taking the
// URL now is deliberate — the owner should not have to learn a second one —
// but nothing here should be built on as if it were CT-7.
//
// ─────────────────────────────────────────────────────────────────────────
// THE TWO CONTROLS LIVE IN THE URL
//
// `?periodo=` and `?cliente=`, read here and applied before a single bar is
// bucketed. The alternative — shipping the movements and filtering in the
// browser — would put a shop's whole month of rows on a phone so it could throw
// most of them away.
const PERIOD_LABEL: Record<LendingPeriod, string> = {
  "7d": "los últimos 7 días",
  "30d": "los últimos 30 días",
};

export default async function ReportesPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string; cliente?: string }>;
}) {
  const { periodo, cliente } = await searchParams;
  // Anything that is not one of the two known values falls back to 7 days
  // rather than erroring: this parameter is in a URL the owner can share, edit
  // or mistype, and a report is not worth a crash.
  const period: LendingPeriod = periodo === "30d" ? "30d" : "7d";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: clients }, { data: summaries }, { data: owner }, ownerRate] = await Promise.all([
    supabase
      .from("clients")
      .select("id, name, document_id")
      .eq("owner_id", user!.id)
      .is("trashed_at", null)
      .is("deleted_at", null)
      .order("name"),
    supabase.from("client_summary").select("*").eq("owner_id", user!.id),
    supabase.from("owners").select("country").eq("id", user!.id).single(),
    getOwnerRateContext(supabase, user!.id),
  ]);

  // Same guard as Inicio, and for the same reason: not knowing the country is
  // not knowing it is CO. Guessing here would draw a Venezuelan shop the
  // Colombian chart — which is not an error message, it is an empty chart that
  // looks like "you had a quiet week".
  const ownerCountry =
    (owner?.country as OwnerCountry | undefined) ?? (await readOwnerCountry(supabase, user!.id));
  if (!ownerCountry) return <OwnerUnavailableDialog />;

  // An unknown or hidden id simply means "no filter". Silently, and on purpose:
  // the alternative is a 404 on a screen whose job is to show numbers, from a
  // parameter the owner may have inherited from a shared link.
  const selected = (clients ?? []).find((c) => c.id === cliente) ?? null;
  const scopeIds = selected ? [selected.id] : (clients ?? []).map((c) => c.id);

  const rows = ((summaries ?? []) as ClientSummary[]).filter(
    (r) => !selected || r.client_id === selected.id,
  );
  // Flagged clients count here, exactly as they do in Inicio's capital. The
  // mark hides someone from a list; it does not stop them owing money.
  const totalCop = rows.filter((r) => Number(r.balance) > 0).reduce((s, r) => s + Number(r.balance), 0);
  const totalUsd = rows.filter((r) => Number(r.balance_usd) > 0).reduce((s, r) => s + Number(r.balance_usd), 0);
  const totalEur = rows.filter((r) => Number(r.balance_eur) > 0).reduce((s, r) => s + Number(r.balance_eur), 0);

  const lending = await readWeeklyLending(supabase, scopeIds, period);
  // Only asked when the period came back empty: on any other period the answer
  // changes nothing, and this is a count over the whole movements table.
  const everAny = lending.anyInPeriod ? true : await hasAnyMovement(supabase, scopeIds);

  const ledger = ownerRate ? { rate: ownerRate.effectiveRate } : null;
  const chartSuffix = period === "7d" ? "de la semana" : "de 30 días";

  return (
    <div className="flex flex-1 flex-col gap-4">
      <ScreenHeader
        title="Reportes"
        /* No subtitle: the spec turns that layer off on this screen, and the
           period chip right below already says which window the bars cover. */
        search={
          <ReportesClientSearch clients={clients ?? []} selectedName={selected?.name ?? null} />
        }
        filters={<ReportesPeriodChips period={period} />}
      />

      {/* "Métricas totales" is the spec's own label, and the word "totales" is
          what makes the filtered state readable: with a client picked it says
          whose numbers these are instead of quietly showing one person's under
          a heading that claims to cover everyone. */}
      <h2 className="text-base font-semibold">
        {selected ? `Métricas de ${selected.name}` : "Métricas totales"}
      </h2>

      {lending.anyInPeriod ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
          {ownerRate ? (
            <>
              <ReporteCard
                label="Capital por cobrar en USD"
                balance={totalUsd}
                currency="USD"
                ledger={ledger}
                chartData={lending.usd}
                chartTitle={`Fiado vs. Abono ${chartSuffix} (USD)`}
              />
              <ReporteCard
                label="Capital por cobrar en Euro"
                balance={totalEur}
                currency="EUR"
                ledger={ledger}
                chartData={lending.eur}
                chartTitle={`Fiado vs. Abono ${chartSuffix} (EUR)`}
              />
            </>
          ) : (
            <ReporteCard
              label="Capital por cobrar"
              balance={totalCop}
              currency={null}
              ledger={null}
              chartData={lending.cop}
              chartTitle={`Fiado vs. Abono ${chartSuffix}`}
            />
          )}
        </div>
      ) : (
        /* Two different texts because they are two different situations, and
           confusing them reads badly in both directions: telling someone who
           signed up yesterday "nothing in the last 7 days" sounds like a
           reproach for a week they were not here for, and telling someone with
           eight months of history "here you will see your activity" sounds like
           the app lost their data. */
        <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/30 px-6 py-12 text-center">
          <ChartColumn className="size-8 text-muted-foreground" aria-hidden="true" />
          {everAny ? (
            <>
              <p className="font-medium">
                {selected ? `${selected.name} no tiene movimientos` : "No hay movimientos"} en{" "}
                {PERIOD_LABEL[period]}
              </p>
              <p className="max-w-sm text-sm text-muted-foreground">
                {selected ? "Su saldo" : "Tu cartera"} sigue igual; aquí solo se ve el movimiento
                del periodo que elijas.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">Todavía no hay nada que mostrar</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                En cuanto registres tu primer fiado o abono, aquí verás cuánto diste y cuánto te
                pagaron.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
