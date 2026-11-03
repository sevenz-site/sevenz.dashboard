"use client";

import { useRef, useState } from "react";
import { Copy, MoreVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { PaymentMethodDialog } from "@/components/dashboard/payment-method-dialog";
import { deletePaymentMethod, type PaymentMethod } from "@/app/(app)/profile/actions";
import { renderFormattedText, toWhatsappText } from "@/lib/format-text";
import { copyText } from "@/lib/copy-text";

// Mirrors PAYMENT_METHODS_LIMIT in profile/actions.ts: "Agregar" disappears at
// this count instead of letting the owner type a method the server refuses.
const LIMIT = 10;

// "Métodos de pago", frame `1928:24764` (empty: `1927:24373`, filled:
// `1927:24510`). Lives OUTSIDE the business-settings <form> on purpose: every
// change here saves on its own (owner's choice, 2026-11-02), and React bubbles
// events through portals, so a dialog rendered from inside the form would mark
// the form dirty with every keystroke and its submit would reach the form's
// own handler.
export function PaymentMethodsCard({ initialMethods }: { initialMethods: PaymentMethod[] }) {
  const [methods, setMethods] = useState(initialMethods);
  const [adding, setAdding] = useState(false);
  const atLimit = methods.length >= LIMIT;

  return (
    <section className="flex flex-col gap-6 rounded-[10px] border p-4">
      {methods.length === 0 ? (
        <>
          <p className="text-sm">Métodos de pago</p>
          <EmptyState
            title="Aún no tienes métodos de pagos registrados"
            subtitle="Agrega un método de pago para compartirlos con tus clientes"
          >
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full text-base font-semibold"
              onClick={() => setAdding(true)}
            >
              <Plus className="size-5" aria-hidden="true" />
              Agregar método de pago
            </Button>
          </EmptyState>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm">Métodos de pago</p>
            {atLimit ? null : (
              <Button
                type="button"
                variant="outline"
                className="h-10 text-base font-semibold"
                onClick={() => setAdding(true)}
              >
                <Plus className="size-5" aria-hidden="true" />
                Agregar
              </Button>
            )}
          </div>
          <ul className="flex flex-col gap-2">
            {methods.map((m) => (
              <PaymentMethodRow
                key={m.id}
                method={m}
                onSaved={(saved) => setMethods((list) => list.map((x) => (x.id === saved.id ? saved : x)))}
                onDeleted={() => setMethods((list) => list.filter((x) => x.id !== m.id))}
              />
            ))}
          </ul>
        </>
      )}

      <PaymentMethodDialog
        open={adding}
        onOpenChange={setAdding}
        onSaved={(saved) => setMethods((list) => [...list, saved])}
      />
    </section>
  );
}

// `copyText` falls back to execCommand when the Clipboard API is refused
// (measured in this environment's browser pane on 2026-11-02, and the same
// happens in in-app WebViews). If both fail, the text is still on screen.
async function copyMethod(body: string) {
  const ok = await copyText(toWhatsappText(body));
  if (ok) toast.success("Método de pago copiado");
  else toast.error("No pudimos copiarlo. Mantén pulsado el texto para copiarlo a mano.");
}

function PaymentMethodRow({
  method,
  onSaved,
  onDeleted,
}: {
  method: PaymentMethod;
  onSaved: (m: PaymentMethod) => void;
  onDeleted: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);

  // The card shows the first line as its title and the rest underneath in
  // small grey, as the frame draws «Pago móvil» over «414 000 00 00, Juan
  // Pérez». The method is one free text, so this is a reading of it, not two
  // fields: a single-line method is just a title.
  const [title, ...rest] = method.body.split("\n");
  const detail = rest.join("\n").trim();

  // DESIGN-SYSTEM.md, "Un menú de Radix que se queda montado no devuelve el
  // foco": the menu is `modal={false}` and focus goes back to ⋮ by hand when
  // a dialog it opened closes.
  function returnFocus() {
    requestAnimationFrame(() => moreRef.current?.focus());
  }

  async function handleDelete() {
    setDeleting(true);
    const result = await deletePaymentMethod(method.id);
    setDeleting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setConfirmingDelete(false);
    toast.success("Método de pago eliminado");
    onDeleted();
  }

  return (
    <li className="flex items-start gap-2 rounded-[10px] border p-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1 break-words">
        <p className="text-sm">{renderFormattedText(title)}</p>
        {detail ? <p className="text-xs text-muted-foreground">{renderFormattedText(detail)}</p> : null}
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="-my-2 size-8 shrink-0"
        aria-label="Copiar método de pago"
        onClick={() => copyMethod(method.body)}
      >
        <Copy className="size-4" aria-hidden />
      </Button>

      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            ref={moreRef}
            type="button"
            variant="ghost"
            size="icon"
            className="-my-2 -mr-2 size-8 shrink-0"
            aria-label="Más opciones de este método de pago"
          >
            <MoreVertical className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        {/* No `preventDefault` on the items: the menu is non-modal, so letting
            it close is safe, and keeping it open left it floating over the
            dialog it had just opened (seen on 2026-11-02). */}
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => copyMethod(method.body)}>
            <Copy className="size-4" />
            Copiar
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setEditing(true)}
          >
            <Pencil className="size-4" />
            Editar
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setConfirmingDelete(true)}
          >
            <Trash2 className="size-4" />
            Eliminar
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <PaymentMethodDialog
        open={editing}
        onOpenChange={(open) => {
          setEditing(open);
          if (!open) returnFocus();
        }}
        method={method}
        onSaved={onSaved}
      />

      {/* Not in the frame: a confirmation before deleting, the same one the
          logo and an abono already ask for. A deleted method has to be typed
          again from scratch, and the ⋮ menu sits a thumb away from "Copiar". */}
      <AlertDialog
        open={confirmingDelete}
        onOpenChange={(open) => {
          setConfirmingDelete(open);
          if (!open) returnFocus();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este método de pago?</AlertDialogTitle>
            <AlertDialogDescription>
              Dejará de aparecer en tu lista. Si lo necesitas otra vez, tendrás que escribirlo de nuevo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
            >
              {deleting ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
