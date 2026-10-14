import { createServiceClient } from "@/lib/supabase/service";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { enviarPlantilla } from "@/lib/whatsapp/kapso";

// EL RECORDATORIO DE PLAZO: `payment_due_date`.
//
// Sale N días antes del vencimiento más cercano, y N depende del plazo:
//
//   días_antes = acotar( redondear(plazo × 0,25), mínimo 1, máximo 7 )
//
// La ventana la fijó el dueño el 2026-10-14 y su tabla completa vive en
// `WHATSAPP-PLANTILLAS.md`. La fórmula está en la base, dentro de
// `whatsapp_destinatarios_plazo()`, y no se repite aquí: dos copias de una
// regla de negocio acaban discrepando, y aquí la discrepancia serían
// recordatorios de más o silencio hacia quien lo esperaba.
//
// ES UN RECORDATORIO, Y ESO CAMBIA DOS COSAS frente al recibo:
//
//   1. `p_reminder: true` en la puerta, así que le aplica el tope de 20 por
//      negocio y por día (MS-27). Lo que sobra sale mañana, porque el cron
//      vuelve a mirar — nadie pierde su aviso.
//   2. El origen `photo_import` NO lo frena. MS-7 solo apaga lo que se dispara
//      al guardar; un fiado subido de una libreta sí recibe su recordatorio
//      cuando vence. Es la decisión de MS-27 y se confirmó el 2026-10-14.

const PLANTILLA = "payment_due_date";

export type ResumenRecordatorios = {
  candidatos: number;
  enviados: number;
  omitidos: Record<string, number>;
  fallidos: number;
};

type Destinatario = {
  movement_id: string;
  client_id: string;
  owner_id: string;
  client_name: string;
  phone: string;
  business_display: string;
  due_date: string;
  amount_due: number;
  currency: "USD" | "EUR" | null;
};

type Objetivo = {
  ok: boolean;
  reason?: string;
  client_name: string;
  phone: string;
  business_display: string;
  share_token: string | null;
};

function clientNoticesEnabled(): boolean {
  return process.env.WHATSAPP_CLIENT_NOTICES === "on";
}

function formatearMonto(monto: number, currency: "USD" | "EUR" | null): string {
  if (currency === null) return formatCurrency(monto);
  return formatDisplayCurrency(monto, currency);
}

// «15 de octubre», como pide la plantilla. Sin año: el recordatorio habla de
// algo que pasa esta semana o la que viene, y el año sobra en una frase corta.
//
// `timeZone` explícito porque la fecha llega como `YYYY-MM-DD` y `new Date()`
// la interpreta como medianoche UTC — sin esto, en un servidor al oeste de
// Greenwich saldría el día anterior.
const formateadorFecha = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

function formatearFecha(iso: string): string {
  return formateadorFecha.format(new Date(`${iso}T00:00:00Z`));
}

export async function enviarRecordatoriosDePlazo(): Promise<ResumenRecordatorios> {
  const resumen: ResumenRecordatorios = { candidatos: 0, enviados: 0, omitidos: {}, fallidos: 0 };
  const omitir = (motivo: string) => {
    resumen.omitidos[motivo] = (resumen.omitidos[motivo] ?? 0) + 1;
  };

  if (!clientNoticesEnabled()) {
    omitir("desactivado");
    return resumen;
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase.rpc("whatsapp_destinatarios_plazo");
  if (error) {
    console.error("[recordatorio] destinatarios:", error.message);
    throw new Error("No se pudo calcular a quién le toca el recordatorio.");
  }

  const destinatarios = (data ?? []) as Destinatario[];
  resumen.candidatos = destinatarios.length;

  for (const d of destinatarios) {
    // SE VUELVE A PREGUNTAR JUSTO ANTES DE MANDAR, y no es redundancia: entre
    // que se calculó la lista y le toca el turno a este, el cliente puede
    // haberse dado de baja, el tendero puede haberlo mandado a la papelera o
    // haberle corregido el número — que caduca el permiso. La lista dice a
    // quién le TOCA; esto dice si todavía SE PUEDE.
    //
    // `true` es lo que le dice a la función que esto es un recordatorio, para
    // que no lo frene por venir de una foto.
    const { data: objetivoRaw, error: errorObjetivo } = await supabase.rpc(
      "movement_notice_target",
      { p_movement_id: d.movement_id, p_reminder: true },
    );

    if (errorObjetivo) {
      console.error("[recordatorio] movement_notice_target:", errorObjetivo.message);
      resumen.fallidos++;
      continue;
    }

    const objetivo = objetivoRaw as Objetivo;
    if (!objetivo?.ok) {
      omitir(objetivo?.reason ?? "desconocido");
      continue;
    }

    // El botón exige un token y hay clientes que nunca recibieron enlace
    // (CT-1). Se crea aquí, igual que en el recibo.
    let token: string = objetivo.share_token ?? "";
    if (token === "") {
      const { data: link, error: errorLink } = await supabase
        .from("share_links")
        .insert({ client_id: d.client_id })
        .select("token")
        .single();
      if (errorLink || !link) {
        console.error("[recordatorio] no pude crear el enlace:", errorLink?.message);
        resumen.fallidos++;
        continue;
      }
      token = link.token;
    }

    // LA CLAVE DE IDEMPOTENCIA ES EL CARGO QUE VENCE. Un cliente recibe un
    // recordatorio por ese plazo y no más: si el cron corre dos veces el mismo
    // día, el segundo pase devuelve `ya_enviado`.
    const { data: reserva, error: errorReserva } = await supabase.rpc("whatsapp_send_begin", {
      p_owner_id: d.owner_id,
      p_template: PLANTILLA,
      p_period_key: `due:${d.movement_id}`,
      p_audience: "client",
      p_recipient: objetivo.phone,
      p_client_id: d.client_id,
      p_movement_id: d.movement_id,
      p_reminder: true,
    });

    if (errorReserva) {
      console.error("[recordatorio] whatsapp_send_begin:", errorReserva.message);
      resumen.fallidos++;
      continue;
    }

    const r = reserva as { id?: string; skip?: string };
    if (r.skip) {
      omitir(r.skip);
      continue;
    }

    const envio = await enviarPlantilla({
      audience: "client",
      to: objetivo.phone,
      plantilla: PLANTILLA,
      parametrosCuerpo: [
        { nombre: "client_name", texto: objetivo.client_name },
        { nombre: "business_display", texto: objetivo.business_display },
        { nombre: "due_date", texto: formatearFecha(d.due_date) },
        { nombre: "amount_due", texto: formatearMonto(Number(d.amount_due), d.currency) },
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
      console.error(`[recordatorio] falló para ${d.client_id}:`, envio.error);
      resumen.fallidos++;
      continue;
    }

    resumen.enviados++;
  }

  return resumen;
}
