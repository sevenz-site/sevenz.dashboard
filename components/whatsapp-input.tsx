"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { CountryCodeSelect } from "@/components/country-code-select";
import {
  DEFAULT_COUNTRY_ISO2,
  COUNTRIES,
  splitPhoneNumber,
  exampleLocalNumber,
} from "@/lib/countries";
import { normalizePhone, phoneWarning } from "@/lib/phone";

export function WhatsappInput({
  name,
  defaultValue,
  id,
  required,
  preferredDialCode,
}: {
  name: string;
  defaultValue?: string | null;
  id?: string;
  required?: boolean;
  // Jumps the dial code to match whenever this changes (e.g. signup's
  // "País" select) — the owner can still pick a different one by hand
  // afterward, this only fires again on the next change from the caller.
  preferredDialCode?: string;
}) {
  const parsed = defaultValue ? splitPhoneNumber(defaultValue) : null;
  const defaultDialCode =
    parsed?.country.dialCode ??
    preferredDialCode ??
    COUNTRIES.find((c) => c.iso2 === DEFAULT_COUNTRY_ISO2)!.dialCode;

  const [dialCode, setDialCode] = useState(defaultDialCode);
  const [local, setLocal] = useState(parsed?.local ?? "");

  // Re-syncs the dial code whenever the caller's preferredDialCode itself
  // changes (a new "País" pick) — setState-during-render, the documented
  // way to react to a changed prop without an effect. A manual dial-code
  // override in between two "País" picks is left alone.
  const [lastPreferredDialCode, setLastPreferredDialCode] = useState(preferredDialCode);
  if (preferredDialCode !== lastPreferredDialCode) {
    setLastPreferredDialCode(preferredDialCode);
    if (preferredDialCode) setDialCode(preferredDialCode);
  }

  // The stored value is always the formatted one — the owner shouldn't have to
  // know that WhatsApp wants 414 and not 0414. Applied on blur too, so the
  // field visibly shows what was saved rather than rewriting it behind their
  // back: a silent correction that guessed wrong would be undetectable.
  const check = normalizePhone(dialCode, local);
  const combined = check.local ? `${dialCode}${check.local}` : "";
  const warning = local ? phoneWarning(check, dialCode) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        <CountryCodeSelect value={dialCode} onChange={setDialCode} />
        <Input
          id={id}
          type="tel"
          inputMode="numeric"
          placeholder={exampleLocalNumber(dialCode)}
          value={local}
          onChange={(e) => setLocal(e.target.value.replace(/\D/g, ""))}
          onBlur={() => setLocal(check.local)}
          required={required}
          aria-invalid={warning ? true : undefined}
        />
        <input type="hidden" name={name} value={combined} />
      </div>
      {warning ? <p className="text-xs text-amber-600">{warning}</p> : null}
    </div>
  );
}
