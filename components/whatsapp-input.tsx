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

  const digits = local.replace(/\D/g, "");
  const combined = digits ? `${dialCode}${digits}` : "";

  return (
    <div className="flex gap-2">
      <CountryCodeSelect value={dialCode} onChange={setDialCode} />
      <Input
        id={id}
        type="tel"
        inputMode="numeric"
        placeholder={exampleLocalNumber(dialCode)}
        value={local}
        onChange={(e) => setLocal(e.target.value.replace(/\D/g, ""))}
        required={required}
      />
      <input type="hidden" name={name} value={combined} />
    </div>
  );
}
