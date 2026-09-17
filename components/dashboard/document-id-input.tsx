"use client";

import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { composeDocumentId, DOCUMENT_PREFIX, parseDocumentId } from "@/lib/document-id";
import type { OwnerCountry } from "@/lib/types";

// The document field, with the country's prefix fixed in front of it.
//
// WHY A FIXED PREFIX AT ALL. The field used to take anything, so the same
// person could be "V-12345678" in one record and "12345678" in another, and
// "pendiente" in a third. normalizeDocumentId already makes the first two
// compare equal, but it cannot rescue the third — and the day a person has to
// be matched to a record, junk in this field is what breaks it.
//
// VENEZUELA GETS "V-" AND NOTHING ELSE. Not a V/E picker: decided 2026-09-17,
// with the consequence stated and accepted — a foreign resident's cédula, which
// is written "E-", will be stored as "V-". If that ever has to change, this is
// the file, and the stored values from before the change are the migration.
//
// COLOMBIA GETS NO PREFIX. A Colombian cédula is plain digits. Forcing "V-" on
// a Cúcuta shopkeeper's clients would write a false fact into every new record,
// and half the businesses on Sevenz are Colombian.
export function DocumentIdInput({
  id,
  country,
  value,
  onChange,
  invalid,
  required,
}: {
  id: string;
  country: OwnerCountry;
  // The full stored value — "V-12345678", "12345678", or a legacy one.
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
  required?: boolean;
}) {
  const { digits, legacy } = parseDocumentId(value, country);

  // The form still submits ONE field called document_id holding the whole
  // value, so every server action keeps reading it exactly as before. The
  // visible box only ever holds the digits.
  const hidden = <input type="hidden" name="document_id" value={value} />;

  if (legacy) {
    return (
      <>
        {hidden}
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
          required={required}
        />
        <p className="text-xs text-muted-foreground">
          Documento guardado con otro formato. Se queda como está; si lo reescribes, toma el formato
          nuevo.
        </p>
      </>
    );
  }

  const onDigits = (raw: string) => onChange(composeDocumentId(raw.replace(/\D/g, ""), country));

  if (country === "CO") {
    return (
      <>
        {hidden}
        <Input
          id={id}
          value={digits}
          onChange={(e) => onDigits(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={invalid}
          required={required}
        />
      </>
    );
  }

  return (
    <>
      {hidden}
      <InputGroup data-invalid={invalid ? "" : undefined}>
        {/* aria-hidden: a screen reader gets the prefix from the input's own
            label, and announcing "V dash" before every digit is noise. */}
        <InputGroupAddon>
          <InputGroupText aria-hidden>{DOCUMENT_PREFIX.VE}</InputGroupText>
        </InputGroupAddon>
        <InputGroupInput
          id={id}
          value={digits}
          onChange={(e) => onDigits(e.target.value)}
          inputMode="numeric"
          autoComplete="off"
          aria-invalid={invalid}
          required={required}
        />
      </InputGroup>
    </>
  );
}
