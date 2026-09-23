import { NextResponse } from "next/server";
import { enviarAtencionSemanal } from "@/lib/whatsapp/cartera-attention";

export const runtime = "nodejs";

// "Lo que necesita atención en tu cartera", los jueves. Hermana de
// /api/cron/whatsapp-cartera-summary, con la misma convención de autenticación
// —`Authorization: Bearer $CRON_SECRET`, que es lo que manda Vercel Cron— y la
// misma idempotencia por semana: se puede llamar varias veces el jueves y cada
// dueño recibe uno solo, reintentando a los que fallaron.
//
// Dos rutas y no una con un parámetro, a propósito: así `vercel.json` registra
// dos horarios distintos sin lógica de fechas en el código, y un fallo del
// jueves no puede arrastrar al del lunes.

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  try {
    const resumen = await enviarAtencionSemanal();
    // Sin teléfonos ni texto crudo de errores del proveedor: eso se queda en
    // whatsapp_sends.error y en el log del servidor.
    return NextResponse.json(resumen);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido.";
    console.error("cron whatsapp-cartera-attention:", error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
