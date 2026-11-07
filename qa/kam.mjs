// KAM, COMMISSION AND THE ACCOUNT'S HISTORY (the owner's request of 2026-11-07).
//
// Part 1 needs no database: the arithmetic of `lib/admin/commission.ts` and the
// sentences of `lib/admin/history.ts`, with the edges that were decided by name.
// Part 2 is DEV ONLY (vzqppwrwnmlbrxizskdh): migration 198 as the server calls it,
// on two throwaway businesses created here and removed at the end.
//
// The owner-session rule of CLAUDE.md, read the other way round: these tables are
// meant to refuse the shopkeeper, so part 2 signs in as one and expects 42501. The
// service key alone could not see that.
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  addDays,
  addMonths,
  commissionDrift,
  commissionFigures,
  countCharges,
  lastCoveredDay,
  proposeCommission,
} from "../lib/admin/commission.ts";
import { auditDetail, auditTitle, commercialTitle, formatYmd, mergeHistory, usd } from "../lib/admin/history.ts";

const filas = [];
const check = (nombre, pasa, detalle = "") => {
  filas.push(Boolean(pasa));
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${pasa || !detalle ? "" : `  — ${detalle}`}`);
};

const base = {
  id: "c1",
  kam_id: "k1",
  kam_name: "Ana Pérez",
  starts_on: "2026-11-17",
  ends_on: "2027-05-16",
  closed_on: null,
  amount_usd: 9.75,
  base_price_usd: 19.5,
  periodicidad: "mensual",
  source_demo_ends_on: "2026-11-16",
  paid_usd: 0,
};
const pago = (on, amount_usd = 19.5) => ({ on, amount_usd });

// ── Part 1: pure ─────────────────────────────────────────────────────────
{
  const p = (over = {}) =>
    proposeCommission({
      today: "2026-11-07",
      demoEndsOn: "2026-11-16",
      paidUntilOn: null,
      priceUsd: 19.5,
      periodicity: "mensual",
      catalogProUsd: 19.5,
      lastEndOn: null,
      ...over,
    });

  check("1a. la propuesta del dueño: inicio al acabar la demo, 50%, 6 meses", p().startsOn === "2026-11-17" && p().endsOn === "2027-05-16" && p().amountUsd === 9.75, JSON.stringify(p()));
  check("1b. seis meses mensuales son 6 cobros y $58,50, no 7", commissionFigures(base, []).charges === 6 && commissionFigures(base, []).totalUsd === 58.5);
  check("1c. trimestral: 2 cobros en 6 meses", countCharges("2026-11-17", "2027-05-16", "trimestral") === 2);
  check("1d. anual: 1 cobro en 6 meses, porque el año se paga el primer día", countCharges("2026-11-17", "2027-05-16", "anual") === 1);
  check("1e. el día 31 no se salta febrero", addMonths("2026-01-31", 1) === "2026-02-28" && addDays("2026-02-28", 1) === "2026-03-01");
  check("1f. precio $0: propone el 50% del Pro, y dice de dónde sale", p({ priceUsd: 0, periodicity: null }).amountUsd === 9.75 && p({ priceUsd: 0, periodicity: null }).baseSource === "catalog");
  check("1g. precio vacío: igual que $0", p({ priceUsd: null, periodicity: null }).baseSource === "catalog");
  check("1h. precio con plan anual: 50% del año", p({ priceUsd: 234, periodicity: "anual" }).amountUsd === 117 && p({ priceUsd: 234, periodicity: "anual" }).periodicity === "anual");
  check("1i. sin demo: el día después de «Pagado hasta»", p({ demoEndsOn: null, paidUntilOn: "2026-12-16" }).startsOn === "2026-12-17" && p({ demoEndsOn: null, paidUntilOn: "2026-12-16" }).startSource === "paid_until");
  check("1j. sin demo ni periodo pagado: hoy", p({ demoEndsOn: null }).startsOn === "2026-11-07" && p({ demoEndsOn: null }).startSource === "today");
  check("1k. después de un acuerdo cerrado, nunca el mismo día", p({ demoEndsOn: null, lastEndOn: "2026-11-07" }).startsOn === "2026-11-08" && p({ demoEndsOn: null, lastEndOn: "2026-11-07" }).startSource === "previous_agreement");

  const f = (payments, over = {}) => commissionFigures({ ...base, ...over }, payments);
  check("2a. solo genera lo que el negocio pagó: 3 pagos, $29,25", f([pago("2026-11-17"), pago("2026-12-17"), pago("2027-01-17")]).generatedUsd === 29.25);
  check("2b. tres meses juntos generan tres, proporcional", f([pago("2026-11-17", 58.5)]).generatedUsd === 29.25);
  check("2c. medio pago genera la mitad", f([pago("2026-11-17", 9.75)]).generatedUsd === 4.88 || f([pago("2026-11-17", 9.75)]).generatedUsd === 4.87, String(f([pago("2026-11-17", 9.75)]).generatedUsd));
  check("2d. un pago antes del inicio no genera", f([pago("2026-11-16")]).generatedUsd === 0);
  check("2e. un pago el último día sí, y el siguiente no", f([pago("2027-05-16")]).generatedUsd === 9.75 && f([pago("2027-05-17")]).generatedUsd === 0);
  check("2f. nunca pasa del total pactado", f([pago("2026-11-17", 1000)]).generatedUsd === 58.5);
  check("2g. pagado de menos: pendiente", f([pago("2026-11-17")], { paid_usd: 5 }).pendingUsd === 4.75 && f([pago("2026-11-17")], { paid_usd: 5 }).advanceUsd === 0);
  check("2h. pagado de más: adelantado, nunca un pendiente negativo", f([pago("2026-11-17")], { paid_usd: 15 }).pendingUsd === 0 && f([pago("2026-11-17")], { paid_usd: 15 }).advanceUsd === 5.25);
  check("2i. cerrar a los 2 meses baja el total a lo alcanzado", f([], { closed_on: "2027-01-20" }).charges === 3 && f([], { closed_on: "2027-01-20" }).totalUsd === 29.25, String(f([], { closed_on: "2027-01-20" }).charges));
  check("2j. un pago después de cerrar no genera", f([pago("2027-02-01")], { closed_on: "2027-01-20" }).generatedUsd === 0);
  check("2k. cerrar antes de empezar: cero, sin romper nada", f([], { closed_on: "2026-11-10" }).totalUsd === 0);
  check("2l. sin decimales de coma flotante: 3 × 0,10", commissionFigures({ ...base, amount_usd: 0.1, base_price_usd: 0.2 }, []).totalUsd === 0.6);

  check("3a. acuerdo cerrado antes de empezar no cuenta como cubierto", lastCoveredDay([{ ...base, closed_on: "2026-11-10" }]) === null);
  check("3b. el último día cubierto de un acuerdo cerrado", lastCoveredDay([{ ...base, closed_on: "2027-01-20" }]) === "2027-01-20");
  check("3c. un acuerdo en curso no se cuenta como cerrado", lastCoveredDay([base]) === null);

  const d = (acc) => commissionDrift(base, { demoEndsOn: "2026-11-16", priceUsd: 19.5, periodicity: "mensual", ...acc });
  check("4a. nada cambió: nada que avisar", d({}).length === 0);
  check("4b. la demo se movió: avisa", d({ demoEndsOn: "2026-11-30" })[0]?.kind === "demo");
  check("4c. la demo ya no existe porque pagó: NO avisa", d({ demoEndsOn: null }).length === 0);
  check("4d. el precio cambió: avisa", d({ priceUsd: 25 })[0]?.kind === "price");
  check("4e. la periodicidad cambió: avisa", d({ priceUsd: 19.5, periodicity: "anual" })[0]?.kind === "price");
  check("4f. precio $0 en un acuerdo sobre el catálogo: NO avisa", d({ priceUsd: 0, periodicity: null }).length === 0);
  check("4g. un acuerdo cerrado no avisa", commissionDrift({ ...base, closed_on: "2027-01-20" }, { demoEndsOn: "2026-11-30", priceUsd: 25, periodicity: "mensual" }).length === 0);

  check("5a. el dinero sale en dólares con coma", usd(9.75) === "$9,75", usd(9.75));
  check("5b. una fecha de calendario no se mueve con la zona", formatYmd("2026-11-17").startsWith("17 nov"), formatYmd("2026-11-17"));
  check("5c. el rótulo nuevo del correo", auditTitle({ action: "recovery_email_resent", detail: {} }) === "Correo para recuperar contraseña reenviado");
  check("5d. los campos del negocio se nombran", auditTitle({ action: "business_profile_changed", detail: { fields: ["logo", "nombre"] } }) === "Datos del negocio cambiados: logo, nombre");
  check("5e. el correo sale enmascarado en el detalle", auditDetail({ actor: "a@x.y", detail: { from: "viejo@example.com", to: "nuevo@example.com" } }) === "a@x.y · v***@example.com → n***@example.com");
  check("5f. el pago al KAM dice a quién y cómo", commercialTitle({ action: "commission_paid", detail: { kam_name: "Ana Pérez", amount_usd: 9.75, method: "zelle" } }) === "Pago a Ana Pérez: $9,75 por Zelle");

  const linea = (over) => ({ id: "1", ocurrido_el: "2026-11-01T10:00:00Z", actor_email: "a@b.c", desde_estado: "demo", hasta_estado: "demo", desde_plan: "free", hasta_plan: "free", motivo: null, metodo_pago: null, monto_usd: null, comprobante_path: null, ...over });
  const h = mergeHistory(
    [linea({ motivo: "Marcado como negocio de prueba" })],
    [{ action: "not_me_confirmed", actor: "owner", at: "2026-11-03T10:00:00Z", detail: {} }],
    [{ id: "9", action: "kam_assigned", actor_email: "a@b.c", detail: { to: "Ana Pérez" }, proof_path: null, at: "2026-11-02T10:00:00Z" }],
  );
  check("6a. las tres tablas en una línea de tiempo, lo más nuevo arriba", h.map((x) => x.title).join("|") === "«No fui yo»: sesiones cerradas|KAM asignado: Ana Pérez|Marcado como negocio de prueba", h.map((x) => x.title).join("|"));
  check("6b. ninguna fila dice «Cambio sin efecto visible» si tiene motivo", !h.some((x) => x.title.includes("sin efecto")));
}

// ── Part 2: DEV ──────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

if (!env.NEXT_PUBLIC_SUPABASE_URL?.includes("vzqppwrwnmlbrxizskdh")) {
  check("7. .env.local apunta a la rama dev", false, "esta suite solo escribe en dev");
} else {
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const anon = () => createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const ACTOR = "qa-kam@example.com";
  const sello = randomUUID().slice(0, 8);
  const creados = [];
  const kamsCreados = [];

  const nuevoDueno = async (nombre) => {
    const email = `qa-kam-${nombre}-${sello}@example.com`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: `Qa-${randomUUID()}`,
      email_confirm: true,
      user_metadata: { business_name: `QA KAM ${nombre}`, country: "VE", first_name: "QA", last_name: "KAM" },
    });
    if (error) throw new Error(error.message);
    creados.push(data.user.id);
    return { id: data.user.id, email };
  };
  const rpc = async (fn, args) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw new Error(`${fn}: ${error.message}`);
    return data;
  };
  const leer = (owner) => rpc("admin_account_commercial", { p_owner: owner });
  const guardar = (owner, over = {}) =>
    rpc("admin_commission_save", {
      p_owner: owner,
      p_commission: null,
      p_starts_on: "2026-11-01",
      p_ends_on: "2027-04-30",
      p_amount_usd: 9.75,
      p_base_price_usd: 19.5,
      p_periodicidad: "mensual",
      p_source_demo_ends_on: null,
      p_actor_email: ACTOR,
      ...over,
    });

  try {
    const A = await nuevoDueno("a");
    const B = await nuevoDueno("b");

    // 7. Who can reach this.
    {
      const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: A.email });
      const dueno = anon();
      const { data: sesion } = await dueno.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
      const comoDueno = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
        global: { headers: { Authorization: `Bearer ${sesion.session.access_token}` } },
      });
      const tablas = ["kams", "account_kam_assignments", "kam_commissions", "kam_commission_payments", "account_feedback", "account_commercial_events"];
      for (const [quien, cliente] of [["anónimo", anon()], ["dueño", comoDueno]]) {
        const rechazos = await Promise.all(tablas.map((t) => cliente.from(t).select("id").limit(1)));
        check(`7a. ${quien}: ninguna de las 6 tablas se puede leer`, rechazos.every((r) => r.error?.code === "42501"), JSON.stringify(rechazos.map((r) => r.error?.code)));
        const fns = await Promise.all([
          cliente.rpc("admin_kam_list"),
          cliente.rpc("admin_account_commercial", { p_owner: A.id }),
          cliente.rpc("admin_kam_assign", { p_owner: A.id, p_kam: null, p_actor_email: "x" }),
          cliente.rpc("admin_account_security_log", { p_owner: A.id }),
        ]);
        check(`7b. ${quien}: ninguna función de /admin se puede ejecutar`, fns.every((r) => r.error), JSON.stringify(fns.map((r) => r.error?.code)));
      }
    }

    // 8. The record.
    const correo = `ana-${sello}@example.com`;
    const crearKam = (email, nombre = "Ana") => rpc("admin_kam_create", { p_first_name: nombre, p_last_name: "Pérez", p_email: email, p_city: "Barquisimeto", p_phone: "+58 412 111 2233" });
    const ana = await crearKam(correo);
    kamsCreados.push(ana.kam_id);
    check("8a. se crea el KAM", ana.ok && ana.kam_id);
    const repetido = await crearKam(correo.toUpperCase());
    check("8b. el mismo correo en mayúsculas no crea otro", repetido.ok === false && repetido.code === "email_taken", JSON.stringify(repetido));

    const sinKam = await guardar(A.id);
    check("8c. sin KAM no hay comisión", sinKam.code === "no_kam", JSON.stringify(sinKam));

    const asignar = (owner, kam) => rpc("admin_kam_assign", { p_owner: owner, p_kam: kam, p_actor_email: ACTOR });
    const r1 = await asignar(A.id, ana.kam_id);
    await asignar(B.id, ana.kam_id);
    check("8d. asignar dice qué hizo", r1.ok && r1.action === "kam_assigned", JSON.stringify(r1));
    check("8e. asignar dos veces el mismo se rechaza", (await asignar(A.id, ana.kam_id)).code === "same_kam");
    check("8f. un KAM que no existe se rechaza", (await asignar(A.id, randomUUID())).code === "no_kam");

    const lista = await rpc("admin_cuentas_lista", {});
    const fila = lista.find((c) => c.owner_id === A.id);
    check("8g. la tabla trae nombre y correo del KAM", fila?.kam_name === "Ana Pérez" && fila?.kam_email === correo, JSON.stringify(fila?.kam_name));
    const libre = lista.filter((c) => !creados.includes(c.owner_id));
    check("8h. la lista sigue devolviendo las demás cuentas, con sus campos de siempre", libre.length > 0 && "se_bloquea_el" in libre[0] && "es_prueba" in libre[0]);
    check("8i. la ficha cuenta sus 2 cuentas", (await leer(A.id)).kam.accounts === 2);

    const editar = await rpc("admin_kam_update", { p_kam: ana.kam_id, p_first_name: "Ana María", p_last_name: "Pérez", p_email: correo, p_city: "Caracas", p_phone: "", p_actor_email: ACTOR });
    const [ea, eb] = await Promise.all([leer(A.id), leer(B.id)]);
    check("8j. editar desde una cuenta cambia las dos", editar.ok && ea.kam.first_name === "Ana María" && eb.kam.first_name === "Ana María");
    check("8k. y queda en el historial de las dos, con los campos", ea.events.some((e) => e.action === "kam_updated") && eb.events.some((e) => e.action === "kam_updated" && e.detail.fields.includes("ciudad")));
    check("8l. el teléfono vacío queda vacío, no como texto", ea.kam.phone === null);
    const sinCambios = await rpc("admin_kam_update", { p_kam: ana.kam_id, p_first_name: "Ana María", p_last_name: "Pérez", p_email: correo, p_city: "Caracas", p_phone: "", p_actor_email: ACTOR });
    check("8m. guardar sin cambios no escribe historial", sinCambios.changed === 0 && (await leer(A.id)).events.filter((e) => e.action === "kam_updated").length === 1);

    // 9. The agreement.
    check("9a. fecha final antes del inicio se rechaza", (await guardar(A.id, { p_ends_on: "2026-10-01" })).code === "bad_dates");
    check("9b. monto cero se rechaza", (await guardar(A.id, { p_amount_usd: 0 })).code === "bad_amount");
    const c1 = await guardar(A.id, { p_source_demo_ends_on: "2026-10-31" });
    check("9c. se guarda el acuerdo", c1.ok && c1.commission_id, JSON.stringify(c1));
    check("9d. una segunda comisión en curso se rechaza", (await guardar(A.id)).code === "already_open");
    const cB = await guardar(B.id);
    const ajena = await guardar(A.id, { p_commission: cB.commission_id, p_amount_usd: 1 });
    check("9e. editar la comisión de OTRA cuenta se rechaza", ajena.code === "no_commission", JSON.stringify(ajena));
    check("9f. y no cambió nada en la otra", Number((await leer(B.id)).commissions[0].amount_usd) === 9.75);
    const pagar = (owner, commission, over = {}) =>
      rpc("admin_commission_pay", { p_owner: owner, p_commission: commission, p_paid_on: "2026-11-07", p_amount_usd: 5, p_method: "zelle", p_note: "", p_actor_email: ACTOR, ...over });
    check("9g. pagar la comisión de OTRA cuenta se rechaza", (await pagar(A.id, cB.commission_id)).code === "no_commission");
    check("9h. pagar cero se rechaza", (await pagar(A.id, c1.commission_id, { p_amount_usd: 0 })).code === "bad_amount");

    const ingresosAntes = await rpc("admin_ingresos_por_mes", { p_meses: 1 });
    const pagoKam = await pagar(A.id, c1.commission_id);
    const ingresosDespues = await rpc("admin_ingresos_por_mes", { p_meses: 1 });
    check("9i. el pago al KAM queda con su línea", pagoKam.ok && pagoKam.evento_id);
    check("9j. y NO cuenta como ingreso de Sevenz", JSON.stringify(ingresosAntes) === JSON.stringify(ingresosDespues));

    // «Dar demo» stores the agreed price in `monto_usd` with no method. It is not a
    // payment, and found by a capture on 2026-11-07: it was generating commission.
    await rpc("admin_dar_demo", { p_owner: B.id, p_dias: 30, p_actor_email: ACTOR, p_notas: null, p_precio_usd: 19.5, p_periodicidad: "mensual" });
    await rpc("admin_cambiar_plan", { p_owner: B.id, p_plan: "pro", p_actor_email: ACTOR, p_periodicidad: "mensual", p_precio_usd: 19.5, p_notas: null });
    check("9j2. dar demo o cambiar de plan NO cuentan como pago del negocio", (await leer(B.id)).account_payments.length === 0, JSON.stringify((await leer(B.id)).account_payments));

    // The first payment of the business clears the demo: the agreement must not care.
    await rpc("admin_registrar_pago", { p_owner: A.id, p_monto_usd: 19.5, p_metodo: "zelle", p_hasta: "2026-12-31T23:59:59-04:00", p_actor_email: ACTOR, p_notas: null });
    const trasPago = await leer(A.id);
    const acuerdo = trasPago.commissions[0];
    const cifras = commissionFigures({ ...acuerdo, amount_usd: Number(acuerdo.amount_usd), base_price_usd: Number(acuerdo.base_price_usd), paid_usd: Number(acuerdo.paid_usd) }, trasPago.account_payments.map((p) => ({ on: p.on, amount_usd: Number(p.amount_usd) })));
    check("9k. el pago borró el fin de la demo y el acuerdo sigue con su fecha", trasPago.demo_ends_on === null && acuerdo.starts_on === "2026-11-01");
    check("9l. el pago del negocio genera $9,75", cifras.generatedUsd === 9.75, JSON.stringify(cifras));
    check("9m. pagado $5, pendiente $4,75", cifras.paidUsd === 5 && cifras.pendingUsd === 4.75, JSON.stringify(cifras));

    const editado = await guardar(A.id, { p_commission: c1.commission_id, p_amount_usd: 10 });
    check("9n. editar queda en el historial con el antes", editado.ok && (await leer(A.id)).events.some((e) => e.action === "commission_updated" && Number(e.detail.before.amount_usd) === 9.75));

    // 10. Changing the KAM.
    const luis = await crearKam(`luis-${sello}@example.com`, "Luis");
    kamsCreados.push(luis.kam_id);
    const cambio = await asignar(A.id, luis.kam_id);
    const trasCambio = await leer(A.id);
    const cerrada = trasCambio.commissions.find((c) => c.id === c1.commission_id);
    check("10a. cambiar de KAM cierra el acuerdo ese día", cambio.action === "kam_changed" && cerrada.closed_on === trasCambio.today, JSON.stringify(cerrada?.closed_on));
    check("10b. el KAM nuevo empieza sin acuerdo", trasCambio.commissions.filter((c) => !c.closed_on).length === 0);
    check("10c. un acuerdo cerrado no se puede editar", (await guardar(A.id, { p_commission: c1.commission_id })).code === "no_commission");
    check("10d. lo pendiente se puede pagar después de cerrar", (await pagar(A.id, c1.commission_id, { p_amount_usd: 4.75 })).ok);
    const solapa = await guardar(A.id, { p_starts_on: trasCambio.today });
    check("10e. el acuerdo nuevo no puede compartir día con el anterior", solapa.code === "overlaps", JSON.stringify(solapa));
    check("10f. al día siguiente sí", (await guardar(A.id, { p_starts_on: addDays(trasCambio.today, 1), p_ends_on: addDays(trasCambio.today, 30) })).ok);
    const quitar = await asignar(A.id, null);
    const trasQuitar = await leer(A.id);
    check("10g. dejar sin KAM cierra también", quitar.action === "kam_removed" && trasQuitar.kam === null && trasQuitar.commissions.every((c) => c.closed_on));
    const fichaAna = (await rpc("admin_kam_list", {})).find((k) => k.id === ana.kam_id);
    check("10h. Ana queda con 1 cuenta", fichaAna?.accounts === 1, JSON.stringify(fichaAna));

    // 11. Feedback and evidence.
    const fb = (over = {}) => rpc("admin_feedback_add", { p_owner: B.id, p_kind: "complaint", p_body: "Tarda en abrir.", p_actor_email: ACTOR, ...over });
    check("11a. un tipo inventado se rechaza", (await fb({ p_kind: "otro" })).code === "bad_kind");
    check("11b. un texto vacío se rechaza", (await fb({ p_body: "   " })).code === "bad_body");
    check("11c. una cuenta que no existe se rechaza", (await fb({ p_owner: randomUUID() })).code === "no_account");
    const nota = await fb();
    check("11d. se guarda", nota.ok && nota.evento_id);
    const adjuntar = (path) => rpc("admin_commercial_attach", { p_event: nota.evento_id, p_path: path });
    check("11e. un archivo de otra cuenta no se pega", (await adjuntar(`${A.id}/x.jpg`)).code === "bad_path");
    check("11f. el de su carpeta sí", (await adjuntar(`${B.id}/x.jpg`)).ok);
    check("11g. y no se puede reemplazar", (await adjuntar(`${B.id}/y.jpg`)).code === "no_event");
    const conAdjunto = await leer(B.id);
    check("11h. la nota y la línea del historial llevan el mismo archivo", conAdjunto.feedback[0].attachment_path === `${B.id}/x.jpg` && conAdjunto.events.find((e) => e.action === "feedback_logged").proof_path === `${B.id}/x.jpg`);

    // 12. The history, whole.
    for (let i = 0; i < 12; i++) {
      await rpc("log_security_audit", { p_owner_id: B.id, p_action: "password_changed", p_actor: "owner", p_detail: {} });
    }
    const bitacora = await rpc("admin_account_security_log", { p_owner: B.id });
    const tarjeta = await rpc("admin_cuenta_seguridad", { p_owner_id: B.id });
    check("12a. el historial tiene las 12; la tarjeta de Seguridad sigue en 10", bitacora.length === 12 && tarjeta.audit.length === 10, `${bitacora.length} y ${tarjeta.audit?.length}`);
    const planB = await rpc("admin_cuenta_historial", { p_owner: B.id });
    const unido = mergeHistory(planB, bitacora, conAdjunto.events);
    check("12b. las tres fuentes salen juntas", unido.length === planB.length + 12 + conAdjunto.events.length && unido.some((l) => l.title === "Feedback: Queja") && unido.some((l) => l.title === "KAM asignado: Ana María Pérez" || l.title.startsWith("KAM asignado")), String(unido.length));
  } catch (e) {
    check("suite completa", false, e instanceof Error ? e.message : String(e));
  } finally {
    // Accounts first: their commissions hold a reference to the KAM.
    for (const id of creados) await admin.auth.admin.deleteUser(id);
    for (const id of kamsCreados) await admin.from("kams").delete().eq("id", id);
    const { data: resto } = await admin.from("kams").select("id").in("id", kamsCreados.length ? kamsCreados : [randomUUID()]);
    check("13. no queda nada de la prueba", (resto ?? []).length === 0, JSON.stringify(resto));
  }
}

const fallos = filas.filter((p) => !p).length;
console.log(`\n${filas.length - fallos} de ${filas.length}`);
process.exit(fallos ? 1 : 0);
