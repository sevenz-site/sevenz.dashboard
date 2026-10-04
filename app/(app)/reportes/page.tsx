import { ChartColumn } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { OwnerUnavailableDialog } from "@/components/owner-unavailable-dialog";
import { WeeklyLendingCharts } from "@/components/dashboard/weekly-lending-charts";
import { readWeeklyLending, hasAnyMovement } from "@/lib/weekly-lending-read";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { readOwnerCountry } from "@/lib/owner-country";
import type { OwnerCountry } from "@/lib/types";

// REPORTES — delivery 3 of the 2026-10-03 redesign.
//
// This screen MOVES the two charts that already lived inside Inicio's capital
// card behind a toggle; it does not add reporting. That distinction matters
// because `CT-7` ("Informes", planned in `../docs/REPORTES-PLAN.md`) is a much
// bigger thing that will eventually own this same route and rewrite this page.
// Taking the URL now is deliberate — the owner should not have to learn a
// second one later — but nothing here should be built on as if it were CT-7.
//
// The charts are open, with no toggle. Inside the card they were closed by
// default, which is why the chart library is loaded lazily; here they are the
// only reason to be on the page, so a collapsed one would be a screen whose
// content you have to ask for.
export default async function ReportesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: clients }, { data: owner }, ownerRate] = await Promise.all([
    supabase
      .from("clients")
      .select("id")
      .eq("owner_id", user!.id)
      .is("trashed_at", null)
      .is("deleted_at", null),
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

  const clientIds = (clients ?? []).map((c) => c.id);
  const week = await readWeeklyLending(supabase, clientIds);
  // Only asked when the week came back empty: on any other week the answer
  // changes nothing, and this is a count over the whole movements table.
  const everAny = week.anyThisWeek ? true : await hasAnyMovement(supabase, clientIds);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">Reportes</h1>
        <p className="text-sm text-muted-foreground">
          Lo que fiaste y lo que te abonaron en los últimos 7 días.
        </p>
      </div>

      {week.anyThisWeek ? (
        <WeeklyLendingCharts
          perCurrency={ownerRate !== null}
          cop={week.cop}
          usd={week.usd}
          eur={week.eur}
        />
      ) : (
        /* Two different texts because they are two different situations, and
           confusing them reads badly in both directions: telling someone who
           signed up yesterday "you registered nothing this week" sounds like a
           reproach for a week they were not here for, and telling someone with
           eight months of history and a quiet week "here you will see your
           activity" sounds like the app lost their data. */
        <div className="flex flex-col items-center gap-3 rounded-lg border bg-muted/30 px-6 py-12 text-center">
          <ChartColumn className="size-8 text-muted-foreground" aria-hidden="true" />
          {everAny ? (
            <>
              <p className="font-medium">Esta semana no hay movimientos</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                No has registrado ningún fiado ni abono en los últimos 7 días. Tu cartera sigue
                igual; aquí solo se ve el movimiento de la semana.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium">Todavía no hay nada que mostrar</p>
              <p className="max-w-sm text-sm text-muted-foreground">
                En cuanto registres tu primer fiado o abono, aquí verás cuánto diste y cuánto te
                pagaron cada día de la semana.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
