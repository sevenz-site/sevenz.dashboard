import { createClient } from "@/lib/supabase/server";
import { ClientTable } from "@/components/dashboard/client-table";
import { ScreenHeader } from "@/components/dashboard/screen-header";
import { ClientFilterProvider, ClientFilterChipsRow } from "@/components/dashboard/client-filter-context";
import { ClientSearchFieldRow } from "@/components/dashboard/client-search-sheet";
import { ImportarCartera } from "@/components/dashboard/importar-cartera";
import { ClientSearchDialog } from "@/components/dashboard/client-search-dialog";
import { OwnerUnavailableDialog } from "@/components/owner-unavailable-dialog";
import { readOwnerCountry } from "@/lib/owner-country";
import { computeCreditScoresForClients } from "@/lib/credit-score-batch";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { getMonedaHabitual } from "@/lib/moneda-habitual";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import type { ClientSummary, OwnerCountry } from "@/lib/types";

export default async function ClientsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: summaries }, { data: clients }, { data: owner }, ownerRate, monedaHabitual] = await Promise.all([
    supabase
      .from("client_summary")
      .select("*")
      .eq("owner_id", user!.id)
      .order("days_since_payment", { ascending: false }),
    // Feeds the "add a movement" search. Hidden clients are excluded outright
    // (decision O2): the way back to one is Papelera → Restaurar, so that the
    // word "oculto" means the same thing on every screen.
    supabase
      .from("clients")
      .select("id, name, document_id")
      .eq("owner_id", user!.id)
      .is("trashed_at", null)
      .is("deleted_at", null)
      .order("name"),
    supabase.from("owners").select("business_name, country").eq("id", user!.id).single(),
    getOwnerRateContext(supabase, user!.id),
    // En que moneda escribio la ultima vez, para que el formulario abra ahi.
    getMonedaHabitual(supabase, user!.id),
  ]);

  // Mismo criterio que Cartera: no saber el país no es saber que es CO. Esta
  // pantalla monta el alta de cliente con su primer movimiento, y sin país el
  // formulario sale sin selector de moneda para un negocio venezolano — que es
  // como el fiado acababa rechazado al guardar, sin nada que el dueño pudiera
  // corregir en pantalla.
  // Si la primera lectura no trajo país, readOwnerCountry lo reintenta antes de
  // rendirse: un parpadeo de red no debería taparle la pantalla a nadie. Y si
  // tampoco así, deja constancia de que este aviso apareció.
  const ownerCountry =
    (owner?.country as OwnerCountry | undefined) ?? (await readOwnerCountry(supabase, user!.id));
  if (!ownerCountry) return <OwnerUnavailableDialog />;
  const rateContext: MovementRateContext | null = ownerRate
    ? {
        rateMode: ownerRate.rateMode,
        effectiveRate: ownerRate.effectiveRate,
        officialRateUsd: ownerRate.officialRate.usd,
        prevista: ownerRate.prevista,
      }
    : null;

  // Same rows Cartera shows: a flagged client already has its own screen
  // (Malas pagas), so it stays out of this list too rather than appearing
  // in both.
  const rows = ((summaries ?? []) as ClientSummary[]).filter((r) => !r.is_flagged);
  const scores = await computeCreditScoresForClients(supabase, rows, ownerRate?.effectiveRate ?? null);

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* El estado de los filtros sube al nivel de la pantalla desde el spec
          del 2026-10-04: el buscador y los chips viven ahora en la cabecera, y
          la lista de abajo tiene que filtrarse con lo mismo. `ClientTable`
          reconoce que el estado le llega por contexto y deja de montar su
          propio `ClientSearchInline`. */}
      <ClientFilterProvider rows={rows} rateContext={ownerRate}>
        <ScreenHeader
          title="Clientes"
          subtitle="Todos tus clientes registrados, con su saldo actual."
          /* La única de las tres que lleva acción en el título, decisión del
             dueño el 2026-10-04. */
          action={<ImportarCartera variant="dark" />}
          search={<ClientSearchFieldRow tone="dark" />}
          filters={<ClientFilterChipsRow tone="dark" />}
        />

        {/* Solo escritorio: en teléfono esta acción vive en el botón flotante
            de la barra de abajo. Sale de la fila del título, donde estaba,
            porque esa fila ahora vive dentro de la cabecera oscura y el spec
            solo pone "Subir libreta" ahí. */}
        <div className="hidden md:block">
          <ClientSearchDialog
            clients={clients ?? []}
            ownerId={user!.id}
            businessName={owner?.business_name || user!.email || "tu negocio"}
            ownerCountry={ownerCountry}
            rateContext={rateContext}
            monedaHabitual={monedaHabitual}
          />
        </div>

        {/* El rótulo vuelve, decisión del dueño el 2026-10-04. El comentario
            que estaba aquí defendía lo contrario —que el h1 ya nombra la
            pantalla— y era cierto mientras el h1 estaba a dos centímetros.
            Ahora el h1 vive en un bloque oscuro que se va al hacer scroll, así
            que a media lista no queda nada diciendo qué son estas tarjetas. */}
        <h2 className="text-base font-semibold">Clientes</h2>
        <ClientTable
          rows={rows}
          scores={scores}
          rateContext={ownerRate}
          ownerCountry={ownerCountry}
          source="clientes"
        />
      </ClientFilterProvider>
    </div>
  );
}
