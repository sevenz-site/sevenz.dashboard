"use client";

import { useState, useTransition } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { logout } from "@/app/(app)/actions";

// Owner's decision on 2026-11-02: «Cerrar sesión» asks where. There is no
// Figma frame for this dialog; the copy and the layout are ours, built on the
// app's AlertDialog, and are flagged as such in the delivery report.
//
// THE THREE BUTTONS ARE STACKED AT EVERY WIDTH. The AlertDialog footer lays
// its buttons in a row from `sm`, and in a 384px-wide dialog «En todos mis
// dispositivos» next to two others does not fit. A full-width button is
// allowed by DESIGN-SYSTEM.md when it takes a whole row by design, which is
// what a list of choices is.
//
// «Solo en este dispositivo» is the filled one because it is the everyday
// case; «en todos» is the one an owner reaches for once, after losing a phone.
export function LogoutDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<"local" | "global" | null>(null);
  const [, startTransition] = useTransition();

  const signOut = (scope: "local" | "global") => {
    setError(null);
    setPending(scope);
    startTransition(async () => {
      // On success the action redirects to /login and this component goes
      // away with the page. Only a failure comes back here.
      const r = await logout(scope);
      setError(r.error);
      setPending(null);
    });
  };

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        // Closing mid-request would hide the error the owner most needs: the
        // one saying the other devices were NOT signed out.
        if (pending) return;
        if (!o) setError(null);
        onOpenChange(o);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cerrar sesión</AlertDialogTitle>
          <AlertDialogDescription>
            Si perdiste un teléfono o crees que alguien más entró a tu cuenta, elige «En todos mis
            dispositivos»: te saca también de este.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <AlertDialogFooter className="sm:flex-col-reverse sm:justify-start">
          <AlertDialogCancel disabled={pending !== null} className="w-full">
            Cancelar
          </AlertDialogCancel>
          <Button
            variant="outline"
            className="w-full"
            disabled={pending !== null}
            onClick={() => signOut("global")}
          >
            {pending === "global" ? "Cerrando sesión..." : "En todos mis dispositivos"}
          </Button>
          <Button className="w-full" disabled={pending !== null} onClick={() => signOut("local")}>
            {pending === "local" ? "Cerrando sesión..." : "Solo en este dispositivo"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
