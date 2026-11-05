// NO DATABASE, NO NETWORK. The resolver that turns three readings of the official rate into
// one (lib/exchange-rate/resolve-rates.ts), run against the real numbers of 2026-11-05 and
// the day the dollar will cross Bs. 1.000. Every row of the decision table agreed with the
// owner that day has a case here, and so does the BCV page's markup.
import { resolveOfficialRates, describeSources } from "../lib/exchange-rate/resolve-rates.ts";
import { parseVenezuelanNumber } from "../lib/exchange-rate/dated-rate.ts";
import { parseBcvPage } from "../lib/exchange-rate/bcv-page-provider.ts";
import { assessRateHealth } from "../lib/exchange-rate/rate-health.ts";

const filas = [];
const igual = (nombre, real, esperado) => {
  const pasa = JSON.stringify(real) === JSON.stringify(esperado);
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa ? "" : `  — real ${JSON.stringify(real)} · esperado ${JSON.stringify(esperado)}`}`);
};

const HOY = "2026-11-05";
const ULTIMA_BUENA = { usd: 893.2173, eur: 999.76919171 };
const r = (source, date, usd, eur) => ({ date, usd, eur, source });

// 1. The day it broke: DolarApi's euro reads 1,006, the other two carry 1.006,03.
{
  const res = resolveOfficialRates(
    [r("dolarapi", HOY, 894.8876, 1.006), r("dolarvzla", HOY, 894.8876, 1006.03263992), r("dolarvzla", "2026-11-04", 893.2173, 999.76919171), r("bcv", HOY, 894.8876, 1006.03263992)],
    HOY,
    ULTIMA_BUENA,
  );
  igual("1a. el dólar lo respaldan las tres", [res.usd.value, res.usd.witnesses], [894.8876, ["dolarapi", "dolarvzla", "bcv"]]);
  igual("1b. el euro lo respaldan DolarVZLA y el BCV, DolarApi queda fuera", [res.eur.value, res.eur.witnesses, res.eur.held], [1006.03263992, ["dolarvzla", "bcv"], false]);
  igual("1c. nada retenido, nada a revisión, fecha de hoy", [res.date, res.needsReview, describeSources(res)], [HOY, false, "dolarapi+dolarvzla+bcv"]);
  igual("1d. sin prevista: ninguna lectura es futura", res.prevista, null);
}

// 2. Only DolarApi answers, with its euro broken: the euro is held, the dollar accepted.
{
  const res = resolveOfficialRates([r("dolarapi", HOY, 894.8876, 1.006)], HOY, ULTIMA_BUENA);
  igual("2a. un solo testigo del dólar, a 0,19% del último bueno: entra", [res.usd.value, res.usd.held], [894.8876, false]);
  igual("2b. el euro se mantiene en el último bueno", [res.eur.value, res.eur.held, res.eur.witnesses], [999.76919171, true, []]);
  igual("2c. la fila lo dice", describeSources(res), "dolarapi held:eur");
}

// 3. The dollar crosses Bs. 1.000 with DolarApi still broken: both its numbers read as decimals.
{
  const dia = "2027-02-10";
  const res = resolveOfficialRates(
    [r("dolarapi", dia, 1.002, 1.12), r("dolarvzla", dia, 1002.4, 1120.9), r("bcv", dia, 1002.4, 1120.9)],
    dia,
    { usd: 999.5, eur: 1118 },
  );
  igual("3. dólar y euro los deciden DolarVZLA y el BCV; DolarApi no cuenta en ninguno", [res.usd.value, res.usd.witnesses, res.eur.value, res.eur.witnesses, res.needsReview], [1002.4, ["dolarvzla", "bcv"], 1120.9, ["dolarvzla", "bcv"], false]);
}

// 4. DolarApi broken in the dollar only: its euro is still a witness, judged against the dollar
// the others resolved.
{
  const dia = "2027-02-10";
  const res = resolveOfficialRates(
    [r("dolarapi", dia, 1.002, 1120.9), r("dolarvzla", dia, 1002.4, 1120.9), r("bcv", dia, 1002.4, 1120.9)],
    dia,
    { usd: 999.5, eur: 1118 },
  );
  igual("4. el euro de DolarApi sigue contando aunque su dólar no", [res.usd.witnesses, res.eur.witnesses], [["dolarvzla", "bcv"], ["dolarapi", "dolarvzla", "bcv"]]);
}

// 5. One witness, within 5%: accepted. 6. One witness, 8% away: held. 7. One witness, nothing
// stored: accepted, because there is nothing to compare with.
{
  const dentro = resolveOfficialRates([r("dolarvzla", HOY, 930, 1040)], HOY, ULTIMA_BUENA);
  igual("5. un solo testigo a 4,1%: entra", [dentro.usd.value, dentro.usd.held], [930, false]);
  const fuera = resolveOfficialRates([r("dolarvzla", HOY, 965, 1080)], HOY, ULTIMA_BUENA);
  igual("6. un solo testigo a 8%: se mantiene el último bueno", [fuera.usd.value, fuera.usd.held, fuera.eur.value, fuera.eur.held], [893.2173, true, 999.76919171, true]);
  const primero = resolveOfficialRates([r("dolarvzla", HOY, 965, 1080)], HOY, null);
  igual("7. primer arranque, un solo testigo: entra y no va a revisión", [primero.usd.value, primero.needsReview], [965, false]);
}

// 8. Two disagree and the BCV is silent: hold. 9. Two disagree and the BCV speaks: the BCV.
{
  const sinBcv = resolveOfficialRates([r("dolarapi", HOY, 900, 1010), r("dolarvzla", HOY, 950, 1060)], HOY, ULTIMA_BUENA);
  igual("8. discrepan sin BCV: se mantiene el último bueno", [sinBcv.usd.value, sinBcv.usd.held], [893.2173, true]);
  const conBcv = resolveOfficialRates([r("dolarapi", HOY, 900, 1010), r("dolarvzla", HOY, 940, 1050), r("bcv", HOY, 950, 1060)], HOY, ULTIMA_BUENA);
  igual("9. discrepan los tres: decide el BCV", [conBcv.usd.value, conBcv.usd.witnesses, conBcv.eur.value], [950, ["bcv"], 1060]);
}

// 10. Friday afternoon: the BCV and DolarVZLA already show Monday, DolarApi still Friday.
{
  const viernes = "2026-11-06";
  const res = resolveOfficialRates(
    [r("dolarapi", viernes, 896.1, 1008.2), r("dolarvzla", "2026-11-09", 897.9, 1010.5), r("dolarvzla", viernes, 896.1, 1008.2), r("bcv", "2026-11-09", 897.9, 1010.5)],
    viernes,
    ULTIMA_BUENA,
  );
  igual("10a. la vigente es la del viernes, con DolarApi y DolarVZLA", [res.date, res.usd.value, res.usd.witnesses], [viernes, 896.1, ["dolarapi", "dolarvzla"]]);
  igual("10b. la del lunes es la prevista, respaldada por DolarVZLA y el BCV", [res.prevista.date, res.prevista.usd, res.prevista.source], ["2026-11-09", 897.9, "bcv"]);
}

// 11. Nothing believable at all: held, not reviewed. Nothing believable and nothing stored:
// reviewed, with no value.
{
  const retenido = resolveOfficialRates([r("dolarapi", HOY, 1.002, 1.12)], HOY, ULTIMA_BUENA);
  igual("11a. nada creíble: se mantienen las dos, sin revisión", [retenido.usd.held, retenido.eur.held, retenido.needsReview], [true, true, false]);
  const vacio = resolveOfficialRates([r("dolarapi", HOY, 1.002, 1.12)], HOY, null);
  igual("11b. nada creíble y nada guardado: a revisión, sin cifra", [vacio.usd.value, vacio.needsReview], [null, true]);
  igual("11c. sin lecturas: sin fecha", resolveOfficialRates([], HOY, ULTIMA_BUENA).date, null);
}

// 12. The newest published day wins over a stale source.
{
  const res = resolveOfficialRates([r("dolarapi", "2026-11-04", 893.2173, 999.76919171), r("dolarvzla", HOY, 894.8876, 1006.03263992)], HOY, ULTIMA_BUENA);
  igual("12. DolarApi atrasada un día: manda el día más nuevo, con un solo testigo dentro del 5%", [res.date, res.usd.value, res.eur.value, res.eur.witnesses], [HOY, 894.8876, 1006.03263992, ["dolarvzla"]]);
}

// 13. Prevista preference when future readings disagree and the BCV is absent.
{
  const res = resolveOfficialRates([r("dolarapi", "2026-11-09", 900, 1010), r("dolarvzla", "2026-11-09", 901, 1011), r("dolarapi", HOY, 894.8876, 1006.03263992)], HOY, ULTIMA_BUENA);
  igual("13. prevista en disputa sin BCV: la de DolarVZLA", [res.prevista.source, res.prevista.usd], ["dolarvzla", 901]);
}

// 14. Venezuelan numbers, as the BCV prints them.
igual("14a. 1.006,03263992", parseVenezuelanNumber("1.006,03263992"), 1006.03263992);
igual("14b. 894,88760000", parseVenezuelanNumber("894,88760000"), 894.8876);
igual("14c. 1.006 sin coma es mil seis", parseVenezuelanNumber("1.006"), 1006);
igual("14d. 894.8876 es un decimal normal", parseVenezuelanNumber("894.8876"), 894.8876);
igual("14e. texto que no es número", parseVenezuelanNumber("abc"), null);

// 15. The BCV page's markup of 2026-11-05, trimmed to what the parser needs.
{
  const html = `<div id="euro" class="col-sm-12 col-xs-12 "> <div class="field-content" > <div class="row recuadrotsmc"> <div class="col-sm-6 col-xs-6"> <span style="display: inline; margin-left: 15px;"> EUR </span> </div> <div class="col-sm-6 col-xs-6 centrado textp"><strong class="strong-tb"> 1.006,03263992</strong> </div></div></div></div>
<div id="yuan" class="col-sm-12 col-xs-12"><div class="centrado textp"><strong class="strong-tb"> 130,41</strong></div></div>
<div id="dolar" class="col-sm-12 col-xs-12 "> <div class="field-content" > <div class="row recuadrotsmc"> <div class="col-sm-6 col-xs-6"> <span> USD </span> </div> <div class="col-sm-6 col-xs-6 centrado textp" style="padding-top:2px; font-weight: bold;" > <strong class="strong-tb">894,88760000</strong>  </div></div></div></div>
<div class="pull-right dinpro center">
Fecha Valor: <span  property="dc:date" datatype="xsd:dateTime" content="2026-11-05T00:00:00-04:00" class="date-display-single">Jueves, 05 Noviembre 2026</span></div>`;
  igual("15a. la página del BCV se lee entera", parseBcvPage(html), { date: "2026-11-05", usd: 894.8876, eur: 1006.03263992, source: "bcv" });
  let fallo = null;
  try { parseBcvPage(html.replace('id="euro"', 'id="eur"')); } catch (e) { fallo = e.message; }
  igual("15b. una página rediseñada falla con nombre, no devuelve nada a medias", fallo !== null && fallo.startsWith("la página del BCV no trae lo esperado"), true);
}

// 16. PL-25 and PL-26: what the card and the GitHub check read from the rows alone.
{
  const AHORA = new Date("2026-11-08T12:00:00Z");
  const hace = (h) => new Date(AHORA.getTime() - h * 3_600_000).toISOString();
  const fila = (h, source, needs_review = false) => ({ fetched_at: hace(h), usd: 894.8876, eur: 999.77, source, needs_review });
  const tres = "dolarapi+dolarvzla+bcv";
  const salud = (rows) => assessRateHealth(rows, AHORA);

  igual("16a. tres fuentes al día: ok", salud([fila(1, tres), fila(2, tres)]).status, "ok");
  igual("16b. retenida hace 3 h: aviso, no alarma", [salud([fila(1, "dolarapi+bcv held:eur"), fila(3, "dolarapi+bcv held:eur"), fila(4, tres)]).status], ["warn"]);
  const dias = salud([fila(1, "dolarapi held:eur"), fila(12, "dolarapi held:eur"), fila(30, "dolarapi held:eur"), fila(31, tres)]);
  igual("16c. retenida hace 30 h: alarma, con la fecha en que empezó", [dias.status, dias.heldCurrencies, dias.heldSince], ["fail", ["eur"], hace(30)]);
  igual("16d. retenida antes y recuperada hoy: nada que avisar", salud([fila(1, tres), fila(26, "dolarapi held:eur"), fila(40, "dolarapi held:eur")]).status, "ok");
  igual("16e. una fila vieja sin marca corta la racha, y no inventa días", salud([fila(1, "dolarapi held:eur"), fila(3, "dolarapi")]).heldSince, hace(1));
  igual("16f. dólar y euro retenidos: los dos, y el texto nombra los dos", salud([fila(1, "ninguna held:usd,eur"), fila(26, "ninguna held:usd,eur")]).detail.startsWith("El dólar y el euro llevan"), true);
  const revision = salud([fila(1, "dolarapi", true), fila(26, "dolarapi", true), fila(27, tres)]);
  igual("16g. en revisión 26 h: alarma, y la cifra sigue siendo la última aceptada", [revision.status, revision.reviewRows, revision.eur], ["fail", 2, 999.77]);
  igual("16h. en revisión 2 h: aviso", salud([fila(2, "dolarapi", true), fila(3, tres)]).status, "warn");
  igual("16i. el cron dejó de correr: alarma aunque la última fila sea buena", salud([fila(31, tres)]).status, "fail");
  igual("16j. un solo testigo: aviso", salud([fila(1, "dolarvzla")]).status, "warn");
  igual("16k. sin filas: alarma", salud([]).status, "fail");
  igual("16l. la palabra de la tarjeta sale de cada caso", [salud([fila(1, tres)]).label, salud([fila(1, "dolarvzla+bcv")]).label, salud([fila(1, "dolarvzla")]).label, salud([fila(1, "dolarapi held:eur")]).label, salud([fila(1, "dolarapi", true), fila(2, tres)]).label, salud([fila(31, tres)]).label, salud([]).label], ["3 fuentes", "2 fuentes", "1 fuente", "Retenida", "En revisión", "Detenida", "Sin datos"]);
  igual("16m. una sola lectura se escribe en singular", salud([fila(1, "dolarapi", true), fila(2, tres)]).detail.startsWith("1 lectura en revisión"), true);
}

const ok = filas.filter(Boolean).length;
console.log(`\n${ok}/${filas.length} pasan.`);
process.exit(ok === filas.length ? 0 : 1);
