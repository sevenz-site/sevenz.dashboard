// MEDIR EL CONTRASTE DE LOS TOKENS, EN VEZ DE AFIRMARLO
//
// `DESIGN-SYSTEM.md` tiene una tabla de contrastes medidos y una advertencia
// que este script existe para cumplir: **medir el color que se DIBUJA, no el
// token**. Esa advertencia está ahí porque la fila de `--ring` dijo 2,58:1
// durante meses y el número real era peor — 1,54:1 dibujado al 50% de opacidad.
//
// Una tabla escrita a mano envejece en cuanto alguien toca un token. Esto se
// corre, tarda un segundo y no necesita base de datos.
//
// ─────────────────────────────────────────────────────────────────────────
// QUÉ PIDE WCAG 2.2, Y POR QUÉ SON DOS NÚMEROS
//
//   1.4.3  texto normal                      4.5:1
//          texto grande (≥24px, o ≥18.66px en negrita)   3:1
//   1.4.11 bordes y gráficos que SIGNIFICAN algo          3:1
//
// Un icono decorativo no tiene piso. Uno que dice algo —el anillo de foco, el
// borde de una casilla marcada— sí.

const AA_TEXTO = 4.5;
// AA_NO_TEXTO cubre tambien el texto grande: WCAG les pide el mismo 3:1. Se
// deja un solo nombre en vez de dos constantes iguales — dos nombres para el
// mismo numero invitan a cambiar uno y olvidar el otro.
const AA_NO_TEXTO = 3;

// ── oklch → sRGB ─────────────────────────────────────────────────────────
// Los tokens de este proyecto son casi todos acromáticos (C = 0), pero la
// conversión va completa porque `--destructive` y `--money-in` no lo son, y
// una conversión que solo acierta en los grises es una trampa esperando.
function oklchASrgb(L, C, Hdeg) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  return lin.map((v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, c));
  });
}

function hexASrgb(hex) {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
}

const srgbAHex = (c) =>
  "#" + c.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("");

// ── Contraste WCAG ───────────────────────────────────────────────────────
function luminancia([r, g, b]) {
  const f = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// LO QUE SE DIBUJA CUANDO HAY OPACIDAD. `text-primary-foreground/50` no es el
// token: es el token mezclado con lo que tiene detrás. Medir el token y no la
// mezcla es exactamente el error que costó meses con `--ring`.
const sobre = (frente, fondo, alfa) => frente.map((c, i) => c * alfa + fondo[i] * (1 - alfa));

// Lo mismo que hace `color-mix(in oklch, X, Y N%)` en el hover del botón
// secundario. Se aproxima mezclando en sRGB lineal: para grises acromáticos la
// diferencia con oklch es despreciable, y aquí solo hace falta saber si el
// hover empeora el contraste, no su valor al tercer decimal.
const mezcla = (a, b, p) => a.map((c, i) => c * (1 - p) + b[i] * p);

// ─────────────────────────────────────────────────────────────────────────
const ok = (L, C = 0, H = 0) => oklchASrgb(L, C, H);

const ANTES = {
  primary: ok(0.205),
  secondary: ok(0.97),
};
const DESPUES = {
  primary: hexASrgb("#272727"),
  secondary: hexASrgb("#DADADA"),
};

// Los que NO cambian, y contra los que hay que medir.
const fijo = {
  background: ok(1),
  card: ok(1),
  foreground: ok(0.145),
  primaryForeground: ok(0.985),
  secondaryForeground: ok(0.205),
  mutedForeground: ok(0.556),
};

const filas = [];
const check = (nombre, frente, fondo, piso, nota = "") =>
  filas.push({ nombre, r: ratio(frente, fondo), piso, nota });

for (const [etiqueta, T] of [["ANTES", ANTES], ["DESPUES", DESPUES]]) {
  console.log("");
  console.log(`── ${etiqueta}  (primary ${srgbAHex(T.primary)} · secondary ${srgbAHex(T.secondary)})`);
  filas.length = 0;

  // El botón principal de la app: texto sobre el relleno.
  check("texto sobre bg-primary", fijo.primaryForeground, T.primary, AA_TEXTO);
  // El placeholder del campo de la tira de tasas, al 50% SOBRE el primary.
  check(
    "placeholder /50 sobre bg-primary",
    sobre(fijo.primaryForeground, T.primary, 0.5),
    T.primary,
    AA_TEXTO,
    "exchange-rate-strip",
  );
  // `text-primary` se usa como ICONO sobre fondo claro: piso de 3:1.
  check("icono text-primary sobre fondo blanco", T.primary, fijo.background, AA_NO_TEXTO);
  // `border-primary` / `ring-primary`: bordes con significado.
  check("border-primary sobre blanco", T.primary, fijo.background, AA_NO_TEXTO);

  // El botón y la insignia secundarios.
  check("texto sobre bg-secondary", fijo.secondaryForeground, T.secondary, AA_TEXTO);
  check(
    "texto sobre bg-secondary en hover",
    fijo.secondaryForeground,
    mezcla(T.secondary, fijo.foreground, 0.05),
    AA_TEXTO,
    "button.tsx mezcla 5%",
  );
  // El borde de una superficie secundaria contra la página.
  check("bg-secondary contra el fondo de la pagina", T.secondary, fijo.background, AA_NO_TEXTO,
        "solo informativo: la superficie no lleva borde propio");

  for (const f of filas) {
    const pasa = f.r >= f.piso;
    const margen = (f.r - f.piso).toFixed(2);
    console.log(
      `   ${pasa ? "PASA " : "FALLA"}  ${f.r.toFixed(2)}:1  (piso ${f.piso})  margen ${margen >= 0 ? "+" : ""}${margen}  ${f.nombre}${f.nota ? "  — " + f.nota : ""}`,
    );
  }
}

console.log("");
console.log("Nota: la ultima fila es informativa. `bg-secondary` es una superficie sin");
console.log("borde propio, asi que no tiene que separarse del fondo para cumplir WCAG —");
console.log("pero si no se separa, un boton secundario se vuelve invisible sobre blanco,");
console.log("que es un problema de uso aunque no sea una infraccion.");
