import { createClient } from "@/lib/supabase/server";
import { ClientTable } from "@/components/dashboard/client-table";
import { ScreenHeader } from "@/components/dashboard/screen-header";
import { ClientFilterProvider, ClientFilterChipsRow } from "@/components/dashboard/client-filter-context";
import { ClientSearchFieldRow } from "@/components/dashboard/client-search-sheet";
import { RegisterButton } from "@/components/dashboard/register-button";
import { OwnerUnavailableDialog } from "@/components/owner-unavailable-dialog";
import { readOwnerCountry } from "@/lib/owner-country";
import { computeCreditScoresForClients } from "@/lib/credit-score-batch";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import type { ClientSummary, OwnerCountry } from "@/lib/types";

export default async function MalasPagasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: summaries }, { data: owner }, ownerRate] = await Promise.all([
    supabase
      .from("client_summary")
      .select("*")
      .eq("owner_id", user!.id)
      .eq("is_flagged", true)
      .order("days_since_payment", { ascending: false }),
    supabase.from("owners").select("business_name, country").eq("id", user!.id).single(),
    getOwnerRateContext(supabase, user!.id),
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
  // LO QUE ESTA PANTALLA YA NO PIDE A LA BASE. Hasta el 2026-10-24 leía además
  // la lista de clientes, la tasa derivada y la moneda habitual, y las tres
  // existían SOLO para alimentar el diálogo viejo de «Agregar movimiento». Al
  // sustituirlo por `RegisterButton` —que no necesita nada— se van con él: dos
  // consultas menos por carga de página.

  const rows = (summaries ?? []) as ClientSummary[];
  const scores = await computeCreditScoresForClients(supabase, rows, ownerRate?.effectiveRate ?? null);

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* El estado de los filtros sube al nivel de la pantalla desde el spec
          del 2026-10-04: el buscador y los chips viven ahora en la cabecera, y
          la lista de abajo se filtra con lo mismo. */}
      <ClientFilterProvider rows={rows} rateContext={ownerRate}>
        <ScreenHeader
          title="Malas pagas"
          /* Dice dónde NO aparecen, y deliberadamente no dice nada del capital
             por cobrar: un cliente marcado como mala paga SÍ sigue sumando al
             total de Inicio. El subtítulo de Papelera sí lo dice, porque allí
             es verdad. */
          subtitle="Clientes marcados como malas pagas no aparecen en el inicio ni en la sección de clientes."
          search={<ClientSearchFieldRow tone="dark" />}
          filters={<ClientFilterChipsRow tone="dark" />}
        />

        {/* EL MISMO BOTÓN QUE INICIO, Y EL MISMO COMPONENTE.
            Instrucción del dueño el 2026-10-24: *«ese botón debe ser el
            mismo que el del home "Registrar" (…) usa el mismo componente
            en todas las pantallas»*. Aquí había el disparador de
            `ClientSearchDialog` —«Agregar movimiento»— que abría el
            diálogo viejo «Agregar transacción», o sea el flujo jubilado.

            Solo escritorio: en teléfono esta acción vive en el botón
            flotante de la barra de abajo, y sin `hidden md:block`
            saldrían los dos. */}
        <div className="hidden md:block">
          <RegisterButton />
        </div>

        <h2 className="text-base font-semibold">Clientes</h2>
        <ClientTable
          rows={rows}
          scores={scores}
          rateContext={ownerRate}
          emptyMessage="No tienes clientes marcados como mala paga."
          source="malas_pagas"
          ownerCountry={ownerCountry}
        />
      </ClientFilterProvider>
    </div>
  );
}
