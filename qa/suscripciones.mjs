import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ¿HAY ALGÚN `useSyncExternalStore` SIN SUSCRIBIRSE DE VERDAD?
//
// Un `subscribe` que no hace nada compila, pasa el lint y enseña el valor
// correcto la primera vez. Lo único que deja de pasar es que se ACTUALICE —y
// `router.refresh()` no lo salva, porque el servidor no ve el almacenamiento
// del navegador—. Ha costado dos fallos de dinero: ver la cabecera de
// `lib/suscripcion-de-almacenamiento.ts`.
//
// ESTE GUION NO LLEVA LISTA DE EXCEPCIONES, y es deliberado: una lista hay
// que mantenerla y una desactualizada falla en silencio. La excepción se
// declara en el código, importando `leerUnaVezAlEntrar`, cuyo nombre dice qué
// se está eligiendo. Aquí solo se prohíbe escribir el no-op a mano.
//
// No necesita base de datos ni servidor: lee ficheros.

const RAICES = ["app", "components", "lib"];
const EXTENSIONES = [".ts", ".tsx"];

function* ficheros(dir) {
  for (const entrada of readdirSync(dir)) {
    if (entrada === "node_modules" || entrada.startsWith(".")) continue;
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) yield* ficheros(ruta);
    else if (EXTENSIONES.some((e) => ruta.endsWith(e))) yield ruta;
  }
}

// El no-op escrito a mano, en las formas en que se escribe: `() => () => {}`,
// con o sin espacios, y la variante que devuelve una función vacía con
// cuerpo. Lo que NO casa es un identificador --`leerUnaVezAlEntrar`,
// `suscribir`, `suscribirseAlBorrador`-- que es justo lo que se quiere.
const NO_OP = /\(\s*\)\s*=>\s*\(\s*\)\s*=>\s*\{\s*\}/;

// La declaración de una constante que vale un no-op y luego se pasa como
// suscripción: `const sinSuscripcion = () => () => {};`. Es el disfraz que
// tuvo el fallo del 2026-10-26 durante un mes.
const CONSTANTE_NO_OP = /const\s+(\w+)\s*=\s*\(\s*\)\s*=>\s*\(\s*\)\s*=>\s*\{\s*\}/;

const fallos = [];
let revisados = 0;

for (const raiz of RAICES) {
  for (const ruta of ficheros(raiz)) {
    const texto = readFileSync(ruta, "utf8");
    if (!texto.includes("useSyncExternalStore")) continue;
    revisados += 1;

    // 1. El no-op escrito dentro de la propia llamada.
    const lineas = texto.split(/\r?\n/);
    lineas.forEach((linea, i) => {
      if (linea.includes("useSyncExternalStore") && NO_OP.test(linea)) {
        fallos.push(`${ruta}:${i + 1} — suscripción vacía escrita dentro de la llamada`);
      }
    });

    // Y partida en varias líneas, que es como la escribe Prettier.
    const idx = texto.indexOf("useSyncExternalStore(");
    if (idx >= 0) {
      const trozo = texto.slice(idx, idx + 200);
      if (NO_OP.test(trozo)) {
        const linea = texto.slice(0, idx).split(/\r?\n/).length;
        fallos.push(`${ruta}:${linea} — suscripción vacía escrita dentro de la llamada`);
      }
    }

    // 2. La constante local que vale un no-op y se usa como suscripción.
    const m = texto.match(CONSTANTE_NO_OP);
    if (m) {
      const nombre = m[1];
      if (new RegExp(`useSyncExternalStore\\(\\s*${nombre}\\b`).test(texto.replace(/\s+/g, " "))) {
        fallos.push(
          `${ruta} — \`${nombre}\` es un no-op local usado como suscripción. Importa \`leerUnaVezAlEntrar\` de \`@/lib/suscripcion-de-almacenamiento\`, o suscríbete de verdad.`,
        );
      }
    }
  }
}

const unicos = [...new Set(fallos)];
if (unicos.length > 0) {
  console.log(`\nFALLA — ${unicos.length} suscripción(es) vacía(s) escrita(s) a mano:\n`);
  for (const f of unicos) console.log(`  ✗ ${f}`);
  console.log(
    "\nUna suscripción vacía deja la pantalla con el dato viejo, y `router.refresh()`",
  );
  console.log(
    "no lo arregla: el servidor no ve el almacenamiento del navegador. Si de verdad",
  );
  console.log(
    "ese valor no cambia mientras la pantalla vive, dilo importando `leerUnaVezAlEntrar`.\n",
  );
  process.exit(1);
}

console.log(`PASS  ${revisados} ficheros con \`useSyncExternalStore\`, ninguna suscripción vacía a mano.`);
