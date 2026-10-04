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
// WCAG llama "grande" a >=18pt (24px) o >=14pt en negrita, y le baja el piso a
// 3:1. No es un atajo: a ese tamano el trazo es grueso y se lee con menos
// contraste. Aplicar 4,5 a un texto de 24px es medir contra un piso que no es
// el suyo — y esta linea existe porque este script lo hizo, y casi me lleva a
// "arreglar" un placeholder que ya cumplia con margen.
const AA_TEXTO_GRANDE = 3;
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
    AA_TEXTO_GRANDE,
    "exchange-rate-strip, text-2xl = 24px = texto grande",
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

// ────────────────────────────────────────────────────────────────────────
// THE DARK INICIO HEADER — as built (delivery 2, 2026-10-03)
//
// These rows were the component's SPECIFICATION before it was written: two of
// them decided how it had to be written, and they stay here so it shows if
// anyone undoes them. They now measure what `home-header.tsx` and
// `client-search-cartera.tsx` actually draw, with the final tokens.
console.log("");
console.log("── LA CABECERA DEL INICIO (Entrega 2), sobre --brand-primary #272727");
{
  const cab = hexASrgb("#272727");          // --brand-primary
  const campo = hexASrgb("#525252");        // --brand-field
  const borde = hexASrgb("#a1a1a1");        // --brand-field-border
  const sec = hexASrgb("#dadada");          // --brand-secondary
  const blanco = [1, 1, 1];
  const rojo = ok(0.577, 0.245, 27.325);    // --destructive, the unread badge

  const f = (nombre, r, piso, nota = "") => {
    const pasa = r >= piso;
    const m = (r - piso).toFixed(2);
    console.log(
      `   ${pasa ? "PASA " : "FALLA"}  ${r.toFixed(2)}:1  (piso ${piso})  margen ${m >= 0 ? "+" : ""}${m}  ${nombre}${nota ? "  — " + nota : ""}`,
    );
  };

  f("saludo en blanco, text-2xl", ratio(blanco, cab), AA_TEXTO);
  f("negocio y ultima conexion, white/70", ratio(sobre(blanco, cab, 0.7), cab), AA_TEXTO);
  f("Notificaciones y menu, blanco", ratio(blanco, cab), AA_TEXTO);
  f("anillo de foco white/40 sobre la cabecera", ratio(sobre(blanco, cab, 0.4), cab), AA_NO_TEXTO,
    "el de los tres controles de la cabecera");
  f("hover white/10 sobre la cabecera", ratio(sobre(blanco, cab, 0.1), cab), 1,
    "solo informativo: un hover no tiene piso, pero tiene que notarse");
  f("--brand naranja (en el logo)", ratio(hexASrgb("#f66b02"), cab), AA_TEXTO, "el mas justo de la cabecera");

  // THE UNREAD BADGE. It is a graphic that means something — "you have
  // notifications" — so WCAG 1.4.11 asks it for 3:1 against what is behind it.
  // It passes on its own, which is why it carries no ring: an earlier version
  // added one "because the red did not reach 3:1", and that was wrong twice —
  // the red does reach it, and the ring was the header's exact colour.
  f("contador rojo contra la cabecera, SIN anillo", ratio(rojo, cab), AA_NO_TEXTO,
    "por eso lleva ring-2 ring-brand-primary");
  f("numero blanco dentro del contador", ratio(blanco, rojo), AA_TEXTO);

  // THE SEARCH FIELD'S BORDER CARRIES WEIGHT. The field's fill barely separates
  // from the header: what makes it perceptible is the 2px border, not the
  // background. Whoever removes that border leaves an invisible field, and the
  // failure will look like "the search box is missing" rather than a colour
  // problem.
  f("relleno del campo contra la cabecera", ratio(campo, cab), AA_NO_TEXTO,
    "por eso el borde de 2px NO es decorativo");
  f("borde #a1a1a1 de 2px contra la cabecera", ratio(borde, cab), AA_NO_TEXTO,
    "--brand-field-border, fijo en los dos temas");
  f("borde blanco al enfocar", ratio(blanco, cab), AA_NO_TEXTO);

  console.log("");
  console.log("   dentro del buscador (relleno --brand-field #525252)");
  f("texto escrito, #DADADA", ratio(sec, campo), AA_TEXTO);
  f("placeholder #DADADA a opacidad completa", ratio(sec, campo), AA_TEXTO,
    "es la razon de no usar placeholder:text-muted-foreground");
  f("lupa y aspa, #DADADA", ratio(sec, campo), AA_NO_TEXTO);
  // THE PLACEHOLDER CANNOT BE DIMMED. It is what every input in this repo does
  // by default, and here it fails at ANY opacity — even at 80%.
  for (const a of [0.5, 0.6, 0.7, 0.8]) {
    f(`si se atenuara al ${a * 100}%`, ratio(sobre(sec, campo, a), campo), AA_TEXTO,
      "NO es una opcion");
  }
  // The 0/4/4 inset shadow darkens the fill's top edge. Darkening the
  // background of LIGHT text raises its contrast rather than lowering it: the
  // shadow cannot break the text. What it worsens is the fill's separation from
  // the header, and the border takes care of that.
  f("texto #DADADA sobre el relleno con la sombra interior",
    ratio(sec, sobre([0, 0, 0], campo, 0.25)), AA_TEXTO,
    "la sombra SUBE este contraste");
  f("relleno con sombra interior contra la cabecera",
    ratio(sobre([0, 0, 0], campo, 0.25), cab), AA_NO_TEXTO,
    "empeora, y es justo lo que el borde cubre");
}

console.log("");
console.log("Nota: la ultima fila es informativa. `bg-secondary` es una superficie sin");
console.log("borde propio, asi que no tiene que separarse del fondo para cumplir WCAG —");
console.log("pero si no se separa, un boton secundario se vuelve invisible sobre blanco,");
console.log("que es un problema de uso aunque no sea una infraccion.");
