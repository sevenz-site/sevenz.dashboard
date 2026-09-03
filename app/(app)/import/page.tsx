import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ImportFlow } from "@/components/import/import-flow";

export default async function ImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: clients } = await supabase
    .from("client_summary")
    .select("client_id, name, balance, document_id")
    .eq("owner_id", user!.id);

  const existingClients = (clients ?? []).map((c) => ({
    id: c.client_id as string,
    name: c.name as string,
    balance: c.balance as number,
    document_id: c.document_id as string | null,
  }));

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
        <h1 className="text-2xl font-semibold tracking-tight">Importar cartera</h1>
        <p className="text-sm text-muted-foreground">
          Sube fotos de la libreta. Revisa cada línea antes de guardarla.
        </p>
      </div>
      <ImportFlow existingClients={existingClients} />
    </div>
  );
}
