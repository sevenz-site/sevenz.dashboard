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
// a Venezuelan one offers eight methods, a Colombian one five.
//
// WHO PICKS THE DEFAULT: the caller, with `defaultMethod`, because only it knows the currency
// being typed and whether the shopkeeper already chose something on purpose.
export function MetodoDePagoField({
  id,
  bookCurrency,
  value,
  onValueChange,
  disabled,
  label = "Método de pago",
}: {
  id: string;
  bookCurrency: string | null;
  value: PaymentMethod;
  onValueChange: (value: PaymentMethod) => void;
  disabled?: boolean;
  // The return asks the same list a different question: «¿Cómo le devolviste el dinero?».
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={(v) => onValueChange(v as PaymentMethod)} disabled={disabled}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {methodsForBook(bookCurrency).map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
