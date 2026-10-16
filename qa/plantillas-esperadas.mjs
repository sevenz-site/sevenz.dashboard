// EL INVENTARIO DE PLANTILLAS, EN UN SOLO SITIO.
//
// What Meta approved for each template: the body parameters with their name
// and IN ORDER, and **which button it declares**. Meta rejects a message
// whole and in silence when its components do not match the template, so this
// is what keeps the code and the approved template from drifting apart with
// nobody seeing it.
//
// ===========================================================================
// WHY THE BUTTONS ARE HERE NOW, AND WHAT THEIR ABSENCE COST
//
// Until 2026-10-15 this table listed BODY parameters only. That absence was
// not a minor oversight: it was a blind spot shaped like a complete list. A
// shopping list that never mentions bread never makes you notice the bread is
// missing.
//
// What happened: `abono_confirmation_v2` was approved with its URL button
// STATIC -- the URL carried the literal text `{{share_token}}`, which Meta
// does not recognise as a variable -- while the code sent a parameter for it.
// Meta answered `132018` *"Button at index 0 of type Url does not require
// parameters"* and rejected the WHOLE message. 12 of 12 sends failed in
// production, zero receipts delivered, and the failure was never visible from
// the app: the shopkeeper registered the payment and the screen said fine.
//
// Three places should have caught it and none could:
//   1. This table, because buttons did not exist in it.
//   2. `qa/recibo-cliente.mjs`, which only checked whether the token was 16
//      characters or longer -- green while the send was broken.
//   3. The entry in `../docs/WHATSAPP-PLANTILLAS.md`, which describes what was
//      SUBMITTED for approval, not what Meta APPROVED. Two different things,
//      and nobody opened the second one.
//
// ===========================================================================
// HOW A BUTTON IS DESCRIBED HERE
//
//   boton: null              -> the template declares NO button. No component
//                              is sent. Sending one makes it fail.
//   boton: "sin_parametros"  -> the template DOES declare buttons, but none
//                              takes values at send time: a fixed URL, or a
//                              quick reply. No component is sent either.
//   boton: "url_suffix"      -> URL button with a dynamic `{{1}}` suffix. ONE
//                              component `{type:"button", sub_type:"url",
//                              index:"0"}` is sent, with a single parameter
//                              `{type:"text", text:<suffix>}` and
//                              **no `parameter_name`**.
//
// `null` AND `"sin_parametros"` BEHAVE IDENTICALLY WHEN SENDING AND ARE STILL
// TWO DIFFERENT VALUES, on purpose. This table is not only a check: it is the
// only place in the repo that records what Meta approved. Writing "none" for
// a template that does have a button would be exactly the kind of false
// record that caused the 2026-10-15 failure -- and the day someone wants to
// make one of those buttons dynamic, the difference between "there is no
// button" and "there is one and it is fixed" is precisely what they need.
//
// THE `parameter_name` PART IS HALF THE FAILURE AND DESERVES WRITING DOWN:
// the body uses `parameter_format: NAMED` and its parameters DO carry a name;
// a URL button's suffix is POSITIONAL and does not, even when the body is
// named. Confirmed in writing by Kapso on 2026-10-15.
//
// THE REAL SOURCE OF TRUTH IS `../docs/WHATSAPP-PLANTILLAS.md`. This is its
// executable copy: when the two disagree, the document wins and this is what
// gets corrected. And the document, in turn, is only worth anything if
// somebody opened the approved template and compared it -- see the rule in
// CLAUDE.md.
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
  // TWO OF THE THREE DO CARRY A BUTTON, and the first version of this table
  // -- written on that same 2026-10-15 -- said none did. It was corrected by
  // opening each template's entry instead of assuming, which is literally the
  // rule that had just been written. None takes values at send time: both URL
  // buttons point at a fixed `https://app.sevenz.site`.
  //
  // `cartera_summary_v2` IS NOW CONFIRMED, and this comment said the opposite
  // for a few hours on 2026-10-15. It claimed zero rows in production; a count
  // by template that same afternoon returned 7 rows, all `ok = true`. So a
  // template with a FIXED URL button sends correctly when the code sends no
  // button component -- measured, not argued. `cartera_attention`, which
  // declares no button at all, is confirmed too: 18 of 18.
  //
  // `cartera_pausada` IS STILL UNCONFIRMED: zero rows ever, because nobody has
  // been paused in the window. It is the one left where a dynamic button we do
  // not know about would fail the whole message in silence -- and it would
  // fail for the owner who most needs to read it. See `MS-42`.
  cartera_summary_v2: {
    cuerpo: ["customer_name", "amount_due", "overdue_clients"],
    // Fixed URL "Ver mi cartera" -> https://app.sevenz.site
    boton: "sin_parametros",
  },
  cartera_pausada: {
    cuerpo: ["owner_name", "amount_due", "overdue_clients"],
    // Two of them: fixed URL "Ver cartera" and quick reply "Reactivar cuenta".
    boton: "sin_parametros",
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
  // BOTH ARE NEW VERSIONS FROM 2026-10-15, and not for fun. Kapso confirmed
  // that an approved template is NOT editable: fixing the button meant
  // creating `abono_confirmation_v3` and `payment_due_date_v2`. The previous
  // ones stay approved and unused -- which is why they are NOT in this table:
  // if somebody sends them again, the suite failing to recognise them is
  // exactly the warning that is needed.
  //
  // `abono_confirmation_v3` IS CONFIRMED IN PRODUCTION, 2026-10-16 at 03:26
  // UTC: a real payment, `ok = true`, a message id back from Meta, no error,
  // and `phone_number_id` the clients' number. It is the first receipt a
  // Sevenz client has ever actually received -- the 46 before it were rejected
  // whole. `payment_due_date_v2` is NOT confirmed yet: it has never fired in
  // production, and the first chance is the 13:00 UTC cron.
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
 * Checks a button component against what the template declares.
 *
 * It lives here rather than inside each suite because all three ask the same
 * question, and three copies of this check would end up disagreeing -- which
 * is exactly the shape of the failure this function exists to close.
 *
 * Returns `null` when fine, or a sentence saying what is wrong. That sentence
 * is printed for the user to read, so it stays in Spanish.
 */
export function problemaDelBoton(plantilla, componenteBoton) {
  const esperado = PLANTILLAS_ESPERADAS[plantilla];
  if (!esperado) return `plantilla desconocida: ${plantilla}`;

  if (esperado.boton === null || esperado.boton === "sin_parametros") {
    if (!componenteBoton) return null;
    return esperado.boton === null
      ? "no declara botón y se está mandando uno"
      : "sus botones no toman valores al enviar y se está mandando un componente";
  }

  if (!componenteBoton) return "declara un botón de URL y no se manda ninguno";
  if (componenteBoton.sub_type !== "url") return `sub_type ${componenteBoton.sub_type}, se esperaba url`;
  if (componenteBoton.index !== "0") return `index ${componenteBoton.index}, se esperaba "0"`;

  const params = componenteBoton.parameters ?? [];
  if (params.length !== 1) return `${params.length} parámetros, se esperaba 1`;

  const p = params[0];
  if (p.type !== "text") return `parámetro de tipo ${p.type}, se esperaba text`;
  if (typeof p.text !== "string" || p.text.length < 16) return `sufijo sospechoso: ${p.text}`;

  // THE 2026-10-15 FAILURE, TURNED INTO A CHECK. A URL suffix is positional;
  // `parameter_name` belongs to the body only. With it, Meta returns 132018
  // and discards the whole message.
  if ("parameter_name" in p) return `lleva parameter_name "${p.parameter_name}" y un sufijo de URL es posicional`;

  return null;
}

// El número desde el que sale cada audiencia (MS-24). Mandar un aviso de dueño
// por el número de clientes no se vería en ninguna parte —el mensaje llegaría
// igual— y arriesgaría la reputación limpia que lleva lo que ya funciona.
export const PHONE_ID_OWNERS = "1373508439159674"; // +1 202 915 8501
export const PHONE_ID_CLIENTS = "1329482340254222"; // +1 201 908 5747
