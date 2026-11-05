import https from "node:https";
import tls from "node:tls";
import { BCV_INTERMEDIATE_CERT } from "@/lib/exchange-rate/bcv-intermediate-cert";
import { parseVenezuelanNumber, type DatedRate } from "@/lib/exchange-rate/dated-rate";

// THE BCV'S OWN PAGE, read as the arbiter. Server only: this uses node:https, and the page
// sends no CORS header, so the browser calculator cannot read it.
//
// WHY node:https AND NOT fetch. The BCV's server sends the wrong intermediate certificate
// (measured 2026-11-05: the leaf is issued by «Sectigo Public Server Authentication CA DV
// R36» and the server attaches a different Sectigo intermediate), so Node's fetch fails with
// UNABLE_TO_VERIFY_LEAF_SIGNATURE even though browsers, which fetch missing intermediates on
// their own, open it fine. We ship the missing intermediate ourselves and verify normally.
// Turning verification off was considered and refused: that would let anyone on the path
// pass off a rate as the BCV's, and this number is what fiados are stamped with.
//
// WHAT WILL BREAK IT, and the daily diagnosis (qa/diagnostico-tasas.mjs) watches for both:
// the BCV renewing its certificate under another intermediate (the leaf expires
// 2026-11-20), or redesigning the page so the markup below no longer matches. Either way
// this source fails loudly and the other two carry on.
const PAGE_URL = "https://www.bcv.org.ve/";
const TIMEOUT_MS = 8_000;
const USER_AGENT = "Sevenz/1.0 (+https://sevenz.site)";

export function fetchBcvPageHtml(): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      PAGE_URL,
      { ca: [...tls.rootCertificates, BCV_INTERMEDIATE_CERT], headers: { "user-agent": USER_AGENT }, timeout: TIMEOUT_MS },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(new Error(`bcv.org.ve respondió ${response.statusCode}`));
          return;
        }
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => (body += chunk));
        response.on("end", () => resolve(body));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => request.destroy(new Error("bcv.org.ve no respondió a tiempo")));
    request.on("error", reject);
  });
}

// The page, as of 2026-11-05:
//   <div id="euro" …> … <strong class="strong-tb"> 1.006,03263992</strong>
//   <div id="dolar" …> … <strong class="strong-tb">894,88760000</strong>
//   Fecha Valor: <span property="dc:date" … content="2026-11-05T00:00:00-04:00">
// "Fecha Valor" is the day the shown rate is valid for, which on a Friday afternoon is already
// Monday: the reading goes to the resolver dated, and the resolver files it as the prevista.
function rateById(html: string, id: string): number | null {
  const match = html.match(new RegExp(`id="${id}"[\\s\\S]{0,2000}?<strong[^>]*>\\s*([0-9.,]+)\\s*</strong>`));
  return match ? parseVenezuelanNumber(match[1]) : null;
}

export function parseBcvPage(html: string): DatedRate {
  const usd = rateById(html, "dolar");
  const eur = rateById(html, "euro");
  const date = html.match(/Fecha Valor:[\s\S]{0,400}?content="(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
  if (usd === null || eur === null || date === null) {
    throw new Error(`la página del BCV no trae lo esperado (dólar ${usd}, euro ${eur}, fecha ${date})`);
  }
  return { date, usd, eur, source: "bcv" };
}

export async function readBcvPage(): Promise<DatedRate> {
  return parseBcvPage(await fetchBcvPageHtml());
}
