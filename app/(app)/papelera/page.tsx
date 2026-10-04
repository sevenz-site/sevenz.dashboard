import { createClient } from "@/lib/supabase/server";
import { PapeleraTable } from "@/components/dashboard/papelera-table";
import { ScreenHeader } from "@/components/dashboard/screen-header";
import { ClientFilterProvider, ClientFilterChipsRow } from "@/components/dashboard/client-filter-context";
import { ClientSearchFieldRow } from "@/components/dashboard/client-search-sheet";
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
      {/* `balances="al-ocultar"`: los filtros y las ordenaciones leen el saldo
          congelado al ocultar al cliente, no el actual, para que cuadren con
          las cifras impresas en estas tarjetas. */}
      <ClientFilterProvider rows={rows} rateContext={ownerRate} balances="al-ocultar">
        <ScreenHeader
          title="Papelera"
          /* SÍ dice lo del capital, al contrario que el de Malas pagas, porque
             aquí es verdad: `client_summary` lleva `where trashed_at is null`,
             y es esa vista la que Inicio suma. Y conserva la frase del enlace a
             petición del dueño el 2026-10-04 — el spec la quitaba, y es
             justo lo que un tendero se pregunta al ocultar a alguien. */
          subtitle="Clientes en papelera no aparecen en la sección de clientes. Tampoco suman al capital por cobrar, pero su historial se conserva y su enlace de saldo sigue funcionando."
          search={<ClientSearchFieldRow tone="dark" />}
          filters={<ClientFilterChipsRow tone="dark" />}
        />

        <h2 className="text-base font-semibold">Clientes</h2>
        <PapeleraTable rows={rows} rateContext={ownerRate} />
      </ClientFilterProvider>
    </div>
  );
}
