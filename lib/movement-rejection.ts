import type { createClient } from "@/lib/supabase/server";
import { trackServer } from "@/lib/mixpanel-server";
import type { MovementRejectionReason } from "@/lib/exchange-rate/resolve-movement-rate";
import type { LedgerCurrency } from "@/lib/types";

// Por cuál de las tres escrituras de dinero entró el rechazo. Son tres porque
// cuestan cosas distintas: en las dos primeras el dueño pierde un movimiento y
// lo reintenta; en el import se cae la tanda entera, y ahí ya se gastó la
// extracción de la foto y la revisión línea por línea.
export type MovementRejectionSource = "movimiento" | "cliente_nuevo" | "import";

// Deja constancia de un movimiento que no se escribió.
//
// Antes de esto, un rechazo no dejaba absolutamente nada: el dueño veía el
// mensaje rojo, cerraba la ventana, y para nosotros no había ocurrido. Un
// movimiento mal archivado —lo que pasaba antes del guardarraíl— al menos
// dejaba una fila que se podía buscar. Sin esta anotación no hay forma de saber
// si esto ocurre una vez al año o diez veces al día.
//
// NUNCA lanza. Lo que se está registrando ya es un fallo; que la anotación del
// fallo provoque otro fallo sería cambiar un mensaje explicable por una pantalla
// rota. Y cuando el motivo es 'pais_desconocido' la base de datos puede estar
// justamente caída, así que esta escritura es la que más probabilidades tiene de
// no llegar — por eso el evento de Mixpanel se manda aparte y no depende de ella.
export async function recordMovementRejection(
  supabase: Awaited<ReturnType<typeof createClient>>,
  {
    reason,
    source,
    userId,
    userEmail,
    clientId = null,
    amount = null,
    attemptedCurrency = null,
    rowsAffected = 1,
  }: {
    reason: MovementRejectionReason;
    source: MovementRejectionSource;
    userId: string;
    userEmail?: string | null;
    clientId?: string | null;
    amount?: number | null;
    attemptedCurrency?: LedgerCurrency | null;
    rowsAffected?: number;
  },
) {
  try {
    trackServer(
      "Movement Rejected",
      userId,
      { reason, source, rows_affected: rowsAffected, attempted_currency: attemptedCurrency },
      userEmail,
    );
  } catch {
    // Analítica: nunca vale una excepción en la ruta del dinero.
  }

  try {
    await supabase.rpc("record_movement_rejection", {
      p_reason: reason,
      p_source: source,
      p_client_id: clientId,
      p_amount: amount,
      p_attempted_currency: attemptedCurrency,
      p_rows_affected: rowsAffected,
    });
  } catch {
    // Idem. Si esto no entra, queda el evento de Mixpanel y el log del servidor.
  }
}
