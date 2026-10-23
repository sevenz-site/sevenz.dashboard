// ONLY THE DEV BRANCH (vzqppwrwnmlbrxizskdh) — reads .env.local.
//
// WRITES NOTHING. It signs in as two owners and fetches three pages.
//
// ===========================================================================
// WHAT THIS WATCHES: A COLOMBIAN FIADO TELLING THE TRUTH
//
// Two defects, both found in dev on 2026-10-22 while verifying migration 139,
// and both the same mistake: comparing a NULL against a sentinel. The
// Colombian book travels as NULL in `movements` and as 'COP' everywhere else.
//
// 1. BOLIVARES WHERE THERE ARE NONE. The detail printed «Bs. 0,00 al día de
//    la compra» on every Colombian fiado with no down payment.
//    `detalle-de-transaccion.tsx` passed `tasaSellada: … : 0` so that a
//    VENEZUELAN fiado with nothing paid would print «Bs. 0,00», which the
//    owner asked for literally. But `TarjetaDeAbono` decides with
//    `tasaSellada != null`, and `0` is not `null`: any number makes it draw
//    the line, and 0 × 0 is 0.
//
// 2. A DOWN PAYMENT THAT VANISHED, which is the serious one, because it is
//    money. The owner's page summed `sale_payments` filtering with
//    `(p.currency ?? null) === m.currency` — 'COP' against NULL, which never
//    matches. A Colombian fiado of 16.000 with 8.000 handed over at the
//    counter showed the shopkeeper «Abonó $0», while his customer opened the
//    shared link and saw the 8.000. The same fiado, two screens, two
//    different answers about real money.
//
// ===========================================================================
// WHY IT FETCHES PAGES INSTEAD OF CALLING A FUNCTION
//
// There is no function to ask. The decision lives in a component's props, so
// the only place the answer exists is the rendered page. This is the same
// reason `qa/pedidos.mjs` reads as the owner: a suite that only talks to the
// database cannot see what a screen prints.
//
// THE SESSION COMES FROM A MAGIC LINK, no password typed — the pattern
// `qa/fixtures-venta-colombia.mjs` already uses: `generateLink` +
// `verifyOtp`, then the session encoded into the cookie `@supabase/ssr`
// expects, sent as a `Cookie:` header. The chunking is the library's own
// (`createChunks`) and not a hand-rolled copy, so a change to its 3180-byte
// limit cannot silently desync this file.
//
// ===========================================================================
// ROW 3 IS THE ONE THAT MAKES ROWS 1 AND 2 MEAN ANYTHING
//
// Rows 1 and 2 assert that a string is ABSENT, and a string is absent from a
// login page, from a 500, and from an empty response. Row 3 asserts the same
// string is PRESENT for a Venezuelan fiado — so if the fetch stops reaching
// the real screen, row 3 goes red and says so. Without it, breaking the suite
// and fixing the bug look identical from the outside.
//
// Each row also asserts the page is the detail and carries its amount, for
// the same reason: a redirect to /login would otherwise pass rows 1 and 2.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { createChunks } from "@supabase/ssr/dist/main/utils/chunker.js";
import { stringToBase64URL } from "@supabase/ssr/dist/main/utils/base64url.js";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const DEV_REF = "vzqppwrwnmlbrxizskdh";
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== DEV_REF) {
  console.error(`ME NIEGO A CORRER. .env.local apunta a "${ref}", no a la rama dev (${DEV_REF}).`);
  process.exit(1);
}

const BASE = process.env.BASE ?? "http://localhost:3000";

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

// THE OWNER'S COOKIE, exactly as `@supabase/ssr` would have written it.
async function cookieDe(correo) {
  const { data: link, error: eLink } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: correo,
  });
  if (eLink) throw new Error(`generateLink ${correo}: ${eLink.message}`);
  const { data: s, error: eOtp } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (eOtp) throw new Error(`verifyOtp ${correo}: ${eOtp.message}`);
  const valor = "base64-" + stringToBase64URL(JSON.stringify(s.session));
  return createChunks(`sb-${ref}-auth-token`, valor)
    .map((t) => `${t.name}=${t.value}`)
    .join("; ");
}

async function pagina(ruta, cookie) {
  const res = await fetch(`${BASE}${ruta}`, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: "follow",
    cache: "no-store",
  });
  return { estado: res.status, url: res.url, html: await res.text() };
}

// A FIADO OF THAT OWNER WITH THE DOWN PAYMENT WE ASK FOR. Looked up instead
// of hard-coded: a uuid written into this file survives the row it points at
// being deleted from dev, and then the suite tests a 404.
async function fiadoDe(correo, { conAbonoInicial }) {
  const { data: o, error } = await admin
    .from("owners")
    .select("id, email, country")
    .eq("email", correo)
    .single();
  if (error) throw new Error(`dueño ${correo}: ${error.message}`);

  const { data: cls } = await admin.from("clients").select("id").eq("owner_id", o.id);
  const ids = (cls ?? []).map((c) => c.id);
  if (!ids.length) throw new Error(`${correo} no tiene clientes en dev`);

  const { data: ms } = await admin
    .from("movements")
    .select("id, amount, currency, sale_id")
    .in("client_id", ids)
    .eq("type", "charge")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });

  for (const m of ms ?? []) {
    let inicial = 0;
    if (m.sale_id) {
      const { data: ps } = await admin
        .from("sale_payments")
        .select("amount")
        .eq("sale_id", m.sale_id);
      inicial = (ps ?? []).reduce((a, p) => a + Number(p.amount), 0);
    }
    if (conAbonoInicial === inicial > 0.005) {
      return { ...m, inicial, pais: o.country };
    }
  }
  return null;
}

const CO = "companiastartup@gmail.com";
const VE = "qa-libreta-ve@example.com";

// BOTH SESSIONS UP FRONT, and each row uses the one for its own owner. Built
// here rather than where each row needs it so that no row can read as if one
// owner's cookie worked for another's pages.
const cookieCO = await cookieDe(CO);
const cookieVE = await cookieDe(VE);

try {

  // ── 1. EL FIADO COLOMBIANO SIN ABONO INICIAL ────────────────────────
  //
  // The exact case that was broken: the `: 0` branch.
  const sinAbono = await fiadoDe(CO, { conAbonoInicial: false });
  if (!sinAbono) throw new Error(`${CO} no tiene ningún fiado SIN abono inicial en dev`);
  const p1 = await pagina(`/transacciones/${sinAbono.id}`, cookieCO);
  const esLaFicha1 = p1.html.includes("Detalle de transacción") && !p1.url.includes("/login");
  check(
    "1. fiado COLOMBIANO sin abono inicial: ni un bolívar en la pantalla del dueño",
    esLaFicha1 && !p1.html.includes("Bs."),
    !esLaFicha1
      ? `NO SE CARGÓ LA FICHA (${p1.estado}, ${p1.url}) — la fila no mide nada`
      : p1.html.includes("Bs.")
        ? "aparece «Bs.»"
        : `limpia · fiado ${sinAbono.amount}`,
  );

  // ── 2. Y EL QUE SÍ TUVO ABONO INICIAL ───────────────────────────────
  //
  // THIS ROW ONLY BECAME THE OTHER BRANCH once defect 2 was fixed, and that
  // is worth knowing. With the down payment coming back as 0, this fiado took
  // the `: 0` branch like every other Colombian one, so the row was a second
  // copy of row 1 wearing a different name. It was reintroducing defect 1 and
  // watching BOTH rows go red that gave it away — the arithmetic said row 2
  // should have stayed green.
  //
  // Now `abonoInicial` is 8.000, so it takes `? exchangeRateUsed`, which is
  // null for a Colombian movement, and the line stays away for a different
  // reason than row 1's. Both branches have to stay silent.
  const conAbono = await fiadoDe(CO, { conAbonoInicial: true });
  if (conAbono) {
    const p2 = await pagina(`/transacciones/${conAbono.id}`, cookieCO);
    const esLaFicha2 = p2.html.includes("Detalle de transacción") && !p2.url.includes("/login");
    check(
      "2. fiado COLOMBIANO CON abono inicial: tampoco — es la otra rama del mismo ternario",
      esLaFicha2 && !p2.html.includes("Bs."),
      !esLaFicha2
        ? `NO SE CARGÓ LA FICHA (${p2.estado}, ${p2.url}) — la fila no mide nada`
        : p2.html.includes("Bs.")
          ? "aparece «Bs.»"
          : `limpia · abonó ${conAbono.inicial} de ${conAbono.amount}`,
    );
  } else {
    check(
      "2. fiado COLOMBIANO CON abono inicial: tampoco — es la otra rama del mismo ternario",
      false,
      `NO HAY NINGUNO en dev para ${CO} — hace falta uno para cubrir esa rama`,
    );
  }

  // ── 3. EL CONTROL VENEZOLANO ────────────────────────────────────────
  //
  // Read the header: without this row, a suite that has stopped reaching the
  // screen is indistinguishable from a fixed bug.
  const veSinAbono = await fiadoDe(VE, { conAbonoInicial: false });
  if (!veSinAbono) throw new Error(`${VE} no tiene ningún fiado SIN abono inicial en dev`);
  const p3 = await pagina(`/transacciones/${veSinAbono.id}`, cookieVE);
  const esLaFicha3 = p3.html.includes("Detalle de transacción") && !p3.url.includes("/login");
  check(
    "3. CONTROL: el fiado VENEZOLANO sí enseña bolívares — sin esto, 1 y 2 no miden nada",
    esLaFicha3 && p3.html.includes("Bs."),
    !esLaFicha3
      ? `NO SE CARGÓ LA FICHA (${p3.estado}, ${p3.url})`
      : p3.html.includes("Bs.")
        ? `los enseña · fiado ${veSinAbono.amount} ${veSinAbono.currency}`
        : "NO aparece «Bs.» — o el control está mal elegido, o se rompió el caso venezolano",
  );

  // ── 4. Y LA PANTALLA DEL CLIENTE, que es la misma componente ────────
  //
  // Both pages mount `DetalleDeTransaccion` and both pass
  // `currency={m.currency}` from the same column, so one fix covers both. That
  // is a reason to check the pair, not a reason to check only one: the day
  // somebody adds a third call site, this row is what notices.
  const { data: enlace } = await admin
    .from("share_links")
    .select("token")
    .eq("client_id", (await clienteDelMovimiento(sinAbono.id)) ?? "")
    .maybeSingle();
  if (enlace) {
    const p4 = await pagina(`/s/${enlace.token}/t/${sinAbono.id}`, null);
    const esLaFicha4 = p4.html.includes("Detalle de transacción");
    check(
      "4. el mismo fiado colombiano en la pantalla del CLIENTE: tampoco",
      esLaFicha4 && !p4.html.includes("Bs."),
      !esLaFicha4
        ? `NO SE CARGÓ LA FICHA (${p4.estado}, ${p4.url}) — la fila no mide nada`
        : p4.html.includes("Bs.")
          ? "aparece «Bs.»"
          : "limpia",
    );
  } else {
    check(
      "4. el mismo fiado colombiano en la pantalla del CLIENTE: tampoco",
      false,
      "ese cliente no tiene enlace compartido en dev",
    );
  }
  // ── 5 y 6. EL ABONO INICIAL, QUE ES DINERO ──────────────────────────
  //
  // Read off the props React serialises into the page instead of the printed
  // string: `"movementId":"abono-inicial"` carries the `amount` the card was
  // handed, which is the exact value that was wrong. Matching formatted text
  // would make this row fail the day the thousands separator changes, which
  // is not what it is here to notice.
  if (conAbono) {
    const p5 = await pagina(`/transacciones/${conAbono.id}`, cookieCO);
    const enLaPantallaDelDueno = amountDeLaTarjetaInicial(p5.html);
    check(
      "5. el abono inicial COLOMBIANO llega a la pantalla del dueño — no vuelve como 0",
      enLaPantallaDelDueno != null && Math.abs(enLaPantallaDelDueno - conAbono.inicial) < 0.005,
      enLaPantallaDelDueno == null
        ? "NO SE ENCONTRÓ la tarjeta del abono inicial — la fila no mide nada"
        : `la pantalla dice ${enLaPantallaDelDueno} · la venta cobró ${conAbono.inicial}`,
    );

    // THE TWO SCREENS HAVE TO AGREE, and that is a separate row from «each one
    // is right». They are computed in two different places — the owner's page
    // in TypeScript, the client's inside `get_shared_balance` — so nothing but
    // a check keeps them saying the same number about the same fiado. When
    // they disagreed, each side looked perfectly reasonable on its own.
    const { data: cli } = await admin
      .from("movements")
      .select("client_id")
      .eq("id", conAbono.id)
      .single();
    const { data: enlaceConAbono } = await admin
      .from("share_links")
      .select("token")
      .eq("client_id", cli.client_id)
      .maybeSingle();
    if (enlaceConAbono) {
      const { data: compartido } = await anon.rpc("get_shared_balance", {
        p_token: enlaceConAbono.token,
      });
      const delCliente = (compartido?.movements ?? []).find((x) => x.id === conAbono.id);
      const suyo = delCliente == null ? null : Number(delCliente.abono_inicial);
      check(
        "6. y el CLIENTE ve exactamente la misma cifra que el dueño",
        suyo != null &&
          enLaPantallaDelDueno != null &&
          Math.abs(suyo - enLaPantallaDelDueno) < 0.005,
        suyo == null
          ? "el movimiento no viajó en get_shared_balance"
          : `dueño ${enLaPantallaDelDueno} · cliente ${suyo}`,
      );
    } else {
      check("6. y el CLIENTE ve exactamente la misma cifra que el dueño", false, "sin enlace");
    }
  }
} catch (e) {
  check("la suite llegó al final", false, e instanceof Error ? e.message : String(e));
} finally {
  const fallos = filas.filter((f) => !f.pasa).length;
  console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
  if (fallos) process.exitCode = 1;
}

// The `amount` React handed the initial-payment card, pulled out of the RSC
// payload. `movementId` is the synthetic "abono-inicial" the owner's page
// writes for a payment that has no row in `movements`, so it identifies that
// one card and no other.
// BACKSLASHES OUT FIRST. Next serialises the flight data inside a <script>,
// so every quote arrives escaped — the page literally contains
// `\"movementId\":\"abono-inicial\"`. A pattern written against clean JSON
// finds nothing there, and «found nothing» is indistinguishable from «the
// value is 0», which is the bug this row exists to catch. Dropping the
// backslashes first keeps the pattern readable instead of threading `\\?`
// through every quote in it.
function amountDeLaTarjetaInicial(html) {
  const limpio = html.replace(/\\/g, "");
  const m = limpio.match(/"movementId":"abono-inicial"[^}]*?"amount":(-?[\d.]+)/);
  return m ? Number(m[1]) : null;
}

async function clienteDelMovimiento(id) {
  const { data } = await admin.from("movements").select("client_id").eq("id", id).maybeSingle();
  return data?.client_id ?? null;
}
