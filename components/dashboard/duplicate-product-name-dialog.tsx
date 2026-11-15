"use client";

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

// THE WARNING FOR A PRODUCT NAME THAT IS ALREADY IN THE CATALOGUE. Owner's request of
// 2026-11-15: «El app debe mostrar modal de alerta cuando se crea un producto repetido
// (nombre), la modal debe alertar pero no limitar la creación del producto».
//
// It WARNS AND LETS THROUGH: «Crear igual» creates it, «Cambiar nombre» goes back to the
// form with everything typed still there. One component for the two doors that create a
// product -- the product wizard and the quick sheet inside a sale -- so they say the same
// thing (CLAUDE.md, «Un valor visual que sale en más de una pantalla NACE en un componente»).
//
// Not drawn in Figma: the copy is mine and is said in the report.
export function DuplicateProductNameDialog({
  open,
  name,
  onCreateAnyway,
  onCancel,
  nameInputId,
}: {
  open: boolean;
  name: string;
  onCreateAnyway: () => void;
  // Closing by any means: Escape, outside, or «Cambiar nombre».
  onCancel: () => void;
  // The field «Cambiar nombre» puts the cursor in. Measured on 2026-11-15: in the wizard the
  // warning comes on step 4 and the name lives on step 1, so closing alone left the owner on
  // «Crear producto» with no name field in sight. The caller brings the field on screen in
  // `onCancel`; this focuses it once the dialog has handed focus back.
  nameInputId?: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => (v ? null : onCancel())}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Ya tienes un producto con este nombre</AlertDialogTitle>
          <AlertDialogDescription>
            «{name.trim()}» ya está en tu catálogo. Si es otro producto, puedes crearlo igual; si es el
            mismo, cámbiale el nombre o búscalo en tu catálogo.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel
            onClick={() => {
              onCancel();
              if (!nameInputId) return;
              // After Radix returns focus to the trigger, and after the step has re-rendered.
              setTimeout(() => {
                const input = document.getElementById(nameInputId) as HTMLInputElement | null;
                input?.focus();
                input?.select();
              }, 50);
            }}
          >
            Cambiar nombre
          </AlertDialogCancel>
          <AlertDialogAction onClick={onCreateAnyway}>Crear igual</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
