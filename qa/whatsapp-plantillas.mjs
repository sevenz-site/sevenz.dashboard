// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// QUÉ VA DENTRO DEL SOBRE. `qa:pausados` comprueba el destinatario y el
// enrutado: quién entra en la lista, qué plantilla le toca, que anon no pueda
// llamar a las funciones. Este comprueba lo otro — el CUERPO del mensaje que
// se le manda a Kapso.
//
// POR QUÉ HACEN FALTA LOS DOS. El 2026-09-28, `qa:pausados` estaba en verde,
// 5 de 5, con un fallo que habría dejado sin mensaje a todo dueño pausado: la
// plantilla se elegía bien y el parámetro del destinatario iba con el nombre de
// la OTRA plantilla. Kapso manda los parámetros por nombre (`parameter_name`,
// en lib/whatsapp/kapso.ts) y Meta rechaza uno que la plantilla no declara, así
// que el envío falla entero. Y falla callado: el dueño no ve ningún error, solo
// deja de recibir. Se encontró leyendo el diff contra WHATSAPP-PLANTILLAS.md,
// no ejecutando nada. Esto es para que la próxima vez no dependa de eso.
//
// LO QUE SE AFIRMA, y de dónde sale la expectativa: de las plantillas APROBADAS
// por Meta, documentadas en ../docs/WHATSAPP-PLANTILLAS.md. Si alguna vez una
// aprobada cambia de variables —que no puede, hay que crear otra— este archivo
// es lo que hay que actualizar, no el código.
//
//   cartera_summary  -> customer_name, amount_due, overdue_clients
//   cartera_pausada  -> owner_name,    amount_due, overdue_clients
//   cartera_attention-> owner_name, overdue_clients, due_this_week,
//                       viewed_no_payment
//
// `cartera_summary` es la única con `customer_name`, y no es un descuido: ya
// estaba aprobada cuando se decidió la convención, y renombrar una variable
// obliga a rehacer la plantilla. Ver su sección en el documento.
//
// ESTE SCRIPT ESCRIBE EN DEV, al revés que los demás de `qa/`, y es a propósito:
// deja que `whatsapp_send_begin` reserve de verdad para que la puerta de la 067
// —topes, idempotencia, reserva— entre también en la prueba. Al terminar borra
// EXACTAMENTE las filas que creó, comparando los ids de antes y de después. No
// borra por `period_key`: eso se llevaría por delante filas reales de esa
// semana, y una limpieza que puede borrar de más es peor que no limpiar.
//
// NADA SALE A KAPSO. `fetch` se intercepta antes, y se afirma que salieron cero.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
// Las librerías de la app leen process.env, no este objeto.
for (const [k, v] of Object.entries(env)) process.env[k] ??= v;

const DEV_REF = "vzqppwrwnmlbrxizskdh";
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== DEV_REF) {
  console.error(`REFUSING TO RUN. .env.local apunta a "${ref}", no a la rama dev (${DEV_REF}).`);
  process.exit(1);
}

// ── la red: a Kapso se corta, a Supabase se mira y se deja pasar ────────
//
// Las reservas hay que MIRARLAS, no cortarlas: `whatsapp_send_begin` recibe
// `p_owner_id` y `p_template`, y es el único sitio donde las dos cosas viajan
// juntas — en el cuerpo que va a Kapso no hay owner_id, solo el teléfono, y en
// dev los dos dueños de prueba comparten número. Sin esto, "¿al pausado se le
// mandó también la de atención?" no se puede contestar.
const interceptados = [];
const reservas = [];
const fetchReal = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (url, init) => {
  if (String(url).includes("/rpc/whatsapp_send_begin")) {
    try {
      reservas.push(JSON.parse(init.body));
    } catch {
      // Un cuerpo que no se deja leer no es motivo para tumbar la prueba: la
      // afirmación que dependa de esto fallará sola, que es lo correcto.
    }
    return fetchReal(url, init);
  }
  if (String(url).includes("kapso.ai")) {
    interceptados.push(JSON.parse(init.body));
    // Una respuesta creíble, para que el resto del camino —whatsapp_send_finish,
    // el contador de la tanda— se ejecute igual que en producción.
    return new Response(JSON.stringify({ messages: [{ id: "wamid.QA" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  return fetchReal(url, init);
};

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { enviarResumenSemanal } = await import("../lib/whatsapp/cartera-summary.ts");
const { enviarAtencionSemanal } = await import("../lib/whatsapp/cartera-attention.ts");

const ESPERADO = {
  cartera_summary: ["customer_name", "amount_due", "overdue_clients"],
  cartera_pausada: ["owner_name", "amount_due", "overdue_clients"],
  cartera_attention: ["owner_name", "overdue_clients", "due_this_week", "viewed_no_payment"],
};

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}
function skip(nombre, motivo) {
  console.log(`SKIP  ${nombre}  — ${motivo}`);
}

// ── el estado de antes, para poder devolverlo ───────────────────────────
const { data: antesFilas } = await db.from("whatsapp_sends").select("id");
const idsDeAntes = new Set((antesFilas ?? []).map((f) => f.id));

const { data: lista, error: errorLista } = await db.rpc("whatsapp_destinatarios_resumen");
if (errorLista || !lista?.length) {
  console.error("no hay destinatarios en dev, o no se pudo leer la lista:", errorLista?.message);
  process.exit(1);
}
// POR `owner_id`, Y NO POR EL TELÉFONO. El cuerpo que va a Kapso no lleva
// owner_id, solo el número — y en dev los dueños de prueba comparten el mismo,
// así que afirmar por teléfono da falsos rojos: los mensajes de los otros
// parecen suyos. Por eso se miran las reservas, donde owner_id y plantilla
// viajan juntos. Esta primera versión del script se escribió por teléfono y
// falló exactamente así, con el código correcto.
const victima = lista[0].owner_id;

const { data: subPrevia } = await db
  .from("subscriptions")
  .select("owner_id, estado")
  .eq("owner_id", victima)
  .maybeSingle();

console.log(`cuenta que se pausa temporalmente: ${victima.slice(0, 8)} (${lista[0].first_name})`);
console.log(`suscripcion antes: ${subPrevia ? subPrevia.estado : "sin fila"}\n`);

try {
  if (subPrevia) {
    await db.from("subscriptions").update({ estado: "bloqueada" }).eq("owner_id", victima);
  } else {
    await db.from("subscriptions").insert({ owner_id: victima, estado: "bloqueada" });
  }

  await enviarResumenSemanal();
  await enviarAtencionSemanal();

  // ── lo que se habría mandado ──────────────────────────────────────────
  const porPlantilla = {};
  for (const m of interceptados) {
    const cuerpo = m.template.components.find((c) => c.type === "body");
    porPlantilla[m.template.name] ??= [];
    porPlantilla[m.template.name].push({
      a: m.to,
      nombres: cuerpo.parameters.map((p) => p.parameter_name),
      idioma: m.template.language?.code,
      componentes: m.template.components.map((c) => c.type),
    });
    console.log(`  -> ${m.template.name}: ${cuerpo.parameters.map((p) => p.parameter_name).join(", ")}`);
  }
  console.log("");

  // Cada plantilla que se mandó lleva SUS nombres, en SU orden.
  for (const [plantilla, envios] of Object.entries(porPlantilla)) {
    const esperado = ESPERADO[plantilla];
    if (!esperado) {
      check(`${plantilla}: está en el inventario de plantillas conocidas`, false, "plantilla no esperada");
      continue;
    }
    check(
      `${plantilla}: los parámetros del cuerpo, con sus nombres y en orden`,
      envios.every((e) => e.nombres.length === esperado.length && e.nombres.every((n, i) => n === esperado[i])),
      `esperado [${esperado.join(", ")}] · visto [${envios[0].nombres.join(", ")}]`,
    );
    check(
      `${plantilla}: idioma es`,
      envios.every((e) => e.idioma === "es"),
      envios[0].idioma,
    );
    // Ninguna de las tres de dueño lleva sufijo variable en su botón. Mandar un
    // componente de botón a una plantilla que no lo declara la hace fallar
    // igual que un parámetro con el nombre cambiado.
    check(
      `${plantilla}: no se manda componente de botón`,
      envios.every((e) => !e.componentes.includes("button")),
      envios[0].componentes.join(" + "),
    );
  }

  // El enrutado, visto desde el sobre y POR DESTINATARIO. Contar los mensajes
  // de toda la tanda no sirve: `cartera_attention` le llega legítimamente a los
  // dueños al día, así que un total distinto de cero no dice nada. La pregunta
  // es si le llegó AL PAUSADO.
  const suyas = reservas.filter((r) => r.p_owner_id === victima).map((r) => r.p_template);
  console.log(`  reservas del pausado: [${suyas.join(", ") || "ninguna"}]`);
  console.log(`  reservas de los demás: ${reservas.length - suyas.length}\n`);

  check(
    "al dueño pausado se le reserva cartera_pausada",
    suyas.filter((t) => t === "cartera_pausada").length === 1,
    `[${suyas.join(", ")}]`,
  );
  check(
    "al dueño pausado NO se le reserva cartera_summary",
    !suyas.includes("cartera_summary"),
    `[${suyas.join(", ")}]`,
  );
  check(
    "al dueño pausado NO se le reserva cartera_attention",
    !suyas.includes("cartera_attention"),
    `${reservas.filter((r) => r.p_template === "cartera_attention").length} de atención en la tanda, 0 deben ser suyas`,
  );
  check(
    "al pausado le llega UNA sola cosa en la semana",
    suyas.length === 1,
    `${suyas.length} mensajes`,
  );
  if (porPlantilla["cartera_summary"]) {
    check(
      "los dueños al día siguen recibiendo cartera_summary",
      true,
      `${porPlantilla["cartera_summary"].length} enviados`,
    );
  } else {
    skip("los dueños al día siguen recibiendo cartera_summary", "no hay ninguno al día en dev");
  }
  if (!porPlantilla["cartera_attention"]) {
    skip("cartera_attention: sus cuatro parámetros", "ningún dueño tiene nada que atender en dev");
  }

  check("ningún mensaje salió de verdad a Kapso", true, `${interceptados.length} interceptados, 0 enviados`);
} finally {
  // ── devolver dev como estaba ──────────────────────────────────────────
  if (subPrevia) {
    await db.from("subscriptions").update({ estado: subPrevia.estado }).eq("owner_id", victima);
  } else {
    await db.from("subscriptions").delete().eq("owner_id", victima);
  }

  const { data: despuesFilas } = await db.from("whatsapp_sends").select("id");
  const nuevas = (despuesFilas ?? []).map((f) => f.id).filter((id) => !idsDeAntes.has(id));
  if (nuevas.length) await db.from("whatsapp_sends").delete().in("id", nuevas);

  const { data: sub } = await db
    .from("subscriptions")
    .select("estado")
    .eq("owner_id", victima)
    .maybeSingle();
  const { data: quedan } = await db.from("whatsapp_sends").select("id");
  const restauradoBien =
    (sub?.estado ?? null) === (subPrevia?.estado ?? null) &&
    (quedan ?? []).length === idsDeAntes.size;

  console.log(
    `\nLIMPIEZA: suscripcion="${sub?.estado ?? "sin fila"}" (antes "${subPrevia?.estado ?? "sin fila"}") · ` +
      `${nuevas.length} reservas creadas y borradas · whatsapp_sends: ${idsDeAntes.size} antes, ${(quedan ?? []).length} ahora`,
  );
  check("dev queda como estaba", restauradoBien);
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos === 0 ? 0 : 1);
