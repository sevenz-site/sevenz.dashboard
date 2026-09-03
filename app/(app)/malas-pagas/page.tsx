import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
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
      {/* Replaces the app header on a phone (see AppHeader), so it carries the
          same bottom rule. From sm up the real header is back above it and this
          bar would be a redundant second one. */}
      <div className="flex items-center border-b pb-3 sm:hidden">
        <Button variant="ghost" size="icon" asChild className="-ml-2">
          <Link href="/dashboard" aria-label="Volver a Cartera">
            <ChevronLeft className="size-5" />
          </Link>
        </Button>
      </div>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Malas pagas</h1>
        <p className="text-sm text-muted-foreground">
          Clientes marcados como mala paga — no aparecen en la Cartera principal.
        </p>
      </div>
      {/* Same section rule as Cartera: 20px above (mt-1 plus the container's
          16px gap), text-xl, and named for what is actually underneath it. */}
      <h2 className="mt-1 text-xl font-semibold">Clientes</h2>
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
