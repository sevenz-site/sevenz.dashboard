// Matches the password policy configured in Supabase Auth (Sign In /
// Providers → Email → "Password requirements" and "Minimum password
// length") — kept here as the single source of truth so the client-side
// live checklist and every server action's validation can never drift
// apart from each other. If that Supabase setting ever changes, update
// MIN_PASSWORD_LENGTH here to match.
export const MIN_PASSWORD_LENGTH = 8;

export type PasswordCriterion = { id: string; label: string; met: boolean };

export function getPasswordCriteria(password: string): PasswordCriterion[] {
  return [
    {
      id: "length",
      label: `Al menos ${MIN_PASSWORD_LENGTH} caracteres`,
      met: password.length >= MIN_PASSWORD_LENGTH,
    },
    { id: "lower", label: "Una letra minúscula", met: /[a-z]/.test(password) },
    { id: "upper", label: "Una letra mayúscula", met: /[A-Z]/.test(password) },
    { id: "digit", label: "Un número", met: /[0-9]/.test(password) },
    { id: "symbol", label: "Un símbolo (ej. !@#$%)", met: /[^A-Za-z0-9]/.test(password) },
  ];
}

// Server-side counterpart to the live checklist — same criteria, returns a
// single friendly Spanish message instead of a per-item breakdown.
export function validatePasswordComplexity(password: string): string | null {
  const unmet = getPasswordCriteria(password).filter((c) => !c.met);
  if (unmet.length === 0) return null;
  return `La contraseña debe cumplir: ${unmet.map((c) => c.label.toLowerCase()).join(", ")}.`;
}
