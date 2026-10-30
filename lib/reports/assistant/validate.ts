import type { FactsForTheModel } from "@/lib/reports/assistant/facts";
import { hechosEnTexto } from "@/lib/reports/assistant/prompt";
import { MAX_CHARS, noteLength, type AssistantNote } from "@/lib/reports/assistant/fallback";

// ═══════════════════════════════════════════════════════════════════════
// NINGUNA CIFRA LLEGA A LA PANTALLA SIN ESTAR EN LOS HECHOS
//
// This is the guarantee the whole feature rests on, and it is checked rather
// than trusted. The prompt forbids inventing numbers; prompts are asked, not
// obeyed, and a model that misreads one is indistinguishable from one that got
// it right unless somebody compares.
//
// WHAT IT COSTS TO GET WRONG, in the shopkeeper's terms: the banner says he is
// owed $1.185 when he is owed $11.852, and he stops chasing the client who
// owes him the difference. Or it says four products are running out when
// fourteen are. Nothing errors, nothing turns red, and the number is
// believable — which is exactly the failure mode this repo keeps paying for.
//
// ───────────────────────────────────────────────────────────────────────
// HOW IT WORKS, AND WHY IT IS NOT A REGEX OVER THE FACTS
//
// Every number-looking token in the generated text must appear, verbatim, in
// the pre-rendered fact list. The facts arrive already formatted -- «$11.852,69»
// and not `11852.69` -- precisely so that this comparison is a string match and
// not a numeric one. A numeric comparison would have to parse «11.852,69» back,
// and the parser would be a second place to get Venezuelan separators wrong.
//
// TOKENS, NOT SUBSTRINGS. «11.852,69» is one token; checking digit by digit
// would accept any number made of digits that happen to appear somewhere. And
// a token of the output must match a WHOLE token of the facts, so «1.185» does
// not pass by being a prefix of «11.852,69».
//
// WHAT IS DELIBERATELY ALLOWED: «30» (the days that define «crítico») and «7»
// (the window), because the prompt itself states them and a summary that says
// «más de 30 días» is quoting the app, not inventing. They are listed rather
// than inferred so that adding a third exception is a decision somebody makes
// on purpose.
// ═══════════════════════════════════════════════════════════════════════

export type Veredicto =
  | { ok: true; note: AssistantNote }
  | { ok: false; motivo: "validation"; detalle: string };

/**
 * Numbers the model may write without them being a fact: the ones the prompt
 * puts in its own mouth. Keep this list tiny -- every entry is a number nobody
 * will ever check again.
 */
const PERMITIDOS = new Set(["30", "7"]);

/** Pulls out anything that reads as a figure: 1.234,56 · 45 · 12% */
function cifras(texto: string): string[] {
  return texto.match(/\d[\d.,]*/g) ?? [];
}

export function validarNota(bruto: unknown, f: FactsForTheModel): Veredicto {
  if (typeof bruto !== "object" || bruto === null) {
    return { ok: false, motivo: "validation", detalle: "la respuesta no es un objeto" };
  }
  const o = bruto as Record<string, unknown>;
  const summary = typeof o.summary === "string" ? o.summary.trim() : "";
  const recommendations = Array.isArray(o.recommendations)
    ? o.recommendations.filter((r): r is string => typeof r === "string").map((r) => r.trim()).filter(Boolean)
    : [];

  if (!summary) {
    return { ok: false, motivo: "validation", detalle: "sin resumen" };
  }
  // THREE AT MOST, enforced here and not only asked for: a fourth bullet would
  // push the note over budget and get silently trimmed, which looks like the
  // model being cut off rather than the app holding a limit.
  if (recommendations.length > 3) {
    return { ok: false, motivo: "validation", detalle: `${recommendations.length} recomendaciones` };
  }

  const note: AssistantNote = { summary, recommendations };
  if (noteLength(note) > MAX_CHARS) {
    return { ok: false, motivo: "validation", detalle: `${noteLength(note)} caracteres` };
  }

  // ── LA COMPROBACIÓN QUE IMPORTA ───────────────────────────────────
  const permitidas = new Set(PERMITIDOS);
  for (const h of hechosEnTexto(f)) for (const c of cifras(h.valor)) permitidas.add(c);

  const inventadas = [...new Set(cifras([summary, ...recommendations].join(" ")))].filter(
    (c) => !permitidas.has(c),
  );
  if (inventadas.length) {
    return {
      ok: false,
      motivo: "validation",
      detalle: `cifras que no están en los hechos: ${inventadas.join(", ")}`,
    };
  }

  // NOMBRES, POR SI ACASO. Los hechos no llevan ninguno, así que el modelo no
  // tiene de dónde sacarlos -- pero inventarse un nombre plausible es
  // justamente lo que un modelo sabe hacer, y un «Cóbrale a María» en la
  // pantalla de un tendero que no tiene ninguna María no se lee como un error
  // de la IA: se lee como que la app se confundió de negocio.
  const sospecha = /\b(cliente|producto|proveedor)\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+/.test(
    [summary, ...recommendations].join(" "),
  );
  if (sospecha) {
    return { ok: false, motivo: "validation", detalle: "parece nombrar a alguien" };
  }

  return { ok: true, note };
}
