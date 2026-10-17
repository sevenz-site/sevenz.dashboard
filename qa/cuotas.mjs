// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// El fiado en cuotas: migración 118. SÍ ESCRIBE en dev —crea clientes de
// prueba con sus movimientos— y los borra todos en el `finally`, aunque el
// script se caiga a mitad.
//
// LO QUE VIGILA, y por qué cada cosa:
//
//   1. Que sin cuotas NO cambie nada. Es la mitad del valor de la migración:
//      `null` significa «una sola cuota», así que lo ya guardado —todo lo de
//      producción— tiene que seguir juzgándose exactamente igual que ayer.
//
//   2. Que «3 cuotas en 30 días» venza cada 10. Es la regla que dio el dueño
//      el 2026-10-17, con su ejemplo literal.
//
//   3. Que MEDIA CUOTA NO REFRESQUE. La otra decisión del dueño del mismo
//      día, y la que impide que esto se convierta en «abona 1 Bs al mes y no
//      vences nunca»: pagar 29 de una cuota de 30 deja el vencimiento donde
//      estaba.
//
//   4. Que la base RECHACE lo que no tiene sentido: cuotas sin plazo, cuotas
//      en un abono, una sola cuota (eso es null) y un número absurdo. El
//      `check` es la última línea, no la primera, pero es la que no se puede
//      saltar desde ninguna pantalla.
//
//   5. Que un negocio COLOMBIANO también las tenga. Su moneda es `null`, y
//      ese null es un libro más — si el filtro de la cola se escribiera con
//      `=` en vez de `is not distinct from`, Colombia se quedaría fuera y en
//      silencio.

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

const MARCA = "ZZ QA cuotas";
const dias = (n) => new Date(Date.now() - n * 86400000).toISOString();
const creados = [];

// Cuántos días después del cargo vence lo siguiente, según la base.
async function vencimiento(clientId, cargoAt) {
  const { data, error } = await admin
    .from("client_summary")
    .select("oldest_unpaid_charge_at, oldest_unpaid_charge_due_at")
    .eq("client_id", clientId)
    .single();
  if (error) throw new Error(`client_summary: ${error.message}`);
  if (data.oldest_unpaid_charge_due_at == null) return null;
  return (
    (new Date(data.oldest_unpaid_charge_due_at) - new Date(cargoAt)) / 86400000
  );
}

async function nuevoCliente(ownerId, nombre) {
  const { data, error } = await admin
    .from("clients")
    .insert({ owner_id: ownerId, name: `${MARCA} ${nombre}` })
    .select("id")
    .single();
  if (error) throw new Error(`clients: ${error.message}`);
  creados.push(data.id);
  return data.id;
}

try {
  const { data: owners, error: eOwners } = await admin
    .from("owners")
    .select("id, country, whatsapp, whatsapp_opt_in_at, whatsapp_opt_out_at")
    .in("country", ["VE", "CO"]);
  if (eOwners) throw new Error(`owners: ${eOwners.message}`);

  // THE 10b OWNER HAS TO ACTUALLY RECEIVE WHATSAPP, or the check skips itself
  // and reports nothing. The consent rule is copied from
  // `whatsapp_destinatarios_atencion()`: opted in, and not opted out later.
  //
  // Picking the first VE owner that came back used to leave 10b skipped, which
  // reads in the output as one line of prose among twelve PASSes — the exact
  // shape of a check that nobody notices has stopped checking.
  const recibeWhatsapp = (o) =>
    Boolean(o.whatsapp) &&
    Boolean(o.whatsapp_opt_in_at) &&
    (!o.whatsapp_opt_out_at ||
      new Date(o.whatsapp_opt_in_at) > new Date(o.whatsapp_opt_out_at));

  const ve =
    owners.filter((o) => o.country === "VE" && recibeWhatsapp(o))[0] ??
    owners.find((o) => o.country === "VE");
  const co = owners.find((o) => o.country === "CO");
  if (!ve) throw new Error("Hace falta un dueño venezolano en dev.");

  // ── 1. SIN CUOTAS, TODO IGUAL QUE AYER ────────────────────────────────
  {
    const id = await nuevoCliente(ve.id, "sin cuotas");
    const cargo = dias(10);
    await admin.from("movements").insert({
      client_id: id, type: "charge", amount: 100, currency: "USD",
      plazo_dias: 30, created_at: cargo, source: "manual", description: `${MARCA} fiado`,
    });
    await admin.rpc("recalc_client_running_balance", { p_client_id: id });
    check("1. sin cuotas, el vencimiento es el final del plazo", (await vencimiento(id, cargo)) === 30, "30 días");
  }

  // ── 2 y 3. EL EJEMPLO DEL DUEÑO: 3 CUOTAS EN 30 DÍAS ──────────────────
  {
    const id = await nuevoCliente(ve.id, "tres cuotas");
    const cargo = dias(5);
    await admin.from("movements").insert({
      client_id: id, type: "charge", amount: 90, currency: "USD",
      plazo_dias: 30, cuotas: 3, created_at: cargo, source: "manual", description: `${MARCA} fiado`,
    });
    await admin.rpc("recalc_client_running_balance", { p_client_id: id });
    check("2. 3 cuotas en 30 días: la primera vence a los 10", (await vencimiento(id, cargo)) === 10, "la cuota es de 30");

    // Media cuota: 29 de 30.
    await admin.from("movements").insert({
      client_id: id, type: "payment", amount: 29, currency: "USD",
      created_at: dias(4), source: "manual", description: `${MARCA} media cuota`,
    });
    await admin.rpc("recalc_client_running_balance", { p_client_id: id });
    check("3. media cuota NO refresca: pagar 29 de 30 deja el vencimiento a los 10", (await vencimiento(id, cargo)) === 10, "decisión del dueño, 2026-10-17");

    // El euro que faltaba completa la primera cuota.
    await admin.from("movements").insert({
      client_id: id, type: "payment", amount: 1, currency: "USD",
      created_at: dias(3), source: "manual", description: `${MARCA} completa la primera`,
    });
    await admin.rpc("recalc_client_running_balance", { p_client_id: id });
    check("4. cuota entera: el vencimiento pasa a los 20", (await vencimiento(id, cargo)) === 20);

    // Y la segunda entera.
    await admin.from("movements").insert({
      client_id: id, type: "payment", amount: 30, currency: "USD",
      created_at: dias(2), source: "manual", description: `${MARCA} segunda cuota`,
    });
    await admin.rpc("recalc_client_running_balance", { p_client_id: id });
    check("5. dos cuotas: el vencimiento pasa a los 30, que es el final del plazo", (await vencimiento(id, cargo)) === 30);
  }

  // ── 6. UN PLAZO QUE NO SE DIVIDE EXACTO ───────────────────────────────
  {
    const id = await nuevoCliente(ve.id, "plazo con decimales");
    const cargo = dias(1);
    await admin.from("movements").insert({
      client_id: id, type: "charge", amount: 100, currency: "USD",
      plazo_dias: 30, cuotas: 4, created_at: cargo, source: "manual", description: `${MARCA} fiado`,
    });
    await admin.rpc("recalc_client_running_balance", { p_client_id: id });
    check("6. 4 cuotas en 30 días son 7,5 y no 7: la base no redondea", (await vencimiento(id, cargo)) === 7.5);
  }

  // ── 7. LO QUE LA BASE TIENE QUE RECHAZAR ──────────────────────────────
  {
    const id = await nuevoCliente(ve.id, "rechazos");
    const intento = async (fila) => {
      const { error } = await admin.from("movements").insert({ client_id: id, source: "manual", ...fila });
      return error;
    };
    check("7a. cuotas sin plazo, rechazado",
      Boolean(await intento({ type: "charge", amount: 50, currency: "USD", plazo_dias: null, cuotas: 3, created_at: dias(1) })));
    check("7b. cuotas en un abono, rechazado",
      Boolean(await intento({ type: "payment", amount: 50, currency: "USD", plazo_dias: 30, cuotas: 3, created_at: dias(1) })));
    check("7c. una sola cuota, rechazado — eso es null",
      Boolean(await intento({ type: "charge", amount: 50, currency: "USD", plazo_dias: 30, cuotas: 1, created_at: dias(1) })));
    check("7d. 40 cuotas, rechazado",
      Boolean(await intento({ type: "charge", amount: 50, currency: "USD", plazo_dias: 30, cuotas: 40, created_at: dias(1) })));
  }

  // ── 8. COLOMBIA, CUYA MONEDA ES NULL ──────────────────────────────────
  if (co) {
    const id = await nuevoCliente(co.id, "colombia");
    const cargo = dias(2);
    const { error } = await admin.from("movements").insert({
      client_id: id, type: "charge", amount: 60, currency: null,
      plazo_dias: 30, cuotas: 3, created_at: cargo, source: "manual", description: `${MARCA} fiado`,
    });
    if (error) throw new Error(`movements CO: ${error.message}`);
    await admin.rpc("recalc_client_running_balance", { p_client_id: id });
    check("8. un negocio colombiano también reparte en cuotas", (await vencimiento(id, cargo)) === 10, "su moneda es null, que es un libro más");
  } else {
    console.log("SALTADA  8. no hay dueño colombiano en dev");
  }
  // ── 10. WHATSAPP TIENE QUE DECIR LO MISMO QUE LA PANTALLA ─────────────
  //
  // La comprobación que faltaba el 2026-10-17, y que salió de una pregunta
  // del dueño y no de una prueba: `whatsapp_destinatarios_atencion()` se
  // calculaba el vencimiento por su cuenta —`carga_at + plazo`, el plazo
  // ENTERO— así que un cliente con una cuota vencida habría salido «Plazo
  // vencido» en la pantalla del tendero y NO habría contado entre los
  // `overdue_clients` de su propio resumen semanal. El mismo cliente, dos
  // respuestas. La migración `119` lo arregla haciendo que lea la misma
  // columna; esto es lo que avisa si alguien vuelve a rehacer la cuenta en
  // otro sitio.
  // SE MIDE LA DIFERENCIA, NO EL TOTAL, y esto es lo único que hace que la
  // comprobación signifique algo. Escrita primero como `overdue_clients >= 1`,
  // PASÓ en verde con la `119` sin aplicar y el defecto entero en pie: el dueño
  // de prueba ya tenía 2 clientes vencidos por su cuenta, así que el umbral se
  // cumplía sin mirar al cliente de la prueba. Un total no distingue «lo contó»
  // de «ya había otros».
  async function overdueDeWhatsapp(ownerId) {
    const { data, error } = await admin.rpc("whatsapp_destinatarios_atencion");
    if (error) throw new Error(`whatsapp_destinatarios_atencion: ${error.message}`);
    const fila = (data ?? []).find((d) => d.owner_id === ownerId);
    return fila ? Number(fila.overdue_clients) : null;
  }

  {
    const antes = await overdueDeWhatsapp(ve.id);

    const id = await nuevoCliente(ve.id, "whatsapp");
    // 3 cuotas en 30 días sobre un cargo de hace 20: la primera cuota venció
    // hace 10 días y el plazo entero todavía NO ha vencido. Es el caso exacto
    // en el que las dos cuentas se separan.
    await admin.from("movements").insert({
      client_id: id, type: "charge", amount: 90, currency: "USD",
      plazo_dias: 30, cuotas: 3, created_at: dias(20), source: "manual", description: `${MARCA} fiado`,
    });
    await admin.rpc("recalc_client_running_balance", { p_client_id: id });

    const { data: r } = await admin
      .from("client_summary")
      .select("oldest_unpaid_charge_due_at")
      .eq("client_id", id)
      .single();
    check(
      "10a. la pantalla lo da por vencido: venció la cuota, no el plazo entero",
      new Date(r.oldest_unpaid_charge_due_at) < new Date(),
      r.oldest_unpaid_charge_due_at,
    );

    const despues = await overdueDeWhatsapp(ve.id);
    if (antes === null || despues === null) {
      console.log(
        "SALTADA  10b. el dueño de prueba no recibe WhatsApp (sin opt-in), no sale en la lista",
      );
    } else {
      check(
        "10b. WhatsApp suma ese cliente a los vencidos, igual que la pantalla",
        despues === antes + 1,
        `overdue_clients ${antes} → ${despues}`,
      );
    }
  }
} catch (e) {
  console.error("\nSE CAYÓ:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  for (const id of creados) {
    await admin.from("movements").delete().eq("client_id", id);
    await admin.from("clients").delete().eq("id", id);
  }
  const { data: quedan } = await admin.from("clients").select("id").like("name", `${MARCA}%`);
  check("9. limpieza: no queda nada de la prueba en dev", (quedan ?? []).length === 0, `quedan ${(quedan ?? []).length}`);
}

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
