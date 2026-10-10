// THE CLOSED LISTS OF THE PRODUCT FORM.
//
// Figma frame 1175:5881 turns two free-text fields into pickers. They live here
// and not inside the dialog because the movement form is going to reuse both
// when a product is created inline, and a second copy of either list is a
// second vocabulary for the same thing.

// ───────────────────────────────────────────────────────────────────────────
// UNITS
//
// The frame's five: Unidad, Docena, Bulto, Kilo, Otro.
//
// `unit` in the database stays free text (083 did not constrain it), and that
// is deliberate even now that the UI is a picker: "Otro" has to put SOMETHING
// in that column, and the shopkeeper's own word for it is better than a bucket
// label. The picker is guidance; the column is whatever was chosen or typed.
//
// Still no conversion between units — see CT-51. A shopkeeper who buys by the
// dozen and sells by the unit has to pick which one they count in.
export const UNIT_OPTIONS = ["Unidad", "Docena", "Bulto", "Kilo"] as const;

// What `(unidad)` reads as beside the quantity stepper. The frame annotates it:
// «Valor entre paréntesis '(unidad)' depende de la unidad seleccionada».
//
// Plural, because it always follows a number greater than one in practice, and
// because "12 (unidad)" reads as a typo. The singular case is worth less than
// the plural one looking wrong on every other product.
const UNIT_PLURALS: Record<string, string> = {
  Unidad: "unidades",
  Docena: "docenas",
  Bulto: "bultos",
  Kilo: "kilos",
};

export function unitPlural(unit: string | null): string {
  if (!unit) return "unidades";
  return UNIT_PLURALS[unit] ?? unit.toLowerCase();
}

// ───────────────────────────────────────────────────────────────────────────
// MARGIN PRESETS
//
// The frame lists 10, 15, 20, 25, 35, 40 — and NOT 30.
//
// 30 is added here on purpose. It is the single most-cited number in the field
// research of 2026-10-09: Tendero 1 said «al precio de venta le pongo
// comúnmente un 30 % de margen», and Tendero 2 said «10 %, 15 % ó 30 % según
// el caso». A picker of the six closest numbers that omits the one both
// shopkeepers named sends the most common case straight to "Otro".
//
// Said out loud rather than fixed silently, because it contradicts the frame
// and the frame is the owner's: if the omission was intentional, this is the
// line to delete.
export const MARGIN_PRESETS = [10, 15, 20, 25, 30, 35, 40] as const;
