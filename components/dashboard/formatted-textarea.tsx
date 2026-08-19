"use client";

import { useRef } from "react";
import { Bold, Italic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

const MAX_LENGTH = 500;

export function FormattedTextarea({
  id,
  name,
  defaultValue,
  placeholder,
}: {
  id: string;
  name: string;
  defaultValue?: string | null;
  placeholder?: string;
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
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-7"
          onClick={() => wrapSelection("**")}
          aria-label="Negrita"
        >
          <Bold className="size-3.5" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-7"
          onClick={() => wrapSelection("*")}
          aria-label="Cursiva"
        >
          <Italic className="size-3.5" />
        </Button>
        <span className="text-xs text-muted-foreground">
          Selecciona texto y toca un botón para darle formato.
        </span>
      </div>
      <Textarea
        ref={ref}
        id={id}
        name={name}
        defaultValue={defaultValue ?? ""}
        maxLength={MAX_LENGTH}
        rows={3}
        placeholder={placeholder}
      />
    </div>
  );
}
