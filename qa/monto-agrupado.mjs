// LOS MILES MIENTRAS SE TECLEA, Y QUIEN LEE ESA CIFRA. Sin red ni base de datos.
//
// Pedido por el dueño el 2026-10-24 para toda la app: *«al digitar se debe ver
// "1.000.000" y no "1000000"»*. Esta suite vigila las DOS mitades, porque la
// primera sola es una trampa.
//
// POR QUÉ MERECE UNA SUITE Y NO UNA MIRADA A LA PANTALLA. Agrupar los miles
// cambia el TEXTO que queda en el campo, y de ese texto sale el número que se
// guarda. Si el formateador y el lector no se ponen de acuerdo, la pantalla se
// ve perfecta y el número es otro — que es la única clase de fallo que este
// repo ya ha pagado dos veces con dinero de gente (el reparto de Bs. 200.005,87
// del 2026-10-24, y los 7 de 13 abonos que enseñaban una cifra distinta).
//
// EL CASO QUE LA MOTIVÓ, medido y no razonado: `parseAmount` lee «1,234» como
// MIL DOSCIENTOS TREINTA Y CUATRO, porque su regla para texto libre es «un
// separador solo con tres dígitos detrás son miles» — cierta para «12.000» y
// falsa para un campo agrupado, donde la coma es siempre el decimal. Mil veces
// el importe acordado, sin un error, sin un rojo, sin nada que mirar.
import {
  parseAmount,
  parseTypedAmount,
  parseMoneyInput,
  formatAmountWhileTyping,
} from "../lib/products/price.ts";

let fallos = 0;
const check = (nombre, ok, detalle) => {
  if (!ok) fallos++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${nombre}${detalle ? "  — " + detalle : ""}`);
};

// Teclea una cadena caracter a caracter por el formateador, como lo haria una
// persona, y devuelve lo que queda en pantalla. No vale pasarle la cadena de
// golpe: ese es el camino del PEGADO, que es otro y mas facil.
function teclear(s, maxDecimales = 4) {
  let txt = "";
  for (const c of s) {
    const bruto = txt + c;
    txt = formatAmountWhileTyping(bruto, txt, bruto.length, maxDecimales).texto;
  }
  return txt;
}

console.log("\n=== 1. Lo que ve el tendero mientras teclea ===");
for (const [entrada, pantalla, valor] of [
  ["1000000", "1.000.000", 1000000],
  ["1000", "1.000", 1000],
  ["999", "999", 999],
  ["1234,5", "1.234,5", 1234.5],
  ["0,5", "0,5", 0.5],
  ["1234567,89", "1.234.567,89", 1234567.89],
]) {
  const p = teclear(entrada);
  check(`teclea ${entrada} y ve ${pantalla}`, p === pantalla, `salio ${JSON.stringify(p)}`);
  check(`  y se guarda ${valor}`, parseTypedAmount(p) === valor, `salio ${parseTypedAmount(p)}`);
}

console.log("\n=== 2. El hueco de los tres decimales (el fallo de mil veces) ===");
check("parseAmount lee «1,234» como 1234 — por eso NO puede leer un campo agrupado",
  parseAmount("1,234") === 1234, `salio ${parseAmount("1,234")}`);
check("parseTypedAmount lo lee como 1,234", parseTypedAmount("1,234") === 1.234,
  `salio ${parseTypedAmount("1,234")}`);
check("y el campo deja escribir esos tres decimales", teclear("1,234") === "1,234");
check("con 12,345 pasa igual", parseAmount("12,345") === 12345 && parseTypedAmount("12,345") === 12.345);

console.log("\n=== 3. El signo menos, que el saldo de apertura necesita ===");
// Una pagina de libreta puede arrancar con el negocio debiendole al cliente.
// El filtro de caracteres del formateador se comia el menos antes del
// 2026-10-24: con la agrupacion puesta, esa libreta era imposible de escribir.
for (const [entrada, pantalla, valor] of [
  ["-1500", "-1.500", -1500],
  ["-1000000", "-1.000.000", -1000000],
  ["-1234,56", "-1.234,56", -1234.56],
]) {
  const p = teclear(entrada);
  check(`teclea ${entrada} y ve ${pantalla}`, p === pantalla, `salio ${JSON.stringify(p)}`);
  check(`  y se guarda ${valor}`, parseTypedAmount(p) === valor, `salio ${parseTypedAmount(p)}`);
}
check("un menos solo no se borra al teclearlo", teclear("-") === "-");

console.log("\n=== 4. El lector del servidor aguanta las DOS convenciones ===");
// Una accion de servidor sigue contestando a un navegador con el paquete
// ANTERIOR cargado durante horas despues de un despliegue: el campo era
// `type="number"` y mandaba «1250.50». Leer las dos con una sola convencion
// equivoca una de ellas por 100, en silencio.
for (const [s, v, quien] of [
  ["1250.50", 1250.5, "paquete viejo, dos decimales"],
  ["1250.5", 1250.5, "paquete viejo, un decimal"],
  ["1.000.000", 1000000, "campo agrupado, un millon"],
  ["1.000,50", 1000.5, "campo agrupado con decimales"],
  ["1,234", 1.234, "campo agrupado, tres decimales"],
  ["1000000", 1000000, "sin separadores, igual en las dos"],
  ["-1.500", -1500, "negativo agrupado"],
  ["", null, "vacio"],
  ["abc", null, "basura"],
]) {
  check(`parseMoneyInput(${JSON.stringify(s)}) = ${v}  (${quien})`, parseMoneyInput(s) === v,
    `salio ${parseMoneyInput(s)}`);
}

console.log("\n=== 5. Pegar una cifra tambien queda agrupado ===");
// El camino del pegado no interpreta pulsaciones: lo decide `parseAmount` y se
// vuelve a formatear. Se comprueba porque es el unico camino con otra rama.
for (const [pegado, pantalla] of [
  ["1000000", "1.000.000"],
  ["1.000.000", "1.000.000"],
  ["1250,75", "1.250,75"],
]) {
  const r = formatAmountWhileTyping(pegado, "", pegado.length);
  check(`pega ${pegado} y ve ${pantalla}`, r.texto === pantalla, `salio ${JSON.stringify(r.texto)}`);
}

console.log(fallos === 0 ? "\nTODO PASA" : `\n${fallos} FALLOS`);
process.exit(fallos === 0 ? 0 : 1);
