"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { Check, MoreVertical, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { EmptyState } from "@/components/dashboard/empty-state";
import { SearchField } from "@/components/dashboard/client-search-sheet";
import { useKeyboardOpen } from "@/hooks/use-keyboard-open";
import { foldForSearch } from "@/lib/search/fold";
import { crearCategoria, eliminarCategoria, renombrarCategoria } from "@/app/(app)/productos/actions";
import {
  MAX_NOMBRE_DE_CATEGORIA,
  errorDeNombreDeCategoria,
  ordenarCategorias,
  type Categoria,
} from "@/lib/products/categories";

// THE CATEGORY SHEET AND ITS POPUP — sitemap `1963:15912`, owner's request of
// 2026-11-03. Frames: `1961:16107` (no categories), `1961:16584` (with them),
// `1961:16357` (the popup). Two arrows lead here:
//
//   - «Categoría» in the product flow, which also PICKS one (`picker`);
//   - «Editar» in the catalogue's «Categorías» section, which only manages.
//     Owner's decision that day: no check and no tapping a row from there,
//     because nothing is being chosen; filtering stays with the chips.
//
// THE SITEMAP'S DIAMOND, «¿Hay categoría?», is simply `categorias.length`: one
// sheet that draws either state, so creating the first category moves it from
// the empty frame to the list on its own, which is where the «Crear» arrow
// lands.
//
// WHAT THE FRAMES DO NOT DRAW, and was settled on 2026-11-03:
//
//   - «Editar» has no arrow. It opens the same popup, «Editar categoría» and
//     «Guardar» (owner's decision).
//   - There is no «Sin categoría» row any more. Tapping the chosen row removes
//     it (owner's decision), and the sheet closes either way.
//   - «Eliminar» keeps its confirmation, which says how many products are left
//     without a category. That is why `productos` stays in the type although
//     the rows no longer print it.
//   - A search with no match reuses the wording of the client's catalogue.
//
// A CATEGORY CREATED FROM THE PRODUCT FLOW COMES BACK CHOSEN, and the sheet
// stays open: the «Crear» arrow returns to the list, and that is the row with
// the check in frame `1961:16584`. Until 2026-11-03 creating closed the sheet.
//
// THE LIST BELONGS TO THE CALLER, which keeps it in state: creating, renaming
// or deleting updates it at once, so neither the chips nor the field show a
// stale name while the server revalidates.

export type CategoriaConConteo = Categoria & { productos: number };

type Popup = { id: string | null; nombre: string };

export function CategoryManagerSheet({
  open,
  onOpenChange,
  categorias,
  onCategoriasChange,
  picker,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categorias: CategoriaConConteo[];
  onCategoriasChange: (next: CategoriaConConteo[]) => void;
  // Present in the product flow only: rows become choices.
  picker?: { value: string | null; onPick: (id: string | null) => void };
}) {
  const [busqueda, setBusqueda] = useState("");
  const [popup, setPopup] = useState<Popup | null>(null);
  const [errorDelPopup, setErrorDelPopup] = useState<string | null>(null);
  const [borrando, setBorrando] = useState<CategoriaConConteo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();
  const tecladoAbierto = useKeyboardOpen();

  // THE FOCUS IS OURS BOTH WAYS (DESIGN-SYSTEM.md): closing, the menu hands
  // focus back to its «⋮», which took it from the popup's field just after the
  // popup claimed it (measured 2026-11-03). So the menu gives it up when an
  // option opens a dialog, and the dialog hands it to the sheet on the way
  // out, because its row may no longer exist.
  const hojaRef = useRef<HTMLDivElement>(null);
  const abreCapa = useRef(false);
  const volverALaHoja = (e: Event) => {
    e.preventDefault();
    hojaRef.current?.focus();
  };

  // Every opening starts clean: no error and no search left over from the
  // last time. Both doors open it by flipping `open` from outside, so the
  // reset hangs off the prop, not off a click handler.
  const [estabaAbierta, setEstabaAbierta] = useState(open);
  if (open !== estabaAbierta) {
    setEstabaAbierta(open);
    if (open) {
      setError(null);
      setBusqueda("");
      setPopup(null);
    }
  }

  const visibles = useMemo(() => {
    const q = foldForSearch(busqueda.trim());
    const ordenadas = ordenarCategorias(categorias) as CategoriaConConteo[];
    return q ? ordenadas.filter((c) => foldForSearch(c.name).includes(q)) : ordenadas;
  }, [categorias, busqueda]);

  function abrirPopup(categoria: CategoriaConConteo | null) {
    setError(null);
    setErrorDelPopup(null);
    setPopup({ id: categoria?.id ?? null, nombre: categoria?.name ?? "" });
  }

  function guardarPopup() {
    if (!popup || pendiente) return;
    const { id, nombre } = popup;
    const aviso = errorDeNombreDeCategoria(nombre, categorias, id ?? undefined);
    if (aviso) return setErrorDelPopup(aviso);
    setErrorDelPopup(null);
    startTransition(async () => {
      if (id) {
        const r = await renombrarCategoria(id, nombre);
        if ("error" in r) return setErrorDelPopup(r.error);
        onCategoriasChange(categorias.map((c) => (c.id === id ? { ...c, name: r.categoria.name } : c)));
      } else {
        const r = await crearCategoria(nombre);
        if ("error" in r) return setErrorDelPopup(r.error);
        onCategoriasChange([...categorias, { ...r.categoria, productos: 0 }]);
        picker?.onPick(r.categoria.id);
        // A leftover search could hide the row just created.
        setBusqueda("");
      }
      setPopup(null);
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
      setBorrando(null);
    });
  }

  const creando = popup?.id === null;

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        {/* `dvh`, not `vh`: the same trap the «Registrar» sheet documents. */}
        <SheetContent
          ref={hojaRef}
          side="bottom"
          showCloseButton={false}
          className="flex max-h-[90dvh] flex-col gap-0 rounded-t-[16px]"
        >
          {/* The X comes first on purpose: Radix focuses the first control of
              a sheet, and if that were the search field the keyboard would
              rise over the list on every opening. */}
          <div className="flex items-start justify-between gap-2.5 px-4 py-6">
            <div className="flex min-w-0 flex-1 flex-col">
              <SheetTitle className="text-base leading-6 font-semibold text-primary">Categorías</SheetTitle>
              <SheetDescription className="text-sm leading-5">
                Gestiona las categorías para organizar tus productos en el catálogo.
              </SheetDescription>
            </div>
            <SheetClose asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Cerrar categorías" className="shrink-0">
                <X className="size-5" aria-hidden="true" />
              </Button>
            </SheetClose>
          </div>

          {categorias.length === 0 ? (
            <div className="px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
              {/* «Crea una nueva categoría», singular: the frame reads «una
                  nueva categorías», taken for a typo. */}
              <EmptyState
                title="Aún no tienes categorías creadas"
                subtitle="Crea una nueva categoría para organizar tus productos en el catálogo."
              >
                <Button type="button" className="h-10 w-full gap-2 text-base font-semibold" onClick={() => abrirPopup(null)}>
                  <Plus className="size-4" aria-hidden="true" />
                  Crear categoría
                </Button>
              </EmptyState>
            </div>
          ) : (
            <>
              <div className="px-4 pt-2 pb-4">
                <SearchField size="sheet" value={busqueda} onChange={setBusqueda} placeholder="Buscar categoría" />
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
                {visibles.length === 0 ? (
                  <EmptyState title={`No encontramos nada con «${busqueda.trim()}»`} subtitle="Prueba con otra palabra." />
                ) : (
                  <ul className="flex flex-col gap-3">
                    {visibles.map((c) => {
                      const elegida = picker?.value === c.id;
                      return (
                        <li
                          key={c.id}
                          // Both rows measure 50px in the frame.
                          className={`flex h-[50px] items-center gap-2.5 rounded-[10px] border px-2.5 ${
                            elegida ? "border-primary bg-accent" : "border-border"
                          }`}
                        >
                          {picker ? (
                            <button
                              type="button"
                              aria-pressed={elegida}
                              onClick={() => {
                                picker.onPick(elegida ? null : c.id);
                                onOpenChange(false);
                              }}
                              className="flex h-full min-w-0 flex-1 items-center gap-1 text-left text-sm leading-5 text-primary outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                            >
                              {elegida ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
                              <span className="truncate">{c.name}</span>
                            </button>
                          ) : (
                            <span className="min-w-0 flex-1 truncate text-sm leading-5 text-primary">{c.name}</span>
                          )}
                          {/* «⋮» INSTEAD OF A BIN AND A PENCIL, owner's request of
                              2026-11-03: *«elimina los botones "Editar" y "Eliminar",
                              cambiemoslo por botón "More"»*. This displaces the two
                              buttons of frame `1961:16584`, and both options lead
                              where those did.

                              `modal={false}`: each option opens a dialog of its own,
                              and a modal menu keeps its focus trap alive under it
                              (DESIGN-SYSTEM.md, «Un menú de Radix que se queda
                              montado no devuelve el foco»). */}
                          <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Más opciones de ${c.name}`}
                                className="shrink-0"
                                disabled={pendiente}
                              >
                                <MoreVertical className="size-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              onCloseAutoFocus={(e) => {
                                if (abreCapa.current) e.preventDefault();
                                abreCapa.current = false;
                              }}
                            >
                              <DropdownMenuItem
                                onSelect={() => {
                                  abreCapa.current = true;
                                  abrirPopup(c);
                                }}
                              >
                                <Pencil className="size-4" aria-hidden="true" />
                                Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => {
                                  abreCapa.current = true;
                                  setError(null);
                                  setBorrando(c);
                                }}
                              >
                                <Trash2 className="size-4" aria-hidden="true" />
                                Eliminar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {error ? <p className="text-sm text-destructive">{error}</p> : null}
              </div>

              {/* CLAUDE.md: nothing stays stuck to the bottom edge with the
                  keyboard up, and the search field raises it right here. */}
              {tecladoAbierto ? null : (
                <div className="flex flex-col gap-4 px-4 pt-6 pb-[calc(env(safe-area-inset-bottom)+2.5rem)]">
                  <Button type="button" className="h-10 w-full gap-2 text-base font-semibold" onClick={() => abrirPopup(null)}>
                    <Plus className="size-5" aria-hidden="true" />
                    Crear categoría
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 w-full text-base font-semibold"
                    onClick={() => onOpenChange(false)}
                  >
                    Cerrar
                  </Button>
                </div>
              )}
            </>
          )}
        </SheetContent>
      </Sheet>

      <Dialog
        open={popup !== null}
        onOpenChange={(o) => {
          if (!o && !pendiente) setPopup(null);
        }}
      >
        {/* HIGH ON A PHONE, not centred: at 812px tall a centred 262px popup
            ends at 537, and the iPhone keyboard starts near 476, on top of
            «Cancelar». At 12dvh it ends near 360. `grid-cols` is the
            DESIGN-SYSTEM.md trap of a `DialogContent` that does not shrink. */}
        <DialogContent
          showCloseButton={false}
          aria-describedby={undefined}
          onCloseAutoFocus={volverALaHoja}
          className="top-[12dvh] translate-y-0 grid-cols-[minmax(0,1fr)] gap-5 rounded-[16px] bg-background p-4 sm:top-1/2 sm:-translate-y-1/2"
        >
          <div className="flex items-center justify-between gap-2.5">
            <DialogTitle className="text-xl leading-[26px] font-medium">
              {creando ? "Crear categoría" : "Editar categoría"}
            </DialogTitle>
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Cerrar" className="shrink-0" disabled={pendiente}>
                <X className="size-5" aria-hidden="true" />
              </Button>
            </DialogClose>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="categoria_nombre" className="text-sm leading-5 font-normal">
              Nombre de categoría
            </Label>
            {/* Enter is handled here and the buttons are `type="button"`: this
                popup is rendered from inside the product flow, and a React
                submit would bubble through the portal to whatever form holds
                it. */}
            <Input
              id="categoria_nombre"
              autoFocus
              value={popup?.nombre ?? ""}
              maxLength={MAX_NOMBRE_DE_CATEGORIA}
              onChange={(e) => setPopup((p) => (p ? { ...p, nombre: e.target.value } : p))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  guardarPopup();
                }
              }}
              placeholder="Escribe nombre"
              className="h-10 rounded-[12px] px-3"
            />
            {errorDelPopup ? <p className="text-sm text-destructive">{errorDelPopup}</p> : null}
          </div>

          <div className="flex flex-col gap-5">
            <Button
              type="button"
              className="h-10 w-full gap-2 text-base font-semibold"
              onClick={guardarPopup}
              disabled={pendiente || !popup?.nombre.trim()}
            >
              {creando ? <Plus className="size-5" aria-hidden="true" /> : null}
              {creando ? "Crear" : "Guardar"}
            </Button>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-10 w-full text-base font-semibold" disabled={pendiente}>
                Cancelar
              </Button>
            </DialogClose>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={borrando !== null} onOpenChange={(o) => (o ? null : setBorrando(null))}>
        <AlertDialogContent onCloseAutoFocus={volverALaHoja}>
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
