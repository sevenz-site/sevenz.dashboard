"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { CODE_LENGTH } from "@/lib/security/code-text";

// THE SIX-DIGIT FIELD, ONCE (C1 of PL-22). It appears on four screens — sign-in, turning
// the factor on, changing the password, proving a new number — and on the admin's email
// change, so it is born here and never copied (CLAUDE.md, «un valor visual que sale en más
// de una pantalla nace en un componente»).
//
// What it fixes, each one a trap on an iPhone:
//   * `text-base` (16px): Safari zooms the page on focus under that size.
//   * `inputMode="numeric"`: the number pad, not the letters.
//   * `autoComplete="one-time-code"`: iOS 26 offers the WhatsApp code from the notification.
//   * Paste tolerated: «482 913» or «482-913» become six digits.
//   * Submits by itself at the sixth digit, so «Copiar código» → paste → done, no extra tap.
//
// TO CLEAR IT WHEN A NEW CODE GOES OUT, remount it: `<CodeInput key={round} />`. The field
// keeps no effect for that — the repo's lint forbids setState inside effects, and a key is
// the React way to say «this is a new field».
export function CodeInput({
  name = "code",
  autoSubmit = true,
  disabled,
  invalid,
}: {
  name?: string;
  autoSubmit?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [value, setValue] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const submittedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!autoSubmit || disabled || value.length !== CODE_LENGTH || submittedFor.current === value) return;
    submittedFor.current = value;
    ref.current?.form?.requestSubmit();
  }, [value, autoSubmit, disabled]);

  return (
    <Input
      ref={ref}
      id={name}
      name={name}
      value={value}
      onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH))}
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="one-time-code"
      maxLength={CODE_LENGTH + 2}
      placeholder="000000"
      required
      autoFocus
      disabled={disabled}
      aria-invalid={invalid}
      className="h-12 text-center text-2xl font-semibold tracking-[0.4em] tabular-nums"
    />
  );
}
