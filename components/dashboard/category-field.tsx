"use client";

import { useState, useTransition } from "react";
import { Check, ChevronDown, Pencil, Trash2 } from "lucide-react";
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

// «CATEGORÍA (OPCIONAL)», under «Proveedor» in step 1/4 of the product flow.
// Owner's request of 2026-11-03, with no frame («No, diséñalo tú»): create a
// category, assign it, edit and delete the ones created — all from here.
//
// A FIELD THAT OPENS A SHEET, not a dropdown: the four actions need room
// (a row per category with its pencil and its bin, and the «Nueva categoría»
// box at the foot), and a bottom sheet is what this app already uses to pick
// from a list on a phone (Repartir abono, the client search).
//
// THE LIST IS THE PAGE'S, kept here in state: creating, renaming or deleting
// updates it at once, so the sheet and the field never show a stale name.

export type CategoriaConConteo = Categoria & { productos: number };

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
  const [nueva, setNueva] = useState("");
  const [editando, setEditando] = useState<{ id: string; nombre: string } | null>(null);
  const [borrando, setBorrando] = useState<CategoriaConConteo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const elegida = categorias.find((c) => c.id === value) ?? null;
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
      // Created from here means «for this product»: it is chosen and the
      // sheet closes, the one step the shopkeeper was going to do next.
      onChange(r.categoria.id);
      setAbierta(false);
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
      if (value === id) onChange(null);
      setBorrando(null);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="producto_categoria">Categoría (opcional)</Label>
      <button
        id="producto_categoria"
        type="button"
        disabled={disabled}
        onClick={() => {
          setError(null);
          setEditando(null);
          setAbierta(true);
        }}
        className="flex h-10 w-full items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-left text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 md:text-sm"
      >
        <span className={elegida ? "truncate" : "truncate text-muted-foreground"}>
          {elegida ? elegida.name : "Sin categoría"}
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>

      <Sheet open={abierta} onOpenChange={setAbierta}>
        {/* `dvh`, not `vh`: the same trap the «Registrar» sheet documents. */}
        <SheetContent side="bottom" className="flex max-h-[90dvh] flex-col rounded-t-xl">
          <SheetHeader>
            <SheetTitle className="text-xl font-medium">Categoría</SheetTitle>
            <SheetDescription>Elige una, o crea la que necesites.</SheetDescription>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-6">
            <ul className="flex min-h-0 flex-1 flex-col divide-y overflow-y-auto rounded-lg border">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    onChange(null);
                    setAbierta(false);
                  }}
                  className="flex min-h-12 w-full items-center justify-between gap-2 px-3 text-left text-sm active:bg-muted/60"
                >
                  <span className="text-muted-foreground">Sin categoría</span>
                  {value === null ? <Check className="size-4 text-foreground" aria-hidden="true" /> : null}
                </button>
              </li>
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
                    <button
                      type="button"
                      onClick={() => {
                        onChange(c.id);
                        setAbierta(false);
                      }}
                      className="flex min-h-12 min-w-0 flex-1 items-center justify-between gap-2 px-3 text-left text-sm active:bg-muted/60"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{c.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {c.productos === 1 ? "1 producto" : `${c.productos} productos`}
                        </span>
                      </span>
                      {value === c.id ? <Check className="size-4 shrink-0 text-foreground" aria-hidden="true" /> : null}
                    </button>
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
    </div>
  );
}
