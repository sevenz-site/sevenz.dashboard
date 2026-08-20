"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Plus, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { createClientWithMovement, type MovementFormState } from "@/app/(app)/dashboard/actions";
import { AttachmentUploader } from "@/components/dashboard/attachment-uploader";
import { PlazoPagoSelect } from "@/components/dashboard/plazo-pago-select";
import { WhatsappInput } from "@/components/whatsapp-input";
import { useTour } from "@/components/dashboard/tour-context";
import { track } from "@/lib/mixpanel";
import { DEFAULT_PLAZO_PAGO } from "@/lib/types";

const initialState: MovementFormState = { error: null, clientId: null };

type ClientOption = { id: string; name: string; document_id: string | null };

export function ClientSearchDialog({
  clients,
  ownerId,
  businessName,
}: {
  clients: ClientOption[];
  ownerId: string;
  businessName: string;
}) {
  const router = useRouter();
  const tour = useTour();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"search" | "new">("search");
  const [query, setQuery] = useState("");
  const [plazoPago, setPlazoPago] = useState(DEFAULT_PLAZO_PAGO);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(createClientWithMovement, initialState);
  const [prevOpen, setPrevOpen] = useState(open);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return clients
      .filter((c) => c.name.toLowerCase().includes(q) || c.document_id?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [clients, query]);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setStep("search");
      setQuery("");
      setPhotoPath(null);
    }
  }

  const [handledState, setHandledState] = useState(state);
  if (state !== handledState && state.clientId) {
    setHandledState(state);
    setOpen(false);
  }

  useEffect(() => {
    if (state === initialState || pending || state.error) return;
    if (state.clientId) {
      toast.success("Cliente registrado");
      track("Client Created", { client_id: state.clientId });
      router.push(`/clients/${state.clientId}`);
    }
  }, [state, pending, router]);

  function selectExisting(id: string) {
    setOpen(false);
    router.push(`/clients/${id}`);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          data-tour="new-client-button"
          onClick={() => {
            if (tour.step === 1) tour.advance();
          }}
        >
          <Plus className="size-4" />
          Nuevo movimiento
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        {step === "search" ? (
          <>
            <DialogHeader>
              <DialogTitle>Buscar cliente</DialogTitle>
              <DialogDescription>Negocio: {businessName} · busca por nombre o cédula.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <Input
                autoFocus
                placeholder="Nombre o cédula del cliente"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />

              {results.length > 0 ? (
                <ul className="flex flex-col divide-y rounded-md border">
                  {results.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => selectExisting(c.id)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                      >
                        <UserRound className="size-4 text-muted-foreground" />
                        <span className="font-medium">{c.name}</span>
                        {c.document_id ? (
                          <span className="text-xs text-muted-foreground">{c.document_id}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : query.trim() ? (
                <p className="text-sm text-muted-foreground">Sin resultados para &quot;{query}&quot;.</p>
              ) : null}

              <Button type="button" variant="outline" onClick={() => setStep("new")}>
                <Plus className="size-4" />
                {query.trim() ? `Nuevo cliente: "${query.trim()}"` : "Nuevo cliente"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6"
                  onClick={() => setStep("search")}
                >
                  <ArrowLeft className="size-4" />
                </Button>
                <DialogTitle>Registrar cliente nuevo</DialogTitle>
              </div>
              <DialogDescription>
                Negocio: {businessName} · queda con el primer movimiento registrado.
              </DialogDescription>
            </DialogHeader>
            <form action={formAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <Label htmlFor="new_client_name">Nombre del cliente</Label>
                <Input id="new_client_name" name="new_client_name" defaultValue={query} required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="whatsapp">WhatsApp (opcional)</Label>
                <WhatsappInput id="whatsapp" name="whatsapp" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="document_id">Cédula/documento (opcional)</Label>
                <Input id="document_id" name="document_id" />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="address">Dirección (opcional)</Label>
                <Input id="address" name="address" />
              </div>

              <div className="flex flex-col gap-2">
                <Label>Tipo</Label>
                <input type="hidden" name="type" value="charge" />
                <p className="text-sm text-muted-foreground">
                  Cargo (fía algo) — un cliente nuevo siempre empieza debiendo. Para registrar un
                  abono, hazlo después desde el detalle del cliente.
                </p>
              </div>

              <PlazoPagoSelect value={plazoPago} onValueChange={setPlazoPago} />

              <div className="flex flex-col gap-2">
                <Label htmlFor="amount">Monto</Label>
                <Input id="amount" name="amount" type="number" min="0" step="0.01" required />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="description">Detalle (opcional)</Label>
                <Input id="description" name="description" />
              </div>

              <div className="flex flex-col gap-2">
                <Label>Foto (opcional)</Label>
                <AttachmentUploader ownerId={ownerId} value={photoPath} onChange={setPhotoPath} />
                <input type="hidden" name="photo_path" value={photoPath ?? ""} />
              </div>

              {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}

              <DialogFooter>
                <Button type="submit" disabled={pending}>
                  {pending ? "Guardando..." : "Guardar"}
                </Button>
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
