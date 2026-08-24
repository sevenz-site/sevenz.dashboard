import { createClient } from "@/lib/supabase/server";
import { ClientTable } from "@/components/dashboard/client-table";
import { ClientSearchDialog } from "@/components/dashboard/client-search-dialog";
import { WeeklyLendingChart } from "@/components/dashboard/lending-bar-chart";
import { computeCreditScoresForClients } from "@/lib/credit-score-batch";
import { computeWeeklyFiadoAbono } from "@/lib/lending-charts";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { ExchangeRateBalanceDisplay } from "@/components/exchange-rate-balance-display";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
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

  const rows = (summaries ?? []) as ClientSummary[];
  // Capital por cobrar counts every client's debt regardless of flag status —
  // flagging only affects what's *visible* in the Cartera table below, never
  // this total.
  const totalEnMora = rows
    .filter((r) => Number(r.balance) > 0)
    .reduce((sum, r) => sum + Number(r.balance), 0);
  const visibleRows = rows.filter((r) => !r.is_flagged);
  const scores = await computeCreditScoresForClients(supabase, visibleRows);

  // The lending chart counts every client's movements regardless of the
  // Mala paga flag — same reasoning as Capital por cobrar above: this is
  // about total lending activity, not who's currently visible in the table.
  const clientIds = (clients ?? []).map((c) => c.id);
  const { data: weeklyMovements } =
    clientIds.length > 0
      ? await supabase
          .from("movements")
          .select("type, amount, created_at")
          .in("client_id", clientIds)
          .is("deleted_at", null)
      : { data: [] };
  const weeklyMovementRows = (weeklyMovements ?? []) as {
    type: "charge" | "payment";
    amount: number;
    created_at: string;
  }[];
  const weeklyLending = computeWeeklyFiadoAbono(weeklyMovementRows);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-1 flex-wrap items-start gap-4">
          <div>
            <p className="text-sm text-muted-foreground">Capital por cobrar</p>
            <ExchangeRateBalanceDisplay
              balance={totalEnMora}
              rateContext={ownerRate}
              mainClassName="text-3xl text-amber-600 dark:text-amber-400"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Lo que tus clientes te deben en total, sin descontar nada.
            </p>
          </div>
          <WeeklyLendingChart data={weeklyLending} />
        </div>
        <ClientSearchDialog
          clients={clients ?? []}
          ownerId={user!.id}
          businessName={owner?.business_name || user!.email || "tu negocio"}
          rateContext={rateContext}
        />
      </div>
      <ClientTable rows={visibleRows} scores={scores} rateContext={ownerRate} />
    </div>
  );
}
