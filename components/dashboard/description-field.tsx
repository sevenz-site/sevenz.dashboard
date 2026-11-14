"use client";

import { useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { DescriptionText } from "@/components/description-text";
import { MAX_DESCRIPTION_LENGTH } from "@/lib/products/description";

// THE DESCRIPTION FIELD OF A PRODUCT, with its three format buttons, its counter and the
// preview of what the customer will read. CT-171, frames `2119:21556` (normal) and
// `2119:21629` (at the limit), approved by the owner on 2026-11-12.
//
// WHY BUTTONS AND NOT A RICH EDITOR. A contenteditable editor is where iOS Safari is at its
// worst (selection, autocorrect, the keyboard jumping), and it would need a dependency. A
// plain textarea with three buttons that insert the markers works everywhere; the cost is
// that the shopkeeper sees «**» in the field, which is what the preview underneath is for:
// it shows the same thing the customer will see, drawn by the same component.
//
// THE BUTTONS DO NOT STEAL FOCUS. `onPointerDown` + `preventDefault` keeps the textarea
// focused, so on a phone the keyboard does not drop every time a button is tapped. Not
// verifiable in the desktop browser pane -- its emulator blurs fields on its own; see
// CLAUDE.md, «CON EL TECLADO ARRIBA».
//
// A FORMAT THAT WOULD PASS THE LIMIT IS NOT APPLIED. Adding «**» around a word at 499
// characters would produce 503, which the field could not even hold. The button simply
// does nothing there, and the counter already says why.
type Formato = "bold" | "italic" | "bullets";

// The glyphs the frame draws -- B, I and • -- rather than icons: the support text
// under the field names them («toca B, I o •»), so the buttons have to show those
// exact characters.
const BOTONES: { kind: Formato; label: string; glyph: string; className: string }[] = [
  { kind: "bold", label: "Negrita", glyph: "B", className: "font-bold" },
  { kind: "italic", label: "Cursiva", glyph: "I", className: "italic" },
  { kind: "bullets", label: "Viñetas", glyph: "•", className: "" },
];

export function DescriptionField({
  id,
  value,
  onChange,
  disabled,
  placeholder = "Escribe descripción del producto",
}: {
  id: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const alLimite = value.length >= MAX_DESCRIPTION_LENGTH;

  function apply(next: string, selStart: number, selEnd: number) {
    if (next.length > MAX_DESCRIPTION_LENGTH) return;
    onChange(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }

  function wrap(marker: string) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const selected = value.slice(a, b);
    // Already wrapped: tapping again removes the style, like any editor.
    if (
      a >= marker.length &&
      value.slice(a - marker.length, a) === marker &&
      value.slice(b, b + marker.length) === marker
    ) {
      const next = value.slice(0, a - marker.length) + selected + value.slice(b + marker.length);
      apply(next, a - marker.length, b - marker.length);
      return;
    }
    const next = value.slice(0, a) + marker + selected + marker + value.slice(b);
    apply(next, a + marker.length, b + marker.length);
  }

  function toggleBullets() {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    const lineStart = value.lastIndexOf("\n", a - 1) + 1;
    const nextBreak = value.indexOf("\n", b);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const lines = value.slice(lineStart, lineEnd).split("\n");
    const allBulleted = lines.every((l) => /^\s*[-*•]\s+/.test(l));
    const changed = lines
      .map((l) => (allBulleted ? l.replace(/^\s*[-*•]\s+/, "") : `- ${l}`))
      .join("\n");
    const next = value.slice(0, lineStart) + changed + value.slice(lineEnd);
    apply(next, lineStart, lineStart + changed.length);
  }

  function run(kind: Formato) {
    if (kind === "bullets") toggleBullets();
    else wrap(kind === "bold" ? "**" : "*");
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2" role="toolbar" aria-label="Formato de la descripción">
        {BOTONES.map(({ kind, label, glyph, className }) => (
          <button
            key={label}
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => run(kind)}
            className="flex size-9 items-center justify-center rounded-lg border bg-background text-foreground disabled:opacity-50"
          >
            <span aria-hidden="true" className={`text-base ${className}`}>
              {glyph}
            </span>
          </button>
        ))}
      </div>
      <Textarea
        ref={ref}
        id={id}
        value={value}
        maxLength={MAX_DESCRIPTION_LENGTH}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        rows={4}
      />
      <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {alLimite
            ? `Llegaste al máximo de ${MAX_DESCRIPTION_LENGTH} caracteres.`
            : "Selecciona texto y toca B, I o •."}
        </span>
        <span className={alLimite ? "shrink-0 font-medium text-foreground" : "shrink-0"}>
          {value.length}/{MAX_DESCRIPTION_LENGTH}
        </span>
      </div>
      {value.trim() ? (
        <div className="flex flex-col gap-2 rounded-lg bg-muted px-3 py-3">
          <span className="text-xs text-muted-foreground">Así lo verá tu cliente</span>
          <DescriptionText text={value} />
        </div>
      ) : null}
    </div>
  );
}
