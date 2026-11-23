"use client";

import { ScanBarcode, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBarcodeScanner } from "@/components/barcode/scanner-provider";

// «CÓDIGO DE BARRAS» ON A PRODUCT (CT-182) -- frames 8, 12 and 13 of the scanner flow,
// approved on 2026-11-23. Several codes per product («Varios códigos», same day), so one
// row per code and «+ Agregar otro código» below. Each row has its own camera button.
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
        {rows.map((value, i) => (
          <div key={i} className="relative flex items-center">
            <Input
              id={`${idPrefix}-${i}`}
              data-barcode-input=""
              inputMode="numeric"
              autoComplete="off"
              className="pr-20"
              placeholder="Escanea o escribe el código"
              value={value}
              onChange={(e) => set(i, e.target.value)}
            />
            <div className="absolute right-1 flex items-center">
              {rows.length > 1 ? (
                <button
                  type="button"
                  aria-label="Quitar este código"
                  className="rounded-md p-1.5 text-muted-foreground hover:text-foreground"
                  onClick={() => onChange(rows.filter((_, j) => j !== i))}
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Escanear el código con la cámara"
                className="rounded-md p-1.5 hover:bg-muted"
                onClick={() => openCamera((code) => set(i, code))}
              >
                <ScanBarcode className="size-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
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
