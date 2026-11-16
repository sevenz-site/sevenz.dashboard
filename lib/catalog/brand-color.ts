// THE OWNER'S BRAND COLOUR, AND WHAT IS WRITTEN ON TOP OF IT (CT-170, phase 1).
//
// Owner's decisions of 2026-11-12, frames `2115:21736`, `2115:21772` and `2115:21921`:
//   - the owner picks ONE colour; the app does the rest;
//   - text and icons on that colour are either `primary` (#272727) or `secondary`
//     (#DADADA), whichever reaches WCAG 2.0 AA for normal text, 4.5:1;
//   - for the band of medium colours where NEITHER reaches it (red #FF0000 gives 3.74 and
//     2.86, blue #1E88E5 4.06 and 2.63), «ajustarlo y avisar»: the app moves the colour's
//     lightness by the least it takes for one of the two to pass, and says so before
//     saving;
//   - the brand colour is never used as text on the white of the page (a yellow such as
//     #E7F701 gives 1.19:1 there). That rule lives in the screens: this module only ever
//     answers what goes ON the colour.
//
// ONE FUNCTION FOR BOTH SIDES. The owner's screen calls it to show the notice, the server
// action calls it again before saving (the browser is never trusted with what is stored),
// and the customer's catalogue calls it to pick the text colour. Computed in one place,
// the notice cannot promise a colour that the catalogue then draws differently.

export const BRAND_TEXT_PRIMARY = "#272727";
export const BRAND_TEXT_SECONDARY = "#DADADA";
// The catalogue as it looked before branding: the band was the app's own #272727.
export const BRAND_DEFAULT = "#272727";
export const BRAND_MIN_CONTRAST = 4.5;

const HEX = /^#[0-9A-F]{6}$/;

// `#abc`, `abcdef`, ` #AbCdEf ` -> `#ABCDEF`; anything else -> null.
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  let v = input.trim().toUpperCase();
  if (!v.startsWith("#")) v = `#${v}`;
  if (/^#[0-9A-F]{3}$/.test(v)) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return HEX.test(v) ? v : null;
}

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

// WCAG 2.0 relative luminance.
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [rr, gg, bb] = [r / 255, g / 255, b / 255];
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rr) h = ((gg - bb) / d) % 6;
  else if (max === gg) h = (bb - rr) / d + 2;
  else h = (rr - gg) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function fromHsl([h, s, l]: [number, number, number]): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

export type BrandTextColor = typeof BRAND_TEXT_PRIMARY | typeof BRAND_TEXT_SECONDARY;

// The text colour for a background, or null if neither reaches 4.5:1. When both pass, the
// one with more contrast wins.
export function textOn(background: string): BrandTextColor | null {
  const p = contrastRatio(background, BRAND_TEXT_PRIMARY);
  const s = contrastRatio(background, BRAND_TEXT_SECONDARY);
  if (p < BRAND_MIN_CONTRAST && s < BRAND_MIN_CONTRAST) return null;
  return p >= s ? BRAND_TEXT_PRIMARY : BRAND_TEXT_SECONDARY;
}

export type BrandColor = {
  // What the owner picked, normalised.
  chosen: string;
  // What the catalogue uses: `chosen`, or the nearest colour that reads.
  applied: string;
  adjusted: boolean;
  text: BrandTextColor;
  contrast: number;
};

// THE LEAST CHANGE, ONE POINT OF LIGHTNESS AT A TIME, IN BOTH DIRECTIONS. Hue and
// saturation are kept: the owner's red stays a red. At each step darker is tried before
// lighter; measured 2026-11-12, red needs 12 points darker (#C20000, secondary, 4.56:1)
// and blue 4 points lighter (#3092E7, primary, 4.55:1). Pure black and white always pass,
// so the loop always ends.
export function resolveBrandColor(input: string | null | undefined): BrandColor | null {
  const chosen = normalizeHex(input);
  if (!chosen) return null;
  const direct = textOn(chosen);
  if (direct) {
    return { chosen, applied: chosen, adjusted: false, text: direct, contrast: contrastRatio(chosen, direct) };
  }
  const [h, s, l] = toHsl(rgb(chosen));
  for (let step = 1; step <= 100; step += 1) {
    for (const next of [l - step / 100, l + step / 100]) {
      if (next < 0 || next > 1) continue;
      const candidate = toHex(fromHsl([h, s, next]));
      const text = textOn(candidate);
      if (text) {
        return { chosen, applied: candidate, adjusted: true, text, contrast: contrastRatio(candidate, text) };
      }
    }
  }
  return null;
}
