import { createServiceClient } from "@/lib/supabase/service";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { enviarPlantilla } from "@/lib/whatsapp/kapso";

// EL RECIBO DEL CLIENTE: `abono_confirmation_v2`.
//
// Sale cuando el tendero registra un abono. Es el PRIMER mensaje que Sevenz le
// manda a un cliente final, y se eligió a propósito que fuera este y no un
// recordatorio de deuda: el número de clientes (+1 201, MS-24) estrena con
// cero historial, y lo que define su reputación temprana son los primeros
// envíos. Casi nadie bloquea un comprobante de que pagó; un cobro desde un
// número extranjero desconocido es la forma exacta de la estafa más corriente
// de Venezuela.
//
// TODO LO QUE DECIDE SI SALE VIVE EN LA BASE, NO AQUÍ. `movement_notice_target`
// es la fuente única de verdad —MS-7, el permiso, el número, la papelera— y la
// puerta lo comprueba otra vez. Esta función no toma ni una sola decisión sobre
// si el mensaje debe salir: solo compone y manda.

type ResultadoRecibo =
  | { estado: "enviado"; messageId: string | null }
  | { estado: "omitido"; motivo: string }
  | { estado: "fallido"; error: string };

type Objetivo = {
  ok: boolean;
  reason?: string;
  movement_id: string;
  client_id: string;
  owner_id: string;
  client_name: string;
  phone: string;
  type: "charge" | "payment";
  amount: number;
  currency: "USD" | "EUR" | null;
  new_balance: number;
  business_display: string;
  share_token: string | null;
};

// `currency` null es el libro de pesos: un negocio colombiano. Es la misma
// convención que usa toda la app y no se traduce aquí.
function formatear(monto: number, currency: "USD" | "EUR" | null): string {
  if (currency === null) return formatCurrency(monto);
  return formatDisplayCurrency(monto, currency);
}

// EL INTERRUPTOR, Y NO ES PARANOIA.
//
// Apagado salvo que `WHATSAPP_CLIENT_NOTICES` valga exactamente `on`. Dos
// razones, y la segunda vale mas que la primera:
//
// 1. En dev hay clientes con permiso y numeros de prueba. Sin interruptor, el
//    primer abono que alguien registre en dev intenta un envio real: Meta lo
//    intenta entregar, falla, y ese fallo cuenta contra la cuota y contra el
//    quality rating del numero nuevo -- que es justo lo que MS-24 separo para
//    proteger.
//
// 2. Es la palanca para APAGARLO en produccion sin desplegar. Si el rating del
//    numero de clientes empieza a caer, lo que hace falta es parar los envios
//    hoy, no mañana cuando termine un build. Esta variable es ese freno.
//
// Apagado por defecto a proposito: un despliegue no enciende nada. Encender es
// un acto explicito, con alguien mirando.
function clientNoticesEnabled(): boolean {
  return process.env.WHATSAPP_CLIENT_NOTICES === "on";
}

export async function enviarReciboAlCliente(movementId: string): Promise<ResultadoRecibo> {
  if (!clientNoticesEnabled()) return { estado: "omitido", motivo: "desactivado" };

  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc("movement_notice_target", {
    p_movement_id: movementId,
  });

  if (error) {
    console.error("[recibo] movement_notice_target:", error.message);
    return { estado: "fallido", error: "No se pudo comprobar el movimiento." };
  }

  const objetivo = data as Objetivo;
  if (!objetivo?.ok) {
    // Los motivos son estables y contables: photo_import, no_consent,
    // no_phone, deleted, client_trashed, not_found. Se registran para poder
    // responder «¿por qué no le llegó?» sin reconstruirlo a mano.
    return { estado: "omitido", motivo: objetivo?.reason ?? "desconocido" };
  }

  // SOLO LOS ABONOS. El aviso de un fiado es `fiado_notification_v2`, que está
  // pausada (MS-38). Sin este guardia, registrar un fiado mandaría un recibo
  // diciendo «registramos tu abono».
  if (objetivo.type !== "payment") {
    return { estado: "omitido", motivo: "no_es_abono" };
  }

  // EL BOTÓN DE LA PLANTILLA EXIGE UN TOKEN, y 43 de 214 clientes nunca
  // recibieron enlace (CT-1). `movement_notice_target` no puede crearlo
  // —es `stable`— así que se crea aquí, que es el único momento en que de
  // verdad hace falta.
  //
  // THROUGH A FUNCTION, NOT THE TABLE. This was an `insert into share_links`
  // with the service-role key until 2026-10-14, which works in the dev branch
  // and CANNOT work in production: it grants service_role nothing on that
  // table (045_dev_grant_parity). The receipt would have gone out for every
  // client who already had a link and failed silently for exactly the ones
  // who never had one. See migration 102; `npm run qa:service-role` is what
  // keeps it from coming back.
  let token: string = objetivo.share_token ?? "";
  if (token === "") {
    const { data: creado, error: errorLink } = await supabase.rpc(
      "whatsapp_share_token_for_client",
      { p_client_id: objetivo.client_id },
    );
    if (errorLink || !creado) {
      console.error("[recibo] no pude crear el enlace:", errorLink?.message);
      return { estado: "fallido", error: "No se pudo preparar el enlace del saldo." };
    }
    token = creado as string;
  }

  // LA CLAVE DE IDEMPOTENCIA ES EL MOVIMIENTO, no una semana. Un recibo habla
  // de un abono concreto: si el cron o un reintento vuelven a pasar por aquí,
  // la puerta devuelve `ya_enviado` y no sale un segundo comprobante del mismo
  // pago.
  const { data: reserva, error: errorReserva } = await supabase.rpc("whatsapp_send_begin", {
    p_owner_id: objetivo.owner_id,
    p_template: "abono_confirmation_v2",
    p_period_key: objetivo.movement_id,
    p_audience: "client",
    p_recipient: objetivo.phone,
    p_client_id: objetivo.client_id,
    p_movement_id: objetivo.movement_id,
    // Un recibo NO es un recordatorio: no le aplica el tope por negocio de
    // MS-27, porque sale cuando el cliente acaba de pagar.
    p_reminder: false,
  });

  if (errorReserva) {
    console.error("[recibo] whatsapp_send_begin:", errorReserva.message);
    return { estado: "fallido", error: "No se pudo reservar el turno de envío." };
  }

  const r = reserva as { id?: string; skip?: string };
  if (r.skip) return { estado: "omitido", motivo: r.skip };

  // UN SALDO NEGATIVO NO SE LE ENSEÑA A NADIE. El alta de abono prohíbe pagar
  // más de lo que se debe, así que en la práctica esto es ≥ 0; un negativo
  // solo puede venir de una fila escrita fuera de esa acción. «Tu saldo ahora
  // es -$20,00» no significa nada para quien lo lee, y «$0,00» sí.
  const saldo = Math.max(0, Number(objetivo.new_balance));

  const envio = await enviarPlantilla({
    audience: "client",
    to: objetivo.phone,
    plantilla: "abono_confirmation_v2",
    parametrosCuerpo: [
      { nombre: "client_name", texto: objetivo.client_name },
      { nombre: "payment_amount", texto: formatear(Number(objetivo.amount), objetivo.currency) },
      { nombre: "business_display", texto: objetivo.business_display },
      { nombre: "new_balance", texto: formatear(saldo, objetivo.currency) },
    ],
    parametroBoton: { nombre: "share_token", texto: token },
  });

  await supabase.rpc("whatsapp_send_finish", {
    p_id: r.id,
    p_ok: envio.ok,
    p_provider_message_id: envio.ok ? envio.messageId : null,
    p_error: envio.ok ? null : envio.error,
  });

  if (!envio.ok) {
    console.error(`[recibo] falló para el movimiento ${movementId}:`, envio.error);
    return { estado: "fallido", error: envio.error };
  }

  return { estado: "enviado", messageId: envio.messageId };
}
