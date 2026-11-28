// «BUSCAR POR DOCUMENTO SIN EL PREFIJO» (owner's request of 2026-11-27). Pure: the rule every
// client search shares, `matchesClientDocument` in lib/search/document.ts. No database.
const filas = [];
const check = (nombre, pasa, detalle = "") => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa ? "" : `  — ${detalle}`}`);
};
const { matchesClientDocument: m } = await import("../lib/search/document.ts");

// Rafael Colmenares in the demo: «V» + «13549859», shown as «V-13.549.859».
const R = ["13549859", "V"];
for (const q of ["13549859", "1354", "13.549.859", "V-13.549.859", "V13549859", "v-13549859", "V 13549859", "v-13.549"]) {
  check(`1. «${q}» encuentra V-13.549.859`, m(q, ...R) === true);
}
check("2a. la letra cuenta: «E-13549859» no encuentra a un V", m("E-13549859", ...R) === false);
check("2b. otro número no lo encuentra", m("20118277", ...R) === false);
check("3a. sin dígitos no se mira el documento: «v» no trae a todos los V", m("v", ...R) === false && m("V-", ...R) === false);
check("3b. un nombre tampoco", m("Rafael", ...R) === false);
check("3c. separadores solos no traen a nadie", m("-", ...R) === false && m(" . ", ...R) === false && m("", ...R) === false);
check("4a. guardado con puntos («13.549.859»): lo encuentran los dígitos", m("13549859", "13.549.859", "V") && m("V13549859", "13.549.859", "V"));
check("4b. guardado con la letra dentro («V-13549859», sin tipo): lo encuentran los dígitos y la letra",
  m("13549859", "V-13549859", null) && m("V13549859", "V-13549859", null) && m("V-13.549.859", "V-13549859", null));
check("4c. con la letra dentro Y en el tipo no se duplica: «V13549859» lo encuentra", m("V13549859", "V-13549859", "V"));
check("5. Colombia: «CC 1.023.456» encuentra CC + 1023456", m("CC 1.023.456", "1023456", "CC") && m("1023456", "1023456", "CC") && !m("CE1023456", "1023456", "CC"));
check("6. sin documento, nada", m("123", null, "V") === false && m("123", "", "V") === false);

const fallos = filas.filter((x) => !x).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos ? 1 : 0);
