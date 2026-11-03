// CALLING A SERVER ACTION OVER HTTP, THE WAY THE BROWSER DOES -- shared.
//
// Lifted from `qa/venta-accion.mjs` on 2026-11-02 when `qa:sale-rollback`
// needed the same three pieces: an owner's session as a cookie, the action
// id discovered from the chunks the server actually serves, and the result
// cut out of React's flight response. `venta-accion.mjs` keeps its own copy
// on purpose -- it is the suite that found every trap documented here, and
// its comments explain them at length; this file is the short version.
import { createClient } from "@supabase/supabase-js";

// The owner's session, without typing a password: a magic link made with the
// admin API and verified here. Chunked like @supabase/ssr does past ~3180
// characters.
export async function cookieDeDueno(env, ownerId) {
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: u, error } = await admin.auth.admin.getUserById(ownerId);
  if (error || !u?.user?.email) throw new Error(`el dueño ${ownerId} no tiene correo con el que abrir sesión`);
  const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: u.user.email });
  const anon = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: verificado, error: eOtp } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (eOtp) throw new Error(`verifyOtp: ${eOtp.message}`);
  const nombre = `sb-${ref}-auth-token`;
  const valor = "base64-" + Buffer.from(JSON.stringify(verificado.session), "utf8").toString("base64url");
  const MAX = 3180;
  return (valor.length <= MAX
    ? [`${nombre}=${valor}`]
    : Array.from({ length: Math.ceil(valor.length / MAX) }, (_, i) => `${nombre}.${i}=${valor.slice(i * MAX, (i + 1) * MAX)}`)
  ).join("; ");
}

// The action id, asked of the server under test: the page's chunks plus one
// level of the chunks they point at (`next dev` loads the wizard lazily), then
// the COMPLETE `createServerReference` call, bounded to a single parenthesis
// so the id is never paired with the next action's name.
export async function idDeLaAccion(base, pagina, nombre, cookie) {
  const res = await fetch(`${base}${pagina}`, { headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`${pagina} respondió HTTP ${res.status} en ${base}`);
  const html = await res.text();
  const urls = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/[^"]+\.js)"/g)].map((m) => m[1]))];
  if (urls.length === 0) throw new Error(`la página ${pagina} no declara ningún chunk — ¿la sesión no entró y devolvió el login?`);
  const vistos = new Set(urls);
  const textos = new Map();
  for (const u of [...urls]) {
    const r = await fetch(`${base}${u}`);
    if (!r.ok) continue;
    const t = await r.text();
    textos.set(u, t);
    for (const m of t.matchAll(/["'(]((?:\/_next\/)[^"')]+?\.js)["')]/g)) {
      if (!vistos.has(m[1]) && vistos.size < 400) { vistos.add(m[1]); urls.push(m[1]); }
    }
  }
  const re = new RegExp(`"([0-9a-f]{40,})"[^()]{0,200}?"${nombre}"`);
  for (const u of urls) {
    let t = textos.get(u);
    if (t == null) { const r = await fetch(`${base}${u}`); if (!r.ok) continue; t = await r.text(); }
    const m = re.exec(t);
    if (m) return m[1];
  }
  return null;
}

// Calls the action and returns the object that starts with `marcador` inside
// the flight response, cut out by counting braces (a regex stops at the first
// `}` followed by `]`, which inside a nested array is the wrong one). A broken
// transport THROWS instead of returning a rejection: a 404 that reads as
// "rejected" would paint every expected-rejection row green.
export async function llamarAccion(base, pagina, accion, cookie, args, marcador = '{"ok":') {
  const res = await fetch(`${base}${pagina}`, {
    method: "POST",
    headers: { "Next-Action": accion, "Content-Type": "text/plain;charset=UTF-8", Cookie: cookie },
    body: JSON.stringify(args),
  });
  const texto = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} llamando a la acción en ${base} — ¿id equivocado, o esa URL no sirve esta versión?`);
  const i = texto.indexOf(marcador);
  if (i < 0) throw new Error(`respuesta sin resultado legible (HTTP ${res.status}): ${texto.slice(0, 160)}`);
  let prof = 0, enCadena = false, escapado = false;
  for (let j = i; j < texto.length; j++) {
    const c = texto[j];
    if (escapado) { escapado = false; continue; }
    if (c === "\\") { escapado = true; continue; }
    if (c === '"') { enCadena = !enCadena; continue; }
    if (enCadena) continue;
    if (c === "{") prof++;
    else if (c === "}" && --prof === 0) return JSON.parse(texto.slice(i, j + 1));
  }
  throw new Error("respuesta sin cierre del objeto de resultado");
}
