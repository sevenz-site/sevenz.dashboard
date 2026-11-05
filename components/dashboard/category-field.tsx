"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { CategoryManagerSheet, type CategoriaConConteo } from "@/components/dashboard/category-manager";

// «CATEGORÍA (OPCIONAL)», under «Proveedor» in step 1/4 of the product flow.
// Frame `1955:15860` and the sitemap `1963:15912`: a field reading «Selecciona
// categoría» that opens `CategoryManagerSheet`, shared with the catalogue's
// «Editar».
//
// THE FRAME'S LABEL IS «Categoría» WITH NO «(opcional)». It stays optional and
// keeps the word, so it reads like «Proveedor (opcional)» above it: owner's
// decision of 2026-11-03, asked because the frame alone could be read as the
// field becoming required.

export type { CategoriaConConteo };

export function CategoryField({
  value,
  onChange,
  categorias,
  onCategoriasChange,
  disabled,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  categorias: CategoriaConConteo[];
  onCategoriasChange: (next: CategoriaConConteo[]) => void;
  disabled?: boolean;
}) {
  const [abierta, setAbierta] = useState(false);
  const elegida = categorias.find((c) => c.id === value) ?? null;

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="producto_categoria">Categoría (opcional)</Label>
      <button
        id="producto_categoria"
        type="button"
        disabled={disabled}
        onClick={() => setAbierta(true)}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-left text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm"
      >
        <span className={elegida ? "truncate" : "truncate text-muted-foreground"}>
          {elegida ? elegida.name : "Selecciona categoría"}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      <CategoryManagerSheet
        open={abierta}
        onOpenChange={setAbierta}
        categorias={categorias}
        onCategoriasChange={onCategoriasChange}
        picker={{ value, onPick: onChange }}
      />
    </div>
  );
}
