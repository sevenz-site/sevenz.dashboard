import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ClientTable } from "@/components/dashboard/client-table";
import { ClientSearchDialog } from "@/components/dashboard/client-search-dialog";
import { computeCreditScoresForClients } from "@/lib/credit-score-batch";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import type { ClientSummary, OwnerCountry } from "@/lib/types";

export default async function MalasPagasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: summaries }, { data: clients }, { data: owner }, ownerRate] = await Promise.all([
    supabase
      .from("client_summary")
      .select("*")
      .eq("owner_id", user!.id)
      .eq("is_flagged", true)
      .order("days_since_payment", { ascending: false }),
    supabase
      .from("clients")
      .select("id, name, document_id")
      .eq("owner_id", user!.id)
      .order("name"),
    supabase.from("owners").select("business_name, country").eq("id", user!.id).single(),
    getOwnerRateContext(supabase, user!.id),
  ]);

  // Same fallback as Cartera: every real owner has a country from signup, so
  // this only covers a row that somehow predates it.
  const ownerCountry = (owner?.country as OwnerCountry | undefined) ?? "CO";
  const rateContext: MovementRateContext | null = ownerRate
    ? {
        rateMode: ownerRate.rateMode,
        effectiveRate: ownerRate.effectiveRate,
        officialRateUsd: ownerRate.officialRate.usd,
      }
    : null;

  const rows = (summaries ?? []) as ClientSummary[];
  const scores = await computeCreditScoresForClients(supabase, rows, ownerRate?.effectiveRate ?? null);

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Replaces the app header on a phone (see AppHeader), so it behaves like
          one: flush to the top, edge to edge. The negative margins cancel main's
          p-4 and px-4 restores the inset for the content itself. Hidden from sm
          up, where the real header returns. */}
      <div className="-mx-4 -mt-4 flex items-center border-b px-4 py-3 sm:hidden">
        <Button variant="ghost" size="icon" asChild className="-ml-2">
          <Link href="/dashboard" aria-label="Volver a Cartera">
            <ChevronLeft className="size-5" />
          </Link>
        </Button>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Malas pagas</h1>
          <p className="text-sm text-muted-foreground">
            Clientes marcados como mala paga — no aparecen en la Cartera principal.
          </p>
        </div>
        {/* Desktop only, same as Cartera: the phone keeps this action in the
            bottom bar's "Agregar" instead, which is why there is no sm:hidden
            counterpart of this trigger the way Cartera has one. */}
        <div className="hidden sm:block">
          <ClientSearchDialog
            clients={clients ?? []}
            ownerId={user!.id}
            businessName={owner?.business_name || user!.email || "tu negocio"}
            ownerCountry={ownerCountry}
            rateContext={rateContext}
          />
        </div>
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
