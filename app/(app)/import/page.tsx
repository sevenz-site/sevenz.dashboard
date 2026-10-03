import { createClient } from "@/lib/supabase/server";
import { CarteraBackButton } from "@/components/dashboard/cartera-back-button";
import { ImportFlow } from "@/components/import/import-flow";
import { OwnerUnavailableDialog } from "@/components/owner-unavailable-dialog";
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
    // `client_summary_all` Y NO `client_summary`, desde CT-33.
    //
    // La vista filtrada esconde a los de la papelera y a los ocultos
    // definitivamente, y eso dejaba a esta pantalla sin poder ver justo a quien
    // la bloqueaba: el aviso decia "Karina castillo (kari) ya tiene esta cedula
    // y esta en la papelera" mientras la lista de candidatos enseñaba a los
    // otros dos. Nombraba a alguien que la pantalla no podia mostrar.
    //
    // LO QUE PROTEGE QUE ESTO NO SE DESMADRE esta en `reconcile.ts`, no aqui:
    // el emparejamiento AUTOMATICO por nombre sigue mirando solo a los
    // visibles. Un oculto solo aparece como CANDIDATO, con su marca, y hace
    // falta que el dueño lo elija a mano. Sin esa separacion, subir una libreta
    // con un nombre repetido habria empezado a emparejar en silencio con gente
    // que el dueño quito de su cartera a proposito.
    supabase
      .from("client_summary_all")
      .select(
        "client_id, name, balance, balance_usd, balance_eur, document_id, whatsapp, trashed_at, deleted_at",
      )
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
    // Solo para NO pedir un WhatsApp que el cliente ya tiene guardado. Sin esto
    // la revisión decía "Falta el WhatsApp" a un cliente que lo tenía —visto en
    // dev el 2026-09-28 con QA Debe Plata— porque el aviso se calculaba
    // únicamente con lo que traía la foto, y la foto nunca trae teléfonos.
    whatsapp: c.whatsapp as string | null,
    // Dos estados distintos y la pantalla los nombra distinto: la papelera se
    // ve y se deshace desde Papelera; "oculto definitivamente" no sale ni ahi.
    // Mandar a alguien a buscar en Papelera a quien no esta en Papelera es el
    // callejon que CT-33 cierra.
    hidden: c.deleted_at
      ? ("definitivo" as const)
      : c.trashed_at
        ? ("papelera" as const)
        : null,
  }));

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* Replaces the app header on a phone (see AppHeader), so it behaves like
          one: flush to the top, edge to edge. The negative margins cancel main's
          p-4 and px-4 restores the inset for the content itself. Hidden from sm
          up, where the real header returns. */}
      <div className="sticky top-0 z-20 -mx-4 -mt-4 flex items-center border-b bg-background px-4 py-3 sm:hidden">
        {/* CarteraBackButton y no un Link pelado: mientras hay una libreta
            leída sin guardar, esta es LA ÚNICA salida de la pantalla —la barra
            de abajo se esconde— y tiene que preguntar. Un Link normal aquí
            sería la puerta por la que se pierden veintitantos movimientos
            corregidos a mano, sin un aviso. Es el mismo componente y el mismo
            guard que usa "Mi negocio". */}
        <CarteraBackButton />
      </div>
      {/* El título vive dentro de `ImportFlow` desde CT-31: el botón de
          deshacer va alineado a su derecha y necesitan el mismo estado. */}
      {ownerCountry ? (
        <ImportFlow existingClients={existingClients} ownerCountry={ownerCountry} rateContext={rateContext} />
      ) : (
        <OwnerUnavailableDialog />
      )}
    </div>
  );
}
