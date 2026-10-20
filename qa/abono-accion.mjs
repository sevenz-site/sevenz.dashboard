// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// SÍ ESCRIBE en dev: un cliente de prueba y sus movimientos. El `finally` los
// borra aunque el script se caiga a mitad.
//
// REQUIERE la migración `126` corrida en dev, y un servidor sirviendo la app —
// `npm run dev` o `QA_BASE_URL=https://dev.sevenz.site`.
//
// ===========================================================================
// LLAMA A `registrarAbonoDirigido` DE VERDAD
//
// `qa:abono-dirigido` prueba el SQL: que la cola respete la dirección y que el
// pendiente por fiado salga bien. Lo que no puede tocar es la acción del
// servidor, y ahí viven los dos topes que el dueño pidió el 2026-10-19:
//
//   · No se puede abonar más de lo que ESE fiado debe.
//   · Solo se puede dirigir a un fiado con saldo pendiente.
//
// Los dos son TypeScript, no restricciones de la base, así que una suite que
// escriba con la clave de servicio los pasa por encima sin tocarlos — que es
// exactamente lo que `CLAUDE.md` cuenta de `qa:pedidos` pasando 14 de 14 con la
// pantalla rota.
//
// EL ID DE LA ACCIÓN SE DESCUBRE, no se fija: es un hash que cambia en cada
// compilación. Mismo método que `qa/venta-accion.mjs`, con su misma lección
// escrita allí — el nombre va al lado del id, y entre los dos no hay paréntesis.

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

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const MARCA = "QA ABONO ACCION";
const creados = { clientes: [] };
const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();

async function idDeLaAccion(base, nombre, cookie, ruta) {
  const res = await fetch(`${base}${ruta}`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`${ruta} respondió HTTP ${res.status} en ${base}`);
  const html = await res.text();
  const urls = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/[^"]+\.js)"/g)].map((m) => m[1]))];
  if (urls.length === 0) throw new Error("la página no declara chunks — ¿la sesión no entró?");

  const vistos = new Set(urls);
  const textos = new Map();
  for (const u of [...urls]) {
    const r = await fetch(`${base}${u}`);
    if (!r.ok) continue;
    const t = await r.text();
    textos.set(u, t);
    for (const m of t.matchAll(/["'(]((?:\/_next\/)[^"')]+?\.js)["')]/g)) {
      if (!vistos.has(m[1]) && vistos.size < 400) {
        vistos.add(m[1]);
        urls.push(m[1]);
      }
    }
  }

  const re = new RegExp(`"([0-9a-f]{40,})"[^()]{0,200}?"${nombre}"`);
  for (const u of urls) {
    let t = textos.get(u);
    if (t == null) {
      const r = await fetch(`${base}${u}`);
      if (!r.ok) continue;
      t = await r.text();
    }
    const m = re.exec(t);
    if (m) return m[1];
  }
  return null;
}

try {
  const { data: ve } = await admin
    .from("owners")
    .select("id")
    .eq("country", "VE")
    .order("id")
    .limit(1)
    .single();

  const usuarios = await admin.auth.admin.listUsers({ perPage: 200 });
  const correo = usuarios.data.users.find((u) => u.id === ve.id)?.email;
  if (!correo) throw new Error("el dueño VE no tiene correo con el que abrir sesión");
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: correo });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: sesion, error: eOtp } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (eOtp) throw new Error(`verifyOtp: ${eOtp.message}`);

  const nombreCookie = `sb-${ref}-auth-token`;
  const valor =
    "base64-" + Buffer.from(JSON.stringify(sesion.session), "utf8").toString("base64url");
  const MAX = 3180;
  const cookie = (
    valor.length <= MAX
      ? [`${nombreCookie}=${valor}`]
      : Array.from(
          { length: Math.ceil(valor.length / MAX) },
          (_, i) => `${nombreCookie}.${i}=${valor.slice(i * MAX, (i + 1) * MAX)}`,
        )
  ).join("; ");

  // ── EL FIXTURE ────────────────────────────────────────────────────────
  const { data: cliente } = await admin
    .from("clients")
    .insert({ owner_id: ve.id, name: `${MARCA} cliente` })
    .select("id")
    .single();
  creados.clientes.push(cliente.id);

  const cargo = async (monto, dias) => {
    const { data } = await admin
      .from("movements")
      .insert({
        client_id: cliente.id,
        created_by: ve.id,
        type: "charge",
        amount: monto,
        currency: "USD",
        plazo_dias: 15,
        created_at: hace(dias),
      })
      .select("id")
      .single();
    return data.id;
  };

  const viejo = await cargo(100, 60);
  const nuevo = await cargo(50, 2);

  const accion = await idDeLaAccion(
    BASE,
    "registrarAbonoDirigido",
    cookie,
    `/abonos/nuevo/${nuevo}/monto`,
  );
  check(
    `0. el id de \`registrarAbonoDirigido\` se descubre en los chunks de ${BASE}`,
    accion != null,
    accion ? `${accion.slice(0, 10)}…` : "NO ENCONTRADO",
  );
  if (!accion) throw new Error("sin id de acción no hay nada que probar");

  async function abonar(entrada) {
    const res = await fetch(`${BASE}/abonos/nuevo/${entrada.fiadoId}/monto`, {
      method: "POST",
      headers: { "Next-Action": accion, "Content-Type": "text/plain;charset=UTF-8", Cookie: cookie },
      body: JSON.stringify([entrada]),
    });
    const texto = await res.text();
    // Un transporte roto NO es un rechazo. Lo aprendió `qa/venta-accion.mjs`
    // pintando nueve filas verdes con HTTP 404 en todas las llamadas.
    if (!res.ok) throw new Error(`HTTP ${res.status} llamando a la acción en ${BASE}`);
    const i = texto.indexOf('{"ok":');
    if (i < 0) throw new Error(`respuesta sin resultado legible: ${texto.slice(0, 160)}`);
    let prof = 0, enCadena = false, esc = false;
    for (let j = i; j < texto.length; j++) {
      const c = texto[j];
      if (esc) { esc = false; continue; }
      if (c === "\\") { esc = true; continue; }
      if (c === '"') { enCadena = !enCadena; continue; }
      if (enCadena) continue;
      if (c === "{") prof++;
      else if (c === "}" && --prof === 0) return JSON.parse(texto.slice(i, j + 1));
    }
    throw new Error("objeto sin cerrar en la respuesta");
  }

  const pendienteDe = async (id) => {
    const { data } = await admin.rpc("get_open_charges_for_client", { p_client_id: cliente.id });
    const f = (data ?? []).find((c) => c.movement_id === id);
    return f ? Number(f.pending) : null;
  };

  // ══════════════════════════════════════════════════════════════════════
  // 1. UN ABONO PARCIAL DIRIGIDO
  // ══════════════════════════════════════════════════════════════════════
  const r1 = await abonar({ fiadoId: nuevo, monto: 20, monedaTecleada: "USD" });
  check("1. abono parcial dirigido: se guarda", r1.ok === true, r1.ok ? "ok" : r1.error);

  if (r1.ok) {
    const { data: m } = await admin
      .from("movements")
      .select("type, amount, currency, applies_to_movement_id")
      .eq("id", r1.movementId)
      .single();
    check(
      "1b. y queda DIRIGIDO a ese fiado, no suelto",
      m?.type === "payment" && Number(m.amount) === 20 && m.applies_to_movement_id === nuevo,
      `${m?.type} ${m?.amount} → ${m?.applies_to_movement_id === nuevo ? "el fiado elegido" : m?.applies_to_movement_id}`,
    );
    check(
      "1c. el pendiente de ESE fiado baja, y el del viejo no se toca",
      (await pendienteDe(nuevo)) === 30 && (await pendienteDe(viejo)) === 100,
      `nuevo ${await pendienteDe(nuevo)} · viejo ${await pendienteDe(viejo)}`,
    );
  }

  // ══════════════════════════════════════════════════════════════════════
  // 2. EL TOPE: no más de lo que ESE fiado debe
  // ══════════════════════════════════════════════════════════════════════
  const r2 = await abonar({ fiadoId: nuevo, monto: 31, monedaTecleada: "USD" });
  check(
    "2. abonar 31 a un fiado que debe 30: rechazado",
    r2.ok === false && /solo debe/i.test(r2.error ?? ""),
    r2.ok ? "SE GUARDÓ" : r2.error,
  );

  const r3 = await abonar({ fiadoId: nuevo, monto: 30, monedaTecleada: "USD" });
  check("2b. abonar los 30 exactos: ENTRA — el borde por el lado que pasa", r3.ok === true, r3.ok ? "ok" : r3.error);

  // ══════════════════════════════════════════════════════════════════════
  // 3. UN FIADO YA SALDADO NO ADMITE MÁS
  // ══════════════════════════════════════════════════════════════════════
  const r4 = await abonar({ fiadoId: nuevo, monto: 1, monedaTecleada: "USD" });
  check(
    "3. ese fiado ya está saldado: rechazado",
    r4.ok === false && /saldado/i.test(r4.error ?? ""),
    r4.ok ? "SE GUARDÓ" : r4.error,
  );

  // ══════════════════════════════════════════════════════════════════════
  // 4. MONTO CERO Y NEGATIVO
  // ══════════════════════════════════════════════════════════════════════
  for (const [nombre, monto] of [["4a. monto 0", 0], ["4b. monto negativo", -5]]) {
    const r = await abonar({ fiadoId: viejo, monto, monedaTecleada: "USD" });
    check(`${nombre}: rechazado`, r.ok === false, r.ok ? "SE GUARDÓ" : r.error);
  }

  // ══════════════════════════════════════════════════════════════════════
  // 5. PROPIEDAD Y TIPO
  // ══════════════════════════════════════════════════════════════════════
  const { data: otro } = await admin
    .from("owners")
    .select("id")
    .neq("id", ve.id)
    .order("id")
    .limit(1)
    .single();
  const { data: ajenoCliente } = await admin
    .from("clients")
    .insert({ owner_id: otro.id, name: `${MARCA} ajeno` })
    .select("id")
    .single();
  creados.clientes.push(ajenoCliente.id);
  const { data: ajenoCargo } = await admin
    .from("movements")
    .insert({
      client_id: ajenoCliente.id,
      created_by: otro.id,
      type: "charge",
      amount: 40,
      currency: "USD",
      created_at: hace(3),
    })
    .select("id")
    .single();

  const r5 = await abonar({ fiadoId: ajenoCargo.id, monto: 5, monedaTecleada: "USD" });
  check(
    "5. fiado de OTRO dueño: rechazado",
    r5.ok === false && /No encontramos ese fiado/i.test(r5.error ?? ""),
    r5.ok ? "SE GUARDÓ" : r5.error,
  );

  const r6 = await abonar({ fiadoId: r1.ok ? r1.movementId : viejo, monto: 5, monedaTecleada: "USD" });
  check(
    "5b. dirigir un abono a OTRO ABONO: rechazado",
    r6.ok === false,
    r6.ok ? "SE GUARDÓ" : r6.error,
  );
} catch (e) {
  check("ERROR: la corrida se detuvo", false, e instanceof Error ? e.message : String(e));
} finally {
  if (creados.clientes.length) {
    await admin.from("movements").delete().in("client_id", creados.clientes);
    await admin.from("clients").delete().in("id", creados.clientes);
  }
  const { count } = await admin
    .from("clients")
    .select("id", { count: "exact", head: true })
    .like("name", `${MARCA}%`);
  check("6. limpieza: no queda nada de la prueba en dev", (count ?? 0) === 0, `quedan ${count}`);

  const fallan = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallan}/${filas.length} pasan.`);
  process.exit(fallan ? 1 : 0);
}
