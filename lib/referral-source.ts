// "¿Cómo conociste Sevenz?" — the closed list, written once.
//
// These strings are stored in owners.referral_source and checked by a
// constraint in supabase/048_owner_referral_source.sql. **The two lists must
// stay identical.** Adding a value means editing both, in that order: the
// migration first (in dev and production), then this file, then deploy — a
// value the database rejects would fail the signup, not the field.
//
// Renaming a value is not an edit, it is a data migration: old rows keep the
// old string and no query would see both halves.

export const REFERRAL_SOURCES = [
  // First on purpose. This is the one the 1:1 pilot exists to measure, and the
  // list is read top-down by someone standing at a counter.
  { value: "visita_vendedor", label: "Un vendedor me visitó" },
  { value: "recomendacion", label: "Me lo recomendó otro comerciante" },
  { value: "redes_sociales", label: "Redes sociales" },
  { value: "busqueda_internet", label: "Buscando en internet" },
  { value: "otro", label: "Otro" },
] as const;

export type ReferralSource = (typeof REFERRAL_SOURCES)[number]["value"];

export function isReferralSource(value: string): value is ReferralSource {
  return REFERRAL_SOURCES.some((s) => s.value === value);
}
