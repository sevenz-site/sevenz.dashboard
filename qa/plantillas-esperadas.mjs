// EL INVENTARIO DE PLANTILLAS, EN UN SOLO SITIO.
//
// Lo que Meta aprobó para cada plantilla: los parámetros de cuerpo con su
// nombre y EN ORDEN, y **qué botón declara**. Meta rechaza entero y en
// silencio un mensaje cuyos componentes no encajen con la plantilla, así que
// esto es lo que impide que el código y la plantilla aprobada se separen sin
// que nadie lo vea.
//
// ===========================================================================
// POR QUÉ AHORA TAMBIÉN LOS BOTONES, Y LO QUE COSTÓ QUE NO ESTUVIERAN
//
// Hasta el 2026-10-15 esta tabla solo listaba los parámetros del CUERPO. Esa
// ausencia no era un descuido menor: era un punto ciego con forma de lista
// completa. Una lista de la compra que no menciona el pan nunca te hace notar
// que falta el pan.
//
// Lo que pasó: `abono_confirmation_v2` se aprobó con el botón de URL como
// ESTÁTICO —la URL llevaba el texto literal `{{share_token}}`, que Meta no
// reconoce como variable— mientras el código mandaba un parámetro para él.
// Meta devolvía `132018` *«Button at index 0 of type Url does not require
// parameters»* y rechazaba el mensaje ENTERO. 12 de 12 envíos fallidos en
// producción, cero recibos entregados, y el fallo nunca se vio desde la app:
// el tendero registraba su abono y la pantalla le decía que todo bien.
//
// Tres sitios debieron cazarlo y ninguno pudo:
//   1. Esta tabla, porque los botones no existían en ella.
//   2. `qa/recibo-cliente.mjs`, que solo miraba si el token tenía 16
//      caracteres o más — pasaba en verde con el envío roto.
//   3. La ficha de `../docs/WHATSAPP-PLANTILLAS.md`, que describe lo que se
//      ENVIÓ a aprobación, no lo que Meta APROBÓ. Son dos cosas distintas y
//      nadie abrió la segunda.
//
// ===========================================================================
// CÓMO SE DESCRIBE UN BOTÓN AQUÍ
//
//   boton: null            → la plantilla NO declara botón. No se manda
//                            componente de botón. Mandarlo la hace fallar.
//   boton: "url_suffix"    → botón de URL con sufijo dinámico `{{1}}`. Se
//                            manda UN componente `{type:"button",
//                            sub_type:"url", index:"0"}` con un solo
//                            parámetro `{type:"text", text:<sufijo>}` y
//                            **sin `parameter_name`**.
//
// LO DE `parameter_name` ES LA MITAD DEL FALLO Y MERECE ESTAR ESCRITO: el
// cuerpo usa `parameter_format: NAMED` y sus parámetros SÍ llevan nombre; el
// sufijo de un botón de URL es POSICIONAL y no lo lleva, aunque el cuerpo sea
// nombrado. Confirmado por Kapso por escrito el 2026-10-15.
//
// LA FUENTE DE VERDAD DE VERDAD ES `../docs/WHATSAPP-PLANTILLAS.md`. Esto es
// su copia ejecutable: cuando las dos discrepen, manda el documento y esto es
// lo que hay que corregir. Y el documento, a su vez, solo vale si alguien
// abrió la plantilla aprobada y la comparó — ver la regla de CLAUDE.md.
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
  //
  // Ninguna de las tres lleva botón, y por eso las tres funcionan en
  // producción mientras las de cliente fallaban: no tenían dónde equivocarse.
  cartera_summary_v2: {
    cuerpo: ["customer_name", "amount_due", "overdue_clients"],
    boton: null,
  },
  cartera_pausada: {
    cuerpo: ["owner_name", "amount_due", "overdue_clients"],
    boton: null,
  },
  cartera_attention: {
    cuerpo: ["owner_name", "overdue_clients", "due_this_week", "viewed_no_payment"],
    boton: null,
  },

  // ── Cliente ─────────────────────────────────────────────────────────────
  //
  // Las dos que se lanzan. `fiado_notification_v2`, `pending_balance_weekly`,
  // `overdue_payment` y `payment_due_today` existen pero NO se lanzan en esta
  // etapa (MS-38), así que no están aquí: una fila para algo que nadie manda
  // es una fila que nadie comprueba.
  //
  // LAS DOS SON VERSIONES NUEVAS DEL 2026-10-15, y no por gusto. Kapso
  // confirmó que una plantilla aprobada NO se edita: para corregir el botón
  // hubo que crear `abono_confirmation_v3` y `payment_due_date_v2`. Las
  // anteriores siguen aprobadas y sin usar — por eso NO están en esta tabla:
  // si alguien las vuelve a mandar, que la suite no las reconozca es
  // exactamente el aviso que hace falta.
  abono_confirmation_v3: {
    cuerpo: ["client_name", "payment_amount", "business_display", "new_balance"],
    boton: "url_suffix",
  },
  payment_due_date_v2: {
    cuerpo: ["client_name", "business_display", "due_date", "amount_due"],
    boton: "url_suffix",
  },
};

/**
 * Comprueba un componente de botón contra lo que la plantilla declara.
 *
 * Vive aquí y no dentro de cada suite porque las tres preguntan lo mismo, y
 * tres copias de esta comprobación acabarían discrepando — que es justo la
 * forma del fallo que esta función existe para cerrar.
 *
 * Devuelve `null` si está bien, o una frase que dice qué falla.
 */
export function problemaDelBoton(plantilla, componenteBoton) {
  const esperado = PLANTILLAS_ESPERADAS[plantilla];
  if (!esperado) return `plantilla desconocida: ${plantilla}`;

  if (esperado.boton === null) {
    return componenteBoton ? "no declara botón y se está mandando uno" : null;
  }

  if (!componenteBoton) return "declara un botón de URL y no se manda ninguno";
  if (componenteBoton.sub_type !== "url") return `sub_type ${componenteBoton.sub_type}, se esperaba url`;
  if (componenteBoton.index !== "0") return `index ${componenteBoton.index}, se esperaba "0"`;

  const params = componenteBoton.parameters ?? [];
  if (params.length !== 1) return `${params.length} parámetros, se esperaba 1`;

  const p = params[0];
  if (p.type !== "text") return `parámetro de tipo ${p.type}, se esperaba text`;
  if (typeof p.text !== "string" || p.text.length < 16) return `sufijo sospechoso: ${p.text}`;

  // EL FALLO DEL 2026-10-15, convertido en comprobación. Un sufijo de URL es
  // posicional; `parameter_name` es solo del cuerpo. Con él, Meta devuelve
  // 132018 y descarta el mensaje entero.
  if ("parameter_name" in p) return `lleva parameter_name "${p.parameter_name}" y un sufijo de URL es posicional`;

  return null;
}

// El número desde el que sale cada audiencia (MS-24). Mandar un aviso de dueño
// por el número de clientes no se vería en ninguna parte —el mensaje llegaría
// igual— y arriesgaría la reputación limpia que lleva lo que ya funciona.
export const PHONE_ID_OWNERS = "1373508439159674"; // +1 202 915 8501
export const PHONE_ID_CLIENTS = "1329482340254222"; // +1 201 908 5747
