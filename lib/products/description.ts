// A PRODUCT DESCRIPTION, WITH ITS THREE STYLES. CT-171, owner's request of 2026-11-12:
// «Poder agregar estilos markdown a la descripción del producto (bold, italic, bullets)»,
// and «Límite de caracteres a 500 tanto en la creación, edición, detalle y vista del
// cliente».
//
// ONE PARSER FOR EVERY SCREEN, on purpose. The shopkeeper's form preview, step 4/4, the
// product page and the customer's product page all draw the description through
// `parseDescription` + `<DescriptionText>`. Two parsers would eventually disagree about one
// asterisk, and the customer would read something the shopkeeper never saw.
//
// THE SYNTAX IS A SMALL SUBSET OF MARKDOWN, and only that:
//   **bold**   *italic*   a line starting with "- " (or "• ", or "* ") is a bullet
// Anything else is text, shown as typed. A lone asterisk -- «talla 5*6» -- stays an
// asterisk: a marker only counts when it closes on the same line.
//
// IT IS NEVER TURNED INTO HTML. The customer's page is public, and HTML written by somebody
// else is the classic way to inject a script. The parser returns plain data and React
// draws it, so a «<script>» in a description is printed as those characters.
//
// THE LIMIT COUNTS WHAT IS STORED, markers included. Owner's decision with the frames of
// 2026-11-12 (recommendation accepted: «Vamos con tus recomendaciones»): the counter, the
// field and the server all measure the same string, so the number on screen is the number
// the server checks. Counting only visible letters would let the stored text exceed 500.

export const MAX_DESCRIPTION_LENGTH = 500;

export type DescriptionSpan = { text: string; bold: boolean; italic: boolean };

export type DescriptionBlock =
  | { kind: "line"; spans: DescriptionSpan[] }
  | { kind: "list"; items: DescriptionSpan[][] }
  | { kind: "gap" };

const BULLET = /^\s*(?:[-*•])\s+/;

// Inline styles of one line. `**` is tried before `*`, so «**a**» is bold, not two
// italics around nothing. An unclosed marker is literal text.
export function parseInline(line: string): DescriptionSpan[] {
  const spans: DescriptionSpan[] = [];
  let plain = "";
  let i = 0;
  const flush = () => {
    if (plain) spans.push({ text: plain, bold: false, italic: false });
    plain = "";
  };
  while (i < line.length) {
    if (line.startsWith("**", i)) {
      const end = line.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        for (const inner of parseInline(line.slice(i + 2, end))) {
          spans.push({ ...inner, bold: true });
        }
        i = end + 2;
        continue;
      }
    } else if (line[i] === "*") {
      const end = line.indexOf("*", i + 1);
      // Not «* » at the very start (that is a bullet, handled by the caller) and not an
      // empty pair. «5*6*7» would italicise «6»; accepted, it is what Markdown does too.
      if (end > i + 1 && line[end + 1] !== "*") {
        flush();
        spans.push({ text: line.slice(i + 1, end), bold: false, italic: true });
        i = end + 1;
        continue;
      }
    }
    plain += line[i];
    i += 1;
  }
  flush();
  return spans;
}

export function parseDescription(text: string | null | undefined): DescriptionBlock[] {
  const lines = (text ?? "").replace(/\r\n?/g, "\n").trim().split("\n");
  const blocks: DescriptionBlock[] = [];
  for (const raw of lines) {
    if (raw.trim() === "") {
      // Several blank lines collapse into one gap, and a gap never opens or closes.
      if (blocks.length && blocks[blocks.length - 1].kind !== "gap") blocks.push({ kind: "gap" });
      continue;
    }
    if (BULLET.test(raw)) {
      const item = parseInline(raw.replace(BULLET, ""));
      const last = blocks[blocks.length - 1];
      if (last?.kind === "list") last.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
      continue;
    }
    blocks.push({ kind: "line", spans: parseInline(raw.trim()) });
  }
  while (blocks.length && blocks[blocks.length - 1].kind === "gap") blocks.pop();
  return blocks;
}

// THE SAME DESCRIPTION WITHOUT ITS MARKERS, for places that only take plain text: the
// link preview WhatsApp draws from `og:description`. Without this the customer's chat
// would show «**Casco**» with the asterisks. Bullets become sentences, which is the only
// way a list survives a preview that collapses line breaks.
export function plainDescription(text: string | null | undefined): string | null {
  const parts: string[] = [];
  for (const block of parseDescription(text)) {
    if (block.kind === "line") parts.push(spansText(block.spans));
    if (block.kind === "list") parts.push(...block.items.map(spansText));
  }
  const out = parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (/[.!?:;…]$/.test(p) ? p : `${p}.`))
    .join(" ");
  return out || null;
}

function spansText(spans: DescriptionSpan[]): string {
  return spans.map((s) => s.text).join("");
}
