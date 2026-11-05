// NO DATABASE, NO SERVER. The arithmetic behind the transaction events, every case
// that has already gone wrong elsewhere in this app: the Colombian book spelled two
// ways, a sale that is cash in one currency and credit in another, and a sale paid
// with saldo that must not read as a loan (`CT-166`).
import { flowContext, moneyProps, paymentForm, settlesDebt } from "../lib/analytics/amounts.ts";

const filas = [];
const igual = (nombre, real, esperado) => {
  const pasa = JSON.stringify(real) === JSON.stringify(esperado);
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa ? "" : ` — dio ${JSON.stringify(real)}, se esperaba ${JSON.stringify(esperado)}`}`);
};
const m = (o) => new Map(Object.entries(o));

igual("1. el libro colombiano null y 'COP' caen en la misma propiedad", moneyProps("total", [[null, 10], ["COP", 5]]), { total_usd: 0, total_eur: 0, total_cop: 15 });
igual("2. dos monedas nunca se suman", moneyProps("total", [["USD", 10], ["EUR", 5]]), { total_usd: 10, total_eur: 5, total_cop: 0 });
igual("3. sin importes salen los tres ceros, para no saltarse esa venta en una media", moneyProps("owed", []), { owed_usd: 0, owed_eur: 0, owed_cop: 0 });
igual("4. no arrastra el error de coma flotante", moneyProps("total", [["USD", 0.1], ["USD", 0.2]]), { total_usd: 0.3, total_eur: 0, total_cop: 0 });

igual("5. pagada entera: cash", paymentForm({ totals: m({ USD: 10 }), collected: m({ USD: 10 }), owed: m({}) }), "cash");
igual("6. sin pago: fiado", paymentForm({ totals: m({ USD: 10 }), collected: m({}), owed: m({ USD: 10 }) }), "fiado");
igual("7. con abono inicial: partial", paymentForm({ totals: m({ USD: 10 }), collected: m({ USD: 4 }), owed: m({ USD: 6 }) }), "partial");
igual("8. cubierta con saldo a favor: saldo, nunca fiado (CT-166)", paymentForm({ totals: m({ USD: 10 }), collected: m({}), owed: m({}) }), "saldo");
igual("9. saldo que cubre una parte y el resto fiado: fiado", paymentForm({ totals: m({ USD: 15 }), collected: m({}), owed: m({ USD: 5 }) }), "fiado");
igual("10. dólares cobrados y euros fiados: mixed", paymentForm({ totals: m({ USD: 10, EUR: 30 }), collected: m({ USD: 10 }), owed: m({ EUR: 30 }) }), "mixed");
igual("11. dos monedas fiadas enteras siguen siendo fiado", paymentForm({ totals: m({ USD: 10, EUR: 30 }), collected: m({}), owed: m({ USD: 10, EUR: 30 }) }), "fiado");
igual("12. medio céntimo no convierte un contado en fiado", paymentForm({ totals: m({ USD: 10 }), collected: m({ USD: 9.998 }), owed: m({ USD: 0.002 }) }), "cash");

const abiertos = [{ currency: "USD", pending: 30 }, { currency: "USD", pending: 20 }, { currency: "EUR", pending: 7 }];
igual("13. pagar todo el libro lo salda aunque deba en otro", settlesDebt(abiertos, new Map([["USD", 50]])), true);
igual("14. pagar una parte no lo salda", settlesDebt(abiertos, new Map([["USD", 30]])), false);
igual("15. el libro colombiano null se compara bien", settlesDebt([{ currency: null, pending: 100 }], new Map([[null, 100]])), true);
igual("16. sin nada pagado no salda nada", settlesDebt(abiertos, new Map()), false);

igual("17. flow_id y entry_point válidos pasan", flowContext({ flowId: "f3a1c9e2-77", entryPoint: "register" }), { flow_id: "f3a1c9e2-77", entry_point: "register" });
igual("18. un entry_point inventado se tira", flowContext({ entryPoint: "<script>" }), {});
igual("19. un flow_id con otra forma se tira", flowContext({ flowId: "corto" }), {});
igual("20. sin datos no rompe", flowContext(undefined), {});

const ok = filas.filter(Boolean).length;
console.log(`\n${ok}/${filas.length} pasan.`);
process.exit(ok === filas.length ? 0 : 1);
