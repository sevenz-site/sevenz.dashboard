"use client";

import { ScanBarcode, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBarcodeScanner } from "@/components/barcode/scanner-provider";

// «CÓDIGO DE BARRAS» ON A PRODUCT (CT-182) -- frames 8, 12 and 13 of the scanner flow,
// approved on 2026-11-23. Several codes per product («Varios códigos», same day), so one
// row per code and «+ Agregar otro código» below.
//
// THE PATTERN, owner's request of 2026-11-23 after trying it on his phone («Establecer
// como patrón y corregir en todas las interfaces»), written in DESIGN-SYSTEM.md:
//   · «Escanear» is a button of its own, OUTSIDE the field: outlined, with its label.
//     It used to be an icon inside the field next to the X, and the two were close
//     enough to press the wrong one.
//   · The X is always inside the field when it holds something, and it CLEARS it. On an
//     empty row that is not the only one, it removes the row. In the catalogue's form it
//     only appeared with two rows, so a single code could not be cleared.
//
// `data-barcode-input` tells the gun guard that a burst typed here IS the code, so it is
// left in the field instead of being taken out like in every other field.
//
// Rendered only when the business works with codes: a form that does not render it sends
// `barcodes: undefined`, which leaves the product's codes untouched on the server.
export function BarcodeField({
  values,
  onChange,
  idPrefix,
  optional = false,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  idPrefix: string;
  optional?: boolean;
}) {
  const { openCamera } = useBarcodeScanner();
  const rows = values.length > 0 ? values : [""];
  const set = (i: number, value: string) => onChange(rows.map((v, j) => (j === i ? value : v)));

  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`${idPrefix}-0`}>{optional ? "Código de barras (opcional)" : "Código de barras"}</Label>
      <div className="flex flex-col gap-2">
        {rows.map((value, i) => {
          const canRemove = value === "" && rows.length > 1;
          return (
            // `items-stretch`: «Escanear» takes the height of the field beside it, whatever the
            // form's inputs measure (32px in the quick sheet, more in the catalogue's).
            <div key={i} className="flex items-stretch gap-2">
              <div className="relative flex min-w-0 flex-1 items-center">
                <Input
                  id={`${idPrefix}-${i}`}
                  data-barcode-input=""
                  inputMode="numeric"
                  autoComplete="off"
                  className={value !== "" || canRemove ? "pr-9" : undefined}
                  placeholder="Escanea o escribe el código"
                  value={value}
                  onChange={(e) => set(i, e.target.value)}
                />
                {value !== "" || canRemove ? (
                  <button
                    type="button"
                    aria-label={value !== "" ? "Borrar el código" : "Quitar esta fila"}
                    className="absolute right-1 rounded-md p-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => (value !== "" ? set(i, "") : onChange(rows.filter((_, j) => j !== i)))}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                // Phone only: on the web the gun types straight into the field, and there is
                // no camera button anywhere (owner's decision of 2026-11-23, «solo la pistola»).
                className="h-auto shrink-0 gap-1.5 px-3 md:hidden"
                onClick={() => openCamera((code) => set(i, code))}
              >
                <ScanBarcode className="size-4" aria-hidden="true" />
                Escanear
              </Button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="self-start pt-1 text-sm font-semibold"
        onClick={() => onChange([...rows, ""])}
      >
        + Agregar otro código
      </button>
    </div>
  );
}
