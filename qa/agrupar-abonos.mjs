// NO HABLA CON NINGUNA BASE DE DATOS. Lógica pura.
//
// UN ABONO REPARTIDO ES UNA FILA — encargo del dueño el 2026-10-30. Esta suite
// vigila la regla que comparten el historial del tendero y el del cliente
// (`lib/history/group-payments.ts`). Lo que la hace merecer suite propia es que
// sus dos fallos posibles no avisan: juntar dos pagos distintos en uno le
// esconde dinero al tendero, y no juntar un reparto vuelve a enseñar cuatro
// abonos donde hubo uno. Ninguno de los dos se pone en rojo en ninguna parte.

import { groupPayments, paymentGroupKey } from "../lib/history/group-payments.ts";

let fallos = 0;
function check(nombre, pasa, detalle = "") {
  if (!pasa) fallos++;
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

const T = "2026-10-30T15:00:00.000Z";
const linea = (id, extra = {}) => ({
  id,
  type: "payment",
  currency: "USD",
  amount: 5,
  created_at: T,
  transaction_code: "ABCD123",
  running_balance: 0,
  entry_currency: null,
  entry_amount: null,
  ...extra,
});

// ── 1. EL CASO DEL USUARIO: USD 20 EN CUATRO FIADOS DE 5 ────────────────
const reparto = [
  linea("a1", { running_balance: 15 }),
  linea("b2", { running_balance: 10 }),
  linea("c3", { running_balance: 5 }),
  linea("d4", { running_balance: 0 }),
];
const g1 = groupPayments(reparto);
check("cuatro líneas con el mismo código son UNA fila", g1.length === 1, `${g1.length} filas`);
check("la fila dice el total, 20", g1[0]?.row.amount === 20, String(g1[0]?.row.amount));
check("y conserva las cuatro líneas, en orden", g1[0]?.lines.map((l) => l.id).join() === "a1,b2,c3,d4");
check(
  "su «Por cobrar» es el saldo DESPUÉS de la última línea (la del id mayor con la misma hora)",
  g1[0]?.row.running_balance === 0 && g1[0]?.row.id === "d4",
  `${g1[0]?.row.id} → ${g1[0]?.row.running_balance}`,
);

// ── 2. EL ORDEN DE ENTRADA NO IMPORTA ───────────────────────────────────
const desordenado = groupPayments([reparto[2], reparto[0], reparto[3], reparto[1]]);
check("desordenadas, la última sigue siendo d4", desordenado[0]?.row.id === "d4");

// ── 3. LO QUE NO SE PUEDE JUNTAR ────────────────────────────────────────
const distintos = groupPayments([linea("x", { transaction_code: "AAAA111" }), linea("y", { transaction_code: "BBBB222" })]);
check("dos abonos con códigos distintos siguen siendo dos", distintos.length === 2);

const sinCodigo = groupPayments([linea("p", { transaction_code: null }), linea("q", { transaction_code: null })]);
check("sin código no se junta nada (lo anterior a la 147)", sinCodigo.length === 2);

const fiados = groupPayments([
  { ...linea("f1"), type: "charge" },
  { ...linea("f2"), type: "charge" },
]);
check("dos fiados con el mismo código (una venta mixta) NO se juntan", fiados.length === 2);

// ── 4. UN REPARTO QUE CRUZÓ LIBROS: UNA FILA POR MONEDA ─────────────────
const cruzado = groupPayments([
  linea("u1", { currency: "USD", amount: 10 }),
  linea("u2", { currency: "USD", amount: 5 }),
  linea("e1", { currency: "EUR", amount: 8 }),
]);
check("dólares y euros del mismo pago son dos filas", cruzado.length === 2, `${cruzado.length} filas`);
const usd = cruzado.find((g) => g.row.currency === "USD");
check("la de dólares suma solo dólares (15)", usd?.row.amount === 15, String(usd?.row.amount));
check(
  "la clave separa por libro",
  paymentGroupKey(linea("u", { currency: "USD" })) !== paymentGroupKey(linea("e", { currency: "EUR" })),
);
check(
  "Colombia (moneda null) agrupa igual",
  groupPayments([linea("c1", { currency: null }), linea("c2", { currency: null })]).length === 1,
);

// ── 5. LOS BOLÍVARES TECLEADOS ──────────────────────────────────────────
const enBs = groupPayments([
  linea("b1", { entry_currency: "VES", entry_amount: 100000 }),
  linea("b2", { entry_currency: "VES", entry_amount: 100000 }),
]);
check(
  "si todas se teclearon en bolívares, la fila lleva su suma exacta",
  enBs[0]?.row.entry_currency === "VES" && enBs[0]?.row.entry_amount === 200000,
  String(enBs[0]?.row.entry_amount),
);
const mezcla = groupPayments([
  linea("m1", { entry_currency: "VES", entry_amount: 100000 }),
  linea("m2"),
]);
check("si una no, la fila no inventa una cifra tecleada", mezcla[0]?.row.entry_amount === null);

// ── 6. LOS CÉNTIMOS NO SE ACUMULAN MAL ──────────────────────────────────
const centimos = groupPayments([linea("k1", { amount: 0.1 }), linea("k2", { amount: 0.2 })]);
check("0,10 + 0,20 da 0,30 y no 0,30000000000000004", centimos[0]?.row.amount === 0.3, String(centimos[0]?.row.amount));

// ── 7. UN ABONO SUELTO SE QUEDA COMO ESTABA ─────────────────────────────
const solo = linea("s1", { amount: 7.5 });
const gSolo = groupPayments([solo]);
check("un abono de una línea sale tal cual, el mismo objeto", gSolo[0]?.row === solo);

console.log(fallos === 0 ? "\nTODO PASA" : `\n${fallos} FALLO(S)`);
process.exit(fallos === 0 ? 0 : 1);
