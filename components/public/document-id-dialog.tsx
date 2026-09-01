"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitDocumentId } from "@/app/s/[token]/actions";

// Mandatory, non-dismissible: shown only when this client has no
// document_id on file (checked server-side, not a per-browser flag — see
// submit_shared_document_id()'s own "never overwrite" guard). No close
// button, no click-outside, no Escape — the only way out is submitting a
// value, which persists for every future visit, by anyone, forever.
export function DocumentIdDialog({ token, initialDocumentId }: { token: string; initialDocumentId: string | null }) {
  const [documentId, setDocumentId] = useState<string | null>(initialDocumentId);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (documentId) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    const result = await submitDocumentId(token, value);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setDocumentId(result.documentId);
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
          <DialogTitle>Confirma tu documento de identidad</DialogTitle>
          <DialogDescription>
            Para ayudarte a encontrar tu cuenta más fácilmente en el futuro, indícanos tu cédula o
            documento de identidad.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="shared_document_id">Cédula/documento</Label>
            <Input
              id="shared_document_id"
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
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
