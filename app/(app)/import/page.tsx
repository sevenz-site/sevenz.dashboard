import { createClient } from "@/lib/supabase/server";
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
