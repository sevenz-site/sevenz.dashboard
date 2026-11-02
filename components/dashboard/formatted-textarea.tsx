"use client";

import { useRef } from "react";
import { Bold, Italic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const MAX_LENGTH = 500;

// Bold/italic toolbar over a textarea, laid out as the "Agregar método de
// pago" dialog draws it (frame `1927:24696`): the two 40px buttons first, then
// the field's label, then the box. Until 2026-11-02 the buttons were 28px with
// a hint beside them («Selecciona texto y toca un botón…»); the frame has
// neither, so both went.
//
// The markers it writes (`**`, `*`) are the ones `renderFormattedText` reads;
// "Copiar" turns them into WhatsApp's own with `toWhatsappText`.
export function FormattedTextarea({
  id,
  name,
  label,
  defaultValue,
  placeholder,
  invalid,
}: {
  id: string;
  name: string;
  label: string;
  defaultValue?: string | null;
  placeholder?: string;
  invalid?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function wrapSelection(marker: string) {
    const el = ref.current;
    if (!el) return;
    const { selectionStart, selectionEnd, value } = el;
    if (selectionStart === selectionEnd) return;

    const selected = value.slice(selectionStart, selectionEnd);
    const next = value.slice(0, selectionStart) + marker + selected + marker + value.slice(selectionEnd);
    el.value = next.slice(0, MAX_LENGTH);
    el.focus();
    el.setSelectionRange(selectionStart + marker.length, selectionEnd + marker.length);
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4">
        <Button
          type="button"
          variant="outline"
          className="h-10 w-[42px] px-0"
          onClick={() => wrapSelection("**")}
          aria-label="Negrita"
        >
          <Bold className="size-5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-[42px] px-0"
          onClick={() => wrapSelection("*")}
          aria-label="Cursiva"
        >
          <Italic className="size-5" />
        </Button>
      </div>
      <div className="flex flex-col gap-1">
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
        <Textarea
          ref={ref}
          id={id}
          name={name}
          defaultValue={defaultValue ?? ""}
          maxLength={MAX_LENGTH}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          className="h-[120px] field-sizing-fixed resize-none rounded-xl px-4 py-3"
        />
      </div>
    </div>
  );
}
