// La conversion de bolivares a la moneda del libro. Sin red ni base de datos.
//
// Existe porque el dueño teclea bolivares y lo que se guarda es otra cifra: si
// esta cuenta se desvia, nadie lo nota mirando la pantalla — el numero se ve
// razonable igual. Y porque el redondeo con dinero de gente merece una prueba.
import { convertirDesdeBolivares } from "../lib/exchange-rate/monto-en-bolivares.ts";

let fallos = 0;
const check = (nombre, ok, detalle) => {
  if (!ok) fallos++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${nombre}${detalle ? "  — " + detalle : ""}`);
};

const snap = (usd, eur) => ({ ledger: { currency: "USD", rate: { usd, eur } } });
const VIGENTE = snap(832.4883, 968.06734453);
const PREVISTA = snap(842.2067, 977.8777773);

// El caso del reporte, con numeros reales.
const a = convertirDesdeBolivares(45000, "USD", VIGENTE);
check("Bs. 45.000 a la tasa del viernes -> $54,05", a.monto === 54.05, `= ${a.monto}`);
const b = convertirDesdeBolivares(45000, "USD", PREVISTA);
check("Bs. 45.000 a la tasa del lunes -> $53,43", b.monto === 53.43, `= ${b.monto}`);
check("la diferencia son los 62 centimos del reporte",
  Math.round((a.monto - b.monto) * 100) === 62, `${(a.monto - b.monto).toFixed(2)}`);

// Euros usan SU tasa, no la del dolar. Confundirlas es el fallo que este
// producto ya cometio dos veces con la moneda.
const e = convertirDesdeBolivares(45000, "EUR", VIGENTE);
check("euros usan la tasa del euro", Math.abs(e.monto - 45000 / 968.06734453) < 0.01, `= ${e.monto}`);
check("euros y dolares dan cifras distintas", e.monto !== a.monto);

// Redondeo a dos decimales, hacia arriba y hacia abajo.
check("redondea hacia arriba", convertirDesdeBolivares(1000, "USD", snap(3, 3)).monto === 333.33);
check("redondea hacia abajo", convertirDesdeBolivares(2000, "USD", snap(3, 3)).monto === 666.67);

// Lo tecleado queda anotado tal cual, que es el respaldo en una disputa.
check("guarda los bolivares tecleados", a.entryAmount === 45000 && a.entryCurrency === "VES");

// Sin tasa no se puede convertir, y aqui NO se sigue adelante: el monto entero
// depende de ella.
const sinTasa = convertirDesdeBolivares(45000, "USD", { ledger: null });
check("sin tasa -> rechaza con un mensaje", "error" in sinTasa, sinTasa.error?.slice(0, 48));

// Una cantidad que no llega a un centimo no es un movimiento.
const cero = convertirDesdeBolivares(0.001, "USD", VIGENTE);
check("monto que redondea a cero -> rechaza", "error" in cero);

console.log(`\n${fallos === 0 ? "TODO EN VERDE" : fallos + " FALLO(S)"}`);
process.exit(fallos === 0 ? 0 : 1);
