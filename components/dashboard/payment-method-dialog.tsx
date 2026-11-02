"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FormattedTextarea } from "@/components/dashboard/formatted-textarea";
import { addPaymentMethod, updatePaymentMethod, type PaymentMethod } from "@/app/(app)/profile/actions";

// "Agregar método de pago", frame `1927:24696`. The same dialog edits an
// existing method when given one; the frame only draws the "Agregar" state,
// so the "Editar método de pago" title is ours.
//
// Saves on its own when "Guardar cambios" is pressed (owner's choice,
// 2026-11-02: «Al instante»), like the logo and the WhatsApp switch. It never
// touches the business-settings form, so the unsaved-changes guard keeps
// meaning "the fields of the form".
export function PaymentMethodDialog({
  open,
  onOpenChange,
  method,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  method?: PaymentMethod;
  onSaved: (method: PaymentMethod) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // Also keeps this submit from reaching any form an ancestor renders:
    // React bubbles events through the portal.
    e.stopPropagation();
    if (pending) return;

    const body = String(new FormData(e.currentTarget).get("body") ?? "");
    if (!body.trim()) {
      setError("Escribe el método de pago.");
      return;
    }

    setPending(true);
    const result = method ? await updatePaymentMethod(method.id, body) : await addPaymentMethod(body);
    setPending(false);
    if (result.error || !result.method) {
      setError(result.error ?? "No pudimos guardar el método de pago.");
      return;
    }

    setError(null);
    toast.success(method ? "Método de pago actualizado" : "Método de pago agregado");
    onSaved(result.method);
    onOpenChange(false);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="gap-5">
        <DialogHeader>
          <DialogTitle className="text-xl font-medium">
            {method ? "Editar método de pago" : "Agregar método de pago"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Escribe cómo te pueden pagar tus clientes. Puedes copiarlo después para mandarlo por WhatsApp.
          </DialogDescription>
        </DialogHeader>
        {/* `key` remounts the field each time the dialog opens, so a draft
            abandoned with the X is not waiting there the next time. */}
        <form key={open ? "open" : "closed"} onSubmit={handleSubmit} className="flex flex-col gap-5">
          <FormattedTextarea
            id={method ? `payment-method-${method.id}` : "payment-method-new"}
            name="body"
            label="Método de pago"
            defaultValue={method?.body}
            placeholder="Escribe método de pago"
            invalid={Boolean(error)}
          />
          {error ? <p className="-mt-3 text-xs text-destructive">{error}</p> : null}
          <Button type="submit" disabled={pending} className="h-10 w-full text-base font-semibold">
            {pending ? "Guardando..." : "Guardar cambios"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
