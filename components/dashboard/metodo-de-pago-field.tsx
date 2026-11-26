"use client";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { methodsForBook, type PaymentMethod } from "@/lib/payments/methods";

// «MÉTODO DE PAGO», the one field the three payment forms share: the sale's «Registrar pago»
// (and the catalogue order's payment step, which is the same component), the abono to one fiado
// and the split abono. Owner's request of 2026-11-17.
//
// ONE COMPONENT, NOT THREE COPIES (CLAUDE.md, «Un valor visual que sale en más de una pantalla
// NACE en un componente»). The list comes from `lib/payments/methods.ts` and depends on the book:
// a Venezuelan one offers nine methods, a Colombian one five.
//
// EMPTY UNTIL CHOSEN, AND REQUIRED (owner's request of 2026-11-26): it opens on «Seleccionar
// opción» and the caller refuses to go on without a value, passing `error` so the field says why.
// The caller decides when it is required: only when money changes hands (see each screen).
export function MetodoDePagoField({
  id,
  bookCurrency,
  value,
  onValueChange,
  disabled,
  label = "Método de pago",
  error = null,
}: {
  id: string;
  bookCurrency: string | null;
  value: PaymentMethod | null;
  onValueChange: (value: PaymentMethod) => void;
  disabled?: boolean;
  // Set when the shopkeeper tried to continue without choosing.
  error?: string | null;
  // The return asks the same list a different question: «¿Cómo le devolviste el dinero?».
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {/* `""` and not `undefined` while empty: Radix shows the placeholder for an empty string, and
          a value that goes from undefined to a string would switch the select from uncontrolled
          to controlled. */}
      <Select value={value ?? ""} onValueChange={(v) => onValueChange(v as PaymentMethod)} disabled={disabled}>
        <SelectTrigger id={id} className="w-full" aria-invalid={error ? true : undefined}>
          <SelectValue placeholder="Seleccionar opción" />
        </SelectTrigger>
        <SelectContent>
          {methodsForBook(bookCurrency).map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
