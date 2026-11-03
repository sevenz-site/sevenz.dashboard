"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Label } from "@/components/ui/label";
import { CategoryManagerSheet, type CategoriaConConteo } from "@/components/dashboard/category-manager";

// «CATEGORÍA (OPCIONAL)», under «Proveedor» in step 1/4 of the product flow.
// Owner's request of 2026-11-03, with no frame («No, diséñalo tú»): create a
// category, assign it, edit and delete the ones created — all from here.
//
// A FIELD THAT OPENS A SHEET, not a dropdown: the four actions need room
// (a row per category with its pencil and its bin, and the «Nueva categoría»
// box at the foot), and a bottom sheet is what this app already uses to pick
// from a list on a phone (Repartir abono, the client search). The sheet is
// `CategoryManagerSheet`, shared with the catalogue's «Editar».

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
          {elegida ? elegida.name : "Sin categoría"}
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
