import { createServiceClient } from "@/lib/supabase/service";

// EL LATIDO DEL CRON DE WHATSAPP.
//
// Una fila por ejecución, siempre, aunque no se haya enviado nada.
//
// POR QUÉ NO BASTA `whatsapp_sends`: esa tabla gana una fila cuando se RESERVA
// un envío, así que una tanda sin destinatarios no escribe nada — y un cron que
// dejó de dispararse tampoco. Desde la base las dos son cero filas, y la
// segunda es la que pasa de verdad, porque los crons de Vercel Hobby son de
// mejor esfuerzo. La cuenta que distingue el silencio legítimo del silencio
// roto no es "cuántos se enviaron" sino "cuánto hace de la última corrida".
//
// Va por RPC y no con un insert directo a propósito: producción revoca el
// SELECT a `service_role` sobre las tablas de clientes y dev no, y esa
// asimetría ya tiró /admin una vez (migración 039). Una SECURITY DEFINER no
// necesita grant sobre la tabla. `npm run qa:service-role` vigila que nadie
// vuelva por el camino corto.

// Lo que la ruta del cron ya calcula para su propia respuesta. Se guarda tal
// cual: si mañana entra una plantilla más —`cartera_pausada` está esperando a
// Meta— aparece en el jsonb sin migración de por medio.
export type ResultadoDeLaTanda = Record<string, unknown>;

// NUNCA LANZA, y eso es deliberado.
//
// Es instrumentación: si no se puede escribir el latido, lo que NO puede pasar
// es que eso tumbe una tanda de mensajes que sí salieron. Mismo criterio que
// `recordMovementRejection()`. El precio, dicho por delante: un fallo al
// registrar el latido es invisible salvo en el log del servidor, así que la
// tarjeta de /admin podría enseñar "hace 30 horas" cuando el cron sí corrió.
// Se acepta porque la alternativa —tirar la tanda por no poder anotarla— es
// peor, y porque un latido que falla dos días seguidos se nota igual.
export async function registrarLatido(
  diaIso: number,
  resultado: ResultadoDeLaTanda | null,
  error?: string,
): Promise<void> {
  try {
    const supabase = createServiceClient();
    const { error: rpcError } = await supabase.rpc("whatsapp_cron_run_registrar", {
      p_dia_iso: diaIso,
      p_resultado: resultado ?? {},
      p_error: error ?? null,
    });
    if (rpcError) console.error("latido whatsapp:", rpcError);
  } catch (e) {
    console.error("latido whatsapp:", e);
  }
}
