// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// La puerta de envío: migraciones 096 (contar destinatarios y reservar cupo
// para los dueños, MS-21 y MS-37) y 097 (un movimiento que viene de una foto
// no avisa nunca, MS-7).
//
// SÍ ESCRIBE en dev, a propósito: lo único que importa aquí son los efectos, y
// una puerta no se puede comprobar leyéndola. Todo lo que crea lleva el prefijo
// `qa096_` o uno de los dos teléfonos de prueba, y se borra en el `finally`
// pase lo que pase.
//
// EL ORDEN NO ES CASUAL. Los topes van AL FINAL porque la única forma de
// probarlos es llenar la ventana de 24 h con 150 destinatarios, y eso deja la
// puerta cerrada para todo lo que venga después. La primera versión los tenía
// en medio, y el resultado fue un `tope_diario_clientes` en una prueba de MS-7
// que se leía como que la puerta rechaza un movimiento manual — justo lo
// contrario de lo que pasa.
//
// LO QUE VIGILA, y por qué cada cosa:
//
//   1. Que una llamada de TRES argumentos siga funcionando. Es la garantía del
//      orden de despliegue: la migración entra en producción antes que el
//      código, así que durante un rato la producción desplegada llama así. Si
//      esto se rompe, ese rato son los avisos de los 24 dueños cayendo.
//
//   2. MS-7 por los DOS caminos: la fuente de verdad y la puerta. La segunda
//      capa existe justo para el día que alguien se salte la primera.
//
//   3. Que la cuenta sea por destinatario. Dos clientes de la misma bodega son
//      DOS, y la cuenta vieja decía uno. Meta cuenta personas, no cuentas.
//
//   4. Que el tope de clientes frene a los clientes y NO a los dueños. Si esto
//      falla, el síntoma es silencio: 24 dueños que dejan de recibir su resumen
//      sin que haya un error en ninguna parte.

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

const DEV_REF = "vzqppwrwnmlbrxizskdh";
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== DEV_REF) {
  console.error(`ME NIEGO A CORRER. .env.local apunta a "${ref}", no a la rama dev (${DEV_REF}).`);
  console.error("Este script ESCRIBE. Nunca contra producción.");
  process.exit(1);
}

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const PREFIJO = "qa096_";
const TEL = "584129700097";
const TEL2 = "584129700098";

const begin = (args) => admin.rpc("whatsapp_send_begin", args);
const target = async (id) =>
  (await admin.rpc("movement_notice_target", { p_movement_id: id })).data;

let clienteId = null;
let cliente2Id = null;
let cliente3Id = null;

try {
  const { data: o } = await admin.from("owners").select("id").limit(2);
  if ((o ?? []).length < 2) throw new Error("hacen falta 2 dueños en dev");
  const [A, B] = o.map((x) => x.id);

  // ── fixtures ───────────────────────────────────────────────────────────
  await admin.from("client_whatsapp_consents").delete().in("phone", [TEL, TEL2]);

  const { data: c1 } = await admin
    .from("clients")
    .insert({ owner_id: A, name: `${PREFIJO}cliente`, whatsapp: TEL })
    .select("id")
    .single();
  clienteId = c1.id;

  const { data: c2 } = await admin
    .from("clients")
    .insert({ owner_id: A, name: `${PREFIJO}cliente2`, whatsapp: TEL2 })
    .select("id")
    .single();
  cliente2Id = c2.id;

  const base = { created_by: A, type: "charge", amount: 10, currency: "USD" };
  const { data: movManual, error: eMov } = await admin
    .from("movements")
    .insert({ ...base, client_id: clienteId, source: "manual" })
    .select("id")
    .single();
  if (eMov) throw new Error(`no pude crear el movimiento: ${eMov.message}`);
  const { data: movFoto } = await admin
    .from("movements")
    .insert({ ...base, client_id: clienteId, source: "photo_import" })
    .select("id")
    .single();
  const { data: movOtro } = await admin
    .from("movements")
    .insert({ ...base, client_id: cliente2Id, source: "manual" })
    .select("id")
    .single();

  // ── 1. La llamada del código desplegado ───────────────────────────────
  const vieja = await begin({ p_owner_id: A, p_template: `${PREFIJO}vieja`, p_period_key: "k1" });
  check(
    "1a. una llamada de TRES argumentos sigue reservando turno",
    Boolean(vieja.data?.id),
    vieja.error ? vieja.error.message : JSON.stringify(vieja.data),
  );

  const { data: filaVieja } = await admin
    .from("whatsapp_sends")
    .select("audience, recipient")
    .eq("template", `${PREFIJO}vieja`)
    .single();
  check(
    "1b. y queda como aviso de dueño, que es lo que era",
    filaVieja?.audience === "owner" && filaVieja?.recipient === null,
    JSON.stringify(filaVieja),
  );

  check(
    "1c. la misma clave dos veces sigue devolviendo 'ya_enviado'",
    (await begin({ p_owner_id: A, p_template: `${PREFIJO}vieja`, p_period_key: "k1" })).data
      ?.skip === "ya_enviado",
  );

  // ── 2. MS-7, la fuente única de verdad ────────────────────────────────
  check(
    "2a. sin permiso, el movimiento manual no avisa — y dice por qué",
    (await target(movManual.id))?.reason === "no_consent",
    JSON.stringify(await target(movManual.id)),
  );

  for (const id of [clienteId, cliente2Id]) {
    await admin.rpc("record_owner_declared_whatsapp_consent", {
      p_client_id: id,
      p_owner_id: A,
      p_consent_text: "QA 097: acepta.",
      p_source: "owner_movement_form",
    });
  }

  const ok = await target(movManual.id);
  check(
    "2b. con permiso, el manual SÍ avisa y trae lo que el remitente necesita",
    ok?.ok === true && ok?.phone === TEL && ok?.client_id === clienteId,
    JSON.stringify(ok),
  );

  // LA REGLA DURA. Mismo cliente, mismo permiso, mismo teléfono: lo único que
  // cambia es que esta fila vino de una foto.
  check(
    "2c. el de la FOTO no avisa, aunque el cliente haya aceptado",
    (await target(movFoto.id))?.reason === "photo_import",
    JSON.stringify(await target(movFoto.id)),
  );

  check(
    "2d. un movimiento que no existe se rechaza sin reventar",
    (await target("00000000-0000-4000-8000-000000000000"))?.reason === "not_found",
  );

  await admin
    .from("movements")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", movManual.id);
  check(
    "2e. un movimiento borrado deja de avisar",
    (await target(movManual.id))?.reason === "deleted",
    JSON.stringify(await target(movManual.id)),
  );
  await admin.from("movements").update({ deleted_at: null }).eq("id", movManual.id);

  // ── 3. MS-7, la segunda capa ──────────────────────────────────────────
  check(
    "3a. la puerta rechaza un envío a cliente SIN movimiento",
    (
      await begin({
        p_owner_id: A,
        p_template: `${PREFIJO}sinmov`,
        p_period_key: "x",
        p_audience: "client",
        p_recipient: TEL,
      })
    ).data?.skip === "sin_movimiento",
  );

  check(
    "3b. y rechaza el de la foto, aunque el remitente insista",
    (
      await begin({
        p_owner_id: A,
        p_template: `${PREFIJO}foto`,
        p_period_key: "y",
        p_audience: "client",
        p_recipient: TEL,
        p_client_id: clienteId,
        p_movement_id: movFoto.id,
      })
    ).data?.skip === "photo_import",
  );

  check(
    "3c. una audiencia inventada se rechaza",
    (
      await begin({
        p_owner_id: A,
        p_template: `${PREFIJO}raro`,
        p_period_key: "z",
        p_audience: "lo_que_sea",
        p_recipient: TEL,
      })
    ).data?.skip === "audiencia_invalida",
  );

  // ── 4. Un envío a cliente de verdad ───────────────────────────────────
  const recibo = await begin({
    p_owner_id: A,
    p_template: `${PREFIJO}recibo`,
    p_period_key: movManual.id,
    p_audience: "client",
    p_recipient: TEL,
    p_client_id: clienteId,
    p_movement_id: movManual.id,
  });
  check("4a. el manual sí pasa la puerta", Boolean(recibo.data?.id), JSON.stringify(recibo.data));

  const { data: filaCli } = await admin
    .from("whatsapp_sends")
    .select("audience, recipient, client_id")
    .eq("template", `${PREFIJO}recibo`)
    .single();
  check(
    "4b. y queda marcado como 'client', con su teléfono y su cliente",
    filaCli?.audience === "client" &&
      filaCli?.recipient === TEL &&
      filaCli?.client_id === clienteId,
    JSON.stringify(filaCli),
  );

  // ── 5. LOS TOPES. Van al final: llenan la ventana ─────────────────────
  const relleno = Array.from({ length: 150 }, (_, i) => ({
    owner_id: B,
    template: `${PREFIJO}relleno`,
    period_key: `r${i}`,
    audience: "client",
    recipient: `5841299${String(i).padStart(5, "0")}`,
    ok: true,
  }));
  const { error: eRelleno } = await admin.from("whatsapp_sends").insert(relleno);
  if (eRelleno) throw new Error(`no pude rellenar la ventana: ${eRelleno.message}`);

  check(
    "5a. con 150 clientes en la ventana, un cliente NUEVO se frena",
    (
      await begin({
        p_owner_id: A,
        p_template: `${PREFIJO}recibo2`,
        p_period_key: movOtro.id,
        p_audience: "client",
        p_recipient: TEL2,
        p_client_id: cliente2Id,
        p_movement_id: movOtro.id,
      })
    ).data?.skip === "tope_diario_clientes",
  );

  const duenoPasa = await begin({
    p_owner_id: B,
    p_template: `${PREFIJO}resumen`,
    p_period_key: "sem-1",
  });
  check(
    "5b. y el aviso al DUEÑO pasa igual: la reserva funciona",
    Boolean(duenoPasa.data?.id),
    JSON.stringify(duenoPasa.data),
  );

  // Al del punto 4 ya se le escribió en la ventana, así que no gasta cupo
  // nuevo. Frenarlo sería perder un mensaje por un tope que él no consume.
  const yaEscrito = await begin({
    p_owner_id: A,
    p_template: `${PREFIJO}recibo3`,
    p_period_key: `${movManual.id}-2`,
    p_audience: "client",
    p_recipient: TEL,
    p_client_id: clienteId,
    p_movement_id: movManual.id,
  });
  check(
    "5c. un cliente que YA recibió algo hoy no gasta cupo nuevo, así que pasa",
    Boolean(yaEscrito.data?.id),
    JSON.stringify(yaEscrito.data),
  );

  const { data: conTel } = await admin
    .from("whatsapp_sends")
    .select("recipient")
    .like("template", `${PREFIJO}%`)
    .not("recipient", "is", null);
  const unicos = new Set(conTel.map((r) => r.recipient)).size;
  check(
    "5d. varias filas al mismo teléfono son UN destinatario",
    conTel.length > unicos,
    `${conTel.length} filas · ${unicos} destinatarios distintos`,
  );

  // ── 6. MS-27: EL TOPE DE RECORDATORIOS POR NEGOCIO ────────────────
  //
  // MS-7 apaga los mensajes que se disparan AL GUARDAR. Los recordatorios de
  // plazo se disparan después, mirando qué fechas vencen — así que una libreta
  // de cuarenta fiados a 7 días no explota el lunes, explota el sábado. El tope
  // los reparte.
  //
  // Va al final de todo porque llena la ventana con 20 recordatorios de un
  // negocio, igual que el bloque 5 la llena con 150 clientes.
  //
  // LO QUE MÁS IMPORTA AQUÍ ES 6b: el tope NO frena a los recibos. Un recibo
  // sale cuando el cliente acaba de pagar, delante del tendero; frenarlo sería
  // dejar sin confirmación a quien más se la ha ganado.
  await admin.from("whatsapp_sends").delete().like("template", `${PREFIJO}%`);

  const recordatorios = Array.from({ length: 20 }, (_, i) => ({
    owner_id: A,
    template: `${PREFIJO}recordatorio`,
    period_key: `rec${i}`,
    audience: "client",
    recipient: `5841288${String(i).padStart(5, "0")}`,
    reminder: true,
    ok: true,
  }));
  const { error: eRec } = await admin.from("whatsapp_sends").insert(recordatorios);
  if (eRec) throw new Error(`no pude rellenar los recordatorios: ${eRec.message}`);

  check(
    "6a. con 20 recordatorios hoy, ESE negocio no manda otro",
    (
      await begin({
        p_owner_id: A,
        p_template: `${PREFIJO}rec21`,
        p_period_key: `${movManual.id}-rec`,
        p_audience: "client",
        p_recipient: TEL,
        p_client_id: clienteId,
        p_movement_id: movManual.id,
        p_reminder: true,
      })
    ).data?.skip === "tope_recordatorios_negocio",
  );

  const reciboPasa = await begin({
    p_owner_id: A,
    p_template: `${PREFIJO}recibo4`,
    p_period_key: `${movManual.id}-recibo`,
    p_audience: "client",
    p_recipient: TEL,
    p_client_id: clienteId,
    p_movement_id: movManual.id,
    p_reminder: false,
  });
  check(
    "6b. pero un RECIBO del mismo negocio pasa igual",
    Boolean(reciboPasa.data?.id),
    JSON.stringify(reciboPasa.data),
  );

  // El tope es POR NEGOCIO: que una bodega haya gastado su tanda no puede
  // dejar sin recordatorios a la de al lado.
  const { data: otroCliente } = await admin
    .from("clients")
    .insert({ owner_id: B, name: `${PREFIJO}cliente3`, whatsapp: "584129700099" })
    .select("id")
    .single();
  cliente3Id = otroCliente.id;
  const { data: movB } = await admin
    .from("movements")
    .insert({ created_by: B, type: "charge", amount: 10, currency: "USD", client_id: cliente3Id, source: "manual" })
    .select("id")
    .single();
  await admin.rpc("record_owner_declared_whatsapp_consent", {
    p_client_id: cliente3Id,
    p_owner_id: B,
    p_consent_text: "QA 099: acepta.",
    p_source: "owner_movement_form",
  });

  const otroNegocio = await begin({
    p_owner_id: B,
    p_template: `${PREFIJO}recB`,
    p_period_key: movB.id,
    p_audience: "client",
    p_recipient: "584129700099",
    p_client_id: cliente3Id,
    p_movement_id: movB.id,
    p_reminder: true,
  });
  check(
    "6c. y OTRO negocio sigue pudiendo mandar los suyos",
    Boolean(otroNegocio.data?.id),
    JSON.stringify(otroNegocio.data),
  );

  const { data: marcadas } = await admin
    .from("whatsapp_sends")
    .select("reminder")
    .eq("template", `${PREFIJO}recB`)
    .single();
  check("6d. y la fila queda marcada como recordatorio", marcadas?.reminder === true);

} finally {
  await admin.from("whatsapp_sends").delete().like("template", `${PREFIJO}%`);
  for (const id of [clienteId, cliente2Id, cliente3Id]) {
    if (!id) continue;
    await admin.from("movements").delete().eq("client_id", id);
    await admin.from("clients").delete().eq("id", id);
  }
  await admin.from("client_whatsapp_consents").delete().in("phone", [TEL, TEL2, "584129700099"]);

  const { count: sends } = await admin
    .from("whatsapp_sends")
    .select("id", { count: "exact", head: true })
    .like("template", `${PREFIJO}%`);
  const { count: clientes } = await admin
    .from("clients")
    .select("id", { count: "exact", head: true })
    .like("name", `${PREFIJO}%`);
  check(
    "6. limpieza: no queda nada de la prueba en dev",
    sends === 0 && clientes === 0,
    `${sends} envíos · ${clientes} clientes`,
  );

  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  if (fallos) process.exitCode = 1;
}
