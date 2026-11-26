// qa:barcodes-normalize (CT-182). The one spelling of a barcode, checked with real cases:
// a 12-digit UPC-A and its 13-digit EAN form must become the same code, a typo in the check
// digit must be caught, and a shop's own alphanumeric label must survive. No database.
//
// Run from dashboard/: `npm run qa:barcodes-normalize`.
import { hasValidCheckDigit, normalizeBarcode, normalizeBarcodeList } from "../lib/barcodes/normalize.ts";

const cases = [
  ["UPC-A de 12 dígitos se guarda como su EAN-13", normalizeBarcode("012345678905") === "0012345678905"],
  ["El mismo producto leído como EAN-13 da el mismo código", normalizeBarcode("0012345678905") === normalizeBarcode("012345678905")],
  ["Espacios y guiones se quitan", normalizeBarcode(" 759-1234 567894 ") === "7591234567894"],
  ["Letras en minúscula pasan a mayúscula", normalizeBarcode("abc-123") === "ABC123"],
  ["Menos de 4 caracteres no es un código", normalizeBarcode("123") === null],
  ["Vacío no es un código", normalizeBarcode("   ") === null],
  ["EAN-13 con dígito de control correcto", hasValidCheckDigit("7591234567894")],
  ["EAN-13 con un dígito cambiado se rechaza", !hasValidCheckDigit("7591234567895")],
  ["EAN-8 correcto (96385074)", hasValidCheckDigit("96385074")],
  ["UPC-A normalizado valida como EAN-13", hasValidCheckDigit(normalizeBarcode("012345678905"))],
  ["Una etiqueta propia alfanumérica no se rechaza", hasValidCheckDigit("ABC123")],
  [
    "La lista quita repetidos (UPC y EAN del mismo) y vacíos",
    JSON.stringify(normalizeBarcodeList(["012345678905", "0012345678905", "", "7591234567894"]).codes) ===
      JSON.stringify(["0012345678905", "7591234567894"]),
  ],
  ["La lista nombra el código inválido", normalizeBarcodeList(["7591234567895"]).invalid[0] === "7591234567895"],
];

// ── THE CAMERA: when a read counts, and how it is set up (2026-11-25) ──
const { createConfirmer, CONFIRM_WITHIN_MS } = await import("../lib/barcodes/confirm.ts");
const { zoomTarget, viewfinderRect, enlargement, tuneCamera, hasTorch, setTorch, OPEN_CONSTRAINTS, VIDEO_CONSTRAINTS, otherBackCameras } = await import("../lib/barcodes/camera-tuning.ts");
const A = "7591058001109";
const B = "0561850001109";
const reads = (list) => {
  const counts = createConfirmer(1500);
  return list.filter(([code, at]) => counts(code, at)).map(([code, at]) => `${code}@${at}`).join(" ");
};
// A camera that records what it is asked for.
const fakeTrack = (caps, { refuse = false, dropSize = false } = {}) => {
  const calls = [];
  let width = 1920;
  return {
    calls,
    getCapabilities: () => caps,
    getSettings: () => ({ width }),
    applyConstraints: async (c) => {
      calls.push(c);
      if (refuse) throw new Error("OverconstrainedError");
      if (dropSize) width = c.width ? 1920 : 640;
    },
  };
};
const withZoom = fakeTrack({ zoom: { min: 1, max: 8 }, focusMode: ["manual", "continuous"], width: { max: 4032 } });
await tuneCamera(withZoom);
const noZoom = fakeTrack({ width: { max: 4032 }, height: { max: 3024 } });
await tuneCamera(noZoom, 1);
const nothing = fakeTrack({ width: { max: 1280 }, height: { max: 720 } });
await tuneCamera(nothing, 1);
const refusing = fakeTrack({ zoom: { min: 1, max: 8 } }, { refuse: true });
let threw = false;
await tuneCamera(refusing).catch(() => (threw = true));
await tuneCamera({}).catch(() => (threw = true));
await tuneCamera(undefined).catch(() => (threw = true));
const dropping = fakeTrack({ zoom: { min: 1, max: 8 } }, { dropSize: true });
await tuneCamera(dropping);
// Android: the capabilities are missing at first.
let asked = 0;
const late = fakeTrack({});
late.getCapabilities = () => (++asked < 3 ? { width: { max: 4032 } } : { zoom: { min: 1, max: 8 }, width: { max: 4032 } });
const lateResult = await tuneCamera(late, 1);
const torchOf = (settingAfter, refuse = false, listed = false) => ({
  calls: [],
  getCapabilities: () => (listed ? { torch: true } : {}),
  getSettings: () => ({ torch: settingAfter }),
  async applyConstraints(c) {
    this.calls.push(c);
    if (refuse) throw new Error("x");
  },
});
const lit = torchOf(true);
// A browser that drops the whole set when one of its members is not its own: only «torch» alone works.
const picky = { on: false, getCapabilities: () => ({}), getSettings: () => ({ torch: picky.on }), async applyConstraints(c) { if (Object.keys(c.advanced[0]).length === 1) picky.on = c.advanced[0].torch; } };
const pickyResult = await setTorch(picky, true, { zoom: 2 }, 1);
// CHROME ON ANDROID, as its source does it: `getSettings` is refreshed only by the call itself, and
// with the state from before that call. The light does change.
const chrome = (listed = true) => {
  const t = { light: false, seen: false, calls: 0, getCapabilities: () => (listed ? { torch: true } : {}), getSettings: () => ({ torch: t.seen }) };
  t.applyConstraints = async (c) => { t.calls++; t.seen = t.light; t.light = c.advanced[0].torch; };
  return t;
};
const android = chrome();
const androidOn = await setTorch(android, true, { zoom: 2 }, 1);
const androidLit = android.light;
const androidOff = await setTorch(android, false, { zoom: 2 }, 1);
// SAFARI: applies in a deferred task.
const safari = { light: false, getCapabilities: () => ({ torch: true }), getSettings: () => ({ torch: safari.light }), async applyConstraints(c) { setTimeout(() => (safari.light = c.advanced[0].torch), 2); } };
const safariOn = await setTorch(safari, true, {}, 5);
await new Promise((d) => setTimeout(d, 10));
const safariLit = safari.light;
const safariOff = await setTorch(safari, false, {}, 5);
const slowUnlisted = { light: false, getCapabilities: () => ({}), getSettings: () => ({ torch: slowUnlisted.light }), async applyConstraints(c) { setTimeout(() => (slowUnlisted.light = c.advanced[0].torch), 4); } };
const slowResult = await setTorch(slowUnlisted, true, {}, 5);
const litResult = await setTorch(lit, true, { zoom: 2, focusMode: "continuous" }, 1);

cases.push(
  ["Cámara: una sola lectura no cuenta", reads([[A, 0]]) === ""],
  ["Cámara: dos lecturas iguales cuentan una vez", reads([[A, 0], [A, 100], [A, 200], [A, 300]]) === `${A}@100`],
  ["Cámara: una lectura falsa suelta no cuenta, y la buena sí", reads([[A, 0], [B, 100], [A, 200], [A, 300]]) === `${A}@300`],
  ["Cámara: dos lecturas iguales muy separadas no cuentan", reads([[A, 0], [A, CONFIRM_WITHIN_MS + 1]]) === ""],
  ["Cámara: el código quieto delante no suma otra unidad", reads(Array.from({ length: 60 }, (_, i) => [A, i * 100])) === `${A}@100`],
  ["Cámara: al quitarlo y volverlo a poner, sí", reads([[A, 0], [A, 100], [A, 1700], [A, 1800]]) === `${A}@100 ${A}@1800`],
  ["Cámara: dos productos seguidos cuentan los dos", reads([[A, 0], [A, 100], [B, 400], [B, 500]]) === `${A}@100 ${B}@500`],
  ["Zoom: 2x si la cámara llega; si tiene gran angular (0.5), también 2x", zoomTarget({ min: 1, max: 8 }) === 2 && zoomTarget({ min: 0.5, max: 10 }) === 2],
  ["Zoom: el máximo de la cámara si no llega a 2x", zoomTarget({ min: 1, max: 1.5 }) === 1.5],
  ["Zoom: en centésimas (Chrome viejo)", zoomTarget({ min: 100, max: 800 }) === 200],
  ["Zoom: ninguno si la cámara no lo tiene", zoomTarget(undefined) === null && zoomTarget({ min: 1, max: 1 }) === null],
  ["Cámara con zoom: enfoque continuo y zoom, sin pedir 4K", withZoom.calls.length === 1 && withZoom.calls[0].advanced[0].zoom === 2 && withZoom.calls[0].advanced[0].focusMode === "continuous" && !withZoom.calls[0].width],
  ["Cámara sin zoom: pide más detalle", noZoom.calls.length === 1 && noZoom.calls[0].width.ideal === 3840],
  ["Cámara sin nada de eso: no se le pide nada", nothing.calls.length === 0],
  ["Cámara que se niega, o que no sabe decir qué tiene: no revienta", !threw],
  ["Cámara que pierde el tamaño al poner el zoom: se le devuelve", dropping.calls.length === 2 && dropping.calls[1].width.ideal === 1920 && dropping.calls[1].advanced[0].zoom === 2],
  ["Recuadro: centrado y dentro de la imagen (vertical a pantalla completa)", (() => {
    const r = viewfinderRect(1080, 1920, 375, 812);
    return r.x >= 0 && r.y >= 0 && r.x + r.width <= 1080 && r.y + r.height <= 1920 && Math.abs(r.x * 2 + r.width - 1080) <= 1;
  })()],
  ["Recuadro: dentro también en la franja de la venta y en una cámara apaisada", [[1080, 1920, 343, 200], [1920, 1080, 343, 200], [640, 480, 375, 812]].every(([w, h, bw, bh]) => {
    const r = viewfinderRect(w, h, bw, bh);
    return r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0 && r.x + r.width <= w && r.y + r.height <= h;
  })],
  ["Capacidades tardías (Android): espera y pone zoom, sin pedir 4K", lateResult.zoom === 2 && late.calls.length === 1 && !late.calls[0].width],
  ["Linterna: la ofrece si la cámara la tiene, y no si no", hasTorch(true) && hasTorch([false, true]) && !hasTorch(undefined) && !hasTorch(false) && !hasTorch([false])],
  ["Linterna: al encenderla conserva zoom y enfoque", litResult === "ok" && lit.calls[0].advanced[0].torch === true && lit.calls[0].advanced[0].zoom === 2 && lit.calls[0].advanced[0].focusMode === "continuous"],
  ["Linterna: si no se apaga (Samsung), lo dice para reabrir la cámara", (await setTorch(torchOf(true), false, {}, 1)) === "stuck" && (await setTorch(torchOf(undefined, true), false, {}, 1)) === "stuck"],
  ["Linterna: si se niega a encender, falla sin reventar", (await setTorch(torchOf(false), true, {}, 1)) === "failed" && (await setTorch(torchOf(undefined, true), true, {}, 1)) === "failed"],
  ["Linterna: si no informa su estado pero dice tenerla, se da por buena", (await setTorch(torchOf(undefined, false, true), true, {}, 1)) === "ok" && (await setTorch(torchOf(undefined), false, {}, 1)) === "ok"],
  ["Linterna: si ni la lista ni informa, no dice «encendida» a oscuras", (await setTorch(torchOf(undefined), true, {}, 1)) === "failed"],
  ["Linterna: si no la lista pero enciende de verdad, vale", (await setTorch(torchOf(true), true, {}, 1)) === "ok"],
  ["Linterna en Chrome Android: enciende aunque el estado llegue atrasado", androidOn === "ok" && androidLit === true],
  ["Linterna en Chrome Android: apaga sin reabrir la cámara", androidOff === "ok" && android.light === false],
  ["Linterna en Safari: enciende y apaga aunque lo aplique después", safariOn === "ok" && safariLit === true && safariOff === "ok" && safari.light === false],
  ["Linterna: si no la lista pero tarda en encender, espera", slowResult === "ok"],
  ["Permisos: la primera petición incluye el zoom, y las demás no", OPEN_CONSTRAINTS.zoom === true && !("zoom" in VIDEO_CONSTRAINTS) && OPEN_CONSTRAINTS.facingMode.ideal === "environment"],
  ["Otra cámara con flash: solo las traseras, sin la actual, hasta 4", (() => {
    const cam = (deviceId, label, kind = "videoinput") => ({ kind, deviceId, label });
    const list = [cam("a", "camera2 1, facing front"), cam("b", "camera2 0, facing back"), cam("c", "camera2 2, facing back"), cam("d", "Cámara trasera"), cam("e", "Back Ultra Wide Camera"), cam("f", "Cámara frontal"), cam("g", "Câmera traseira"), cam("h", "facing back", "audioinput"), cam("", "facing back")];
    return otherBackCameras(list, "c").join() === "b,d,e,g" && otherBackCameras([], "x").length === 0 && otherBackCameras([cam("z", "")], "x").length === 0;
  })()],
  ["Linterna: si el conjunto se descarta, prueba la linterna sola", pickyResult === "ok" && picky.on],
  ["Ampliación: hasta el doble, y nunca reduce", enlargement(400) === 2 && enlargement(3000) === 1],
);

let fails = 0;
for (const [name, ok] of cases) {
  console.log(`${ok ? "✅" : "❌"} ${name}`);
  if (!ok) fails++;
}
console.log(fails ? `\n${fails} fallo(s).` : `\n${cases.length}/${cases.length} bien.`);
process.exit(fails ? 1 : 0);
