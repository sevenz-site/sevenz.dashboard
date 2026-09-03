"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitDocumentId } from "@/app/s/[token]/actions";
import { useFieldErrors, useFormRef } from "@/hooks/use-field-errors";
import { required } from "@/lib/form-validation";

// Mandatory, non-dismissible: shown only when this client has no
// document_id on file (checked server-side, not a per-browser flag — see
// submit_shared_document_id()'s own "never overwrite" guard). No close
// button, no click-outside, no Escape — the only way out is submitting a
// value, which persists for every future visit, by anyone, forever.
export function DocumentIdDialog({
  token,
  clientName,
  initialDocumentId,
}: {
  token: string;
  clientName: string;
  initialDocumentId: string | null;
}) {
  const router = useRouter();
  const [documentId, setDocumentId] = useState<string | null>(initialDocumentId);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [formRef, setFormRef] = useFormRef();
  const { errors, validate, recheck } = useFieldErrors({ document_id: required });

  if (documentId) return null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!validate(e.currentTarget)) return;
    setPending(true);
    const result = await submitDocumentId(token, value);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDocumentId(result.documentId);
    // The "Cédula/documento: —" line above is rendered by the parent
    // Server Component from data fetched once at page load — without this,
    // it keeps showing the old (missing) value until a manual reload.
    router.refresh();
  }

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>¡Hola {clientName}, confirma tu cédula!</DialogTitle>
          <DialogDescription>
            Para ayudarte a encontrar tu cuenta más fácilmente en el futuro, indícanos tu cédula o
            documento de identidad.
          </DialogDescription>
        </DialogHeader>
        <form ref={setFormRef} onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="shared_document_id">Número de cédula</Label>
            <Input
              id="shared_document_id"
              name="document_id"
              autoFocus
              required
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                recheck("document_id", formRef.current);
              }}
              aria-invalid={Boolean(errors.document_id)}
            />
            {errors.document_id ? (
              <p className="text-xs text-destructive">{errors.document_id}</p>
            ) : null}
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <Button type="submit" disabled={pending}>
            {pending ? "Guardando..." : "Guardar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
