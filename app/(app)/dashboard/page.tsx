import { createClient } from "@/lib/supabase/server";
import { ClientTable } from "@/components/dashboard/client-table";
import { ClientSearchDialog } from "@/components/dashboard/client-search-dialog";
import { WeeklyLendingChart } from "@/components/dashboard/lending-bar-chart";
import { LendingChartPanel } from "@/components/dashboard/lending-chart-panel";
import { computeCreditScoresForClients } from "@/lib/credit-score-batch";
import { computeWeeklyFiadoAbono } from "@/lib/lending-charts";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { HideableBalance } from "@/components/dashboard/hideable-balance";
import { ExchangeRateStrip } from "@/components/dashboard/exchange-rate-strip";
import { ExchangeRateLegalDisclaimer } from "@/components/exchange-rate-legal-disclaimer";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { ClientSummary } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: summaries }, { data: clients }, { data: owner }, ownerRate] = await Promise.all([
    supabase
      .from("client_summary")
      .select("*")
      .eq("owner_id", user!.id)
      .order("days_since_payment", { ascending: false }),
    supabase
      .from("clients")
      .select("id, name, document_id")
      .eq("owner_id", user!.id)
      .order("name"),
    supabase.from("owners").select("business_name").eq("id", user!.id).single(),
    getOwnerRateContext(supabase, user!.id),
  ]);

  const rateContext: MovementRateContext | null = ownerRate
    ? {
        rateMode: ownerRate.rateMode,
        effectiveRate: ownerRate.effectiveRate,
        officialRateUsd: ownerRate.officialRate.usd,
      }
    : null;
  const ledger: LedgerDisplay | null = ownerRate ? { rate: ownerRate.effectiveRate } : null;

  const rows = (summaries ?? []) as ClientSummary[];
  // Capital por cobrar counts every client's debt regardless of flag status —
  // flagging only affects what's *visible* in the Cartera table below, never
  // this total. USD and EUR are independent ledgers, so each gets its own sum.
  const totalCop = rows.filter((r) => Number(r.balance) > 0).reduce((sum, r) => sum + Number(r.balance), 0);
  const totalUsd = rows.filter((r) => Number(r.balance_usd) > 0).reduce((sum, r) => sum + Number(r.balance_usd), 0);
  const totalEur = rows.filter((r) => Number(r.balance_eur) > 0).reduce((sum, r) => sum + Number(r.balance_eur), 0);
  const visibleRows = rows.filter((r) => !r.is_flagged);
  const scores = await computeCreditScoresForClients(supabase, visibleRows, ownerRate?.effectiveRate ?? null);

  // The lending chart sums raw movement amounts, which only means something
  // within one currency — a VE owner sees one chart per currency (each
  // filtered to its own movements, no conversion) instead of one mixed total.
  const clientIds = (clients ?? []).map((c) => c.id);
  const { data: weeklyMovements } =
    clientIds.length > 0
      ? await supabase
          .from("movements")
          .select("type, amount, currency, created_at")
          .in("client_id", clientIds)
          .is("deleted_at", null)
      : { data: [] };
  const weeklyMovementRows = (weeklyMovements ?? []) as {
    type: "charge" | "payment";
    amount: number;
    currency: "USD" | "EUR" | null;
    created_at: string;
  }[];
  const weeklyLendingCop = computeWeeklyFiadoAbono(weeklyMovementRows.filter((m) => !m.currency));
  const weeklyLendingUsd = computeWeeklyFiadoAbono(weeklyMovementRows.filter((m) => m.currency === "USD"));
  const weeklyLendingEur = computeWeeklyFiadoAbono(weeklyMovementRows.filter((m) => m.currency === "EUR"));

  return (
    <div className="flex flex-1 flex-col gap-4">
      {rateContext ? <ExchangeRateStrip rateContext={rateContext} /> : null}

      <div className="flex flex-col items-stretch gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
        <div className="flex flex-1 flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start">
          {rateContext ? (
            <>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-64">
                <div>
                  <p className="text-sm text-muted-foreground">Capital por cobrar en USD</p>
                  <HideableBalance
                    balance={totalUsd}
                    currency="USD"
                    ledger={ledger}
                    mainClassName="text-3xl text-amber-600 dark:text-amber-400"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Lo que tus clientes te deben en total, sin descontar nada.
                  </p>
                </div>
                <LendingChartPanel data={weeklyLendingUsd} title="Fiado vs. Abono (USD)" />
              </div>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:min-w-64">
                <div>
                  <p className="text-sm text-muted-foreground">Capital por cobrar en Euro</p>
                  <HideableBalance
                    balance={totalEur}
                    currency="EUR"
                    ledger={ledger}
                    mainClassName="text-3xl text-amber-600 dark:text-amber-400"
                  />
                  <p className="mt-1 text-xs text-muted-foreground">
                    Lo que tus clientes te deben en total, sin descontar nada.
                  </p>
                </div>
                <LendingChartPanel data={weeklyLendingEur} title="Fiado vs. Abono (EUR)" />
              </div>
            </>
          ) : (
            <>
              <div>
                <p className="text-sm text-muted-foreground">Capital por cobrar</p>
                <HideableBalance
                  balance={totalCop}
                  currency={null}
                  ledger={null}
                  mainClassName="text-3xl text-amber-600 dark:text-amber-400"
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Lo que tus clientes te deben en total, sin descontar nada.
                </p>
              </div>
              <WeeklyLendingChart data={weeklyLendingCop} />
            </>
          )}
        </div>
        <ClientSearchDialog
          clients={clients ?? []}
          ownerId={user!.id}
          businessName={owner?.business_name || user!.email || "tu negocio"}
          rateContext={rateContext}
        />
      </div>
      <ClientTable rows={visibleRows} scores={scores} rateContext={ownerRate} source="cartera" />

      {rateContext ? <ExchangeRateLegalDisclaimer /> : null}
    </div>
  );
}
