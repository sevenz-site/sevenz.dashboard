"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { CountryCodeSelect } from "@/components/country-code-select";
import { DEFAULT_COUNTRY_ISO2, COUNTRIES, splitPhoneNumber } from "@/lib/countries";

export function WhatsappInput({
  name,
  defaultValue,
  id,
  required,
}: {
  name: string;
  defaultValue?: string | null;
  id?: string;
  required?: boolean;
}) {
  const parsed = defaultValue ? splitPhoneNumber(defaultValue) : null;
  const defaultDialCode =
    parsed?.country.dialCode ?? COUNTRIES.find((c) => c.iso2 === DEFAULT_COUNTRY_ISO2)!.dialCode;

  const [dialCode, setDialCode] = useState(defaultDialCode);
  const [local, setLocal] = useState(parsed?.local ?? "");

  const digits = local.replace(/\D/g, "");
  const combined = digits ? `${dialCode}${digits}` : "";

  return (
    <div className="flex gap-2">
      <CountryCodeSelect value={dialCode} onChange={setDialCode} />
      <Input
        id={id}
        type="tel"
        inputMode="numeric"
        placeholder="3001234567"
        value={local}
        onChange={(e) => setLocal(e.target.value.replace(/\D/g, ""))}
        required={required}
      />
      <input type="hidden" name={name} value={combined} />
    </div>
  );
}
