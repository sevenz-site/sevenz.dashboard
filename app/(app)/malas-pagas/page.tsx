import { createClient } from "@/lib/supabase/server";
import { ClientTable } from "@/components/dashboard/client-table";
import { computeCreditScoresForClients } from "@/lib/credit-score-batch";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import type { ClientSummary } from "@/lib/types";

export default async function MalasPagasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: summaries }, ownerRate] = await Promise.all([
    supabase
      .from("client_summary")
      .select("*")
      .eq("owner_id", user!.id)
      .eq("is_flagged", true)
      .order("days_since_payment", { ascending: false }),
    getOwnerRateContext(supabase, user!.id),
  ]);

  const rows = (summaries ?? []) as ClientSummary[];
  const scores = await computeCreditScoresForClients(supabase, rows, ownerRate?.effectiveRate ?? null);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Malas pagas</h1>
        <p className="text-sm text-muted-foreground">
          Clientes marcados como mala paga — no aparecen en la Cartera principal.
        </p>
      </div>
      <ClientTable
        rows={rows}
        scores={scores}
        rateContext={ownerRate}
        emptyMessage="No tienes clientes marcados como mala paga."
        source="malas_pagas"
      />
    </div>
  );
}
