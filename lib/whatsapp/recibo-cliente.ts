import { createServiceClient } from "@/lib/supabase/service";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { enviarPlantilla } from "@/lib/whatsapp/kapso";

// EL RECIBO DEL CLIENTE: `abono_confirmation_v3`.
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

// EL COMPOSITOR, UNO SOLO PARA LAS DOS PUERTAS.
//
// Un abono suelto y un reparto mandan EL MISMO mensaje con la misma plantilla,
// y lo único que cambia son dos cosas: por cuánto, y con qué clave se impide
// el duplicado. Escribirlo dos veces habría sido empezar a que divergieran —es
// la razón que `tarjeta-de-fiado.tsx` tiene escrita para existir— y aquí lo
// que divergiría es un mensaje que le dice a un cliente cuánto pagó.
//
// `grupo` null es el camino de siempre, intacto.
async function enviarRecibo(
  movementId: string,
  grupo: { groupId: string; total: number } | null,
): Promise<ResultadoRecibo> {
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
  //
  // Y EN UN REPARTO ES EL GRUPO, por lo mismo leído una línea más arriba: el
  // pago concreto del que habla este recibo es el billete entero, no una de
  // sus líneas. Con la clave del movimiento, las tres líneas de un reparto
  // serían tres claves distintas y la puerta dejaría salir los tres mensajes
  // sin tener nada que objetar — que es exactamente el fallo que todo esto
  // existe para evitar.
  const { data: reserva, error: errorReserva } = await supabase.rpc("whatsapp_send_begin", {
    p_owner_id: objetivo.owner_id,
    p_template: "abono_confirmation_v3",
    p_period_key: grupo ? grupo.groupId : objetivo.movement_id,
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
    plantilla: "abono_confirmation_v3",
    parametrosCuerpo: [
      { nombre: "client_name", texto: objetivo.client_name },
      // EL TOTAL DEL REPARTO, NO EL DE UNA LÍNEA. El cliente entregó un
      // billete; decirle que pagó los $10 de su último fiado cuando entregó
      // $60 es peor que no mandarle nada, porque le da un número que él sabe
      // que es falso.
      {
        nombre: "payment_amount",
        texto: formatear(grupo ? grupo.total : Number(objetivo.amount), objetivo.currency),
      },
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
    // Which number it really went out from (migration 105).
    p_phone_number_id: envio.phoneNumberId,
  });

  if (!envio.ok) {
    console.error(`[recibo] falló para el movimiento ${movementId}:`, envio.error);
    return { estado: "fallido", error: envio.error };
  }

  return { estado: "enviado", messageId: envio.messageId };
}

// UN ABONO SUELTO. El camino de siempre, con el mismo nombre y la misma firma:
// `addMovement` y `registrarAbonoDirigido` lo llaman igual que ayer.
export async function enviarReciboAlCliente(movementId: string): Promise<ResultadoRecibo> {
  if (!clientNoticesEnabled()) return { estado: "omitido", motivo: "desactivado" };
  return enviarRecibo(movementId, null);
}

// UN REPARTO: UN SOLO RECIBO, POR EL TOTAL.
//
// Es la mitad de `CT-128` que protege al cliente, y sin ella la migración `137`
// no sirve de nada: `abono_confirmation_v3` sale por fila, así que un billete
// repartido en tres le manda TRES WhatsApp por un solo pago y le enseña tres
// abonos donde hizo uno. A alguien que ya recibe mensajes sobre su deuda desde
// un número de EE. UU. (`MS-17`), eso lo acerca justo a lo que Sevenz intenta
// no parecer.
//
// PREGUNTA POR LA ÚLTIMA LÍNEA DEL GRUPO, y eso no es un detalle: `new_balance`
// es el `running_balance` de la fila por la que se pregunta. Con la primera, el
// mensaje le diría un saldo que todavía debe lo que las otras líneas acaban de
// pagar.
//
// Y NO DECIDE NADA SOBRE SI EL MENSAJE SALE. Eso sigue siendo entero de
// `movement_notice_target` —el permiso, el número, la papelera, `MS-7`— que es
// quien lo sabe y a quien el compositor le pregunta. Aquí solo se averigua a
// qué línea preguntar y por cuánto.
export async function enviarReciboDeGrupo(groupId: string): Promise<ResultadoRecibo> {
  if (!clientNoticesEnabled()) return { estado: "omitido", motivo: "desactivado" };

  const supabase = createServiceClient();
  const { data, error } = await supabase.rpc("payment_group_summary", { p_group_id: groupId });

  if (error) {
    console.error("[recibo] payment_group_summary:", error.message);
    return { estado: "fallido", error: "No se pudo leer el reparto." };
  }

  const resumen = data as {
    ok: boolean;
    reason?: string;
    total: number;
    last_movement_id: string;
  } | null;

  // `null` es un grupo sin líneas vivas: no es un fallo, no hay nada que
  // confirmar. El mismo criterio que los demás «omitido» de este archivo, que
  // se cuentan y no se registran como errores.
  if (!resumen) return { estado: "omitido", motivo: "grupo_vacio" };
  if (!resumen.ok) return { estado: "omitido", motivo: resumen.reason ?? "desconocido" };

  return enviarRecibo(resumen.last_movement_id, {
    groupId,
    total: Number(resumen.total),
  });
}
