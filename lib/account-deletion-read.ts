import { formatDateLong, zonaDelNegocio } from "@/lib/format";

/**
 * The date the signed-in owner's account will be deleted, written as the screens show it
 * («20 de diciembre de 2026», in the business's zone), from the result of
 * `supabase.rpc("my_account_deletion")` (migration 227). Null with no open request.
 *
 * Mi negocio and Inicio both call the RPC inside their own `Promise.all` and pass the result
 * here, so the date is written in one place. A failed read, migration 227 not run included,
 * reads as «no request»: the card then offers «Eliminar», which is what it showed before.
 */
export function deletionDateText(
  result: { data: unknown; error: { message: string } | null },
  country: string | null | undefined,
): string | null {
  if (result.error) {
    console.error("my_account_deletion:", result.error.message);
    return null;
  }
  return typeof result.data === "string" && result.data ? formatDateLong(result.data, zonaDelNegocio(country)) : null;
}
