// El bloqueo de una cuenta, visto desde la app del tendero.
//
// Este archivo NO toca la base. La cerradura es la política de la 061; esto es
// el idioma común entre el servidor, que sabe que la cuenta está pausada, y la
// pantalla, que tiene que decirlo de una manera que se entienda.
//
// SIN IMPORTS DE SERVIDOR, a propósito: lo lee un componente de cliente. La
// consulta a la base vive en lib/cuenta-pausada-server.ts.

// El texto que devuelven las acciones cuando la cuenta está pausada.
//
// Es un mensaje de verdad y no un código interno (`__pausada__`) por una razón
// práctica: si algún día una acción nueva se olvida de pasar por el aviso, lo
// peor que puede pasar es que el tendero lea esta frase en rojo — que es
// correcta— en vez de "new row violates row-level security policy for table
// movements", que es lo que veía antes.
export const MENSAJE_CUENTA_PAUSADA =
  "Tu cuenta está pausada. Por ahora no puedes registrar ni modificar nada.";

export const EVENTO_CUENTA_PAUSADA = "sevenz:cuenta-pausada";

// ¿Este error es "la cuenta está pausada"?
//
// Reconoce DOS cosas. La primera es nuestro mensaje. La segunda es el texto
// crudo de Postgres, que es el que se coló en la pantalla del formulario el
// día que se probó el bloqueo. Sigue reconociéndose porque hay dos caminos por
// los que puede volver a aparecer: una acción que escriba sin pasar por el
// aviso previo, y la carrera de bloquear a alguien con el formulario ya
// abierto — ahí la comprobación de antes dijo que sí y la política dice que
// no.
export function esCuentaPausada(mensaje?: string | null): boolean {
  if (!mensaje) return false;
  return (
    mensaje === MENSAJE_CUENTA_PAUSADA ||
    mensaje.includes("row-level security policy") ||
    mensaje.includes("violates row-level security")
  );
}

// Enseña el diálogo de cuenta pausada si el error es ese, y dice si lo hizo.
//
// Devuelve true para que quien llama se calle: el toast rojo con el mismo
// texto detrás del diálogo sobra, y ya nos pasó en el formulario de
// movimientos que el mensaje crudo quedara ahí debajo.
//
// Un evento del window y no un contexto de React porque esto se llama desde
// dentro de callbacks y de funciones que no son componentes, donde no hay hook
// que valga. El que escucha es CuentaPausadaProvider, montado en el layout.
export function avisarCuentaPausada(mensaje?: string | null): boolean {
  if (!esCuentaPausada(mensaje)) return false;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(EVENTO_CUENTA_PAUSADA));
  }
  return true;
}
