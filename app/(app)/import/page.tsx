import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ImportFlow } from "@/components/import/import-flow";
import { OwnerUnavailableDialog } from "@/components/owner-unavailable-dialog";
import { RANURA_ACCION_CABECERA } from "@/components/import/ranura-cabecera";
import { readOwnerCountry } from "@/lib/owner-country";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";

export default async function ImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // balance_usd/balance_eur alongside balance: the review table's running
  // total is per currency, so it needs the right starting point for each one.
  // A VE owner's `balance` is not the sum of the other two and must not be
  // used as a stand-in.
  const [{ data: clients }, { data: owner }, ownerRate] = await Promise.all([
    supabase
      .from("client_summary")
      .select("client_id, name, balance, balance_usd, balance_eur, document_id")
      .eq("owner_id", user!.id),
    supabase.from("owners").select("country").eq("id", user!.id).maybeSingle(),
    // Para la línea de bolívares del resumen de confirmación, nada más.
    getOwnerRateContext(supabase, user!.id),
  ]);

  const rateContext: MovementRateContext | null = ownerRate
    ? {
        rateMode: ownerRate.rateMode,
        effectiveRate: ownerRate.effectiveRate,
        officialRateUsd: ownerRate.officialRate.usd,
        prevista: ownerRate.prevista,
      }
    : null;

  // Sin país no se puede importar: es lo que decide si las filas llevan moneda
  // o no. Se comprueba aquí, antes de subir la foto, y no al confirmar — al
  // confirmar ya se gastó la extracción y la revisión de las 25 líneas, y el
  // servidor rechazaría la tanda entera sin escribir nada.
  // Si la primera lectura no trajo país, readOwnerCountry lo reintenta antes de
  // rendirse: un parpadeo de red no debería taparle la pantalla a nadie. Y si
  // tampoco así, deja constancia de que este aviso apareció.
  const ownerCountry =
    (owner?.country as string | undefined) ?? (await readOwnerCountry(supabase, user!.id));

  const existingClients = (clients ?? []).map((c) => ({
    id: c.client_id as string,
    name: c.name as string,
    balance: (c.balance as number | null) ?? 0,
    balance_usd: (c.balance_usd as number | null) ?? 0,
    balance_eur: (c.balance_eur as number | null) ?? 0,
    document_id: c.document_id as string | null,
  }));

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
        {/* Vacío casi siempre. Mientras se revisa una libreta, ImportFlow
            manda aquí su botón de "Confirmar e importar" por portal — ver
            components/import/ranura-cabecera.tsx. `ml-auto` lo pega a la
            derecha; con la ranura vacía no ocupa nada. */}
        <div id={RANURA_ACCION_CABECERA} className="ml-auto flex items-center" />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">Importar cartera</h1>
      {ownerCountry ? (
        <ImportFlow existingClients={existingClients} ownerCountry={ownerCountry} rateContext={rateContext} />
      ) : (
        <OwnerUnavailableDialog />
      )}
    </div>
  );
}
