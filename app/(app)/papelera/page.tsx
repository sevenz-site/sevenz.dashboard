import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { PapeleraTable } from "@/components/dashboard/papelera-table";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import type { ClientSummaryAll } from "@/lib/types";

export default async function PapeleraPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: summaries }, ownerRate] = await Promise.all([
    // One of the three places allowed to read the unfiltered view. Clients
    // hidden definitivamente are excluded here too — deleted_at is what takes
    // them out of the owner's UI entirely, including this screen.
    supabase
      .from("client_summary_all")
      .select("*")
      .eq("owner_id", user!.id)
      .not("trashed_at", "is", null)
      .is("deleted_at", null)
      .order("trashed_at", { ascending: false }),
    getOwnerRateContext(supabase, user!.id),
  ]);

  const rows = (summaries ?? []) as ClientSummaryAll[];

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Papelera</h1>
        <p className="text-sm text-muted-foreground">
          Clientes que ocultaste. No aparecen en tu Cartera y su saldo no cuenta en los totales, pero su
          historial se conserva y su enlace de saldo sigue funcionando.
        </p>
      </div>
      <h2 className="mt-1 text-xl font-semibold">Clientes</h2>
      <PapeleraTable rows={rows} rateContext={ownerRate} />
    </div>
  );
}
