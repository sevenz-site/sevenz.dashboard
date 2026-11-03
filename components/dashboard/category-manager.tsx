"use client";

import { useState, useTransition } from "react";
import { Check, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { crearCategoria, eliminarCategoria, renombrarCategoria } from "@/app/(app)/productos/actions";
import {
  MAX_NOMBRE_DE_CATEGORIA,
  errorDeNombreDeCategoria,
  ordenarCategorias,
  type Categoria,
} from "@/lib/products/categories";

// THE CATEGORY SHEET: list, rename, delete, create. Two doors open it:
//
//   - the «Categoría (opcional)» field of the product flow, which also PICKS
//     one for the product (`picker`);
//   - the «Editar» of the catalogue's «Categorías» section, owner's request of
//     2026-11-03 with frame `1958:16272` («al seleccionar botón "Editar"
//     muestra en componente sheet todas las categorías. Desde el sheet se debe
//     poder editar, eliminar y crear nuevas categorías»), which only manages.
//
// ONE COMPONENT for both, so renaming or deleting cannot behave differently
// depending on where the shopkeeper started (CLAUDE.md: a visual value shown
// in two screens is born in a component). The frame draws the section, not
// the sheet; the sheet is the one the product flow already had.
//
// THE LIST BELONGS TO THE CALLER, which keeps it in state: creating, renaming
// or deleting updates it at once, so neither the chips nor the field show a
// stale name while the server revalidates.

export type CategoriaConConteo = Categoria & { productos: number };

export function CategoryManagerSheet({
  open,
  onOpenChange,
  categorias,
  onCategoriasChange,
  onDeleted,
  picker,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categorias: CategoriaConConteo[];
  onCategoriasChange: (next: CategoriaConConteo[]) => void;
  // Lets the caller drop a selection or a filter that pointed at it.
  onDeleted?: (id: string) => void;
  // Present in the product flow only: rows become choices.
  picker?: { value: string | null; onPick: (id: string | null) => void };
}) {
  const [nueva, setNueva] = useState("");
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null);
  const [borrando, setBorrando] = useState<CategoriaConConteo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  // Every opening starts clean: no error and no half-finished rename left
  // over from the last time. Both doors open it by flipping `open` from
  // outside, so the reset hangs off the prop, not off a click handler.
  const [estabaAbierta, setEstabaAbierta] = useState(open);
  if (open !== estabaAbierta) {
    setEstabaAbierta(open);
    if (open) {
      setError(null);
      setEditando(null);
    }
  }

  const ordenadas = ordenarCategorias(categorias) as CategoriaConConteo[];

  function crear() {
    const aviso = errorDeNombreDeCategoria(nueva, categorias);
    if (aviso) return setError(aviso);
    setError(null);
    startTransition(async () => {
      const r = await crearCategoria(nueva);
      if ("error" in r) return setError(r.error);
      onCategoriasChange([...categorias, { ...r.categoria, productos: 0 }]);
      setNueva("");
      // From the product flow, creating means «for this product»: it is
      // chosen and the sheet closes. From the catalogue it stays open, since
      // whoever is managing usually creates several in a row.
      if (picker) {
        picker.onPick(r.categoria.id);
        onOpenChange(false);
      }
    });
  }

  function guardarNombre() {
    if (!editando) return;
    const aviso = errorDeNombreDeCategoria(editando.nombre, categorias, editando.id);
    if (aviso) return setError(aviso);
    setError(null);
    startTransition(async () => {
      const r = await renombrarCategoria(editando.id, editando.nombre);
      if ("error" in r) return setError(r.error);
      onCategoriasChange(categorias.map((c) => (c.id === r.categoria.id ? { ...c, name: r.categoria.name } : c)));
      setEditando(null);
    });
  }

  function confirmarBorrado() {
    if (!borrando) return;
    const id = borrando.id;
    startTransition(async () => {
      const r = await eliminarCategoria(id);
      if (r.error) {
        setError(r.error);
        setBorrando(null);
        return;
      }
      onCategoriasChange(categorias.filter((c) => c.id !== id));
      if (picker?.value === id) picker.onPick(null);
      onDeleted?.(id);
      setBorrando(null);
    });
  }

  const nombreYConteo = (c: CategoriaConConteo) => (
    <span className="flex min-w-0 flex-col">
      <span className="truncate">{c.name}</span>
      <span className="text-xs text-muted-foreground">
        {c.productos === 1 ? "1 producto" : `${c.productos} productos`}
      </span>
    </span>
  );

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/* `dvh`, not `vh`: the same trap the «Registrar» sheet documents. */}
        <SheetContent side="bottom" className="flex max-h-[90dvh] flex-col rounded-t-xl">
          <SheetHeader>
            <SheetTitle className="text-xl font-medium">{picker ? "Categoría" : "Categorías"}</SheetTitle>
            <SheetDescription>
              {picker ? "Elige una, o crea la que necesites." : "Crea, cambia el nombre o elimina tus categorías."}
            </SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-6">
            {!picker && ordenadas.length === 0 ? (
              // The empty-state copy of frame «Crear producto V4» (node
              // `1955:15820`), the owner's own words for «no categories yet».
              <div className="flex flex-col gap-1 rounded-lg border px-4 py-6 text-center">
                <p className="font-semibold">Aún no tienes categorías registradas</p>
                <p className="text-xs text-muted-foreground">Agrega una categoría para organizar tus productos.</p>
              </div>
            ) : (
              <ul className="flex min-h-0 flex-1 flex-col divide-y overflow-y-auto rounded-lg border">
                {picker ? (
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        picker.onPick(null);
                        onOpenChange(false);
                      }}
                      className="flex min-h-12 w-full items-center justify-between gap-2 px-3 text-left text-sm active:bg-muted/60"
                    >
                      <span className="text-muted-foreground">Sin categoría</span>
                      {picker.value === null ? <Check className="size-4 text-foreground" aria-hidden="true" /> : null}
                    </button>
                  </li>
                ) : null}
                {ordenadas.map((c) =>
                  editando?.id === c.id ? (
                    <li key={c.id} className="flex flex-col gap-2 p-3">
                      <Input
                        autoFocus
                        value={editando.nombre}
                        maxLength={MAX_NOMBRE_DE_CATEGORIA}
                        onChange={(e) => setEditando({ id: c.id, nombre: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            guardarNombre();
                          }
                        }}
                        aria-label={`Nuevo nombre de ${c.name}`}
                        className="h-10"
                      />
                      <div className="flex justify-end gap-2">
                        <Button type="button" variant="ghost" size="sm" onClick={() => setEditando(null)} disabled={pendiente}>
                          Cancelar
                        </Button>
                        <Button type="button" size="sm" onClick={guardarNombre} disabled={pendiente}>
                          Guardar
                        </Button>
                      </div>
                    </li>
                  ) : (
                    <li key={c.id} className="flex items-center gap-1 pr-1">
                      {picker ? (
                        <button
                          type="button"
                          onClick={() => {
                            picker.onPick(c.id);
                            onOpenChange(false);
                          }}
                          className="flex min-h-12 min-w-0 flex-1 items-center justify-between gap-2 px-3 text-left text-sm active:bg-muted/60"
                        >
                          {nombreYConteo(c)}
                          {picker.value === c.id ? (
                            <Check className="size-4 shrink-0 text-foreground" aria-hidden="true" />
                          ) : null}
                        </button>
                      ) : (
                        <div className="flex min-h-12 min-w-0 flex-1 items-center px-3 text-sm">{nombreYConteo(c)}</div>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Editar ${c.name}`}
                        onClick={() => {
                          setError(null);
                          setEditando({ id: c.id, nombre: c.name });
                        }}
                        disabled={pendiente}
                      >
                        <Pencil className="size-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Eliminar ${c.name}`}
                        onClick={() => {
                          setError(null);
                          setBorrando(c);
                        }}
                        disabled={pendiente}
                      >
                        <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                      </Button>
                    </li>
                  ),
                )}
              </ul>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="categoria_nueva">Nueva categoría</Label>
              <div className="flex gap-2">
                <Input
                  id="categoria_nueva"
                  value={nueva}
                  maxLength={MAX_NOMBRE_DE_CATEGORIA}
                  onChange={(e) => setNueva(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      crear();
                    }
                  }}
                  placeholder="Ej.: Bebidas"
                  className="h-10 min-w-0 flex-1"
                />
                <Button type="button" className="h-10" onClick={crear} disabled={pendiente || !nueva.trim()}>
                  Crear
                </Button>
              </div>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={borrando !== null} onOpenChange={(o) => (o ? null : setBorrando(null))}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar «{borrando?.name}»?</AlertDialogTitle>
            <AlertDialogDescription>
              {/* The owner's decision of 2026-11-03: the products stay, only
                  without a category. Said with the number, before pressing. */}
              {!borrando || borrando.productos === 0
                ? "No tiene productos. Tus productos no cambian."
                : borrando.productos === 1
                  ? "1 producto se quedará sin categoría. El producto no se borra."
                  : `${borrando.productos} productos se quedarán sin categoría. Los productos no se borran.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pendiente}>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmarBorrado} disabled={pendiente}>
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
