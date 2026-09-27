import "server-only";
import { createServiceClient } from "@/lib/supabase/service";
import { enviarPlantilla, type ParametroPlantilla } from "@/lib/whatsapp/kapso";

// EL ÚNICO PUNTO DE SALIDA. Nada más debería importar `kapso.ts`.
//
// La secuencia no es negociable y el orden es el punto entero:
//
//   1. `whatsapp_send_begin` reserva el turno — inserta la fila ANTES de que
//      salga nada.
//   2. Solo si dio un id, se llama a Kapso.
//   3. `whatsapp_send_finish` anota cómo fue.
//
// Reservar primero es lo que hace que un cron disparado diez veces una noche
// mande un mensaje y no diez: el índice único de la tabla rechaza los
// intentos 2 al 10 antes de que toquen la red. Si se llamara a Kapso primero
// y se anotara después, el freno no frenaría nada — solo llevaría la cuenta
// del desastre.
//
// Los topes viven en la función de Postgres, no aquí (ver migración 067). Una
// comprobación en este archivo se esquiva escribiendo un segundo llamador; la
// de la base no.

export type ResultadoEnvio =
  | { estado: "enviado"; messageId: string | null }
  | { estado: "omitido"; motivo: string }
  | { estado: "fallido"; error: string };

export async function enviarAvisoAlDueno(opciones: {
  ownerId: string;
  // Dígitos con prefijo y sin `+`, tal como lo guarda `owners.whatsapp`.
  to: string;
  plantilla: string;
  // Lo que hace idempotente al envío: '2026-W39' para una plantilla semanal.
  periodKey: string;
  parametrosCuerpo: ParametroPlantilla[];
  parametroBoton?: ParametroPlantilla;
}): Promise<ResultadoEnvio> {
  const supabase = createServiceClient();

  const { data: reserva, error: errorReserva } = await supabase.rpc("whatsapp_send_begin", {
    p_owner_id: opciones.ownerId,
    p_template: opciones.plantilla,
    p_period_key: opciones.periodKey,
  });

  if (errorReserva) {
    // No se llamó a Kapso, así que no hay nada que anotar. Que la puerta
    // misma falle es grave y tiene que verse en el log del cron.
    console.error("whatsapp_send_begin:", errorReserva);
    return { estado: "fallido", error: "No se pudo reservar el turno de envío." };
  }

  const r = reserva as {
    id?: string;
    skip?: string;
    alarma?: boolean;
    enviados_mes?: number;
  };

  if (r.skip) {
    // 'ya_enviado' es el caso normal y bueno: el cron corrió otra vez y este
    // dueño ya tiene el suyo. 'tope_mensual' y 'tope_diario' son la parada
    // dura, y esas sí hay que verlas.
    if (r.skip !== "ya_enviado") {
      console.error(`WhatsApp detenido por ${r.skip}:`, JSON.stringify(reserva));
    }
    return { estado: "omitido", motivo: r.skip };
  }

  // Una alarma al 70% del cupo. Una parada silenciosa es peor que pasarse:
  // los mensajes dejan de salir y nadie se entera durante tres semanas.
  if (r.alarma) {
    console.error(
      `AVISO: WhatsApp lleva ${r.enviados_mes} mensajes este mes, cerca del tope de 1.600.`,
    );
  }

  const envio = await enviarPlantilla({
    to: opciones.to,
    plantilla: opciones.plantilla,
    parametrosCuerpo: opciones.parametrosCuerpo,
    parametroBoton: opciones.parametroBoton,
  });

  await supabase.rpc("whatsapp_send_finish", {
    p_id: r.id,
    p_ok: envio.ok,
    p_provider_message_id: envio.ok ? envio.messageId : null,
    p_error: envio.ok ? null : envio.error,
  });

  if (!envio.ok) {
    console.error(`WhatsApp falló para ${opciones.ownerId}:`, envio.error);
    // Marcada como fallida, la fila deja de bloquear el turno (índice parcial
    // de la 067), así que el siguiente paso del cron lo reintenta. Sin eso, un
    // fallo de treinta segundos un lunes a las 8 dejaría a todos sin resumen
    // esa semana.
    return { estado: "fallido", error: envio.error };
  }

  return { estado: "enviado", messageId: envio.messageId };
}

// La clave de periodo de una plantilla semanal: '2026-W39'.
//
// Semana ISO, que empieza en lunes — que es justo el día en que sale el
// resumen. Con la semana empezando en domingo, un envío del lunes y otro del
// domingo anterior caerían en la misma clave y el segundo se perdería.
export function claveSemanal(fecha = new Date()): string {
  // Copia en UTC para que el cálculo no dependa de la zona del servidor.
  const d = new Date(Date.UTC(fecha.getUTCFullYear(), fecha.getUTCMonth(), fecha.getUTCDate()));
  // ISO: el jueves de esa semana decide a qué año pertenece.
  const diaIso = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - diaIso);
  const inicioDeAno = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const semana = Math.ceil(((d.getTime() - inicioDeAno.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(semana).padStart(2, "0")}`;
}

// Día ISO (1 lunes … 7 domingo) en hora de Colombia.
//
// Vercel corre en UTC. A las 13:00 UTC son las 8:00 en Bogotá y las 9:00 en
// Caracas — el mismo día en las tres, así que hoy da igual. Se calcula en
// UTC-5 de todas formas porque el día que alguien mueva el horario a las 2:00
// UTC, el cálculo en UTC diría "martes" cuando en la bodega es lunes por la
// noche, y el mensaje saldría con un día de desfase sin que nadie entendiera
// por qué.
//
// Colombia no tiene horario de verano, así que el offset es constante. Si
// algún día Sevenz opera en un país que sí lo tenga, esto deja de valer y hay
// que usar una zona con nombre, no un número.
const OFFSET_COLOMBIA_MS = -5 * 60 * 60 * 1000;

export function diaIsoEnColombia(ahora = new Date()): number {
  const local = new Date(ahora.getTime() + OFFSET_COLOMBIA_MS);
  return local.getUTCDay() || 7;
}
