// EL INVENTARIO DE PLANTILLAS, EN UN SOLO SITIO.
//
// Los parámetros de cuerpo que Meta aprobó para cada plantilla, con su nombre
// y EN ORDEN. Meta rechaza entero y en silencio un mensaje que lleve un
// parámetro que la plantilla no declara, así que esto es lo que impide que el
// código y la plantilla aprobada se separen sin que nadie lo vea.
//
// POR QUÉ UN ARCHIVO Y NO UNA TABLA DENTRO DE CADA SUITE. Vivía dentro de
// `qa/whatsapp-plantillas.mjs`, que solo ejercita las del dueño. Al añadir las
// dos de cliente —`abono_confirmation_v2` y `payment_due_date`, el 2026-10-14—
// la misma tabla habría quedado escrita en TRES sitios, uno por suite. Tres
// copias de una lista acaban discrepando, y la discrepancia aquí no se ve:
// el envío falla en Meta, entero, y al tendero no se le muestra nada.
//
// LA FUENTE DE VERDAD DE VERDAD ES `../docs/WHATSAPP-PLANTILLAS.md`, que
// describe cada plantilla tal como se envió a aprobación. Esto es su copia
// ejecutable: cuando las dos discrepen, manda el documento y esto es lo que
// hay que corregir.
//
// CUANDO SE APRUEBE UNA PLANTILLA NUEVA, su fila entra aquí. Una suite no
// puede vigilar una plantilla de la que nunca ha oído hablar.

export const PLANTILLAS_ESPERADAS = {
  // ── Dueño ───────────────────────────────────────────────────────────────
  //
  // `cartera_summary_v2` sustituyó a la v1 el 2026-10-14. El parámetro sigue
  // llamándose `customer_name` aunque lleve el nombre del DUEÑO: fue la
  // propuesta inicial de Kapso y quedó así al aprobarse la v1. Renombrarlo
  // convertiría un cambio de pie en un cambio de integración.
  cartera_summary_v2: ["customer_name", "amount_due", "overdue_clients"],
  cartera_pausada: ["owner_name", "amount_due", "overdue_clients"],
  cartera_attention: ["owner_name", "overdue_clients", "due_this_week", "viewed_no_payment"],

  // ── Cliente ─────────────────────────────────────────────────────────────
  //
  // Las dos que se lanzan. `fiado_notification_v2`, `pending_balance_weekly`,
  // `overdue_payment` y `payment_due_today` existen pero NO se lanzan en esta
  // etapa (MS-38), así que no están aquí: una fila para algo que nadie manda
  // es una fila que nadie comprueba.
  abono_confirmation_v2: ["client_name", "payment_amount", "business_display", "new_balance"],
  payment_due_date: ["client_name", "business_display", "due_date", "amount_due"],
};

// El número desde el que sale cada audiencia (MS-24). Mandar un aviso de dueño
// por el número de clientes no se vería en ninguna parte —el mensaje llegaría
// igual— y arriesgaría la reputación limpia que lleva lo que ya funciona.
export const PHONE_ID_OWNERS = "1373508439159674"; // +1 202 915 8501
export const PHONE_ID_CLIENTS = "1329482340254222"; // +1 201 908 5747
