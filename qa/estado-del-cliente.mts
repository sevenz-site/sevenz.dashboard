// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local.
//
// SÍ ESCRIBE en dev: clientes de prueba y sus fiados. El `finally` de cada
// caso los borra aunque el script se caiga a mitad.
//
// ===========================================================================
// QUÉ VIGILA, Y POR QUÉ NO LO CUBRÍA NADA
//
// El chip de estado es el único aviso que el tendero mira antes de volver a
// fiarle a alguien. Hasta la migración `134` salía del fiado MÁS ANTIGUO, así
// que un fiado viejo todavía en plazo decidía por todos los demás: un cliente
// con $50 al día y $400 vencidos hace 73 días salía «Dentro del plazo».
//
// Ninguna suite lo miraba. Se descubrió a ojo, mirando la lista, que es
// exactamente de donde han salido todos los agujeros de esta carpeta.
//
// LOS CASOS SON PARES CON CONTROL. No basta comprobar que el caso roto ahora
// pasa: hay que comprobar que el caso sano sigue sano, porque la forma más
// fácil de "arreglar" esto es poner a todo el mundo en rojo.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { getClientStatus, clientStatusLabel } from "@/lib/types";

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

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

let fallos = 0;
function check(nombre: string, ok: boolean, detalle = "") {
  console.log(`${ok ? "PASS " : "FALLO"}  ${nombre}${detalle ? "  — " + detalle : ""}`);
  if (!ok) fallos++;
}

const dias = (n: number) => new Date(Date.now() - n * 86400000).toISOString();

// El dueño VE con el que se montan los casos. Se elige por país y no por un
// id escrito a mano: la regla de `DM-7`, que existe porque cinco suites
// elegían el negocio a ciegas y una mintió un día entero.
const { data: duenoFila } = await db
  .from("owners")
  .select("id")
  .eq("country", "VE")
  .order("id")
  .limit(1)
  .single();
if (!duenoFila) throw new Error("no hay ningún dueño VE en dev con el que montar los casos");
// A UNA CONSTANTE NO NULA, y no es ceremonia: `conCliente` la usa dentro de
// un closure, y ahí TypeScript no se queda con el estrechamiento del `throw`
// de arriba. Sin esto el script corre igual y el typecheck del repo falla.
const ownerId: string = duenoFila.id;

type Fiado = { hace: number; plazo: number | null; monto: number; moneda?: string };

async function conCliente<T>(
  nombre: string,
  doc: string,
  antiguedadDias: number,
  fiados: Fiado[],
  fn: (chip: string, vencidos: number | null) => T,
): Promise<T> {
  const { data: cliente, error } = await db
    .from("clients")
    .insert({
      owner_id: ownerId,
      name: nombre,
      document_id: doc,
      document_country: "VE",
      created_at: dias(antiguedadDias),
    })
    .select("id")
    .single();
  if (error) throw new Error(`alta del cliente de prueba: ${error.message}`);

  try {
    for (const f of fiados) {
      const { error: e } = await db.from("movements").insert({
        client_id: cliente.id,
        type: "charge",
        amount: f.monto,
        currency: f.moneda ?? "USD",
        created_by: ownerId,
        source: "manual",
        plazo_dias: f.plazo,
        created_at: dias(f.hace),
      });
      if (e) throw new Error(`alta del fiado: ${e.message}`);
    }

    const { data: fila, error: e2 } = await db
      .from("client_summary")
      .select(
        "balance_usd, balance_eur, days_since_payment, worst_unpaid_charge_at, worst_unpaid_charge_plazo_dias, worst_unpaid_charge_due_at, overdue_charge_count",
      )
      .eq("client_id", cliente.id)
      .single();
    if (e2) throw new Error(`client_summary: ${e2.message}`);

    const estado = getClientStatus({
      balance: Number(fila.balance_usd ?? 0) + Number(fila.balance_eur ?? 0),
      daysSincePayment: fila.days_since_payment,
      worstChargeAt: fila.worst_unpaid_charge_at,
      worstChargePlazoDias: fila.worst_unpaid_charge_plazo_dias,
      worstChargeDueAt: fila.worst_unpaid_charge_due_at,
    });

    return fn(clientStatusLabel(estado, fila.overdue_charge_count), fila.overdue_charge_count);
  } finally {
    await db.from("movements").delete().eq("client_id", cliente.id);
    await db.from("clients").delete().eq("id", cliente.id);
  }
}

// ── 1. EL CASO QUE LO ORIGINÓ, Y SU CONTROL ──────────────────────────────
//
// Un fiado pequeño y al día no puede apagar la alarma de uno grande y
// vencido. El control quita el pequeño: el chip no debe moverse.
await conCliente("QA estado · oculto", "96000001", 100, [
  { hace: 90, plazo: 120, monto: 50 },
  { hace: 80, plazo: 7, monto: 400 },
], (chip) => {
  check("1. el fiado al día NO esconde al vencido", chip.startsWith("Crítico"), chip);
});

await conCliente("QA estado · control", "96000002", 100, [
  { hace: 80, plazo: 7, monto: 400 },
], (chip) => {
  check("1b. CONTROL: el mismo cliente sin el fiado pequeño dice lo mismo", chip.startsWith("Crítico"), chip);
});

// ── 2. Y CRUZANDO LAS DOS MONEDAS ────────────────────────────────────────
await conCliente("QA estado · monedas", "96000003", 5, [
  { hace: 40, plazo: 60, monto: 50, moneda: "USD" },
  { hace: 30, plazo: 7, monto: 300, moneda: "EUR" },
], (chip) => {
  check("2. un fiado en euros vencido no se esconde tras uno en dólares al día", chip.startsWith("Plazo vencido"), chip);
});

// ── 3. EL CONTROL QUE IMPIDE «PONER A TODOS EN ROJO» ─────────────────────
await conCliente("QA estado · al dia", "96000004", 5, [
  { hace: 2, plazo: 30, monto: 50 },
], (chip) => {
  check("3. un fiado al día sigue siendo «Dentro del plazo»", chip === "Dentro del plazo", chip);
});

// ── 4. EL CONTADOR ───────────────────────────────────────────────────────
await conCliente("QA estado · contador", "96000005", 5, [
  { hace: 40, plazo: 7, monto: 10 },
  { hace: 35, plazo: 7, monto: 20 },
  { hace: 30, plazo: 7, monto: 30 },
], (chip, n) => {
  check("4. cuenta los tres fiados vencidos", n === 3, `overdue_charge_count=${n}`);
  check("4b. y el chip escribe el número", chip.includes("(3)"), chip);
});

// Con uno solo no hay número: un «(1)» no añade nada y le pondría cifra a
// casi todas las filas, que es cómo se consigue que nadie lea el número el
// día que de verdad importa.
await conCliente("QA estado · uno solo", "96000006", 5, [
  { hace: 40, plazo: 7, monto: 10 },
  { hace: 2, plazo: 60, monto: 20 },
], (chip, n) => {
  check("5. con UN vencido el chip no lleva número", !chip.includes("("), `${chip} · count=${n}`);
});

// El contador también en «Crítico», a petición del dueño el 2026-10-21: es un
// plazo vencido agravado por los 30 días sin abonar, así que el número dice
// lo mismo.
await conCliente("QA estado · critico n", "96000007", 100, [
  { hace: 90, plazo: 7, monto: 10 },
  { hace: 85, plazo: 7, monto: 20 },
  { hace: 80, plazo: 7, monto: 30 },
], (chip) => {
  check("6. «Crítico» también lleva contador", chip === "Crítico (3)", chip);
});

// ── 7. UN FIADO SIN PLAZO CUENTA COMO VENCIDO EL DÍA QUE SE TOMÓ ─────────
//
// Nunca se le puso fecha, así que lleva esperando desde el principio y
// `getClientStatus` ya lo trata con la misma gravedad que un plazo vencido.
await conCliente("QA estado · sin plazo", "96000008", 5, [
  { hace: 2, plazo: null, monto: 40 },
  { hace: 1, plazo: 60, monto: 10 },
], (chip) => {
  check("7. un fiado SIN plazo manda sobre el que está al día", chip.startsWith("Sin plazo"), chip);
});

// ── 8. SIN DEUDA NO HAY NI ESTADO NI CONTADOR ────────────────────────────
await conCliente("QA estado · sin deuda", "96000009", 5, [], (chip, n) => {
  check("8. sin fiados: «Sin deuda» y sin contador", chip === "Sin deuda" && !n, `${chip} · count=${n}`);
});

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : fallos + " FALLO(S)"}`);
process.exit(fallos === 0 ? 0 : 1);
