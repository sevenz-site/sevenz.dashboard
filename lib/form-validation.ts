import { validatePasswordComplexity } from "@/lib/password";

// Blocking, field-level validation shown as red text under the input.
//
// These exist because the browser's own validation (`required`, `type=email`,
// `min`) shows an English tooltip — "Please fill out this field." — over a
// Spanish form, positioned wherever the browser likes and gone the moment you
// touch anything. Every form that uses these rules sets `noValidate` so the
// browser stops doing that, and gets the same red border + Spanish message
// treatment instead.
//
// `required` attributes stay on the inputs even with noValidate: they no
// longer block submission, but they are what tells a screen reader the field
// is mandatory before anyone tries to submit.
//
// A rule reads its own field's value and, when it needs a second field (a
// password confirmation), the whole FormData. Returning null means valid.
export type FieldRule = (value: string, data: FormData) => string | null;

export const REQUIRED_MESSAGE = "Completa este campo.";

export const required: FieldRule = (value) => (value.trim() ? null : REQUIRED_MESSAGE);

// Deliberately loose: something@something.tld. Anything stricter starts
// rejecting real addresses, and the only check that actually proves an
// address works is the confirmation email.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export const email: FieldRule = (value) => {
  const trimmed = value.trim();
  if (!trimmed) return REQUIRED_MESSAGE;
  return EMAIL_PATTERN.test(trimmed)
    ? null
    : "Escribe un correo válido, por ejemplo nombre@correo.com.";
};

// The WhatsApp field writes its combined "+57 300..." value into a hidden
// input, so an empty one means no number was typed at all. Whether the number
// looks right for its country stays a WARNING inside WhatsappInput (amber,
// still saveable) — an owner with an unusual but real number must never be
// locked out of saving their own client.
export const whatsapp: FieldRule = (value) =>
  value.trim() ? null : "Escribe el número de WhatsApp.";

export function amount({
  max,
  maxMessage,
}: { max?: number | null; maxMessage?: string } = {}): FieldRule {
  return (value) => {
    const trimmed = value.trim();
    if (!trimmed) return "Escribe el monto.";
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return "El monto solo puede tener números.";
    if (parsed <= 0) return "El monto debe ser mayor que 0.";
    if (max != null && parsed > max) {
      return maxMessage ?? "El monto es mayor de lo permitido.";
    }
    return null;
  };
}

// Only for fields that SET a new password. A login field must never be held
// to the current policy — an older password that predates it still has to be
// able to sign in.
export const newPassword: FieldRule = (value) => {
  if (!value) return REQUIRED_MESSAGE;
  return validatePasswordComplexity(value);
};

export function confirmPassword(passwordFieldName: string): FieldRule {
  return (value, data) => {
    if (!value) return REQUIRED_MESSAGE;
    return value === String(data.get(passwordFieldName) ?? "")
      ? null
      : "Las contraseñas no coinciden.";
  };
}

// An unchecked checkbox submits nothing at all, so an empty value is what
// "not accepted" looks like in FormData.
export function mustAccept(message: string): FieldRule {
  return (value) => (value ? null : message);
}
