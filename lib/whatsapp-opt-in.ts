import type { Owner } from "@/lib/types";

// EL TEXTO DEL CONSENTIMIENTO, EN UN SOLO SITIO.
//
// Es lo que el dueño lee junto al interruptor Y lo que se guarda en su ficha
// cuando lo enciende. Tiene que ser literalmente la misma cadena en los dos
// sitios: si la pantalla dijera una cosa y se guardara otra, la evidencia que
// le enseñaríamos a Meta sería falsa — que es peor que no tener ninguna.
//
// SE CAMBIA CREANDO UNA VERSIÓN NUEVA, NO EDITANDO ESTA. Las fichas que ya
// tienen guardada la v1 seguirán diciendo v1, que es exactamente lo correcto:
// eso fue lo que esas personas leyeron. Editar esta constante reescribiría el
// pasado de nadie —las copias guardadas no se tocan— pero dejaría dos textos
// distintos llamándose igual, y al comparar no se sabría cuál es cuál.
export const TEXTO_AVISOS_WHATSAPP =
  "Acepto recibir en mi WhatsApp un resumen semanal de mi cartera y avisos " +
  "sobre lo que necesita atención. Puedo desactivarlo cuando quiera desde " +
  "esta misma pantalla.";

// La única función que decide si a un dueño se le puede escribir.
//
// No basta con `whatsapp_opt_in_at is not null`: al desactivar NO se borra esa
// fecha —es la prueba de que el consentimiento existió ese día— sino que se
// escribe `whatsapp_opt_out_at`. Así que aceptó de verdad quien tiene fecha de
// alta y, o no tiene baja, o la baja es anterior a un alta posterior.
//
// Y sin número no se le escribe a nadie, por obvio que parezca: es la
// comprobación que convierte "aceptó" en "se le puede mandar".
export function aceptaAvisosWhatsapp(
  owner: Pick<Owner, "whatsapp" | "whatsapp_opt_in_at" | "whatsapp_opt_out_at">,
): boolean {
  if (!owner.whatsapp?.trim()) return false;
  if (!owner.whatsapp_opt_in_at) return false;
  if (!owner.whatsapp_opt_out_at) return true;
  return new Date(owner.whatsapp_opt_in_at) > new Date(owner.whatsapp_opt_out_at);
}
