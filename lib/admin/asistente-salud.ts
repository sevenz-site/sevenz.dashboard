import { createServiceClient } from "@/lib/supabase/service";

// ═══════════════════════════════════════════════════════════════════════
// CUÁNTAS VECES SE HA CAÍDO EL ASISTENTE DE REPORTES
//
// Encargo del dueño el 2026-10-29: *«crea una nueva card en el admin que mida
// las caídas»*, junto al evento de Mixpanel que pidió en la misma frase.
//
// ───────────────────────────────────────────────────────────────────────
// NO ES UNA SONDA, Y POR ESO ES UNA TARJETA APARTE
//
// `lib/admin/health.ts` ya tiene «Gemini · lectura de libretas», que llama a
// Google AHORA y dice si contesta. Esta contesta otra pregunta: **cuántas
// veces se cayó mientras nadie miraba**.
//
// Son distintas porque el asistente está diseñado para que su caída sea
// invisible: al tendero le sale el texto de respaldo, sin un error en
// pantalla. Una sonda que pregunta «¿está en pie?» puede decir que sí todos
// los días y ocultar que a treinta negocios les falló a las ocho de la mañana.
//
// ───────────────────────────────────────────────────────────────────────
// SALE DE LA TABLA QUE EL ASISTENTE YA ESCRIBE
//
// Ninguna tabla nueva, ningún evento almacenado, ningún cron. La fila
// degradada que la ruta guarda para no reintentar en cada recarga es, por el
// mismo precio, el registro de la caída. Ese doble uso es lo que hace que esto
// cueste una consulta.
//
// SIETE DÍAS Y NO TREINTA: el asistente genera UNA vez por negocio y día, así
// que con 24 negocios la ventana de siete días tiene como mucho 168 filas. Es
// suficiente para ver una tendencia y corto para que un mal día de hace tres
// semanas no diluya uno de ayer.
//
// ───────────────────────────────────────────────────────────────────────
// EL MOTIVO ES LA MITAD DE LA RESPUESTA
//
// «Se cayó 40 veces» no dice qué hacer. Los cuatro motivos llevan a sitios
// distintos, y están en `failure_reason`:
//
//   · `quota`   → se tocó el techo del nivel gratuito. Toca pagar.
//   · `http`    → es Google. No hay nada que tocar aquí.
//   · `timeout` → el presupuesto de 12 s se quedó corto. Es una cifra nuestra.
//   · `validation` → el modelo escribió una cifra que no estaba en los hechos.
//     Es el prompt, y está en este repo.
//   · `no_key`  → la variable de entorno no está puesta. Es configuración.
// ═══════════════════════════════════════════════════════════════════════

export type SaludDelAsistente = {
  /** Resúmenes generados en los últimos 7 días, caídos o no. */
  total: number;
  caidas: number;
  porMotivo: { motivo: string; veces: number }[];
  /** `true` cuando más de un tercio de los resúmenes de la semana se cayeron. */
  alarma: boolean;
  detalle: string;
};

const DIAS = 7;

/** A partir de aquí la cifra deja de ser ruido y pasa a ser una avería. */
const UMBRAL_DE_ALARMA = 1 / 3;

const ETIQUETA: Record<string, string> = {
  quota: "cuota agotada",
  http: "Gemini falló",
  timeout: "se agotó el tiempo",
  validation: "cifra inventada",
  no_key: "sin clave",
};

export async function getSaludDelAsistente(): Promise<SaludDelAsistente> {
  const supabase = createServiceClient();
  const desde = new Date();
  desde.setDate(desde.getDate() - (DIAS - 1));

  const { data, error } = await supabase
    .from("report_assistant_notes")
    .select("degraded, failure_reason")
    .gte("day", desde.toISOString().slice(0, 10));

  if (error) {
    // NO SE DISTINGUE «la tabla no está» de «la consulta falló», y da igual:
    // las dos significan que este panel no sabe nada. Decir «0 caídas» sería
    // peor que decirlo, porque 0 es exactamente la respuesta buena.
    console.error("[admin] salud del asistente:", error.message);
    return { total: 0, caidas: 0, porMotivo: [], alarma: false, detalle: "Sin datos" };
  }

  const filas = data ?? [];
  const caidas = filas.filter((f) => f.degraded);
  const cuenta = new Map<string, number>();
  for (const f of caidas) {
    const m = (f.failure_reason as string | null) ?? "sin motivo";
    cuenta.set(m, (cuenta.get(m) ?? 0) + 1);
  }
  const porMotivo = [...cuenta.entries()]
    .map(([motivo, veces]) => ({ motivo: ETIQUETA[motivo] ?? motivo, veces }))
    .sort((a, b) => b.veces - a.veces);

  const detalle = filas.length
    ? caidas.length
      ? `${caidas.length} de ${filas.length} resúmenes en ${DIAS} días · ${porMotivo
          .map((p) => `${p.veces} ${p.motivo}`)
          .join(", ")}`
      : `${filas.length} resúmenes en ${DIAS} días, ninguno caído`
    : `Nadie ha abierto Reportes en ${DIAS} días`;

  return {
    total: filas.length,
    caidas: caidas.length,
    porMotivo,
    // CON MENOS DE CINCO RESÚMENES NO SE ENCIENDE NADA. Un negocio que entró
    // una vez y le falló daría el 100 %, y una alarma que salta con una
    // muestra de uno enseña a ignorarla.
    alarma: filas.length >= 5 && caidas.length / filas.length > UMBRAL_DE_ALARMA,
    detalle,
  };
}
