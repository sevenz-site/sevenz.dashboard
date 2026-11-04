// Migration 185, the half the database cannot check: `lib/credit-score.ts`.
//
// No database and nothing written. The score walks the same queue as
// `get_open_charges_for_client` in a second copy, and `CT-124` is what those two
// drifting apart cost. `qa:devoluciones` pins the SQL side; this pins this one.
//
// WHAT MATTERS: a client who brought a product back paid nothing that day, so a
// fiado closed by a return says nothing about whether he pays.
//
//   npm run qa:puntaje-devoluciones
import { buildChargeLedger, computeCreditScore } from "../lib/credit-score.ts";

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle !== undefined ? `  — ${detalle}` : ""}`);
}

const dia = (n) => new Date(Date.UTC(2026, 9, n)).toISOString();
let id = 0;
const mov = (type, amount, n, extra = {}) => ({
  id: `00000000-0000-4000-8000-${String(++id).padStart(12, "0")}`,
  type,
  amount,
  currency: "USD",
  created_at: dia(n),
  plazo_dias: null,
  applies_to_movement_id: null,
  ...extra,
});

// A fiado closed by a payment against the last stretch closed by a return.
{
  const c = mov("charge", 30, 1, { plazo_dias: 30 });
  const ledger = buildChargeLedger([
    c,
    mov("payment", 25, 2, { applies_to_movement_id: c.id }),
    mov("return", 5, 3, { applies_to_movement_id: c.id }),
  ]);
  check("1a. la devolución deja el fiado en cero", ledger[0].remaining === 0, ledger[0].remaining);
  check("1b. y queda marcado como cerrado por devolución", ledger[0].closedByReturn === true, ledger[0].closedByReturn);
}
{
  const c = mov("charge", 30, 1, { plazo_dias: 30 });
  const ledger = buildChargeLedger([
    c,
    mov("return", 5, 2, { applies_to_movement_id: c.id }),
    mov("payment", 25, 3, { applies_to_movement_id: c.id }),
  ]);
  check("1c. si el último dinero fue un abono, cuenta como pagado", ledger[0].closedByReturn === false, ledger[0].closedByReturn);
}

// The saldo a favor reaches the next fiado, in the same order as the database.
{
  const ledger = buildChargeLedger([mov("return", 5, 1), mov("charge", 12, 2)]);
  check("2a. un saldo a favor anterior descuenta del fiado siguiente", ledger[0].remaining === 7, ledger[0].remaining);
}
{
  const ledger = buildChargeLedger([mov("payment", 5, 1), mov("charge", 12, 2)]);
  check("2b. un abono viejo de más NO se arrastra: el pasado no cambia", ledger[0].remaining === 12, ledger[0].remaining);
}

// The score itself.
const puntaje = (movements) =>
  computeCreditScore({
    movements,
    balance: 0,
    daysSincePayment: 0,
    worstChargeAt: null,
    worstChargePlazoDias: null,
    worstChargeDueAt: null,
    isFlagged: false,
    now: new Date(dia(28)),
  });
{
  const c = mov("charge", 10, 1, { plazo_dias: 7 });
  const r = puntaje([c, mov("return", 10, 2, { applies_to_movement_id: c.id })]);
  check("3a. quien solo devolvió sigue «Sin historial», no «puntual»", r.tier === "Sin historial", r.tier);
}
{
  const c = mov("charge", 10, 1, { plazo_dias: 7 });
  const r = puntaje([c, mov("payment", 10, 2, { applies_to_movement_id: c.id })]);
  check("3b. control: quien pagó igual sí tiene historial", r.tier !== "Sin historial", r.tier);
}

const fallos = filas.filter((p) => !p).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
