// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// Comprueba la migración 096: la puerta de envío cuenta DESTINATARIOS, no
// cuentas, y reserva cupo para los dueños (MS-21, MS-37).
//
// SÍ ESCRIBE en dev, a propósito: lo único que importa aquí son los efectos, y
// la puerta no se puede comprobar leyéndola. Todo lo que crea lleva una
// plantilla con prefijo propio y se borra por ese prefijo en el `finally`, pase
// lo que pase.
//
// LO QUE VIGILA, y por qué cada cosa:
//
//   1. Que una llamada de TRES argumentos siga funcionando. Es la garantía del
//      orden de despliegue: la migración entra en producción antes que el
//      código, así que durante un rato la producción desplegada llama así. Si
//      esto se rompe, ese rato son los avisos de los 24 dueños cayendo.
//
//   2. Que la cuenta sea por destinatario. Dos clientes de la misma bodega son
//      DOS, y la cuenta vieja decía uno. Dos bodegas que comparten un cliente
//      son UNO, y la vieja decía dos. Meta cuenta personas.
//
//   3. Que el tope de clientes frene a los clientes y NO a los dueños. Es la
//      reserva, y es la razón de ser de la 096: los recibos salen toda la
//      semana y el resumen de los dueños sale un día. Si esto falla, el síntoma
//      es silencio — 24 dueños que dejan de recibirlo, sin error en ningún lado.
//
//   4. Que a quien ya se le escribió en la ventana no se le frene. No gasta
//      cupo nuevo, así que frenarlo sería perder un mensaje por un tope que esa
//      persona no está consumiendo.

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

// Todo lo que este script escriba lleva esto delante. Es la red de limpieza.
const PREFIJO = "qa096_";

const begin = (args) => admin.rpc("whatsapp_send_begin", args);

let owners = [];

try {
  const { data: o } = await admin.from("owners").select("id").limit(2);
  owners = o ?? [];
  if (owners.length < 2) throw new Error("hacen falta 2 dueños en dev");
  const [A, B] = owners.map((x) => x.id);

  // ── 1. La llamada de tres argumentos, que es la del código desplegado ──
  const vieja = await begin({
    p_owner_id: A,
    p_template: `${PREFIJO}vieja`,
    p_period_key: "k1",
  });
  check(
    "1a. una llamada de TRES argumentos sigue reservando turno",
    Boolean(vieja.data?.id),
    vieja.error ? vieja.error.message : JSON.stringify(vieja.data),
  );

  const { data: filaVieja } = await admin
    .from("whatsapp_sends")
    .select("audience, recipient, client_id")
    .eq("template", `${PREFIJO}vieja`)
    .single();
  check(
    "1b. y queda como aviso de dueño, que es lo que era",
    filaVieja?.audience === "owner" && filaVieja?.recipient === null,
    JSON.stringify(filaVieja),
  );

  // ── 2. La idempotencia de siempre no se toca ──────────────────────────
  const repetida = await begin({
    p_owner_id: A,
    p_template: `${PREFIJO}vieja`,
    p_period_key: "k1",
  });
  check(
    "2. la misma clave dos veces sigue devolviendo 'ya_enviado'",
    repetida.data?.skip === "ya_enviado",
    JSON.stringify(repetida.data),
  );

  // ── 3. Un envío a cliente se registra como tal ────────────────────────
  const cli = await begin({
    p_owner_id: A,
    p_template: `${PREFIJO}recibo`,
    p_period_key: "mov-1",
    p_audience: "client",
    p_recipient: "584120000001",
  });
  check("3a. un envío a cliente reserva turno", Boolean(cli.data?.id), JSON.stringify(cli.data));

  const { data: filaCli } = await admin
    .from("whatsapp_sends")
    .select("audience, recipient")
    .eq("template", `${PREFIJO}recibo`)
    .single();
  check(
    "3b. y queda marcado como 'client' con su teléfono",
    filaCli?.audience === "client" && filaCli?.recipient === "584120000001",
    JSON.stringify(filaCli),
  );

  check(
    "3c. una audiencia inventada se rechaza",
    (
      await begin({
        p_owner_id: A,
        p_template: `${PREFIJO}raro`,
        p_period_key: "x",
        p_audience: "lo_que_sea",
        p_recipient: "584120000002",
      })
    ).data?.skip === "audiencia_invalida",
  );

  // ── 4. LA RESERVA DE LOS DUEÑOS ───────────────────────────────────────
  //
  // Se llena la ventana con 150 destinatarios de cliente distintos, metiéndolos
  // directo en la tabla: lo que se prueba es la CUENTA, no el camino de
  // inserción, y 150 llamadas a la función tardarían un minuto.
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

  const clienteFrenado = await begin({
    p_owner_id: A,
    p_template: `${PREFIJO}recibo2`,
    p_period_key: "mov-2",
    p_audience: "client",
    p_recipient: "584120000003",
  });
  check(
    "4a. con 150 clientes en la ventana, un cliente NUEVO se frena",
    clienteFrenado.data?.skip === "tope_diario_clientes",
    JSON.stringify(clienteFrenado.data),
  );

  const duenoPasa = await begin({
    p_owner_id: B,
    p_template: `${PREFIJO}resumen`,
    p_period_key: "sem-1",
  });
  check(
    "4b. y el aviso al DUEÑO pasa igual: la reserva funciona",
    Boolean(duenoPasa.data?.id),
    JSON.stringify(duenoPasa.data),
  );

  // ── 5. A quien ya se le escribió no se le frena ───────────────────────
  const yaEscrito = await begin({
    p_owner_id: A,
    p_template: `${PREFIJO}recibo3`,
    p_period_key: "mov-3",
    p_audience: "client",
    p_recipient: "584120000001", // el del punto 3, ya en la ventana
  });
  check(
    "5. un cliente que YA recibió algo hoy no gasta cupo nuevo, así que pasa",
    Boolean(yaEscrito.data?.id),
    JSON.stringify(yaEscrito.data),
  );

  // ── 6. La cuenta es por persona, no por cuenta ────────────────────────
  //
  // Dos bodegas distintas escribiendo al MISMO teléfono son un destinatario.
  // Con la cuenta vieja (por owner_id) habrían sido dos.
  const { data: antes } = await admin
    .from("whatsapp_sends")
    .select("recipient")
    .like("template", `${PREFIJO}%`)
    .not("recipient", "is", null);
  const unicos = new Set(antes.map((r) => r.recipient)).size;
  const filasConTelefono = antes.length;
  check(
    "6. varias filas al mismo teléfono son UN destinatario",
    filasConTelefono > unicos,
    `${filasConTelefono} filas · ${unicos} destinatarios distintos`,
  );
} finally {
  const { error } = await admin.from("whatsapp_sends").delete().like("template", `${PREFIJO}%`);
  const { count } = await admin
    .from("whatsapp_sends")
    .select("id", { count: "exact", head: true })
    .like("template", `${PREFIJO}%`);
  check("7. limpieza: no queda nada de la prueba en dev", !error && count === 0, `quedan ${count}`);

  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  if (fallos) process.exitCode = 1;
}
