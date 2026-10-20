// LOS TRES ESTADOS DEL PLAZO, montados sobre los fixtures de
// `qa/fixtures-venta-mixta.mjs`: «Dentro del plazo», «Plazo vencido» y
// «Pagado».
//
// ===========================================================================
// POR QUÉ ESTO ES UN GUION APARTE
//
// Hace DOS cosas de naturalezas distintas y mezclarlas sería mentir sobre lo
// que hay en la base:
//
//   · ABONA DE VERDAD, por `registrarAbonoDirigido` con la sesión del dueño.
//     Eso es un registro real, igual que si el tendero lo hubiera tecleado.
//   · RETRASA FECHAS con la clave de servicio. Eso NO lo puede hacer la app, y
//     es la única forma de ver un plazo vencido sin esperar dos semanas.
//
// Lo segundo deja filas que ninguna acción habría escrito así. Por eso vive en
// su propio archivo, con su propio nombre, y por eso lo imprime en voz alta al
// terminar: quien audite estos datos tiene que poder distinguir lo que la app
// hizo de lo que yo moví a mano.
//
// SOLO CONTRA LA RAMA DEV (`vzqppwrwnmlbrxizskdh`). Se niega si no.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const DEV_REF = "vzqppwrwnmlbrxizskdh";
const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
if (ref !== DEV_REF) {
  console.error(`Solo contra la rama DEV (${DEV_REF}). .env.local apunta a ${ref}.`);
  process.exit(1);
}

const BASE = process.env.QA_BASE_URL ?? "http://localhost:3000";
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function idDeLaAccion(base, nombre, cookie, ruta) {
  const html = await (await fetch(`${base}${ruta}`, { headers: { Cookie: cookie } })).text();
  const chunks = [...html.matchAll(/\/_next\/static\/chunks\/[^"']+?\.js/g)].map((m) => m[0]);
  const re = new RegExp(`"([0-9a-f]{40,})"[^()]{0,200}?"${nombre}"`);
  for (const c of [...new Set(chunks)]) {
    let t;
    try {
      t = await (await fetch(`${base}${c}`)).text();
    } catch {
      continue;
    }
    const m = re.exec(t);
    if (m) return m[1];
  }
  return null;
}

function objetoDeLaRespuesta(texto) {
  const i = texto.indexOf('{"ok":');
  if (i < 0) return null;
  let prof = 0;
  let enCadena = false;
  let escapado = false;
  for (let j = i; j < texto.length; j++) {
    const c = texto[j];
    if (escapado) { escapado = false; continue; }
    if (c === "\\") { escapado = true; continue; }
    if (c === '"') { enCadena = !enCadena; continue; }
    if (enCadena) continue;
    if (c === "{") prof++;
    else if (c === "}" && --prof === 0) return JSON.parse(texto.slice(i, j + 1));
  }
  return null;
}

const movidoAMano = [];

try {
  const { data: duenio } = await admin
    .from("owners")
    .select("id, email")
    .eq("email", "contactojesusdelgado@gmail.com")
    .single();

  const { data: link } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: duenio.email,
  });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });
  const { data: verificado, error: eOtp } = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: link.properties.hashed_token,
  });
  if (eOtp) throw new Error(`verifyOtp: ${eOtp.message}`);

  const nombreCookie = `sb-${ref}-auth-token`;
  const valor = "base64-" + Buffer.from(JSON.stringify(verificado.session), "utf8").toString("base64url");
  const MAX = 3180;
  const cookie = (
    valor.length <= MAX
      ? [`${nombreCookie}=${valor}`]
      : Array.from({ length: Math.ceil(valor.length / MAX) }, (_, i) =>
          `${nombreCookie}.${i}=${valor.slice(i * MAX, (i + 1) * MAX)}`,
        )
  ).join("; ");

  // ── LOS FIADOS DE LOS FIXTURES, buscados por el nombre del cliente ──────
  async function fiadoDe(sufijo) {
    const { data: c } = await admin
      .from("clients")
      .select("id")
      .eq("owner_id", duenio.id)
      .eq("name", `QA MIXTA ${sufijo}`)
      .is("deleted_at", null)
      .maybeSingle();
    if (!c) throw new Error(`falta el cliente «QA MIXTA ${sufijo}» — corre antes qa/fixtures-venta-mixta.mjs`);
    const { data: m } = await admin
      .from("movements")
      .select("id, amount, currency, created_at, plazo_dias, cuotas")
      .eq("client_id", c.id)
      .eq("type", "charge")
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!m) throw new Error(`«QA MIXTA ${sufijo}» no tiene ningún fiado`);
    return { cliente: c.id, ...m };
  }

  // ── 1. PAGADO AL 100 %, por la acción de verdad ─────────────────────────
  const pagado = await fiadoDe("pagado");
  const accionAbono = await idDeLaAccion(
    BASE,
    "registrarAbonoDirigido",
    cookie,
    `/abonos/nuevo/${pagado.id}/monto`,
  );
  if (!accionAbono) throw new Error("no se encontró el id de registrarAbonoDirigido");

  async function abonar(fiadoId, monto, moneda) {
    const res = await fetch(`${BASE}/abonos/nuevo/${fiadoId}/monto`, {
      method: "POST",
      headers: {
        "Next-Action": accionAbono,
        "Content-Type": "text/plain;charset=UTF-8",
        Cookie: cookie,
      },
      body: JSON.stringify([
        { fiadoId, monto, monedaTecleada: moneda, usarPrevista: false, photoPath: null, descripcion: null },
      ]),
    });
    return objetoDeLaRespuesta(await res.text());
  }

  const { data: abiertos } = await admin.rpc("get_open_charges_for_client", {
    p_client_id: pagado.cliente,
  });
  const pendiente = Number(
    (abiertos ?? []).find((a) => a.movement_id === pagado.id)?.pending ?? 0,
  );

  if (pendiente > 0.005) {
    const r = await abonar(pagado.id, pendiente, pagado.currency);
    console.log(
      r?.ok
        ? `✓ «pagado»: abonados ${pendiente} ${pagado.currency} enteros por la acción real`
        : `✗ «pagado»: ${r?.error ?? "sin respuesta"}`,
    );
  } else {
    console.log(`· «pagado»: ya estaba saldado, no se tocó`);
  }

  // ── 2. PLAZO VENCIDO, retrasando la fecha ───────────────────────────────
  //
  // El fiado de «abono inicial» son 85 USD a 14 días en 2 cuotas. Retrasado 20
  // días, su plazo entero está vencido y sus DOS cuotas también — que es lo
  // que hace falta para ver el chip rojo en la fila y en la tabla.
  const vencido = await fiadoDe("abono inicial");
  const hace20 = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const { error: e1 } = await admin
    .from("movements")
    .update({ created_at: hace20 })
    .eq("id", vencido.id);
  if (e1) throw new Error(`retrasar «abono inicial»: ${e1.message}`);
  movidoAMano.push(`movements.created_at de ${vencido.id} → ${hace20} (eran ${vencido.created_at})`);
  console.log(`✓ «abono inicial»: retrasado 20 días → plazo vencido y sus 2 cuotas también`);

  // ── 3. UNA CUOTA PAGADA Y OTRA VENCIDA, en el mismo fiado ───────────────
  //
  // Sobre el anterior: abonar la mitad deja la cuota 1 cubierta y la 2 al
  // descubierto. El abono va por la acción real; lo único a mano fue la fecha.
  const mitad = Math.round((Number(vencido.amount) / 2) * 100) / 100;
  const r3 = await abonar(vencido.id, mitad, vencido.currency);
  console.log(
    r3?.ok
      ? `✓ «abono inicial»: abonados ${mitad} ${vencido.currency} → cuota 1 cubierta, cuota 2 al descubierto`
      : `✗ «abono inicial»: ${r3?.error ?? "sin respuesta"}`,
  );

  // ── 4. DENTRO DEL PLAZO lo da «mixta» sin tocar nada ────────────────────
  const dentro = await fiadoDe("mixta");
  console.log(`· «mixta»: queda dentro del plazo sin tocarle nada (${dentro.plazo_dias} días)`);

  console.log("\n══ LO QUE MOVÍ A MANO, que ninguna acción habría escrito ══\n");
  for (const l of movidoAMano) console.log(`  ${l}`);
  console.log("\nTodo lo demás de estos clientes lo escribieron `registrarVenta` y");
  console.log("`registrarAbonoDirigido` por HTTP, con la sesión del dueño.\n");
} catch (e) {
  console.error("\nFALLÓ:", e instanceof Error ? e.message : e);
  process.exitCode = 1;
}
