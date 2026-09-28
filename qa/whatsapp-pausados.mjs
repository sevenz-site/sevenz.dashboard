// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local. NO escribe nada.
//
// Comprueba el enrutado de `cartera_pausada` (migración 072), que es la
// decisión del 2026-09-25 hecha código: a una cuenta pausada SÍ se le escribe,
// pero no el mensaje de un dueño al día.
//
// LO QUE VIGILA, y por qué cada cosa:
//
//   1. Que `pausado` llegue como COLUMNA y no como filtro. Si alguien lo
//      convierte en filtro, el pausado desaparece de la lista y deja de
//      recibir nada — y eso se vería como "todo bien", porque no hay error:
//      simplemente hay menos filas. Es el fallo silencioso de este cambio.
//
//   2. Que `pausado` coincida con `owner_puede_escribir()` negado. Son dos
//      caminos al mismo hecho y si divergen, alguien recibe la plantilla
//      equivocada: o un bloqueado al que se le invita a registrar movimientos
//      que no puede registrar, o uno al día al que se le dice que su cuenta
//      está pausada.
//
//   3. Que la puerta siga cerrada. Un `create or replace` vuelve a conceder
//      EXECUTE a anon y authenticated, y estas funciones devuelven el TELÉFONO
//      DE TODOS LOS DUEÑOS. Si el revoke se olvidara en un reemplazo futuro,
//      esto lo caza.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

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
  console.error(`REFUSING TO RUN. .env.local apunta a "${ref}", no a la rama dev (${DEV_REF}).`);
  process.exit(1);
}

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

// ── la puerta ───────────────────────────────────────────────────────────
for (const fn of ["whatsapp_destinatarios_resumen", "whatsapp_destinatarios_atencion"]) {
  const { error } = await anon.rpc(fn);
  check(`anon NO puede llamar a ${fn}()`, !!error, error ? error.code : "LO CONSIGUIO");
}

// ── la columna existe y es booleana ─────────────────────────────────────
const { data: resumen, error: eR } = await admin.rpc("whatsapp_destinatarios_resumen");
if (eR) {
  console.error("no se pudo leer el resumen:", eR.message);
  process.exit(1);
}
const { data: atencion, error: eA } = await admin.rpc("whatsapp_destinatarios_atencion");
if (eA) {
  console.error("no se pudo leer atencion:", eA.message);
  process.exit(1);
}

check(
  "el resumen devuelve `pausado` en todas las filas",
  resumen.length > 0 && resumen.every((d) => typeof d.pausado === "boolean"),
  `${resumen.length} destinatarios`,
);
check(
  "atencion devuelve `pausado` en todas las filas",
  atencion.every((d) => typeof d.pausado === "boolean"),
  `${atencion.length} destinatarios`,
);

// ── es columna, no filtro ───────────────────────────────────────────────
//
// Si fuera filtro, ningún pausado estaría en la lista. Solo se puede afirmar
// cuando hay alguno bloqueado de verdad; si no lo hay, se dice, en vez de
// dar por buena una comprobación que no se hizo.
const { data: bloqueadas } = await admin
  .from("subscriptions")
  .select("owner_id")
  .eq("estado", "bloqueada");
const idsBloqueados = new Set((bloqueadas ?? []).map((s) => s.owner_id));
const pausadosEnLista = resumen.filter((d) => d.pausado);

if (idsBloqueados.size === 0) {
  console.log(
    "SKIP  es columna y no filtro  — no hay ninguna cuenta bloqueada en dev, " +
      "asi que esta comprobacion no puede hacerse. Bloquea una desde /admin y repite.",
  );
} else {
  const conConsentimiento = resumen.map((d) => d.owner_id);
  const bloqueadosQueAceptaron = [...idsBloqueados].filter((id) => conConsentimiento.includes(id));
  check(
    "es columna y no filtro: un bloqueado sigue en la lista",
    bloqueadosQueAceptaron.length > 0,
    `${bloqueadosQueAceptaron.length} bloqueados con avisos activos siguen en la lista`,
  );
}

// ── coincide con owner_puede_escribir() ─────────────────────────────────
let divergencias = 0;
for (const d of resumen) {
  const { data: puede } = await admin.rpc("owner_puede_escribir", { p_owner: d.owner_id });
  if (puede === !d.pausado) continue;
  divergencias++;
  console.log(`      divergencia: owner ${d.owner_id.slice(0, 8)} pausado=${d.pausado} puede_escribir=${puede}`);
}
check(
  "`pausado` coincide con owner_puede_escribir() negado",
  divergencias === 0,
  `${resumen.length} dueños revisados`,
);

// ── qué plantilla le tocaría a cada uno ─────────────────────────────────
const aPausada = pausadosEnLista.length;
const aResumen = resumen.length - aPausada;
const atencionSaltados = atencion.filter((d) => d.pausado).length;
console.log(
  `\nREPARTO  cartera_summary: ${aResumen} · cartera_pausada: ${aPausada} · ` +
    `atencion se salta: ${atencionSaltados}`,
);

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${fallos} FALLO(S) de ${filas.length}`);
process.exit(fallos === 0 ? 0 : 1);
