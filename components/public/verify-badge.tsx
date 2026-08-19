"use client";

import { useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";

export function VerifyBadge({ expectedLast4 }: { expectedLast4: string }) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const verified = value.length === 4 && value === expectedLast4;

  if (verified) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
        <ShieldCheck className="size-3.5" /> Verificado con tu WhatsApp
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit text-xs text-muted-foreground underline underline-offset-4"
      >
        ¿Es tu cuenta? Verifica con tu WhatsApp
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        inputMode="numeric"
        maxLength={4}
        placeholder="Últimos 4 dígitos"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, "").slice(0, 4))}
        className="h-8 w-36 text-sm"
      />
      {value.length === 4 ? (
        <span className="text-xs text-muted-foreground">No coincide, pero puedes seguir viendo el saldo.</span>
      ) : null}
    </div>
  );
}
