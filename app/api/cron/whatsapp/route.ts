import { NextResponse } from "next/server";
import { enviarResumenSemanal } from "@/lib/whatsapp/cartera-summary";
import { enviarAtencionSemanal } from "@/lib/whatsapp/cartera-attention";
import { diaIsoEnColombia } from "@/lib/whatsapp/send";

export const runtime = "nodejs";

// LA ÚNICA ENTRADA PROGRAMADA. Corre TODOS LOS DÍAS y decide qué toca.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ UNA SOLA Y NO SEIS
//
// El plan Hobby de Vercel permite **2 cron jobs** y cada uno dispara **una vez
// al día**. Uno ya está ocupado por la tasa de cambio, así que queda uno.
//
// El diseño original eran tres disparos el lunes y tres el jueves, para que un
// fallo de Kapso de treinta segundos no dejara a dieciocho dueños sin su
// mensaje. No cabe. Esto lo sustituye, y sale ganando en un aspecto:
//
//   **el reintento pasa del mismo día al día siguiente, y eso cubre una caída
//   de un día entero en vez de una de media hora.**
//
// Funciona sin guardar estado porque la clave de periodo es semanal y una fila
// marcada como fallida libera el turno (índice parcial de la 067):
//
//   - `cartera_summary` se intenta todos los días. Sale el lunes; si el lunes
//     falló, sale el martes; el resto de la semana devuelve `ya_enviado`.
//   - `cartera_attention` se intenta de jueves en adelante, por lo mismo.
//
// Cuando el proyecto pase a Vercel Pro —lo pide `PL-3` por motivos más serios
// que éste, porque Hobby es para uso no comercial— esto se puede sustituir por
// los seis disparos usando /api/cron/whatsapp-cartera-summary y
// /api/cron/whatsapp-cartera-attention, que siguen existiendo.
//
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const dia = diaIsoEnColombia();

  try {
    // El resumen se intenta siempre: la clave semanal decide si sale o no.
    const resumen = await enviarResumenSemanal();

    // Lo que necesita atención, de jueves en adelante. Antes del jueves no se
    // intenta para que no salga el lunes junto al resumen — las dos llevan
    // "clientes con plazo vencido" y el dueño leería la misma cifra dos veces
    // el mismo día.
    const atencion = dia >= 4 ? await enviarAtencionSemanal() : null;

    // Sin `detalle`: lleva ids de dueños y no tiene por qué existir en una
    // respuesta HTTP. Lo que hace falta para saber si la tanda fue bien son
    // los contadores; lo demás está en whatsapp_sends y en el log.
    return NextResponse.json({
      dia,
      resumen: {
        periodo: resumen.periodo,
        destinatarios: resumen.destinatarios,
        enviados: resumen.enviados,
        omitidos: resumen.omitidos,
        fallidos: resumen.fallidos,
      },
      atencion,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido.";
    console.error("cron whatsapp:", error);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
