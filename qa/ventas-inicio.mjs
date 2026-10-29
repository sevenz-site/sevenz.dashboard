// SOLO LA RAMA DEV (vzqppwrwnmlbrxizskdh) — lee .env.local. NO ESCRIBE NADA.
//
// LA CIFRA DE «VENTAS» DEL INICIO CONTRA LA DE REPORTES
//
// El dueño decidió el 2026-10-28 que la tarjeta «Ventas» del Inicio enseñe
// **los últimos 30 días**, con esta razón: es el periodo con el que Reportes
// abre, o sea el mismo al que lleva la tarjeta, y *«la única opción en la que
// las dos pantallas no se contradicen»*.
//
// ═══════════════════════════════════════════════════════════════════════
// POR QUÉ HACE FALTA UNA PRUEBA PARA ESO
//
// Son DOS implementaciones de la misma cifra, y eso es exactamente lo que
// este repo tiene escrito que se separa:
//
//   · `ventasDelPeriodo` --la del Inicio-- hace una consulta corta y suma.
//   · `cargarFacturacion` --la de Reportes-- la calcula en el MISMO recorrido
//     con el que arma el gráfico por días y lo que vino del catálogo, y
//     ademas pide DOS DÍAS de holgura por cada punta para repartir los cubos.
//     Esa holgura no cuenta en el total, y que no cuente es justo lo que se
//     arregló el 2026-10-27 --la pantalla decía $12.142,00 y la base
//     $11.959,00--.
//
// Unificarlas obligaría a Reportes a dar un paseo de más por las mismas
// filas. Así que conviven, y esto es lo que las ata. Es el mismo arreglo que
// `qa:puntaje` para el puntaje de crédito, por la misma razón: dos cuentas de
// lo mismo escritas en dos sitios se separaron una vez y nadie se entera
// hasta que alguien las compara.
//
// SI ESTA SUITE SE PONE ROJA, el Inicio y Reportes están diciendo cifras
// distintas de lo mismo, con un enlace de uno al otro. Es la clase de fallo
// que no revienta nada: el tendero toca la tarjeta y el número cambia.
// ═══════════════════════════════════════════════════════════════════════

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { ventasDelPeriodo } from "../lib/reports/ventas-del-periodo.ts";
import { cargarFacturacion } from "../lib/reports/facturacion.ts";
import { rangoDe } from "../lib/reports/rango.ts";

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

const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const filas = [];
function check(nombre, pasa, detalle) {
  filas.push({ nombre, pasa });
  console.log(`${pasa ? "PASS" : "FAIL"}  ${nombre}${detalle ? `  — ${detalle}` : ""}`);
}

// EL MISMO RANGO QUE LAS DOS PANTALLAS usan por defecto. Si alguien lo cambia
// en `rangoDe`, esta prueba lo sigue solo -- escribir «30 días» a mano aquí
// sería un tercer sitio del que separarse.
const rango = rangoDe({});
console.log(
  `Rango: ${rango.desde.toISOString().slice(0, 10)} … ${rango.hasta.toISOString().slice(0, 10)}\n`,
);

const { data: duenos } = await db.from("owners").select("id, business_name, country");

// SE COMPARAN TODOS LOS DUEÑOS DE DEV, no uno. Un solo negocio podría no
// tener ventas en el rango y las dos cuentas darían cero: dos ceros iguales
// no demuestran nada. Ver abajo la fila que exige que el caso no sea trivial.
let conVentas = 0;
for (const o of duenos ?? []) {
  const { data: rate } = await db
    .from("owners")
    .select("country")
    .eq("id", o.id)
    .single();
  const dosLibros = rate?.country === "VE";

  let deReportes;
  try {
    deReportes = await cargarFacturacion({
      supabase: db,
      ownerId: o.id,
      rango,
      dosLibros,
      clientId: null,
    });
  } catch (e) {
    check(`${o.business_name}: Reportes pudo calcular sus ventas`, false, String(e.message ?? e));
    continue;
  }
  const delInicio = await ventasDelPeriodo({ supabase: db, ownerId: o.id, rango });

  const libros = new Set([
    ...Object.keys(deReportes.ventas ?? {}),
    ...Object.keys(delInicio ?? {}),
  ]);
  const diffs = [];
  for (const l of libros) {
    const a = Number(deReportes.ventas?.[l] ?? 0);
    const b = Number(delInicio?.[l] ?? 0);
    if (Math.abs(a - b) > 0.005) diffs.push(`${l}: Reportes ${a.toFixed(2)} vs Inicio ${b.toFixed(2)}`);
    if (a > 0 || b > 0) conVentas++;
  }
  check(
    `${o.business_name}: Inicio y Reportes dicen lo mismo`,
    diffs.length === 0,
    diffs.length
      ? diffs.join(" · ")
      : [...libros].map((l) => `${l} ${Number(delInicio?.[l] ?? 0).toFixed(2)}`).join(" · ") || "sin ventas",
  );
}

check(
  "el caso de prueba NO es trivial: algún negocio vendió en el rango",
  conVentas > 0,
  conVentas > 0
    ? `${conVentas} libros con ventas`
    : "todos a cero: dos ceros iguales no demuestran que las dos cuentas coincidan",
);

const fallos = filas.filter((f) => !f.pasa).length;
console.log(`\n${filas.length - fallos}/${filas.length} pasan.`);
if (fallos) process.exitCode = 1;
