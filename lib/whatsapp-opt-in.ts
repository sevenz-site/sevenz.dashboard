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
  "Recibir resumen semanal de cartera en tu WhatsApp.";

// NO ES UNA DECLARACIÓN FIRMADA, Y NO TIENE QUE SERLO. Lo que se guarda es
// «esto es lo que tenía delante cuando lo encendió», no «esto es lo que
// declaró». El consentimiento es el acto —mover el interruptor a mano— y esta
// cadena es la prueba de qué decía la pantalla ese día. Por eso tiene que ser
// literalmente lo que se muestra, y no una versión formal escrita aparte: dos
// textos distintos convertirían la evidencia en una reconstrucción.

// Y por eso hay DOS constantes y no una.
//
// El registro y Mi negocio son dos pantallas distintas y dicen cosas
// distintas: en Mi negocio hay un interruptor al lado y la frase lo describe;
// en el registro no hay interruptor, la acción es crear la cuenta, y la frase
// tiene que decir eso. Forzar el mismo texto en las dos dejaría una de las dos
// pantallas leyéndose mal, o —peor— guardaría en la ficha una frase que esa
// persona nunca vio.
//
// Una constante por superficie. Lo que se muestra es lo que se guarda, en las
// dos.
export const TEXTO_AVISOS_WHATSAPP_REGISTRO =
  "Al crear tu cuenta aceptas recibir un resumen semanal de tu cartera en tu " +
  "WhatsApp. Puedes desactivarlo cuando quieras en Mi negocio.";

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

// ── Cuándo volver a preguntar ────────────────────────────────────────────
//
// La espera se cuenta en DÍAS, no en accesos. Un tendero abre Sevenz veinte
// veces al día: "cada 5 accesos" serían cuatro diálogos diarios. El acceso no
// mide tiempo.
//
// Y no es un sorteo, aunque esa fue la idea de partida. Con azar no se puede
// probar —no sabes si el que no salió fue la suerte o un fallo— y le toca
// desigual: a uno dos veces seguidas y a otro nunca. El que se lo lleva dos
// veces seguidas es justo quien piensa que la app le insiste.
const ESPERA_DIAS = [14, 45];
export const MAX_PREGUNTAS = ESPERA_DIAS.length + 1; // 3: la primera y dos más

const DIA_MS = 24 * 60 * 60 * 1000;

export function tocaPreguntarAvisos(
  owner: Pick<
    Owner,
    | "whatsapp"
    | "whatsapp_opt_in_at"
    | "whatsapp_opt_out_at"
    | "whatsapp_prompt_last_at"
    | "whatsapp_prompt_count"
    | "onboarding_completed_at"
  >,
  // Si el dueño tiene algo que resumir. Ofrecerle "el resumen de tu cartera" a
  // quien no tiene ningún cliente debiendo es ofrecerle el resumen de nada, y
  // enseña que los avisos de Sevenz no sirven. Es lo que más sube la respuesta
  // afirmativa, más que la frecuencia.
  tieneCarteraPendiente: boolean,
): boolean {
  // Ya lo tiene. No hay nada que ofrecer.
  if (aceptaAvisosWhatsapp(owner)) return false;

  // Lo apagó a mano: eso es una respuesta, no una pregunta pendiente. Volver a
  // ofrecérselo sería discutirle la decisión.
  if (owner.whatsapp_opt_out_at) return false;

  // Sin número el interruptor lo rechazaría igual, así que el diálogo sería
  // una puerta a ninguna parte.
  if (!owner.whatsapp?.trim()) return false;

  // Durante el tour hay otra capa encima. Dos a la vez es un lío, y además el
  // recién llegado todavía no sabe qué es una cartera.
  if (!owner.onboarding_completed_at) return false;

  if (!tieneCarteraPendiente) return false;

  // Contestó que no las veces acordadas. El interruptor de Mi negocio queda
  // como el único camino, que es lo correcto: un cuarto intento no convence a
  // nadie, fastidia.
  if (owner.whatsapp_prompt_count >= MAX_PREGUNTAS) return false;

  // Primera vez.
  if (!owner.whatsapp_prompt_last_at) return true;

  const espera = ESPERA_DIAS[owner.whatsapp_prompt_count - 1];
  if (espera === undefined) return false;
  return Date.now() - new Date(owner.whatsapp_prompt_last_at).getTime() >= espera * DIA_MS;
}
