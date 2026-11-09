// PL-35: THE SCORE OF THE LIST HAS TO BE THE SCORE OF THE CLIENT'S OWN PAGE.
//
// The list reads every client's movements at once, the client's page reads one client's. A
// read cut at 1,000 rows only hurts the first, so the two disagree in silence: the owner's
// «Pedro le pagó todo a tiempo (…) en la lista de Clientes sale con mal puntaje».
//
// Part 1 needs no database: lib/supabase/read-all.ts against fake pages. Part 2 is DEV ONLY
// (vzqppwrwnmlbrxizskdh): one throw-away business with 150 clients and 1,500 movements, read
// AS THE OWNER, not with the service key, and removed at the end. No client has a number.
//
// 150 AND NOT 300, the number the ficha asked for: on a business built seconds earlier, 300
// clients make `client_summary` hit the 8 s statement timeout as the owner, before the score
// is even reached. Measured in dev on 2026-11-06. It is not what production does: its largest
// business, 224 clients, read the view in 325 ms that same day. See `PL-36`.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { IDS_PER_BATCH, PAGE_ROWS, readAllByIds, readAllPages } from "../lib/supabase/read-all.ts";
import { computeCreditScoresForClients } from "../lib/credit-score-batch.ts";
import { computeCreditScore } from "../lib/credit-score.ts";
import { cargarFacturacion } from "../lib/reports/facturacion.ts";

const filas = [];
const check = (nombre, pasa, detalle = "") => {
  filas.push(pasa);
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa || !detalle ? "" : `  — ${detalle}`}`);
};

// ── Part 1: the reader ───────────────────────────────────────────────────────
const tabla = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
const servidor = (tope, conCuenta) => async (from, to) => ({
  data: tabla.slice(from, Math.min(to + 1, from + tope)),
  error: null,
  count: conCuenta ? tabla.length : null,
});
{
  let viajes = 0;
  const conCuenta = servidor(1000, true);
  const r = await readAllPages((a, b) => { viajes++; return conCuenta(a, b); });
  check("1a. 2.500 filas en páginas de 1.000: todas, sin repetir, y tres viajes", r.length === 2500 && new Set(r.map((x) => x.id)).size === 2500 && viajes === 3, `${r.length} filas, ${viajes} viajes`);
  const corto = await readAllPages(servidor(500, false));
  check("1b. si el servidor corta en 500 y no da total: sigue hasta la página vacía", corto.length === 2500, `${corto.length}`);
  let lanzo = false;
  let n = 0;
  try {
    await readAllPages(async (a, b) => (++n === 2 ? { data: null, error: { message: "caída" } } : { data: tabla.slice(a, b + 1), error: null, count: 2500 }));
  } catch { lanzo = true; }
  check("1c. una página que falla lanza error: nunca un resultado a medias", lanzo);
  const vacio = await readAllPages(async () => ({ data: [], error: null, count: 0 }));
  check("1d. sin filas: lista vacía, sin bucle", vacio.length === 0);
  const tandas = [];
  const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
  const porIds = await readAllByIds(ids, async (batch) => { tandas.push(batch.length); return { data: batch.map((id) => ({ id })), error: null, count: batch.length }; });
  check(`1e. 250 ids salen en tandas de ${IDS_PER_BATCH} como máximo, y vuelven todos`, Math.max(...tandas) <= IDS_PER_BATCH && tandas.length === 3 && porIds.length === 250, JSON.stringify(tandas));
  check("1f. la página pedida es de 1.000", PAGE_ROWS === 1000);

  // A read that dies on page two must leave no scores at all. The old code scored every client
  // as if they had no history, which reads as a real figure on the screen.
  const roto = {
    from: () => {
      const q = { select: () => q, in: () => q, is: () => q, not: () => q, order: () => q, range: async () => ({ data: null, error: { message: "caída" }, count: null }) };
      return q;
    },
  };
  const errorOriginal = console.error;
  console.error = () => {};
  const sinPuntajes = await computeCreditScoresForClients(roto, [{ client_id: "a", balance: 10 }], null);
  console.error = errorOriginal;
  check("1g. si la lectura falla no hay puntajes: nunca uno calculado con lo que llegó", Object.keys(sinPuntajes).length === 0, JSON.stringify(sinPuntajes));
}

// ── Part 2: DEV ──────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8").split(/\r?\n/).filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes("vzqppwrwnmlbrxizskdh")) {
  check("2. .env.local apunta a la rama dev", false, "esta suite solo escribe en dev");
} else {
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const CLIENTES = 150;
  const email = `qa-lecturas-${Date.now().toString(36)}@sevenz-qa.test`;
  const hace = (dias) => new Date(Date.now() - dias * 86400000).toISOString();
  let ownerId = null;
  try {
    const { data: u, error: eU } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { business_name: "QA Lecturas", country: "VE", first_name: "QA", last_name: "Lecturas" } });
    if (eU) throw new Error(`createUser: ${eU.message}`);
    ownerId = u.user.id;
    await admin.from("owners").update({ onboarding_completed_at: new Date().toISOString(), whatsapp: null }).eq("id", ownerId);

    const { data: clientes, error: eC } = await admin.from("clients")
      .insert(Array.from({ length: CLIENTES }, (_, i) => ({ owner_id: ownerId, name: `Cliente ${i}`, whatsapp: null })))
      .select("id");
    if (eC) throw new Error(`clients: ${eC.message}`);

    // Ten rows each, with habits that give different scores: paying on time, paying late, and
    // not paying. A client who loses rows to the cut has to come out different.
    const movimientos = clientes.flatMap((c, i) => {
      const base = { client_id: c.id, created_by: ownerId, currency: "USD", amount: 10 };
      const tarde = i % 3 === 1 ? 30 : 0;
      const row = [90, 80, 70, 60, 50].map((d) => ({ ...base, type: "charge", created_at: hace(d), plazo_dias: 7 }));
      if (i % 3 === 2) row.push(...[45, 40, 35, 30, 25].map((d) => ({ ...base, type: "charge", created_at: hace(d), plazo_dias: 7 })));
      else row.push(...[85, 75, 65, 55, 45].map((d) => ({ ...base, type: "payment", created_at: hace(d - tarde) })));
      return row;
    });
    for (let i = 0; i < movimientos.length; i += 500) {
      const { error } = await admin.from("movements").insert(movimientos.slice(i, i + 500));
      if (error) throw new Error(`movements: ${error.message}`);
    }

    const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
    const { data: s, error: eS } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
    if (eS) throw new Error(`sesión: ${eS.message}`);
    const dueno = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${s.session.access_token}` } } });

    const ids = clientes.map((c) => c.id);
    const crudo = await readAllByIds(ids, (b, from, to) => dueno.from("movements").select("id", { count: "exact" }).in("client_id", b).is("deleted_at", null).order("id").range(from, to));
    check("2a. como dueño se leen los 1.500 movimientos", crudo.length === 1500, String(crudo.length));
    const { data: cortado, error: eCorte } = await dueno.from("movements").select("id").in("client_id", ids).is("deleted_at", null);
    check("2b. control: una lectura sin páginas se corta (si no, esta suite no prueba nada)", !eCorte && cortado.length === 1000, eCorte?.message ?? String(cortado?.length));

    const { data: resumen, error: eR } = await dueno.from("client_summary").select("*").eq("owner_id", ownerId);
    if (eR) throw new Error(`client_summary: ${eR.message}`);
    check(`2c. client_summary trae a los ${CLIENTES} clientes`, resumen.length === CLIENTES, String(resumen.length));

    const lista = await computeCreditScoresForClients(dueno, resumen, null);

    // The client's own page: one client, one read. Same inputs as the batch.
    const distintos = [];
    for (let i = 0; i < resumen.length; i += 25) {
      await Promise.all(resumen.slice(i, i + 25).map(async (r) => {
        const { data: movs } = await dueno.from("movements")
          .select("id, client_id, type, amount, currency, created_at, plazo_dias, applies_to_movement_id")
          .eq("client_id", r.client_id).is("deleted_at", null);
        const ficha = computeCreditScore({
          movements: movs ?? [], balance: r.balance, daysSincePayment: r.days_since_payment,
          worstChargeAt: r.worst_unpaid_charge_at ?? null, worstChargePlazoDias: r.worst_unpaid_charge_plazo_dias ?? null,
          worstChargeDueAt: r.worst_unpaid_charge_due_at ?? null, isFlagged: r.is_flagged, mostRecentUnflaggedAt: null,
        });
        const enLista = lista[r.client_id];
        if (!enLista || enLista.score !== ficha.score || enLista.tier !== ficha.tier) {
          distintos.push(`${r.name}: lista ${enLista?.score}/${enLista?.tier}, ficha ${ficha.score}/${ficha.tier}`);
        }
      }));
    }
    check(`2d. el puntaje de la lista es el de la ficha en los ${CLIENTES} clientes`, distintos.length === 0, `${distintos.length} distintos · ${distintos.slice(0, 3).join(" · ")}`);
    const niveles = new Set(Object.values(lista).map((x) => x.tier));
    check("2e. los hábitos dan puntajes distintos (si todos fueran iguales, 2d no probaría nada)", niveles.size >= 2, [...niveles].join(", "));

    // PL-34: Reportes over the same 1,500 rows. Every charge and payment is $10 inside the last
    // 100 days: 150 clients × 5 charges, plus 5 more for one in three, is $10,000 lent; the
    // other two in three pay 5 times, $5,000. Read in one request, the period stopped at the
    // first 1,000 rows and summed less, with nothing on screen saying so.
    const rango = { desde: new Date(Date.now() - 100 * 86400000), hasta: new Date() };
    const informe = await cargarFacturacion({ supabase: dueno, ownerId, rango, dosLibros: true, effectiveRate: null });
    check(
      "2g. Reportes suma los 1.500: $10.000 fiados y $5.000 abonados",
      Math.round(informe.fiados.USD ?? 0) === 10000 && Math.round(informe.abonos.USD ?? 0) === 5000,
      `fiados ${informe.fiados.USD} · abonos ${informe.abonos.USD}`,
    );

    const { count: envios } = await admin.from("whatsapp_sends").select("id", { count: "exact", head: true }).eq("owner_id", ownerId);
    check("2f. ningún envío de WhatsApp", envios === 0, String(envios));
  } catch (e) {
    check("2. la suite corrió entera", false, e instanceof Error ? e.message : String(e));
  } finally {
    if (ownerId) await admin.auth.admin.deleteUser(ownerId);
    const { count } = await admin.from("owners").select("id", { count: "exact", head: true }).eq("email", email);
    check("3. limpieza: el negocio de prueba ya no existe", count === 0, String(count));
  }
}

const ok = filas.filter(Boolean).length;
console.log(`\n${ok}/${filas.length} pasan.`);
process.exit(ok === filas.length ? 0 : 1);
