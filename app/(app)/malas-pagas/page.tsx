import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ClientTable } from "@/components/dashboard/client-table";
import { ImportarCartera } from "@/components/dashboard/importar-cartera";
import { HideWhileSearching } from "@/components/dashboard/search-focus-context";
import { ClientSearchDialog } from "@/components/dashboard/client-search-dialog";
import { OwnerUnavailableDialog } from "@/components/owner-unavailable-dialog";
import { readOwnerCountry } from "@/lib/owner-country";
import { computeCreditScoresForClients } from "@/lib/credit-score-batch";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { getMonedaHabitual } from "@/lib/moneda-habitual";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import type { ClientSummary, OwnerCountry } from "@/lib/types";

export default async function MalasPagasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: summaries }, { data: clients }, { data: owner }, ownerRate, monedaHabitual] = await Promise.all([
    supabase
      .from("client_summary")
      .select("*")
      .eq("owner_id", user!.id)
      .eq("is_flagged", true)
      .order("days_since_payment", { ascending: false }),
    // Feeds the "add a movement" search — hidden clients excluded (O2), same
    // as Cartera and Clientes.
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

  const rows = (summaries ?? []) as ClientSummary[];
  const scores = await computeCreditScoresForClients(supabase, rows, ownerRate?.effectiveRate ?? null);

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Replaces the app header on a phone (see AppHeader), so it behaves like
          one: flush to the top, edge to edge. The negative margins cancel main's
          p-4 and px-4 restores the inset for the content itself. Hidden from sm
          up, where the real header returns. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 flex items-center border-b bg-background px-4 py-3 sm:hidden">
        <Button variant="ghost" size="icon" asChild className="-ml-2">
          <Link href="/dashboard" aria-label="Volver a Cartera">
            <ChevronLeft className="size-5" />
          </Link>
        </Button>
      </div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Malas pagas</h1>
          <HideWhileSearching>
            <p className="text-sm text-muted-foreground">
              Clientes marcados como mala paga — no aparecen en la Cartera principal.
            </p>
          </HideWhileSearching>
        </div>
        {/* A la derecha de la cabecera. `ghost`: aquí importar es una salida
            secundaria, no la acción de la pantalla, y un recuadro la haría
            pesar más que el título que tiene al lado. Se ve en las dos
            anchuras — a diferencia de "Agregar movimiento", que en teléfono
            vive en la barra de abajo. */}
        <div className="flex shrink-0 items-center gap-1">
          <ImportarCartera variant="responsive" />
          {/* Desktop only, same as Cartera: the phone keeps this action in the
              bottom bar's "Agregar" instead, which is why there is no
              sm:hidden counterpart of this trigger the way Cartera has one. */}
          <div className="hidden sm:block">
            <ClientSearchDialog
              clients={clients ?? []}
              ownerId={user!.id}
              businessName={owner?.business_name || user!.email || "tu negocio"}
              ownerCountry={ownerCountry}
              rateContext={rateContext}
              monedaHabitual={monedaHabitual}
            />
          </div>
        </div>
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
