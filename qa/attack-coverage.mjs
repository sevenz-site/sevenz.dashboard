// IS EVERY PIECE OF THE ATTACK SURFACE UNDER ATTACK? -- no database, one
// second. Compares what the repo builds (`parseSurface`) with what was
// reviewed (`MANIFEST`) and fails on any difference.
//
// The owner's rule of 2026-11-02: «con cada nueva liberación se debe evaluar
// qué nuevos casos se deben incluir en el qa checklist para no dejar por fuera
// batches de seguridad en esas nuevas funcionalidades». This is that rule as a
// red light: a new table, SECURITY DEFINER function, API route or bucket that
// nobody classified cannot slip into a release, because this suite names it.
//
// What to do when it fails is in the qa-regression-checklist skill, section
// 5b: classify the piece in `qa/attack-surface.mjs` -- which is also what puts
// it under `qa:attack`.
import { parseSurface, MANIFEST } from "./attack-surface.mjs";

const s = parseSurface();
const fallos = [];
const falla = (msg) => fallos.push(msg);

const relaciones = [...s.tables, ...s.views];
for (const t of relaciones) if (!MANIFEST.tables[t]) falla(`tabla o vista nueva sin clasificar: ${t} — ¿cómo llega un atacante a las filas de otro negocio?`);
for (const t of Object.keys(MANIFEST.tables)) if (!relaciones.includes(t)) falla(`la tabla ${t} ya no existe: quítala de MANIFEST.tables`);

for (const [fn, f] of s.definers) {
  const revisado = MANIFEST.definers[fn];
  if (!revisado) falla(`función SECURITY DEFINER nueva sin clasificar: ${fn} (hoy: ${f.exposure}) — se salta la RLS; decide si es service, owner o public`);
  else if (revisado !== f.exposure)
    falla(`${fn}: las migraciones la dejan «${f.exposure}» y lo revisado dice «${revisado}» — o la migración abrió algo que no debía, o la revisión está vieja`);
}
for (const fn of Object.keys(MANIFEST.definers)) if (!s.definers.has(fn)) falla(`la función ${fn} ya no existe (o dejó de ser SECURITY DEFINER): quítala de MANIFEST.definers`);

for (const r of s.routes) if (!MANIFEST.routes[r]) falla(`ruta de API nueva sin clasificar: ${r} — ¿cron, session o public?`);
for (const r of Object.keys(MANIFEST.routes)) if (!s.routes.includes(r)) falla(`la ruta ${r} ya no existe: quítala de MANIFEST.routes`);

for (const b of s.buckets) if (!MANIFEST.buckets[b]) falla(`bucket nuevo sin clasificar: ${b} — ¿private o public-read?`);
for (const b of Object.keys(MANIFEST.buckets)) if (!s.buckets.includes(b)) falla(`el bucket ${b} ya no se crea en ninguna migración: quítalo de MANIFEST.buckets`);

const conteo = `${relaciones.length} tablas y vistas · ${s.definers.size} funciones SECURITY DEFINER · ${s.routes.length} rutas · ${s.buckets.length} buckets`;
if (fallos.length === 0) {
  console.log(`ALL GREEN — superficie cubierta: ${conteo}`);
} else {
  for (const f of fallos) console.log(`FAIL  ${f}`);
  console.log(`\n${fallos.length} pieza(s) fuera del ataque · ${conteo}`);
  process.exit(1);
}
