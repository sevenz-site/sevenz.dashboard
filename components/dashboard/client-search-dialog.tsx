"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { createClientWithMovement, type MovementFormState } from "@/app/(app)/dashboard/actions";
import { AttachmentUploader } from "@/components/dashboard/attachment-uploader";
import { PlazoPagoSelect } from "@/components/dashboard/plazo-pago-select";
import { LedgerCurrencyRadio, BsAmountPreview } from "@/components/dashboard/movement-currency-field";
import { WhatsappInput } from "@/components/whatsapp-input";
import { useTour } from "@/components/dashboard/tour-context";
import { track } from "@/lib/mixpanel";
import { formatDocumentId } from "@/lib/format";
import {
  DEFAULT_PLAZO_PAGO,
  DEFAULT_LEDGER_CURRENCY,
  type LedgerCurrency,
  type OwnerCountry,
} from "@/lib/types";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";

const initialState: MovementFormState = { error: null, clientId: null };

type ClientOption = { id: string; name: string; document_id: string | null };

export function ClientSearchDialog({
  clients,
  ownerId,
  businessName,
  ownerCountry,
  rateContext,
}: {
  clients: ClientOption[];
  ownerId: string;
  businessName: string;
  // Seeds "País del documento" below — right for the overwhelming majority
  // of clients, and correctable per client for the cross-border ones.
  ownerCountry: OwnerCountry;
  // Only present for a country='VE' owner with a rate already fetched —
  // null means "behave exactly like today's COP flow", no currency select.
  rateContext: MovementRateContext | null;
}) {
  const router = useRouter();
  const tour = useTour();
  const formRef = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"search" | "new">("search");
  const [query, setQuery] = useState("");
  // Controlled (unlike relying on defaultValue) so a server action round trip
  // — e.g. the duplicate-document check — never visually wipes what the
  // owner already typed. Only reset on full dialog close, not on every
  // step change or server response.
  const [nameValue, setNameValue] = useState("");
  const [documentIdValue, setDocumentIdValue] = useState("");
  const [documentCountry, setDocumentCountry] = useState<OwnerCountry>(ownerCountry);
  const [addressValue, setAddressValue] = useState("");
  const [plazoPago, setPlazoPago] = useState(DEFAULT_PLAZO_PAGO);
  const [currency, setCurrency] = useState<LedgerCurrency>(DEFAULT_LEDGER_CURRENCY);
  const [amountStr, setAmountStr] = useState("");
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
      setAmountStr("");
      setNameValue("");
      setDocumentIdValue("");
      setDocumentCountry(ownerCountry);
      setAddressValue("");
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

  // After a server action submission, the browser resets this form's
  // (uncontrolled) fields — fine normally, since a plain error just means
  // the owner retypes everything. But the duplicate-confirmation retry needs
  // the ORIGINAL values, not whatever the now-blank DOM shows. Caching the
  // submitted FormData here (before that reset happens) and resubmitting the
  // cached copy directly sidesteps it entirely.
  const lastFormDataRef = useRef<FormData | null>(null);

  function confirmDuplicateAndSubmit() {
    const data = lastFormDataRef.current;
    if (!data) return;
    data.set("confirm_duplicate", "true");
    formAction(data);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          className="w-full sm:w-auto"
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
                          <span className="text-xs text-muted-foreground">{formatDocumentId(c.document_id)}</span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : query.trim() ? (
                <p className="text-sm text-muted-foreground">Sin resultados para &quot;{query}&quot;.</p>
              ) : null}

              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNameValue(query);
                  setStep("new");
                }}
              >
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
            <form
              ref={formRef}
              action={formAction}
              onSubmit={(e) => {
                lastFormDataRef.current = new FormData(e.currentTarget);
              }}
              className="flex flex-col gap-4"
            >
              <input type="hidden" name="confirm_duplicate" defaultValue="false" />
              <div className="flex flex-col gap-2">
                <Label htmlFor="new_client_name">Nombre del cliente</Label>
                <Input
                  id="new_client_name"
                  name="new_client_name"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="whatsapp">WhatsApp</Label>
                <WhatsappInput id="whatsapp" name="whatsapp" required />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="document_id">Cédula/documento</Label>
                <Input
                  id="document_id"
                  name="document_id"
                  value={documentIdValue}
                  onChange={(e) => setDocumentIdValue(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="document_country">País del documento</Label>
                <Select
                  name="document_country"
                  value={documentCountry}
                  onValueChange={(v) => setDocumentCountry(v as OwnerCountry)}
                >
                  <SelectTrigger id="document_country" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CO">Colombia</SelectItem>
                    <SelectItem value="VE">Venezuela</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="address">Dirección (opcional)</Label>
                <Input
                  id="address"
                  name="address"
                  value={addressValue}
                  onChange={(e) => setAddressValue(e.target.value)}
                />
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

              {rateContext ? <LedgerCurrencyRadio currency={currency} onCurrencyChange={setCurrency} /> : null}

              <div className="flex flex-col gap-2">
                <Label htmlFor="amount">Monto</Label>
                <Input
                  id="amount"
                  name="amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={amountStr}
                  onChange={(e) => setAmountStr(e.target.value)}
                  required
                />
                {rateContext ? (
                  <BsAmountPreview amount={amountStr} currency={currency} rateContext={rateContext} />
                ) : null}
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

              {state.error ? (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-destructive">{state.error}</p>
                  {state.duplicate ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => selectExisting(state.duplicate!.id)}
                    >
                      Ver cuenta de {state.duplicate.name}
                    </Button>
                  ) : null}
                </div>
              ) : null}

              <DialogFooter>
                {state.duplicate ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button">Crear cuenta separada</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Crear una cuenta separada?</AlertDialogTitle>
                        <AlertDialogDescription>
                          Ya existe un cliente con esta cédula ({state.duplicate.name}). Solo
                          continúa si esto es a propósito — por ejemplo, cuentas separadas para lo
                          personal y el negocio de un mismo cliente.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={confirmDuplicateAndSubmit}>
                          Sí, crear cuenta separada
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <Button type="submit" disabled={pending}>
                    {pending ? "Guardando fiado..." : "Guardar fiado"}
                  </Button>
                )}
              </DialogFooter>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
