import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// ¿HAY ALGUNA LECTURA DE `catalog_order_items` QUE NO FILTRE LAS BORRADAS?
//
// Desde la migración `161` una línea de pedido se puede QUITAR sin borrarla:
// se marca con `deleted_at`. Eso deja una regla nueva que hay que cumplir en
// NUEVE sitios, y uno de ellos es el que escribe la venta.
//
// LO QUE PASA SI SE OLVIDA NO ES UNA FILA DE MÁS: es que la venta COBRA lo
// que el tendero acaba de quitar, con el cliente delante, sin error y sin
// aviso. Esa es la razón de que esto exista y no un comentario.
//
// NO LLEVA LISTA DE EXCEPCIONES, igual que `qa:suscripciones`: una lista hay
// que mantenerla y una desactualizada falla en silencio. Si algún día hace
// falta leer también las borradas --la tarjeta de «Restaurar» lo hace-- se
// declara en la propia consulta con `.not("deleted_at", "is", null)`, que
// este guion reconoce como filtro explícito.
//
// Solo mira `app/`, `lib/` y `components/`. Los guiones de `qa/` borran de
// verdad sus propios datos de prueba y no tienen por qué filtrar.
//
// No necesita base de datos ni servidor: lee ficheros.

const RAICES = ["app", "lib", "components"];
const EXTENSIONES = [".ts", ".tsx"];

// DOS FORMAS DE LEER LA TABLA, y la segunda es la que se escapa sola: una
// consulta a `catalog_orders` puede traerse sus líneas EMBEBIDAS
// --`.select("id, catalog_order_items(id)")`-- sin nombrar nunca `.from()`.
// Es como la lista de Inicio cuenta los productos de cada pedido, y con las
// quitadas dentro contaría de más.
const FORMAS = ['from("catalog_order_items")', "catalog_order_items("];

function* ficheros(dir) {
  for (const entrada of readdirSync(dir)) {
    if (entrada === "node_modules" || entrada.startsWith(".")) continue;
    const ruta = join(dir, entrada);
    if (statSync(ruta).isDirectory()) yield* ficheros(ruta);
    else if (EXTENSIONES.some((e) => ruta.endsWith(e))) yield ruta;
  }
}

const fallos = [];
let consultas = 0;

for (const raiz of RAICES) {
  for (const ruta of ficheros(raiz)) {
    const texto = readFileSync(ruta, "utf8");
    const vistos = [];
    for (const forma of FORMAS) {
      let desde = 0;
      for (;;) {
        const i = texto.indexOf(forma, desde);
        if (i < 0) break;
        desde = i + forma.length;

        // `from("catalog_order_items")` CONTIENE la segunda forma, así que
        // sin esto la misma consulta se contaría --y se reportaría-- dos
        // veces.
        if (vistos.some((v) => Math.abs(v - i) < 40)) continue;
        vistos.push(i);
        consultas += 1;

        // LA CONSULTA TERMINA EN SU `;`. Mirar un número fijo de caracteres
        // dejaría pasar una consulta larga --con varios `.eq()` y un
        // `.order()`-- que es justo la clase que más encadena.
        const fin = texto.indexOf(";", i);
        const cuerpo = texto.slice(i, fin < 0 ? i + 600 : fin);

        // Escrituras: un `update` o un `delete` sobre esta tabla no filtran
        // por `deleted_at` --el que restaura busca precisamente las
        // borradas-- así que solo se exige a las LECTURAS.
        if (/\.(update|delete|insert|upsert)\s*\(/.test(cuerpo)) continue;

        if (!cuerpo.includes("deleted_at")) {
          const linea = texto.slice(0, i).split("\n").length;
          fallos.push(`${ruta}:${linea}`);
        }
      }
    }
  }
}

if (fallos.length > 0) {
  console.log(
    `\nFALLA — ${fallos.length} lectura(s) de catalog_order_items sin filtrar:\n`,
  );
  for (const f of fallos) console.log(`  ✗ ${f}`);
  console.log(
    "\nUna línea quitada por el tendero seguiría entrando en la venta. Añade",
  );
  console.log(
    '`.is("deleted_at", null)` — o, si de verdad quieres las borradas, dilo con',
  );
  console.log('`.not("deleted_at", "is", null)`.\n');
  process.exit(1);
}

console.log(
  `PASS  ${consultas} lectura(s) de \`catalog_order_items\` en app/, lib/ y components/, todas filtran.`,
);
