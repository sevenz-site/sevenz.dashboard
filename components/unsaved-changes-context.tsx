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

type UnsavedChangesContextValue = {
  // A form with unsaved changes registers itself here so any exit attempt
  // (sidebar nav, logout, browser back/refresh/close) can offer to save
  // before leaving instead of just blocking or silently discarding.
  setDirty: (dirty: boolean, onSave?: SaveFn) => void;
  // Anything that would navigate away calls this instead of navigating
  // directly — it runs `proceed` immediately when nothing is dirty, or
  // opens the confirm dialog and runs it only if the user allows the exit.
  guard: (proceed: () => void) => void;
};

const UnsavedChangesContext = createContext<UnsavedChangesContextValue | null>(null);

export function UnsavedChangesProvider({ children }: { children: React.ReactNode }) {
  const isDirtyRef = useRef(false);
  const saveRef = useRef<SaveFn | null>(null);
  const pendingRef = useRef<(() => void) | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const setDirty = useCallback((dirty: boolean, onSave?: SaveFn) => {
    isDirtyRef.current = dirty;
    if (dirty && onSave) saveRef.current = onSave;
    if (!dirty) saveRef.current = null;
  }, []);

  const guard = useCallback((proceed: () => void) => {
    if (!isDirtyRef.current) {
      proceed();
      return;
    }
    pendingRef.current = proceed;
    setOpen(true);
  }, []);

  function handleLeaveWithoutSaving() {
    setOpen(false);
    isDirtyRef.current = false;
    saveRef.current = null;
    pendingRef.current?.();
    pendingRef.current = null;
  }

  async function handleSaveAndLeave() {
    if (!saveRef.current) {
      handleLeaveWithoutSaving();
      return;
    }
    setSaving(true);
    const ok = await saveRef.current();
    setSaving(false);
    if (!ok) return; // error already surfaced by the form itself; stay on the dialog
    setOpen(false);
    pendingRef.current?.();
    pendingRef.current = null;
  }

  return (
    <UnsavedChangesContext.Provider value={{ setDirty, guard }}>
      {children}
      <AlertDialog open={open} onOpenChange={(next) => !saving && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Salir sin guardar los cambios?</AlertDialogTitle>
            <AlertDialogDescription>
              Hiciste cambios en &quot;Mi negocio&quot; que todavía no se han guardado.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
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
