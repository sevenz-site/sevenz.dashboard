import "server-only";
import type { FactsForTheModel } from "@/lib/reports/assistant/facts";
import { construirPrompt } from "@/lib/reports/assistant/prompt";
import { validarNota } from "@/lib/reports/assistant/validate";
import type { AssistantNote } from "@/lib/reports/assistant/fallback";

// ═══════════════════════════════════════════════════════════════════════
// LA LLAMADA A GEMINI, Y POR QUÉ NO REUTILIZA LA QUE YA HAY
//
// `app/api/extract/route.ts` ya llama a Gemini para leer fotos de libreta, y
// este archivo copia su forma --cabecera `x-goog-api-key`, cadena de modelos,
// un presupuesto para toda la petición, reintento solo en 429 y 5xx-- porque
// esa forma está medida y funciona.
//
// Lo que NO comparte es la clave, y es deliberado:
//
//   · `GEMINI_API_KEY` lee fotos con nombres de clientes dentro, y el dueño
//     decidió el 2026-10-29 pasarla a nivel de PAGO.
//   · `GEMINI_REPORTES_API_KEY` manda solo cifras agregadas y se queda en el
//     nivel GRATUITO, también por decisión suya.
//
// Compartirlas ataría las dos decisiones a la misma factura, y haría que una
// funcionalidad pudiera gastarle la cuota diaria a la otra: un tendero
// importando su libreta dejaría a otro sin resumen.
//
// ───────────────────────────────────────────────────────────────────────
// NO SE COMPARTE EL CÓDIGO TODAVÍA, Y SE DICE EN VOZ ALTA
//
// Esta es la TERCERA copia del mismo bloque de `fetch` en el repo --`/api/
// extract`, `lib/admin/health.ts` y ahora esta--, y extraerlo a un cliente
// común es trabajo que merece la pena hacer. No se hace aquí porque tocar el
// camino de las fotos, que está en producción y da de comer, para estrenar una
// funcionalidad nueva es cambiar dos cosas a la vez. Queda apuntado.
//
// ───────────────────────────────────────────────────────────────────────
// EL PRESUPUESTO ES MÁS CORTO QUE EL DE LAS FOTOS, A PROPÓSITO
//
// Allí son 50 segundos porque el tendero está esperando a que su libreta se
// lea y no hay nada más que hacer. Aquí hay un texto de respaldo listo, así
// que esperar mucho no compra nada: lo que se gana tardando 40 segundos en vez
// de 12 es un resumen algo mejor a cambio de una pantalla que parece colgada.
// ═══════════════════════════════════════════════════════════════════════

// ───────────────────────────────────────────────────────────────────────
// LA CADENA, MEDIDA Y NO HEREDADA
//
// `/api/extract` usa cuatro modelos y esta empezó copiando tres de ellos. El
// 2026-10-30, con el prompt REAL de 3.308 caracteres y la clave de dev, dos
// pasadas por cada uno:
//
//   gemini-3.5-flash-lite    1.011 ms · 1.046 ms
//   gemini-3-flash-preview  18.031 ms · se agotó a los 40.000
//   gemini-3.1-flash-lite    1.565 ms · 1.654 ms
//
// El del medio se va. No es que fuera lento de más: es que estaba el SEGUNDO,
// así que cada vez que el primero fallaba se comía el presupuesto entero y la
// cadena no llegaba nunca al tercero --que contesta en segundo y medio--. El
// síntoma era «se agotó el tiempo» en los tres, y la causa era uno.
//
// SE MIDIÓ PORQUE EL LOG LO PIDIÓ. Hasta ese día los fallos transitorios se
// reintentaban en silencio, así que lo único observable era una ruta que
// tardaba 16 segundos y devolvía el texto de respaldo sin decir por qué.
// ───────────────────────────────────────────────────────────────────────
export const runtimeModelos = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"] as const;

// Con los dos respondiendo en torno a 1,5 s, 8 s por intento es cinco veces el
// tiempo medido: holgura para un mal minuto de Google sin que un modelo
// atascado se lleve el turno del siguiente.
const PRESUPUESTO_MS = 18_000;
const INTENTO_MAX_MS = 8_000;

export type ResultadoIA =
  | { ok: true; note: AssistantNote; modelo: string }
  | { ok: false; motivo: "timeout" | "http" | "validation" | "no_key"; detalle: string };

class ErrorTransitorio extends Error {}
class ErrorDeTiempo extends Error {}

export async function generarNota(f: FactsForTheModel): Promise<ResultadoIA> {
  const apiKey = process.env.GEMINI_REPORTES_API_KEY?.trim();
  if (!apiKey) {
    // SIN MARCAR COMO ERROR DEL DUEÑO: es un fallo de configuración nuestro, y
    // él solo verá el texto de respaldo. El detalle útil va al log.
    console.error("[asistente] GEMINI_REPORTES_API_KEY no está configurada.");
    return { ok: false, motivo: "no_key", detalle: "sin clave" };
  }
  // La misma guarda que `/api/extract`, y por la misma razón: Google contesta
  // a una clave cortada con un 401 que habla de OAuth y no menciona la clave.
  if (apiKey.length < 30) {
    console.error(`[asistente] GEMINI_REPORTES_API_KEY parece incompleta (${apiKey.length} caracteres).`);
    return { ok: false, motivo: "no_key", detalle: "clave incompleta" };
  }

  const prompt = construirPrompt(f);
  const arranque = Date.now();
  const queda = () => PRESUPUESTO_MS - (Date.now() - arranque);
  let ultimo = "sin intentos";

  for (const modelo of runtimeModelos) {
    if (queda() < 2_000) break;
    try {
      const bruto = await unIntento(apiKey, modelo, prompt, Math.min(INTENTO_MAX_MS, queda()));
      const v = validarNota(bruto, f);
      if (v.ok) return { ok: true, note: v.note, modelo };
      // UNA VALIDACIÓN FALLIDA CAMBIA DE MODELO, no se da por perdida: el
      // siguiente puede obedecer donde este no. Pero si se acaban, el motivo
      // que se guarda es `validation` y no `http`, porque son dos averías
      // distintas y la tarjeta de /admin las separa.
      ultimo = v.detalle;
      console.error(`[asistente] ${modelo} no pasó la validación: ${v.detalle}`);
      continue;
    } catch (e) {
      if (e instanceof ErrorDeTiempo) {
        ultimo = "timeout";
        console.error(`[asistente] ${modelo}: se agotó el tiempo`);
        continue;
      }
      if (e instanceof ErrorTransitorio) {
        // SE REGISTRA, aunque se reintente. Antes se tragaba en silencio y el
        // resultado era una ruta que tardaba 16 segundos, devolvía el texto de
        // respaldo y no dejaba ni una línea de por qué: imposible distinguir
        // «Google está saturado» de «esta clave no puede con estos modelos».
        // Un reintento callado no es prudencia, es borrar la prueba.
        ultimo = e.message;
        console.error(`[asistente] ${modelo}: ${e.message}`);
        continue;
      }
      // Una credencial rechazada o un 4xx no se arreglan cambiando de modelo.
      console.error("[asistente] Gemini:", e instanceof Error ? e.message : e);
      return { ok: false, motivo: "http", detalle: "respuesta inesperada" };
    }
  }

  return ultimo === "timeout"
    ? { ok: false, motivo: "timeout", detalle: "se agotó el tiempo" }
    : { ok: false, motivo: ultimo.startsWith("Gemini") ? "http" : "validation", detalle: ultimo };
}

async function unIntento(
  apiKey: string,
  modelo: string,
  prompt: string,
  timeoutMs: number,
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // `temperature: 0` COMO EN LAS FOTOS. Dos tenderos con los mismos
          // números deben leer el mismo consejo, y el mismo tendero dos días
          // seguidos también si nada cambió. La variedad no es una virtud
          // cuando lo que se escribe es qué hacer con el dinero de alguien.
          generationConfig: { temperature: 0, responseMimeType: "application/json" },
        }),
      },
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new ErrorDeTiempo();
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 429 || response.status >= 500) {
    throw new ErrorTransitorio(`Gemini ${response.status}`);
  }
  if (!response.ok) {
    const text = await response.text();
    console.error(`[asistente] Gemini respondió ${response.status}:`, text.slice(0, 300));
    throw new Error(`Gemini ${response.status}`);
  }

  const payload = await response.json();
  const raw: string = payload?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  // La valla de ```json que `/api/extract` ya documenta: el modelo la pone
  // aunque se le pida JSON puro.
  const limpio = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(limpio);
  } catch {
    throw new ErrorTransitorio("Gemini devolvió algo que no es JSON");
  }
}
