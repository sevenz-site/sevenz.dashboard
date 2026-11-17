// Runs inside Figma (desktop bridge plugin, `figma_execute`), loaded with `fetch` from the
// local server that `figma-export.mjs` writes to. Builds ONE editable frame from one exported
// screen: boxes become frames (fill, border, radius, shadow), texts become text layers in
// Geist, icons become vectors, photos become image fills. Nothing is a screenshot.
//
// Body of a function `(figma, args)`; `args` = { base, file, parentId, x, y, frameName }.

const res = await fetch(args.base + args.file);
const data = await res.json();
const parent = await figma.getNodeByIdAsync(args.parentId);

const STYLES = ["Regular", "Medium", "SemiBold", "Bold"];
const loaded = {};
for (const s of STYLES) {
  try { await figma.loadFontAsync({ family: "Geist", style: s }); loaded[s] = "Geist"; }
  catch (e) { await figma.loadFontAsync({ family: "Inter", style: s === "SemiBold" ? "Semi Bold" : s }); loaded[s] = "Inter"; }
}
const fontOf = (s) => (loaded[s] === "Geist" ? { family: "Geist", style: s } : { family: "Inter", style: s === "SemiBold" ? "Semi Bold" : s });
const paint = (c) => ({ type: "SOLID", color: { r: c.r, g: c.g, b: c.b }, opacity: c.a });

const frame = figma.createFrame();
frame.name = args.frameName;
frame.resize(data.w, data.h);
frame.fills = [paint(data.bg)];
frame.clipsContent = true;
parent.appendChild(frame);
frame.x = args.x;
frame.y = args.y;

// Paint order: by layer, then document order. Each node goes inside the box of its nearest
// ancestor ELEMENT that drew one (`owner`, from the page's own tree), so a card owns its
// texts and a sticky bar owns its buttons. Geometry alone put a button under the bar it sits
// on, inside a field that happened to be behind it.
const nodes = data.nodes.map((n, i) => ({ ...n, i })).sort((a, b) => a.z - b.z || a.i - b.i);
const byUid = new Map();
const place = (node, n) => {
  const h = n.owner ? byUid.get(n.owner) : null;
  const host = h ? h.node : frame;
  host.appendChild(node);
  node.x = n.x - (h ? h.x : 0);
  node.y = n.y - (h ? h.y : 0);
};

let made = 0, failed = 0;
for (const n of nodes) {
  try {
    if (n.type === "box") {
      // A box the size of the whole page (body, layout wrappers) adds nothing the frame
      // does not already have.
      // A see-through one is an overlay (a dialog's dimmed backdrop) and stays.
      if (n.w >= data.w - 1 && n.h >= data.h - 1 && n.x <= 0.5 && n.y <= 0.5 && (!n.stroke) && (!n.shadow) && (!n.fill || n.fill.a > 0.99)) {
        if (n.fill && n.fill.a > 0.99) frame.fills = [paint(n.fill)];
        continue; // its children fall back to the frame: `byUid` has no entry for it
      }
      const f = figma.createFrame();
      f.name = n.name;
      f.resize(Math.max(1, n.w), Math.max(1, n.h));
      f.fills = n.fill ? [paint(n.fill)] : [];
      f.clipsContent = Boolean(n.clip);
      if (n.radius) f.cornerRadius = Math.min(n.radius, Math.min(n.w, n.h) / 2);
      if (n.stroke) {
        f.strokes = [paint(n.stroke)];
        f.strokeAlign = "INSIDE";
        const [t, r, b, l] = n.sides;
        if (t === r && r === b && b === l) f.strokeWeight = n.strokeW;
        else { f.strokeTopWeight = t; f.strokeRightWeight = r; f.strokeBottomWeight = b; f.strokeLeftWeight = l; }
      }
      if (n.shadow) {
        f.effects = [{ type: "DROP_SHADOW", color: { r: n.shadow.color.r, g: n.shadow.color.g, b: n.shadow.color.b, a: n.shadow.color.a },
          offset: { x: n.shadow.x, y: n.shadow.y }, radius: n.shadow.blur, spread: n.shadow.spread, visible: true, blendMode: "NORMAL" }];
      }
      if (n.opacity < 1) f.opacity = n.opacity;
      place(f, n);
      byUid.set(n.uid, { x: n.x, y: n.y, node: f });
      made++;
    } else if (n.type === "text") {
      const t = figma.createText();
      t.fontName = fontOf(n.font);
      t.fontSize = n.size;
      if (n.lh) t.lineHeight = { unit: "PIXELS", value: n.lh };
      if (n.ls) t.letterSpacing = { unit: "PIXELS", value: n.ls };
      t.characters = n.text;
      // Pieces with their own style inside one sentence: a bold word, a smaller «desde 12».
      for (const g of n.segs || []) {
        if (g.end <= g.start || g.end > n.text.length) continue;
        if (g.font !== n.font) t.setRangeFontName(g.start, g.end, fontOf(g.font));
        if (g.size && g.size !== n.size) t.setRangeFontSize(g.start, g.end, g.size);
        if (g.deco) t.setRangeTextDecoration(g.start, g.end, g.deco);
        if (g.color && n.color && (g.color.r !== n.color.r || g.color.g !== n.color.g || g.color.b !== n.color.b || g.color.a !== n.color.a)) {
          t.setRangeFills(g.start, g.end, [paint(g.color)]);
        }
      }
      t.name = n.name || n.text.slice(0, 40);
      if (n.color) t.fills = [paint(n.color)];
      t.textAlignHorizontal = n.align;
      if (n.decoration && n.decoration !== "NONE") t.textDecoration = n.decoration;
      // One line stays one line: it grows to its own width and is aligned by moving it, so a
      // pixel of difference between the browser's and Figma's metrics cannot wrap «$2,00».
      let dx = 0;
      if (n.multiline) {
        t.textAutoResize = "HEIGHT";
        t.resize(Math.max(1, n.w + 2), Math.max(1, n.h));
      } else {
        t.textAutoResize = "WIDTH_AND_HEIGHT";
        if (n.align === "RIGHT") dx = n.w - t.width;
        else if (n.align === "CENTER") dx = (n.w - t.width) / 2;
      }
      if (n.opacity < 1) t.opacity = n.opacity;
      place(t, n);
      t.x += dx;
      made++;
    } else if (n.type === "svg" && n.asset) {
      const src = await (await fetch(args.base + n.asset)).text();
      const v = figma.createNodeFromSvg(src);
      v.name = "icono · " + (n.name || "");
      v.resize(Math.max(1, n.w), Math.max(1, n.h));
      if (n.opacity < 1) v.opacity = n.opacity;
      place(v, n);
      made++;
    } else if (n.type === "img" && n.asset) {
      const bytes = new Uint8Array(await (await fetch(args.base + n.asset)).arrayBuffer());
      const img = figma.createImage(bytes);
      const r = figma.createRectangle();
      r.name = "imagen · " + (n.name || "");
      r.resize(Math.max(1, n.w), Math.max(1, n.h));
      r.fills = [{ type: "IMAGE", imageHash: img.hash, scaleMode: n.fit === "contain" ? "FIT" : "FILL" }];
      if (n.radius) r.cornerRadius = n.radius;
      if (n.opacity < 1) r.opacity = n.opacity;
      place(r, n);
      made++;
    }
  } catch (e) {
    failed++;
  }
}
// ── TIED TO THE DESIGN SYSTEM, NOT RAW COLOURS ─────────────────────────────────────────────
//
// Owner's request of 2026-11-17: «Estilos de color de textos, buttons icons deben ser los ya
// implementados en el design system, veo que en figma el color negro es un poco más
// oscuro/puro», and «Revisa los estilos de lo implementado en figma, y manténlos». Every solid
// fill and stroke is bound to the nearest variable of «Sevenz · Color · App» when it is close
// enough to be that token; a colour with no token near it (the sky of the abono icon) keeps its
// value. TEXT IN NEAR-BLACK IS `primary` (#272727), the text colour of the implemented frames:
// the app renders `foreground` (#0a0a0a), which is the «more pure black» he saw. And each text
// takes the text style of its size and weight when it is one style throughout.
let ligados = 0, estilos = 0;
try {
  const coleccion = (await figma.variables.getLocalVariableCollectionsAsync()).find((c) => c.name === "Sevenz · Color · App");
  const vars = [];
  if (coleccion) {
    for (const id of coleccion.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(id);
      const val = v && v.resolvedType === "COLOR" ? v.valuesByMode[coleccion.defaultModeId] : null;
      // Not the chart or sidebar tokens: a card border tied to «chart-3» because its grey is
      // nearest says nothing true about the card.
      if (val && val.r !== undefined && !/^(chart|sidebar)-/.test(v.name)) vars.push({ v, r: val.r, g: val.g, b: val.b, name: v.name });
    }
  }
  // Names that are aliases of others with the same value: prefer the ones the frames use.
  const PREFERIDOS = ["primary", "muted-foreground", "border", "success", "warning", "destructive", "background", "muted", "secondary", "info", "brand", "subtle"];
  const porNombre = (n) => vars.find((x) => x.name === n);
  const cercano = (c) => {
    let mejor = null, d = Infinity;
    for (const x of vars) {
      const e = Math.hypot((x.r - c.r) * 255, (x.g - c.g) * 255, (x.b - c.b) * 255);
      const pref = PREFERIDOS.includes(x.name) ? -0.5 : 0;
      if (e + pref < d) { d = e + pref; mejor = x; }
    }
    return d <= 14 ? mejor : null;
  };
  const casiNegro = (c) => c.r < 0.12 && c.g < 0.12 && c.b < 0.12;
  const ligar = (paints, esTexto) => {
    if (!Array.isArray(paints)) return paints;
    let cambio = false;
    const out = paints.map((p) => {
      if (p.type !== "SOLID") return p;
      const x = esTexto && casiNegro(p.color) ? porNombre("primary") : cercano(p.color);
      if (!x) return p;
      cambio = true;
      ligados++;
      return figma.variables.setBoundVariableForPaint(p, "color", x.v);
    });
    return cambio ? out : paints;
  };
  const textStyles = await figma.getLocalTextStylesAsync();
  const estiloDe = (size, style) =>
    textStyles.find((t) => t.name.startsWith("Texto/") && t.fontSize === size && t.fontName.family === "Geist" && t.fontName.style === style);
  for (const node of frame.findAll(() => true)) {
    if ("fills" in node && node.fills !== figma.mixed) node.fills = ligar(node.fills, node.type === "TEXT");
    else if (node.type === "TEXT") {
      // A sentence with pieces in other colours (an amount in green): bind each piece.
      for (const seg of node.getStyledTextSegments(["fills"])) node.setRangeFills(seg.start, seg.end, ligar(seg.fills, true));
    }
    if ("strokes" in node) node.strokes = ligar(node.strokes, false);
    // Not on an underlined text: a text style carries «no decoration» and would wipe the link's
    // underline.
    if (node.type === "TEXT" && node.fontName !== figma.mixed && node.fontSize !== figma.mixed && node.textDecoration === "NONE") {
      const st = estiloDe(node.fontSize, node.fontName.style);
      if (st) {
        await node.setTextStyleIdAsync(st.id);
        estilos++;
      }
    }
  }
} catch (e) {
  // A frame with raw colours is still a frame: report it, do not lose the build.
  return { frameId: frame.id, made, failed, total: nodes.length, ligados, estilos, errorDS: String(e) };
}
return { frameId: frame.id, made, failed, total: nodes.length, ligados, estilos };
