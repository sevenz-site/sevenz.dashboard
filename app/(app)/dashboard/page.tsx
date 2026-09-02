import { createClient } from "@/lib/supabase/server";
import { ClientTable } from "@/components/dashboard/client-table";
import { ClientSearchDialog } from "@/components/dashboard/client-search-dialog";
import { computeCreditScoresForClients } from "@/lib/credit-score-batch";
import { computeWeeklyFiadoAbono } from "@/lib/lending-charts";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { BalanceCard } from "@/components/dashboard/balance-card";
import { ExchangeRateStrip } from "@/components/dashboard/exchange-rate-strip";
import { ExchangeRateLegalDisclaimer } from "@/components/exchange-rate-legal-disclaimer";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import type { ClientSummary, OwnerCountry } from "@/lib/types";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ nuevo?: string }>;
}) {
  // Set by the mobile bar's "Agregar", which navigates here because this
  // is where the movement will appear and where the client list already
  // lives. The dialog clears it from the address once open, so a reload
  // can't reopen it on its own.
  const { nuevo } = await searchParams;
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
    supabase.from("owners").select("business_name, country, first_name").eq("id", user!.id).single(),
    getOwnerRateContext(supabase, user!.id),
  ]);

  // Falls back to CO only if the owners row is somehow missing — every real
  // owner has a country, chosen at signup and not editable afterward.
  const ownerCountry = (owner?.country as OwnerCountry | undefined) ?? "CO";

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

  // Both values ride along on work this page already does: first_name is one
  // more column on the owners query above, and last_sign_in_at is already in
  // the getUser() response. No extra round trip for either.
  //
  // The timezone is not cosmetic. Vercel runs its servers in UTC, so formatting
  // without naming a zone would show a Colombian owner 12:15 p. m. for a sign-in
  // that happened at 7:15 a. m. their time. The owner's own country is already
  // loaded, so it decides the zone.
  //
  // es-VE for the format itself: it renders "2 sept. 2026", where es-CO gives
  // the wordier "2 de sept de 2026" — the shorter one fits a two-line corner
  // label better and matches the format asked for.
  const lastSignIn = user!.last_sign_in_at
    ? new Intl.DateTimeFormat("es-VE", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
        timeZone: owner?.country === "VE" ? "America/Caracas" : "America/Bogota",
      }).format(new Date(user!.last_sign_in_at))
    : null;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        {/* first_name is required by both the signup form and "Mi negocio",
            server-side as well as in the browser, so it is treated as present.
            The guard is only for a row that predates that rule — rendering
            "¡Hola !" would be worse than dropping the name. */}
        <p className="text-2xl font-semibold">
          ¡Hola{owner?.first_name ? ` ${owner.first_name}` : ""}!
        </p>
        {lastSignIn ? (
          /* shrink-0 and nowrap together are what keep this at two lines. As a
             plain flex child it gets squeezed by a longer name and wraps to
             four: "Último inicio de / sesión: / 12 sept. 2026, 11:45 p. / m."
             The greeting wraps instead, which reads fine; this does not. */
          <p className="shrink-0 text-right text-xs leading-tight whitespace-nowrap text-muted-foreground">
            Última conexión:
            <br />
            {lastSignIn}
          </p>
        ) : null}
      </div>

      {/* Section titles carry 40px of separation above them (mt-10), which is
          what marks where one part of the screen ends and the next begins. */}
      <h2 className="mt-10 text-xl font-semibold">Cartera pendiente</h2>

      {/* Stacked on a phone, side by side once there is room — the cards are
          two independent ledgers, not a sequence, so they read better abreast
          than stacked on a wide screen. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {rateContext ? (
          <>
            <BalanceCard
              label="Capital por cobrar en USD"
              balance={totalUsd}
              currency="USD"
              ledger={ledger}
              chartData={weeklyLendingUsd}
              chartTitle="Fiado vs. Abono (USD)"
            />
            <BalanceCard
              label="Capital por cobrar en Euro"
              balance={totalEur}
              currency="EUR"
              ledger={ledger}
              chartData={weeklyLendingEur}
              chartTitle="Fiado vs. Abono (EUR)"
            />
          </>
        ) : (
          <BalanceCard
            label="Capital por cobrar"
            balance={totalCop}
            currency={null}
            ledger={null}
            chartData={weeklyLendingCop}
          />
        )}
      </div>

      {rateContext ? <ExchangeRateStrip rateContext={rateContext} /> : null}

      <ClientSearchDialog
        clients={clients ?? []}
        ownerId={user!.id}
        businessName={owner?.business_name || user!.email || "tu negocio"}
        ownerCountry={ownerCountry}
        autoOpen={nuevo === "1"}
        rateContext={rateContext}
      />

      {/* Named for what is actually underneath: a list of clients and their
          balances. "Historial de movimientos" already means a different screen
          — the movement list inside one client — and reusing it here would
          promise movements and deliver people. */}
      <h2 className="mt-10 text-xl font-semibold">Clientes</h2>

      <ClientTable rows={visibleRows} scores={scores} rateContext={ownerRate} source="cartera" />

      {rateContext ? <ExchangeRateLegalDisclaimer /> : null}
    </div>
  );
}
