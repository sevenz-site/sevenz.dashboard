// NO DATABASE. The euro of 2026-11-05: the provider answered 1,006 instead of 1.006, and
// nothing failed. These are the numbers that must never become a rate, and the rows that
// must never be kept as "the last official one".
import { eurIsPlausible, lastGoodRate } from "../lib/exchange-rate/rate-guard.ts";

const filas = [];
const igual = (nombre, real, esperado) => {
  const pasa = JSON.stringify(real) === JSON.stringify(esperado);
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}`);
};

igual("1. el euro roto del 2026-11-05 se rechaza", eurIsPlausible(894.8876, 1.006), false);
igual("2. el euro del día anterior pasa", eurIsPlausible(893.2173, 999.76919171), true);
igual("3. el euro real de ese día pasaría", eurIsPlausible(894.8876, 1006.12), true);
igual("4. un euro cero se rechaza", eurIsPlausible(894.8876, 0), false);
igual("5. sin dólar no hay con qué comparar", eurIsPlausible(0, 1000), false);
igual("6. un número que no es número se rechaza", eurIsPlausible(894.8876, Number.NaN), false);
igual("7. un euro mil veces mayor se rechaza", eurIsPlausible(894.8876, 1006120), false);
igual("8. el euro en paridad con el dólar pasa", eurIsPlausible(900, 900), true);
igual("9. dólar y euro rotos a la vez se rechazan, aunque su razón cuadre", eurIsPlausible(1.002, 1.12), false);
igual("10. solo el dólar roto se rechaza", eurIsPlausible(1.002, 1120), false);

// The fix as first written kept the newest row, and with a broken one in the table it stored
// 1,006 as official. Reproduced in dev on 2026-11-05.
const buena = { usd: 893.2173, eur: 999.76919171 };
const mala = { usd: 894.8876, eur: 1.006 };
igual("11. una fila rota arriba se salta y se conserva la buena", lastGoodRate([mala, mala, buena]), buena);
igual("12. un número que llega como texto no rompe la lectura", lastGoodRate([{ usd: "893.2173", eur: "999.76919171" }]), buena);
igual("13. sin ninguna fila buena no se inventa nada", lastGoodRate([mala]), null);
igual("14. sin filas no se inventa nada", lastGoodRate([]), null);

// It must let go on its own. A euro compared with a held value got stuck: after a long outage
// the true rate sits more than 15% above the kept one and would be refused forever.
igual("15. tras un mes roto y el bolívar 30% abajo, el euro real vuelve a entrar", eurIsPlausible(1163, 1300), true);

const ok = filas.filter(Boolean).length;
console.log(`\n${ok}/${filas.length} pasan.`);
process.exit(ok === filas.length ? 0 : 1);
