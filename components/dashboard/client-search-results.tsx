"use client";

import { useRouter } from "next/navigation";
import {
  ClientCardBody,
  CLIENT_CARD_ROW,
  CLIENT_CARD_SHELL,
} from "@/components/dashboard/client-card";
import {
  useCloseSearchSheet,
  useSharedClientFilters,
} from "@/components/dashboard/client-filter-context";
import { cn } from "@/lib/utils";
import { track } from "@/lib/mixpanel";
import { clientHref } from "@/lib/client-origin";
import { getClientStatus } from "@/lib/types";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";

// La vista previa que vive DENTRO de la hoja de búsqueda de Cartera.
//
// Por qué existe en vez de dejar que el dueño cierre y mire la lista de abajo:
// en Cartera esa lista está al final de la pantalla, detrás de las tarjetas de
// capital y la tira de tasas. Buscar y luego tener que cerrar y desplazarse
// para ver el resultado convierte una búsqueda en tres gestos.
//
// LO QUE NO HACE: no filtra ni ordena nada por su cuenta. Lee `sortedRows` del
// mismo estado que la tabla de abajo, así que las dos no pueden decir cosas
// distintas sobre el mismo cliente.
const PREVIEW_LIMIT = 6;

export function ClientSearchResults({ ledger }: { ledger: LedgerDisplay | null }) {
  const router = useRouter();
  // Del contexto y no de una prop: quien monta este componente es Cartera, que
  // es un Server Component y no puede pasar funciones.
  const close = useCloseSearchSheet();
  const filters = useSharedClientFilters();
  if (!filters) return null;

  const { sortedRows, judgementBalance } = filters;
  const shown = sortedRows.slice(0, PREVIEW_LIMIT);

  if (sortedRows.length === 0) {
    return (
      <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
        Ningún cliente coincide con estos filtros.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {shown.map((row) => {
        const status = getClientStatus(
          judgementBalance(row),
          row.days_since_payment,
          row.oldest_unpaid_charge_at,
          row.oldest_unpaid_charge_plazo_dias,
        );
        return (
          <button
            key={row.client_id}
            type="button"
            onClick={() => {
              track("Client Details Opened", { client_id: row.client_id, source: "cartera" });
              close();
              router.push(clientHref(row.client_id, "cartera"));
            }}
            className={cn(CLIENT_CARD_SHELL, CLIENT_CARD_ROW)}
          >
            <ClientCardBody
              name={row.name}
              documentId={row.document_id}
              status={status}
              hasPendingReview={row.has_pending_review}
              isFlagged={row.is_flagged}
              balance={row.balance}
              balanceUsd={row.balance_usd}
              balanceEur={row.balance_eur}
              ledger={ledger}
            />
          </button>
        );
      })}

      {/* Decir cuántos quedan fuera, no solo cortar. Seis tarjetas sin más son
          indistinguibles de "estos son todos", y el dueño dejaría de buscar
          creyendo que el cliente que falta no existe. */}
      {sortedRows.length > shown.length ? (
        <p className="px-1 text-xs text-muted-foreground">
          Mostrando {shown.length} de {sortedRows.length}. Afina la búsqueda o abre la lista
          completa.
        </p>
      ) : null}
    </div>
  );
}
