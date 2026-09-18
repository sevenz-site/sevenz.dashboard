"use client";

import { Input } from "@/components/ui/input";
import { parseDocumentId } from "@/lib/document-id";
import type { OwnerCountry } from "@/lib/types";

// The document field: digits only, with a cue beside it in Venezuela.
//
// WHAT THIS IS FOR. The field used to take anything, so a shopkeeper in a hurry
// could type "pendiente" or "no tiene" to get past a required field — the owner
// has seen exactly that with WhatsApp numbers. Junk in this column is what
// breaks matching a person to a record later. Digits only closes that door.
//
// THE "V-" IS A CUE, NOT PART OF THE VALUE. It sits outside the box and never
// reaches the database. An earlier version stored it and was dropped before
// release: every Venezuelan record would have carried the same letter, the
// country already lives in `clients.document_country`, and the comparison used
// for duplicate detection had to strip the letter again anyway.
//
// COLOMBIA GETS NOTHING BESIDE THE BOX. A Colombian cédula is plain digits and
// half the businesses on Sevenz are Colombian.
export function DocumentIdInput({
  id,
  country,
  value,
  onChange,
  invalid,
  required,
}: {
  id: string;
  country: OwnerCountry | null;
  // The stored value: digits, or a legacy value with letters in it.
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
  required?: boolean;
}) {
  const { digits, legacy } = parseDocumentId(value);

  // A value with letters in it stays exactly as it is, in a plain box. Putting
  // an "E-12345678" into a digits box would drop the E the next time anyone
  // saved, and that is losing a real fact about a person by accident.
  if (legacy) {
    return (
      <>
        <Input
          id={id}
          name="document_id"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
          required={required}
        />
        <p className="text-xs text-muted-foreground">
          Documento guardado con otro formato. Se queda como está; si lo reescribes, admite solo
          números.
        </p>
      </>
    );
  }

  const field = (
    <Input
      id={id}
      name="document_id"
      value={digits}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
      inputMode="numeric"
      autoComplete="off"
      aria-invalid={invalid}
      required={required}
    />
  );

  if (country !== "VE") return field;

  return (
    <div className="flex items-center gap-2">
      {/* aria-hidden: the input has its own label, and reading "V dash" before
          every digit is noise. This is decoration for the eye, and the value it
          decorates is not stored. */}
      <span aria-hidden className="shrink-0 text-sm text-muted-foreground">
        V-
      </span>
      {/* min-w-0 so the box shrinks instead of pushing the cue off a phone. */}
      <div className="min-w-0 flex-1">{field}</div>
    </div>
  );
}
