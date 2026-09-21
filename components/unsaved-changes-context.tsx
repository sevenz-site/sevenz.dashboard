"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";

type SaveFn = () => Promise<boolean>;
// A form that traps the physical back button (see business-settings-form's
// popstate handler) pushes a sentinel history entry while dirty — this is
// how it gets a chance to clean that entry up before any navigation away
// actually proceeds, regardless of which path triggered it (discard,
// save-and-leave, or even a later navigation after an in-place save that
// never went through the dialog at all).
type BeforeLeaveFn = () => Promise<void> | void;

// Lo que dice el diálogo. Estaba fijo a "Mi negocio", que era el único que lo
// usaba; la revisión de una libreta importada pierde otra cosa y tiene que
// decirlo con sus palabras.
export type TextoDeSalida = { titulo: string; cuerpo: string };

const TEXTO_POR_DEFECTO: TextoDeSalida = {
  titulo: "¿Salir sin guardar los cambios?",
  cuerpo: 'Hiciste cambios en "Mi negocio" que todavía no se han guardado.',
};

type UnsavedChangesContextValue = {
  // A form with unsaved changes registers itself here so any exit attempt
  // (sidebar nav, logout, browser back/refresh/close) can offer to save
  // before leaving instead of just blocking or silently discarding.
  setDirty: (
    dirty: boolean,
    onSave?: SaveFn,
    onBeforeLeave?: BeforeLeaveFn,
    texto?: TextoDeSalida,
  ) => void;
  // Anything that would navigate away calls this instead of navigating
  // directly — it runs `proceed` immediately when nothing is dirty, or
  // opens the confirm dialog and runs it only if the user allows the exit.
  guard: (proceed: () => void) => void;
};

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const isDirtyRef = useRef(false);
  const saveRef = useRef<SaveFn | null>(null);
  // Deliberately never cleared on `setDirty(false, ...)` — a sentinel
  // pushed while dirty can still be sitting in the browser's history stack
  // after dirty goes back to false (e.g. a successful in-place save), and
  // needs to be consumed before whatever navigation happens next, whenever
  // that ends up being.
  const beforeLeaveRef = useRef<BeforeLeaveFn | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const textoRef = useRef<TextoDeSalida>(TEXTO_POR_DEFECTO);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  // Se copian del ref al estado al ABRIR, no se leen del ref al pintar: un ref
  // no provoca render, así que el diálogo se habría quedado con el texto y los
  // botones de la vez anterior.
  const [texto, setTexto] = useState<TextoDeSalida>(TEXTO_POR_DEFECTO);
  const [sePuedeGuardar, setSePuedeGuardar] = useState(false);

  const setDirty = useCallback(
    (dirty: boolean, onSave?: SaveFn, onBeforeLeave?: BeforeLeaveFn, texto?: TextoDeSalida) => {
      isDirtyRef.current = dirty;
      if (dirty) {
        if (onSave) saveRef.current = onSave;
        if (onBeforeLeave) beforeLeaveRef.current = onBeforeLeave;
        textoRef.current = texto ?? TEXTO_POR_DEFECTO;
      } else {
        saveRef.current = null;
        textoRef.current = TEXTO_POR_DEFECTO;
      }
    },
    [],
  );

  const guard = useCallback((proceed: () => void) => {
    if (!isDirtyRef.current) {
      Promise.resolve(beforeLeaveRef.current?.()).finally(proceed);
      return;
    }
    pendingRef.current = proceed;
    setTexto(textoRef.current);
    // "Guardar y salir" solo si hay algo que guardar de un toque. Importar una
    // libreta NO lo es: guardar ahí significa escribir veintitantos
    // movimientos, y eso tiene su propia confirmación con sus propios
    // requisitos. Un botón que se saltara esa revisión sería justo el error
    // que la revisión existe para evitar.
    setSePuedeGuardar(saveRef.current !== null);
    setOpen(true);
  }, []);

  async function handleLeaveWithoutSaving() {
    setOpen(false);
    isDirtyRef.current = false;
    saveRef.current = null;
    await beforeLeaveRef.current?.();
    pendingRef.current?.();
    pendingRef.current = null;
  }

  async function handleSaveAndLeave() {
    if (!saveRef.current) {
      await handleLeaveWithoutSaving();
      return;
    }
    setSaving(true);
    const ok = await saveRef.current();
    setSaving(false);
    if (!ok) return; // error already surfaced by the form itself; stay on the dialog
    setOpen(false);
    await beforeLeaveRef.current?.();
    pendingRef.current?.();
    pendingRef.current = null;
  }

  return (
    <UnsavedChangesContext.Provider value={{ setDirty, guard }}>
      {children}
      <AlertDialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{texto.titulo}</AlertDialogTitle>
            <AlertDialogDescription>{texto.cuerpo}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
            {sePuedeGuardar ? (
              <>
                <Button variant="outline" disabled={saving} onClick={handleLeaveWithoutSaving}>
                  Salir sin guardar
                </Button>
                <AlertDialogAction
                  disabled={saving}
                  onClick={(e) => {
                    e.preventDefault();
                    handleSaveAndLeave();
                  }}
                >
                  {saving ? "Guardando..." : "Guardar y salir"}
                </AlertDialogAction>
              </>
            ) : (
              <AlertDialogAction
                disabled={saving}
                onClick={(e) => {
                  e.preventDefault();
                  handleLeaveWithoutSaving();
                }}
              >
                Salir sin guardar
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChangesGuard() {
  const ctx = useContext(UnsavedChangesContext);
  if (!ctx) {
    throw new Error("useUnsavedChangesGuard must be used within UnsavedChangesProvider");
  }
  return ctx;
}
