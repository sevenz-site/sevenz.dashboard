import { NextResponse } from "next/server";
import { enviarResumenSemanal } from "@/lib/whatsapp/cartera-summary";

export const runtime = "nodejs";

// El resumen semanal de cartera a los dueños que lo aceptaron. Lunes por la
// mañana.
//
// Misma convención que /api/cron/exchange-rate: `Authorization: Bearer
// $CRON_SECRET`, que es lo que manda Vercel Cron, así que esto se convierte en
// el trabajo programado de verdad sin tocar código en cuanto `vercel.json` lo
// registre. Mientras tanto se dispara con curl.
//
// ─────────────────────────────────────────────────────────────────────────
// SE PUEDE LLAMAR VARIAS VECES EL MISMO LUNES, Y CONVIENE
//
// Cada dueño tiene una clave de periodo ('2026-W39'), así que la segunda
// llamada devuelve `ya_enviado` para todos los que ya lo recibieron y no manda
// nada. Lo que sí hace es **reintentar a los que fallaron**: una fila marcada
// como fallida deja de bloquear el turno (índice parcial de la 067).
//
// Por eso la programación correcta no es un disparo a las 8, sino unos pocos
// esa mañana. Si Kapso está caído treinta segundos justo en el primero, nadie
// se queda sin su resumen.
//
// ─────────────────────────────────────────────────────────────────────────
// NO COMPRUEBA QUE SEA LUNES
//
// A propósito: el día lo decide el cron, no este código. Comprobarlo aquí
// haría imposible probarlo un miércoles, y la idempotencia por semana ya
// impide que una llamada de más mande nada dos veces.

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const resumen = await enviarResumenSemanal();
    // El detalle lleva ids de dueño y motivos, nunca teléfonos ni el texto
    // crudo de un error de Kapso — eso se queda en whatsapp_sends.error y en
    // el log del servidor. Esta ruta está autenticada con el secreto del cron,
    // así que el riesgo es bajo, pero un volcado de datos de dueños en una
    // respuesta HTTP no tiene por qué existir.
    return NextResponse.json({
      periodo: resumen.periodo,
      destinatarios: resumen.destinatarios,
      enviados: resumen.enviados,
      omitidos: resumen.omitidos,
      fallidos: resumen.fallidos,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido.";
    console.error("cron whatsapp-cartera-summary:", error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
