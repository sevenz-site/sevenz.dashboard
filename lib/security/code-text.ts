// THE WORDS AND SHAPES OF THE SECOND-FACTOR CODE (C1 of PL-22). Pure: no I/O, so
// `qa:segundo-factor` can check them without a database.
//
// Six digits, ten minutes, five attempts, one live code — the owner's decisions of
// 2026-11-05. The texts are what the shopkeeper reads on screen, in the in-app voice:
// neutral, exact, one sentence per fact. He asked for it in those words: *«todo debe tener
// cue visual para que el usuario esté informado en todo momento, los cue visuales copies,
// etc deben ser claros y precisos»*.

export const CODE_LENGTH = 6;
export const CODE_TTL_MINUTES = 10;
export const CODE_MAX_ATTEMPTS = 5;
export const RESEND_WAIT_SECONDS = 60;
/** How long the browser keeps the «waiting for the code» ticket: the code's own life. */
export const LOGIN_TICKET_COOKIE = "sz_login";
export const LOGIN_TICKET_MINUTES = CODE_TTL_MINUTES;

export type CodeChannel = "whatsapp" | "email";
export type CodePurpose = "login" | "enable" | "password" | "number" | "admin_email";

/** A code the shopkeeper types: six digits, spaces and dashes tolerated. */
export function normalizeCode(raw: string): string | null {
  const digits = String(raw ?? "").replace(/[\s-]/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

/** `+58 412 ··· 0265`: enough to recognise one's own number, not enough to copy it. */
export function maskPhone(digits: string | null | undefined): string {
  const d = String(digits ?? "").replace(/\D/g, "");
  if (d.length < 6) return "tu WhatsApp";
  return `···· ${d.slice(-4)}`;
}

/** `j***@gmail.com`. The domain stays: it is what tells two of one's addresses apart. */
export function maskEmail(email: string | null | undefined): string {
  const e = String(email ?? "").trim();
  const at = e.indexOf("@");
  if (at < 1) return "tu correo";
  return `${e[0]}***${e.slice(at)}`;
}

/** Where the code went, as the screen says it. */
export function sentToText(channel: CodeChannel, target: string): string {
  return channel === "whatsapp"
    ? `Te enviamos un código al WhatsApp que termina en ${maskPhone(target).replace("···· ", "")}.`
    : `Te enviamos un código al correo ${maskEmail(target)}.`;
}

/** The sentence for each way a code can be refused. `attemptsLeft` only matters for `mismatch`. */
export function rejectionText(code: string, attemptsLeft?: number): string {
  switch (code) {
    case "mismatch":
      return attemptsLeft === 1
        ? "No coincide. Te queda 1 intento."
        : `No coincide. Te quedan ${attemptsLeft ?? 0} intentos.`;
    case "expired":
      return "Ese código caducó. Te enviamos uno nuevo.";
    case "locked":
      return `Demasiados intentos. Espera ${CODE_TTL_MINUTES} minutos o pide un código nuevo.`;
    case "too_many":
      return "Pediste demasiados códigos. Espera una hora e inténtalo de nuevo.";
    case "none":
    case "bad_ticket":
      return "No hay ningún código pendiente. Pide uno nuevo.";
    case "send_failed":
      return "No pudimos enviar el código. Inténtalo en unos minutos.";
    default:
      return "No pudimos comprobar el código. Inténtalo de nuevo.";
  }
}

/** The email that carries a code. Plain text, the code alone on its own line, no links: the
 *  owner's rule of 2026-11-05 (*«no debe haber links en los mensajes, solo el código plano»*). */
export function codeEmail(code: string, purposeText: string): { subject: string; text: string } {
  return {
    subject: `Tu código de Sevenz: ${code}`,
    text: [
      `Tu código para ${purposeText} es:`,
      "",
      code,
      "",
      `Vale ${CODE_TTL_MINUTES} minutos. Si no lo pediste, ignora este correo: sin el código nadie puede hacer nada.`,
      "",
      "Sevenz nunca te pide este código por WhatsApp, llamada ni correo.",
    ].join("\n"),
  };
}

export function purposeText(purpose: CodePurpose): string {
  switch (purpose) {
    case "login":
      return "entrar a Sevenz";
    case "enable":
      return "activar la verificación en dos pasos";
    case "password":
      return "cambiar tu contraseña";
    case "number":
      return "confirmar tu nuevo número de WhatsApp";
    case "admin_email":
      return "confirmar tu identidad con el equipo de Sevenz";
  }
}

/** True when the text carries a link of any kind. Guards the email body in QA. */
export function hasLink(text: string): boolean {
  return /https?:\/\/|www\.|<a\s/i.test(text);
}
