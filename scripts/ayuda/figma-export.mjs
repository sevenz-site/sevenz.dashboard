// Reads the screen the capture daemon (daemon.mjs) is showing and writes it as layers for
// Figma: boxes with their fill, border, radius and shadow; every text as text, with its
// font, size, weight, colour and line height; icons as SVG; images as files. `figma-build.js`
// turns that into an EDITABLE frame through the Figma desktop bridge.
//
// Why this exists: owner's rule of 2026-11-15, «debe ser 100% editable para poder realizar
// ajustes manuales» (CLAUDE.md, «LOS FRAMES DE FIGMA SE CONSTRUYEN EDITABLES»). A screenshot
// in a frame is not a frame. Reading the live screen keeps the frame faithful to what ships,
// copy included, without redrawing each screen by hand.
//
//   import { exportScreen } from "./figma-export.mjs";
//   await exportScreen(call, "c1-menu", OUT_DIR);
//
// Only what is on screen (the viewport), like the screenshot it replaces.

import { mkdirSync, writeFileSync } from "node:fs";

// Runs INSIDE the page. Returns { w, h, nodes: [...], assets: [{ id, kind, data }] }.
const EXTRACT = `(async () => {
  const W = innerWidth, H = innerHeight;
  const out = [], assets = [];
  let seq = 0;
  const px = (v) => parseFloat(v) || 0;
  // Any CSS colour -- Tailwind 4 computes oklch() and lab(), not rgb() -- read back as
  // RGBA by painting it on one canvas pixel.
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const memo = new Map();
  const rgba = (s) => {
    if (!s || s === 'transparent' || s === 'none') return null;
    if (memo.has(s)) return memo.get(s);
    cx.clearRect(0, 0, 1, 1);
    cx.fillStyle = '#000'; cx.fillStyle = s;
    cx.fillRect(0, 0, 1, 1);
    const d = cx.getImageData(0, 0, 1, 1).data;
    const v = d[3] === 0 ? null : { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: d[3] / 255 };
    memo.set(s, v);
    return v;
  };
  const visible = (el, cs) => cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.01;
  const onScreen = (r) => r.width > 0.5 && r.height > 0.5 && r.right > 0 && r.bottom > 0 && r.left < W && r.top < H;
  const weight = (w) => { const n = parseInt(w, 10) || 400; return n >= 700 ? 'Bold' : n >= 600 ? 'SemiBold' : n >= 500 ? 'Medium' : 'Regular'; };
  const label = (el) => (el.getAttribute('aria-label') || el.getAttribute('data-slot') || el.getAttribute('name') || el.tagName.toLowerCase()).slice(0, 40);
  // Paint order, roughly: a positioned ancestor with a z-index lifts everything inside it.
  const layer = (el) => {
    let z = 0, e = el;
    while (e && e !== document.body) {
      const cs = getComputedStyle(e);
      if (cs.position !== 'static' && cs.zIndex !== 'auto') z = Math.max(z, parseInt(cs.zIndex, 10) || 0);
      if (cs.position === 'fixed' || cs.position === 'sticky') z = Math.max(z, 1);
      e = e.parentElement;
    }
    return z;
  };
  const textStyle = (cs, override) => ({
    font: weight(cs.fontWeight),
    size: px(cs.fontSize),
    lh: cs.lineHeight === 'normal' ? null : px(cs.lineHeight),
    ls: cs.letterSpacing === 'normal' ? 0 : px(cs.letterSpacing),
    color: rgba(override || cs.color),
    align: cs.textAlign === 'center' ? 'CENTER' : cs.textAlign === 'right' || cs.textAlign === 'end' ? 'RIGHT' : 'LEFT',
    upper: cs.textTransform === 'uppercase',
    decoration: cs.textDecorationLine && cs.textDecorationLine.includes('underline') ? 'UNDERLINE' : cs.textDecorationLine && cs.textDecorationLine.includes('line-through') ? 'STRIKETHROUGH' : 'NONE',
  });
  let uid = 0;
  const walk = async (el, depth, owner) => {
    const cs = getComputedStyle(el);
    if (!visible(el, cs)) return;
    if (el.id === '__spot' || el.tagName === 'NEXTJS-PORTAL' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
    const r = el.getBoundingClientRect();
    // Screen-reader-only text (Tailwind's sr-only: 1px, clipped) is never seen.
    if ((r.width <= 1 && r.height <= 1) || cs.clip === 'rect(0px, 0px, 0px, 0px)' || /inset\\(50%\\)/.test(cs.clipPath)) return;
    const opacity = parseFloat(cs.opacity);
    const z = layer(el);
    const box = { x: r.left, y: r.top, w: r.width, h: r.height };
    const tag = el.tagName.toLowerCase();

    if (tag === 'svg') {
      if (!onScreen(r)) return;
      const clone = el.cloneNode(true);
      // AS RGB, NOT AS COMPUTED: Tailwind 4 computes oklch() and lab(), Figma's SVG reader does
      // not understand them and paints the icon black -- the abono and fiado icons came out
      // black in the frames of 2026-11-17 for that reason. (No backticks here: this code lives
      // inside a template literal.)
      const c0 = rgba(cs.color);
      const color = c0 ? 'rgb(' + Math.round(c0.r * 255) + ',' + Math.round(c0.g * 255) + ',' + Math.round(c0.b * 255) + ')' : '#000000';
      clone.setAttribute('width', String(r.width)); clone.setAttribute('height', String(r.height));
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      let s = clone.outerHTML.replace(/currentColor/g, color);
      if (!clone.getAttribute('fill') && cs.fill && !/currentColor/.test(el.getAttribute('fill') || '')) s = s.replace('<svg', '<svg fill="' + (el.getAttribute('fill') || 'none') + '"');
      const id = 'a' + (seq++);
      assets.push({ id, kind: 'svg', data: s });
      out.push({ type: 'svg', name: label(el.parentElement || el), z, opacity, ...box, asset: id, owner });
      return;
    }

    const bg = rgba(cs.backgroundColor);
    const bw = [px(cs.borderTopWidth), px(cs.borderRightWidth), px(cs.borderBottomWidth), px(cs.borderLeftWidth)];
    const bc = rgba(cs.borderTopColor) || rgba(cs.borderBottomColor) || rgba(cs.borderLeftColor);
    const hasBorder = bw.some((b) => b > 0) && bc;
    const radius = px(cs.borderTopLeftRadius);
    let shadow = null;
    if (cs.boxShadow && cs.boxShadow !== 'none') {
      const m = cs.boxShadow.match(/(rgba?\\([^)]+\\))\\s+(-?[\\d.]+)px\\s+(-?[\\d.]+)px\\s+([\\d.]+)px(?:\\s+(-?[\\d.]+)px)?/);
      if (m && rgba(m[1])) shadow = { color: rgba(m[1]), x: +m[2], y: +m[3], blur: +m[4], spread: +(m[5] || 0) };
    }
    const bgImg = cs.backgroundImage && cs.backgroundImage !== 'none' && /url\\(/.test(cs.backgroundImage);
    let mine = owner;
    if (onScreen(r) && (bg || hasBorder || shadow) && tag !== 'html') {
      mine = ++uid;
      out.push({ type: 'box', name: label(el), z, opacity, ...box, fill: bg, stroke: hasBorder ? bc : null,
        strokeW: hasBorder ? Math.max(...bw) : 0, sides: bw, radius, shadow, uid: mine, owner,
        clip: cs.overflow !== 'visible' || cs.overflowX !== 'visible' });
    }

    if (tag === 'img' || bgImg) {
      if (!onScreen(r)) return;
      const src = tag === 'img' ? (el.currentSrc || el.src) : cs.backgroundImage.replace(/^url\\(["']?|["']?\\)$/g, '');
      try {
        const res = await fetch(src);
        const blob = await res.blob();
        const id = 'a' + (seq++);
        if (/svg/.test(blob.type) || /\\.svg(\\?|$)/.test(src)) {
          assets.push({ id, kind: 'svg', data: await blob.text() });
          out.push({ type: 'svg', name: el.getAttribute('alt') || 'imagen', z, opacity, ...box, asset: id, fit: cs.objectFit, owner: mine });
        } else {
          const data = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(blob); });
          assets.push({ id, kind: 'img', data });
          out.push({ type: 'img', name: el.getAttribute('alt') || 'foto', z, opacity, ...box, radius, asset: id,
            fit: tag === 'img' ? cs.objectFit : (cs.backgroundSize === 'contain' ? 'contain' : 'cover'), owner: mine });
        }
      } catch (e) { /* an image that cannot be read stays an empty box */ }
      if (tag === 'img') return;
    }

    if (tag === 'input' || tag === 'textarea') {
      if (!onScreen(r)) return;
      if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file' || el.type === 'hidden' || el.type === 'color') return;
      const value = el.value;
      const text = value || el.placeholder || '';
      if (!text) return;
      const pcs = value ? cs : getComputedStyle(el, '::placeholder');
      const st = textStyle(cs, value ? null : pcs.color);
      const x = r.left + px(cs.paddingLeft) + px(cs.borderLeftWidth);
      // A one-line input centres its text vertically; a textarea starts at its padding.
      const lineH = px(cs.lineHeight) || px(cs.fontSize) * 1.4;
      const y = tag === 'textarea' ? r.top + px(cs.paddingTop) + px(cs.borderTopWidth) : r.top + (r.height - lineH) / 2;
      const w = r.width - px(cs.paddingLeft) - px(cs.paddingRight) - px(cs.borderLeftWidth) - px(cs.borderRightWidth);
      out.push({ type: 'text', name: value ? 'valor' : 'placeholder', z, opacity, x, y, w, h: st.lh || st.size * 1.4,
        text: tag === 'textarea' ? text : text.replace(/\\s+/g, ' '), multiline: tag === 'textarea', ...st, owner: mine });
      return;
    }

    // An element holding only text and plain inline elements (a «{name}» in JSX is three
    // text nodes; «Todas ({n})» is four) becomes ONE text layer: per-node layers lost
    // their spaces and stacked on each other.
    const plainInline = (c) => {
      const s2 = getComputedStyle(c);
      if (!/^inline/.test(s2.display) || /flex|grid|block/.test(s2.display)) return false;
      if (rgba(s2.backgroundColor) || (parseFloat(s2.borderTopWidth) > 0) ) return false;
      if (c.querySelector('svg,img,input,textarea,button')) return false;
      const rr = c.getBoundingClientRect();
      if (rr.width <= 1 && rr.height <= 1) return false;
      return true;
    };
    const kids = [...el.children];
    // A sentence whose words all sit in inline children (the assistant's recommendations are
    // spans and a link, with no loose text) is still a sentence: before 2026-11-17 it fell to
    // one layer per piece, and pieces that wrapped overlapped in the frame.
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) || (kids.length > 0 && el.textContent.trim().length > 0);
    const pre = /pre/.test(cs.whiteSpace);
    // pre-wrap (the assistant's summary) merges too, keeping its line breaks; only true <pre>
    // text, laid out by the browser line by line, stays out.
    const preWrap = cs.whiteSpace === 'pre-wrap' || cs.whiteSpace === 'pre-line';
    if (hasText && (!pre || preWrap) && kids.every(plainInline) && !['svg', 'select'].includes(tag)) {
      // The text, built piece by piece so each piece keeps its own style: «desde 12» is
      // smaller than «Precio al mayor», a <strong> is bold.
      let t = '';
      const segs = [];
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      // Text inside a hidden descendant is not on the screen: the percentage of the rate table is
      // display:none on a phone, and before 2026-11-17 it was merged into the cell anyway and
      // pushed the column into its neighbour in the frame.
      const hiddenUnder = (node) => {
        for (let p = node.parentElement; p && p !== el; p = p.parentElement) {
          const ps0 = getComputedStyle(p);
          if (ps0.display === 'none' || ps0.visibility === 'hidden') return true;
        }
        return false;
      };
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        if (hiddenUnder(n)) continue;
        let piece = preWrap ? n.textContent : n.textContent.replace(/\\s+/g, ' ');
        if (!preWrap && (t.endsWith(' ') || t === '')) piece = piece.replace(/^ /, '');
        if (!piece) continue;
        const start = t.length;
        t += piece;
        const ps = getComputedStyle(n.parentElement);
        // The underline of a link inside a sentence travels with its piece («Ver clientes»).
        const deco = (ps.textDecorationLine || '').includes('underline') ? 'UNDERLINE' : null;
        segs.push({ start, end: t.length, font: weight(ps.fontWeight), size: px(ps.fontSize), color: rgba(ps.color), deco });
      }
      t = preWrap ? t.replace(/\\s+$/, '') : t.replace(/ $/, '');
      const range = document.createRange();
      range.selectNodeContents(el);
      const rects = [...range.getClientRects()].filter((q) => q.width > 0 && q.height > 0);
      if (rects.length && t) {
        const left = Math.min(...rects.map((q) => q.left)), top = Math.min(...rects.map((q) => q.top));
        const right = Math.max(...rects.map((q) => q.right)), bottom = Math.max(...rects.map((q) => q.bottom));
        if (onScreen({ left, top, right, bottom, width: right - left, height: bottom - top })) {
          const st = textStyle(cs);
          // A new line starts where a box begins below the bottom of the line above, not at
          // any change of top: a smaller span on the same line sits a few pixels lower.
          const sorted = [...rects].sort((a, b) => a.top - b.top);
          let lines = 1, lineBottom = sorted[0].bottom;
          for (const q of sorted.slice(1)) {
            if (q.top >= lineBottom - 2) { lines++; lineBottom = q.bottom; } else lineBottom = Math.max(lineBottom, q.bottom);
          }
          const clean = segs.map((g) => ({ ...g, end: Math.min(g.end, t.length) })).filter((g) => g.end > g.start);
          out.push({ type: 'text', name: t.slice(0, 40), z, opacity, x: left, y: top, w: right - left, h: bottom - top,
            text: st.upper ? t.toUpperCase() : t, multiline: lines > 1, ...st, segs: clean, owner: mine });
          // A list item's bullet is a ::marker, not text in the page: drawn as its own layer
          // at the left of the first line, where the browser puts it.
          if (tag === 'li' && cs.listStyleType === 'disc') {
            out.push({ type: 'text', name: 'viñeta', z, opacity, x: left - 12, y: top, w: 6, h: st.lh || st.size,
              text: '•', multiline: false, ...st, decoration: 'NONE', segs: [], owner: mine });
          }
        }
      }
      return;
    }

    // Direct text: one text layer per text node, sized by its own line boxes.
    for (const n of el.childNodes) {
      if (n.nodeType !== 3) continue;
      const pre = /pre/.test(cs.whiteSpace);
      let t = pre ? n.textContent : n.textContent.replace(/\\s+/g, ' ');
      if (!t.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rects = [...range.getClientRects()].filter((q) => q.width > 0 && q.height > 0);
      if (!rects.length) continue;
      const left = Math.min(...rects.map((q) => q.left)), top = Math.min(...rects.map((q) => q.top));
      const right = Math.max(...rects.map((q) => q.right)), bottom = Math.max(...rects.map((q) => q.bottom));
      if (!onScreen({ left, top, right, bottom, width: right - left, height: bottom - top })) continue;
      const st = textStyle(cs);
      if (!pre) t = t.trim();
      out.push({ type: 'text', name: t.slice(0, 40), z, opacity, x: left, y: top, w: right - left, h: bottom - top,
        text: st.upper ? t.toUpperCase() : t, multiline: rects.length > 1, ...st, owner: mine });
    }
    for (const c of el.children) await walk(c, depth + 1, mine);
  };
  const rootCs = getComputedStyle(document.body);
  await walk(document.body, 0, 0);
  return { w: W, h: H, bg: rgba(rootCs.backgroundColor) || { r: 1, g: 1, b: 1, a: 1 }, title: document.title, path: location.pathname, nodes: out, assets };
})()`;

export async function exportScreen(call, name, outDir) {
  mkdirSync(outDir, { recursive: true });
  const data = await call({ op: "eval", expr: EXTRACT });
  const assets = {};
  for (const a of data.assets) {
    if (a.kind === "svg") {
      const file = `${name}-${a.id}.svg`;
      writeFileSync(`${outDir}/${file}`, a.data);
      assets[a.id] = file;
    } else {
      const m = /^data:([^;]+);base64,(.*)$/.exec(a.data);
      if (!m) continue;
      const ext = m[1].includes("png") ? "png" : m[1].includes("webp") ? "webp" : "jpg";
      const file = `${name}-${a.id}.${ext}`;
      writeFileSync(`${outDir}/${file}`, Buffer.from(m[2], "base64"));
      assets[a.id] = file;
    }
  }
  const nodes = data.nodes.map((n) => (n.asset ? { ...n, asset: assets[n.asset] ?? null } : n));
  writeFileSync(`${outDir}/${name}.json`, JSON.stringify({ name, w: data.w, h: data.h, bg: data.bg, path: data.path, nodes }));
  return { name, nodes: nodes.length, assets: Object.keys(assets).length };
}
