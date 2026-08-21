import { createClient } from "@/lib/supabase/server";
import { ClientTable } from "@/components/dashboard/client-table";
import { ClientSearchDialog } from "@/components/dashboard/client-search-dialog";
import { computeCreditScoresForClients } from "@/lib/credit-score-batch";
import { formatCurrency } from "@/lib/format";
import type { ClientSummary } from "@/lib/types";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: summaries }, { data: clients }, { data: owner }] = await Promise.all([
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
  ]);

  const rows = (summaries ?? []) as ClientSummary[];
  // Capital por cobrar counts every client's debt regardless of flag status —
  // flagging only affects what's *visible* in the Cartera table below, never
  // this total.
  const totalEnMora = rows
    .filter((r) => Number(r.balance) > 0)
    .reduce((sum, r) => sum + Number(r.balance), 0);
  const visibleRows = rows.filter((r) => !r.is_flagged);
  const scores = await computeCreditScoresForClients(supabase, visibleRows);

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">Capital por cobrar</p>
          <p className="text-3xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
            {formatCurrency(totalEnMora)}
          </p>
        </div>
        <ClientSearchDialog
          clients={clients ?? []}
          ownerId={user!.id}
          businessName={owner?.business_name || user!.email || "tu negocio"}
        />
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Capital por cobrar:</span> lo que tus clientes
        te deben en total, sin descontar nada.
      </p>
      <ClientTable rows={visibleRows} scores={scores} />
    </div>
  );
}
