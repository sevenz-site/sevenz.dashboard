import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { getOwnerRateContext } from "@/lib/exchange-rate/owner-rate";
import { getBolivarRates } from "@/lib/products/catalog";
import { trackServer } from "@/lib/mixpanel-server";
import { buildFacts } from "@/lib/reports/assistant/facts";
import { buildFallbackNote, type AssistantNote } from "@/lib/reports/assistant/fallback";
import { generarNota } from "@/lib/reports/assistant/gemini";

// ═══════════════════════════════════════════════════════════════════════
// EL RESUMEN DEL DÍA
//
// Una nota por dueño y por día, sobre una ventana fija de 7 días. Lo decidió
// el dueño el 2026-10-29: *«la idea es que ese insight se regenere una vez por
// día»*, después de preguntarse qué pasaría con *«100 dueños de negocios
// revisando sus finanzas día a día en una hora»*.
//
// ───────────────────────────────────────────────────────────────────────
// ESTA RUTA NUNCA DEVUELVE UN ERROR AL TENDERO
//
// Pase lo que pase --Gemini caído, cuota agotada, una cifra inventada-- sale
// un texto. El de respaldo está escrito en TypeScript sobre los mismos hechos
// y es indistinguible de un día normal.
//
// No es amabilidad: el banner está EXPANDIDO SIEMPRE por petición suya, y uno
// expandido y vacío no se lee como «la IA no contestó», se lee como que la
// pantalla se rompió.
//
// LO QUE SÍ PASA ES QUE LA CAÍDA QUEDA CONTADA, en dos sitios: un evento de
// Mixpanel y una fila marcada en la tabla, que es lo que alimenta la tarjeta
// de /admin que pidió el mismo día. Un fallo que el usuario no ve es un fallo
// que nadie reporta -- así que tiene que reportarse solo.
//
// ───────────────────────────────────────────────────────────────────────
// EL LIMITADOR ES EL QUE RECHAZA, NO EL QUE HACE COLA
//
// `claim_rate_limit_slot` --el que usa `/api/extract`-- NO rechaza nunca:
// devuelve a qué hora te toca y el llamante duerme hasta entonces. Con las
// fotos eso está bien, porque el tendero está esperando su libreta y no hay
// nada mejor que hacer.
//
// Aquí sería al revés: Reportes quedaría esperando detrás de las libretas de
// otros tenderos, con un texto de respaldo listo y sin usar. La migración
// `040` ya lo advierte por escrito. `claim_rate_limit_quota` contesta «no» al
// instante, y ese «no» cuesta cero.
//
// TRES INTENTOS POR DUEÑO Y DÍA: uno para el caso normal y dos para que un
// fallo pasajero a las ocho de la mañana no deje al tendero con el texto de
// respaldo hasta la noche.
// ═══════════════════════════════════════════════════════════════════════

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

const INTENTOS_POR_DIA = 3;
const UN_DIA = 86_400;

type Respuesta = AssistantNote & {
  degraded: boolean;
  /**
   * El pulgar que el tendero ya dio a ESTA nota, si lo dio.
   *
   * Sin este campo el componente nace sin memoria y vuelve a preguntar «¿qué
   * tan útil te parece?» en cada recarga, por una nota que ya calificó. No era
   * «una vez al día»: era una vez por visita. Lo destapó el dueño el
   * 2026-10-30 preguntando cada cuánto aparecía.
   */
  rating: "useful" | "not_useful" | null;
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const hoy = new Date().toISOString().slice(0, 10);
  const service = createServiceClient();

  // ── 1. ¿YA HAY NOTA DE HOY? ───────────────────────────────────────
  const { data: guardada } = await supabase
    .from("report_assistant_notes")
    .select("summary, recommendations, degraded, rating")
    .eq("owner_id", user.id)
    .eq("day", hoy)
    .maybeSingle();

  // UNA NOTA BUENA CIERRA EL DÍA. Una degradada no: se vuelve a intentar
  // mientras queden intentos, y si no quedan se devuelve la que hay.
  if (guardada && !guardada.degraded) {
    return NextResponse.json(aRespuesta(guardada));
  }

  if (!(await quedaIntento(service, user.id))) {
    return NextResponse.json(
      guardada ? aRespuesta(guardada) : await notaDeRespaldo(supabase, service, user.id, hoy, "quota"),
    );
  }

  // ── 2. LOS HECHOS ─────────────────────────────────────────────────
  let hechos;
  try {
    const ownerRate = await getOwnerRateContext(supabase, user.id);
    const rates = ownerRate ? await getBolivarRates(ownerRate.effectiveRate) : null;
    hechos = await buildFacts({
      supabase,
      ownerId: user.id,
      dosLibros: ownerRate !== null,
      effectiveRate: ownerRate?.effectiveRate ?? null,
      rates,
    });
  } catch (e) {
    // SI NI SIQUIERA HAY HECHOS, no hay nada que resumir ni con IA ni sin
    // ella, y tampoco se guarda nada: el problema es de lectura, no del
    // modelo, y marcarlo como caída del asistente ensuciaría la tarjeta de
    // /admin con una avería que no es la suya.
    console.error("[asistente] no se pudieron construir los hechos:", e instanceof Error ? e.message : e);
    return NextResponse.json({ summary: "", recommendations: [], degraded: true, rating: null }, { status: 200 });
  }

  // UN NEGOCIO SIN NADA NO LLAMA AL MODELO. No hay nada que resumir, y gastar
  // una llamada en decirlo es gastar la cuota de otro.
  if (hechos.empty) {
    const note = buildFallbackNote(hechos);
    await guardar(service, user.id, hoy, note, { degraded: false, modelo: null, motivo: null });
    return NextResponse.json({ ...note, degraded: false, rating: null });
  }

  // ── 3. GEMINI ─────────────────────────────────────────────────────
  const r = await generarNota(hechos);
  if (r.ok) {
    await guardar(service, user.id, hoy, r.note, { degraded: false, modelo: r.modelo, motivo: null });
    return NextResponse.json({ ...r.note, degraded: false, rating: null });
  }

  registrarCaida(user.id, r.motivo, r.detalle);
  const note = buildFallbackNote(hechos);
  await guardar(service, user.id, hoy, note, { degraded: true, modelo: null, motivo: r.motivo });
  return NextResponse.json({ ...note, degraded: true, rating: null });
}

function aRespuesta(fila: {
  summary: string;
  recommendations: string[] | null;
  degraded: boolean;
  rating?: string | null;
}): Respuesta {
  return {
    summary: fila.summary,
    recommendations: fila.recommendations ?? [],
    degraded: fila.degraded,
    rating: (fila.rating as "useful" | "not_useful" | null) ?? null,
  };
}

/**
 * ¿Quedan intentos hoy?
 *
 * FALLA ABIERTO, igual que el limitador de `/s/[token]`: si la base no
 * contesta, se deja pasar. Lo que este contador defiende es la cuota diaria de
 * Gemini, y una base con un mal minuto no es un abuso -- negarle el resumen al
 * tendero por eso sería cobrarle a él un problema nuestro.
 */
async function quedaIntento(service: ReturnType<typeof createServiceClient>, ownerId: string) {
  try {
    const { data, error } = await service.rpc("claim_rate_limit_quota", {
      p_key: `asistente:${ownerId}`,
      p_limit: INTENTOS_POR_DIA,
      p_window_seconds: UN_DIA,
    });
    if (error) {
      console.error("[asistente] limitador:", error.message);
      return true;
    }
    return data !== false;
  } catch (e) {
    console.error("[asistente] limitador:", e instanceof Error ? e.message : e);
    return true;
  }
}

async function notaDeRespaldo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  service: ReturnType<typeof createServiceClient>,
  ownerId: string,
  hoy: string,
  motivo: "quota",
): Promise<Respuesta> {
  try {
    const ownerRate = await getOwnerRateContext(supabase, ownerId);
    const rates = ownerRate ? await getBolivarRates(ownerRate.effectiveRate) : null;
    const hechos = await buildFacts({
      supabase,
      ownerId,
      dosLibros: ownerRate !== null,
      effectiveRate: ownerRate?.effectiveRate ?? null,
      rates,
    });
    const note = buildFallbackNote(hechos);
    await guardar(service, ownerId, hoy, note, { degraded: true, modelo: null, motivo });
    return { ...note, degraded: true, rating: null };
  } catch (e) {
    console.error("[asistente] respaldo:", e instanceof Error ? e.message : e);
    return { summary: "", recommendations: [], degraded: true, rating: null };
  }
}

/**
 * Guarda con el cliente de SERVICIO y no con el del tendero.
 *
 * La política de RLS le da al dueño `select` y `update` --para leer su nota y
 * ponerle el pulgar-- y nada más. Quien escribe la nota es el servidor, que es
 * lo que impide que una sesión cualquiera invente el resumen de su propio
 * negocio.
 *
 * `upsert` y no `insert`: una fila degradada se reemplaza cuando un reintento
 * sale bien, que es justo lo que los tres intentos existen para permitir.
 */
async function guardar(
  service: ReturnType<typeof createServiceClient>,
  ownerId: string,
  hoy: string,
  note: AssistantNote,
  meta: { degraded: boolean; modelo: string | null; motivo: string | null },
) {
  const { error } = await service.from("report_assistant_notes").upsert(
    {
      owner_id: ownerId,
      day: hoy,
      summary: note.summary,
      recommendations: note.recommendations,
      degraded: meta.degraded,
      model: meta.modelo,
      failure_reason: meta.motivo,
      // CADA REGENERACIÓN VUELVE A PREGUNTAR. Decisión del dueño el
      // 2026-10-30: el pie aparece *«con cada regeneración del reporte»*.
      //
      // Y ESO NO ES LO MISMO QUE «UNA VEZ AL DÍA», que es donde yo lo tenía.
      // Dentro del mismo día una nota degradada se reintenta y puede ser
      // reemplazada por la de la IA: si el tendero ya había calificado el
      // texto de respaldo, vería el texto nuevo con un «Gracias» puesto --
      // habiendo calificado otra cosa. El pulgar vale para el texto que
      // juzgó, no para el día.
      //
      // Se escribe aquí y no en una condición porque `guardar` SOLO se llama
      // cuando de verdad se (re)genera: una nota buena de hoy sale antes, por
      // el `return` de arriba, sin pasar por aquí.
      rating: null,
    },
    { onConflict: "owner_id,day" },
  );
  // NO SE PROPAGA. Si no se puede guardar, el tendero ya tiene su texto; lo
  // único que se pierde es no tener que regenerarlo mañana.
  if (error) console.error("[asistente] no se pudo guardar la nota:", error.message);
}

/**
 * ¿CUÁNTAS VECES SE HA CAÍDO EL ASISTENTE DE REPORTES?
 *
 * Encargo del dueño el 2026-10-29, con esas palabras: *«crea un evento en
 * mixpanel con el BQ ¿Cuántas veces se ha caído el asistente de reportes?»*.
 *
 * QUÉ DECIDE: el dueño eligió el nivel GRATUITO de Gemini para esta primera
 * versión, sabiendo lo que cuesta. El nivel gratuito no tiene acuerdo de
 * servicio y Google ya cambió sus límites una vez, en abril de 2026. La
 * pregunta que este evento contesta es si esa elección sigue siendo buena:
 *
 *   · Si las caídas son casi cero, el nivel gratuito está haciendo su trabajo
 *     y no hay nada que decidir.
 *   · Si suben y el motivo es `quota`, el techo del nivel gratuito --unas mil
 *     peticiones al día-- ya se está tocando, y eso llega antes de lo que
 *     parece: una por negocio y día son mil negocios. La respuesta es pasar a
 *     pago, que con 24 negocios cuesta unos $0,18 al mes.
 *   · Si suben y el motivo es `validation`, no es Google: es el prompt, y lo
 *     que hay que tocar está en este repo.
 *   · Y si suben con `timeout`, el presupuesto de 12 segundos se quedó corto,
 *     que es una cifra de este archivo y no de nadie más.
 *
 * VA EN EL SERVIDOR, Y ES LA MITAD DEL VALOR. El tendero NUNCA ve esta caída:
 * le sale el texto de respaldo, sin un error en pantalla, que es exactamente
 * el diseño. Así que no hay gesto que medir desde el navegador --no hay nada
 * que él haga-- y medirlo desde allí sería medir lo que el cliente no sabe.
 * Es el caso contrario al de los pulgares, que sí son un gesto suyo.
 *
 * SE ARCHIVA BAJO EL PERFIL DEL DUEÑO, como todo en esta app, aunque la avería
 * sea nuestra: lo que se quiere poder contestar es «¿a cuántos negocios les
 * está pasando?», no solo «¿cuántas veces?».
 */
function registrarCaida(ownerId: string, motivo: string, detalle: string) {
  trackServer("AI Report Failed", ownerId, { motivo, detalle });
}
