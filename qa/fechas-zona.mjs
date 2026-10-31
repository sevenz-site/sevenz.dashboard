// NO TOCA LA BASE DE DATOS. Son fechas.
//
// PL-1, closed 2026-10-30: every date of an instant is drawn in the zone of
// the business (Caracas for VE, Bogotá for CO), and a calendar day is drawn
// without one. Until then `formatDate` took no zone, so the server (UTC) and
// the owner's phone disagreed by a day from 8 p.m. Caracas to midnight --
// measured in production that night on abono HDXR320, registered at 10:49
// p.m. on 30 October and dated «31 de oct».
//
// These rows pin the arithmetic. Whether every screen USES it is a different
// question, answered by `tsc` -- the zone is a required argument -- and by
// opening the screens; see the PL-1 note in lib/format.ts.
import { formatDate, formatDateLong, formatDateTime, formatCalendarDate, zonaDelNegocio } from "../lib/format.ts";
import { calcularCuotas } from "../lib/cuotas.ts";

const filas = [];
const check = (nombre, pasa, detalle) => {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
};

const CARACAS = zonaDelNegocio("VE");
const BOGOTA = zonaDelNegocio("CO");

// 10:49 p.m. in Caracas on 30 October is 02:49 UTC on the 31st.
const abono = "2026-10-31T02:49:00.000Z";
check("1. Caracas: un abono de las 10:49 p. m. del 30 sale el 30", /30/.test(formatDate(abono, CARACAS)), formatDate(abono, CARACAS));
check("2. y en UTC, que es lo que pintaba el servidor, salía el 31", /31/.test(formatDate(abono, "UTC")), formatDate(abono, "UTC"));
check("3. la fecha larga de las tarjetas, igual", formatDateLong(abono, CARACAS) === "30 de octubre de 2026", formatDateLong(abono, CARACAS));
check("4. con hora: 22:49 en Caracas", /30.*22:49/.test(formatDateTime(abono, CARACAS)), formatDateTime(abono, CARACAS));

// 11:30 p.m. in Bogotá on 30 October is 04:30 UTC on the 31st -- and 00:30 on
// the 31st in Caracas. The country decides, which is why it is not one zone.
const tarde = "2026-10-31T04:30:00.000Z";
check("5. Bogotá: 11:30 p. m. del 30 sale el 30", /30/.test(formatDate(tarde, BOGOTA)), formatDate(tarde, BOGOTA));
check("6. el mismo instante en Caracas ya es el 31", /31/.test(formatDate(tarde, CARACAS)), formatDate(tarde, CARACAS));

// A CALENDAR DAY: «2026-11-02» is the day a forecast rate applies. Drawn as an
// instant in Caracas it read «01 nov» -- seen in production in the sale's
// payment sheet, next to an abono screen that said «lunes 2 nov».
check("7. un día de calendario no se mueve", /02/.test(formatCalendarDate("2026-11-02")) && /nov/.test(formatCalendarDate("2026-11-02")), formatCalendarDate("2026-11-02"));
check("8. tampoco escrito como medianoche UTC", /02/.test(formatCalendarDate("2026-11-02T00:00:00Z")), formatCalendarDate("2026-11-02T00:00:00Z"));

// THE CUOTAS OF PRODUCTION'S OLD DEBT: €20 in 3 cuotas over 15 days, created
// at 10:57 p.m. on 30 October. Each one falls due every 5 days FROM THAT
// MOMENT, so in Caracas they read 4, 9 and 14 November; drawn in UTC they read
// 5, 10 and 15 -- which is what production showed.
const fiado = "2026-10-31T02:57:00.000Z";
const cuotas = calcularCuotas({ createdAt: fiado, amount: 20, plazoDias: 15, cuotas: 3 });
const dias = (cuotas ?? []).map((c) => formatDate(c.fecha.toISOString(), CARACAS));
check(
  "9. las cuotas de la deuda antigua de producción vencen el 4, 9 y 14 de nov",
  dias.length === 3 && /04/.test(dias[0]) && /09/.test(dias[1]) && /14/.test(dias[2]),
  dias.join(" · "),
);

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos === 0 ? 0 : 1);
