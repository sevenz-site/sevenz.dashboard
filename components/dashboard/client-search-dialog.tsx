"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
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
import { toast } from "sonner";
import { createClientWithMovement, type MovementFormState } from "@/app/(app)/dashboard/actions";
import { AttachmentUploader } from "@/components/dashboard/attachment-uploader";
import { PlazoPagoSelect } from "@/components/dashboard/plazo-pago-select";
import { LedgerCurrencyRadio, BsAmountPreview } from "@/components/dashboard/movement-currency-field";
import { WhatsappInput } from "@/components/whatsapp-input";
import { useTour } from "@/components/dashboard/tour-context";
import { formatDocumentId } from "@/lib/format";
import {
  DEFAULT_PLAZO_PAGO,
  DEFAULT_LEDGER_CURRENCY,
  type LedgerCurrency,
  type OwnerCountry,
} from "@/lib/types";
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import { useFieldErrors, useFormRef } from "@/hooks/use-field-errors";
import { required, whatsapp as whatsappRule, amount as amountRule } from "@/lib/form-validation";

const initialState: MovementFormState = { error: null, clientId: null };

type ClientOption = { id: string; name: string; document_id: string | null };

export function ClientSearchDialog({
  clients,
  ownerId,
  businessName,
  ownerCountry,
  autoOpen,
  showTourTarget = true,
  rateContext,
}: {
  clients: ClientOption[];
  ownerId: string;
  businessName: string;
  // Defaults the phone country picker to the shop's own country. Without it
  // a Venezuelan owner silently saves every client under +57.
  ownerCountry: OwnerCountry;
  // True when the mobile bar navigated here asking for the dialog.
  autoOpen?: boolean;
  // Cartera renders this trigger twice — beside the section title on
  // desktop, below the rate card on a phone — because the two sit in
  // different places in the document and CSS alone cannot move an element
  // between parents. Only the desktop one carries the tour marker: the tour
  // finds its target with querySelector, which returns whichever matches
  // first in the DOM, and that would be the hidden one.
  showTourTarget?: boolean;
  // Only present for a country='VE' owner with a rate already fetched —
  // null means "behave exactly like today's COP flow", no currency select.
  rateContext: MovementRateContext | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const tour = useTour();
  const [open, setOpen] = useState(false);
  // Bumped every time the dialog fully closes, and used as the body's `key`
  // below. Remounting is what actually guarantees a clean form next open —
  // this component's own state (nameValue, plazoPago, ...) already got reset
  // field-by-field before, but a WhatsappInput's own internal phone number
  // lived below that reset and was never touched, so it kept surviving a
  // close. A key-remount resets everything in one place, including whatever
  // a future field adds, instead of one more line to remember to update.
  const [instanceKey, setInstanceKey] = useState(0);
  // Read synchronously from the Dialog's onOpenChange handler below, so a
  // ref rather than state — nothing here needs to re-render when it changes.
  const dirtyRef = useRef(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  // Opens on each false -> true transition of autoOpen, not on a one-shot
  // latch. A latch only ever fires once, so the first tap of the bar's
  // "Agregar" worked and every tap afterwards did nothing. Re-arming it on
  // close doesn't work either: the marker is still in the address at that
  // moment, so the guard immediately fires again and the dialog reopens the
  // instant it is dismissed. Tracking the transition is what makes repeat taps
  // work without looping — the effect below returns autoOpen to false once the
  // dialog is closed, which arms the next one.
  // Seeded false, never from autoOpen. Tapping "Agregar" from another screen
  // mounts this component fresh with autoOpen ALREADY true; seeding from the
  // prop would record that as the starting value, so there was no transition
  // to react to and the dialog never opened. Starting false makes a fresh
  // mount carrying the marker a transition in its own right.
  // Normalised once: the prop is optional, so undefined and false have to mean
  // the same thing to the comparison below.
  const wantsOpen = autoOpen === true;
  const [prevAutoOpen, setPrevAutoOpen] = useState(false);
  if (wantsOpen !== prevAutoOpen) {
    setPrevAutoOpen(wantsOpen);
    if (wantsOpen) setOpen(true);
  }

  // Clears the marker only once the dialog is CLOSED, through the router rather
  // than history.replaceState. replaceState moves the address bar behind Next's
  // back: the router still believed it was on ?nuevo=1, so tapping the bar again
  // was a navigation to the page it thought it was already on — the spinner ran
  // and nothing opened. Leaving the marker instead makes a refresh spring the
  // dialog open on its own, which is the other half of what was reported.
  //
  // Skipped entirely when the dialog is closing *because* we are navigating to
  // a client. Picking a client from the search results ran onDone() (open ->
  // false) and then router.push("/clients/<id>"), which armed this effect while
  // `pathname` was still "/dashboard" — so the replace landed after the push
  // and put the owner straight back on Cartera. The dialog closed and nothing
  // else happened, and only from the bar's "Agregar", since that is the only
  // entry point that sets ?nuevo=1 and therefore the only one where wantsOpen
  // is true. There is nothing to clean up in that case anyway: navigating to
  // another route leaves the marker behind on its own.
  const navigatingAwayRef = useRef(false);
  useEffect(() => {
    if (navigatingAwayRef.current) return;
    if (wantsOpen && !open) router.replace(pathname, { scroll: false });
  }, [wantsOpen, open, router, pathname]);

  // Stable identity: the body passes this to an effect (see handledState
  // below), and a fresh function every render would re-run that effect on
  // every render — each run bumping instanceKey, which re-renders, which
  // makes another new function. Both setters are stable, so [] is correct.
  // `navigating` tells the marker-clearing effect above to stand down: the
  // body is closing this dialog on its way to a client page, and the replace
  // would land after that push and cancel it.
  const closeAndReset = useCallback((navigating = false) => {
    navigatingAwayRef.current = navigating;
    setOpen(false);
    setInstanceKey((k) => k + 1);
  }, []);

  const handleDirtyChange = useCallback((dirty: boolean) => {
    dirtyRef.current = dirty;
  }, []);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) {
            setOpen(true);
            return;
          }
          // Covers every way Radix can ask to close — the X button, Escape,
          // and a click outside — with one check instead of guarding each
          // affordance separately.
          if (dirtyRef.current) {
            setConfirmDiscardOpen(true);
            return;
          }
          closeAndReset();
        }}
      >
        <DialogTrigger asChild>
          <Button
            size="sm"
            className="w-full sm:w-auto"
            data-tour={showTourTarget ? "new-client-button" : undefined}
            onClick={() => {
              if (tour.step === 1) tour.advance();
            }}
          >
            <Plus className="size-4" />
            Agregar movimiento
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <ClientSearchDialogBody
            key={instanceKey}
            clients={clients}
            ownerId={ownerId}
            businessName={businessName}
            ownerCountry={ownerCountry}
            rateContext={rateContext}
            onDirtyChange={handleDirtyChange}
            onDone={closeAndReset}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDiscardOpen} onOpenChange={setConfirmDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Descartar este registro?</AlertDialogTitle>
            <AlertDialogDescription>
              Todavía no guardaste este cliente ni su movimiento — si sales ahora se pierde lo que
              ya escribiste.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Seguir editando</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDiscardOpen(false);
                closeAndReset();
              }}
            >
              Descartar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// Everything below is remounted (via the `key` above) on every fresh open,
// which is what makes "close without saving, reopen" start from a blank
// slate — including WhatsappInput's own phone number, which lives entirely
// inside that child and was never reachable from a field-by-field reset up
// in the parent.
function ClientSearchDialogBody({
  clients,
  ownerId,
  businessName,
  ownerCountry,
  rateContext,
  onDirtyChange,
  onDone,
}: {
  clients: ClientOption[];
  ownerId: string;
  businessName: string;
  ownerCountry: OwnerCountry;
  rateContext: MovementRateContext | null;
  onDirtyChange: (dirty: boolean) => void;
  // Called once this instance is done with the dialog — a client was
  // created, an existing one was picked, or the owner confirmed abandoning
  // the registration. The parent closes and remounts a fresh instance.
  // `true` means "I am navigating to a client page" — see closeAndReset.
  onDone: (navigating?: boolean) => void;
}) {
  const router = useRouter();
  const [formRef, setFormRef] = useFormRef();
  const [step, setStep] = useState<"search" | "new">("search");
  const [query, setQuery] = useState("");
  const [nameValue, setNameValue] = useState("");
  const [documentIdValue, setDocumentIdValue] = useState("");
  const [addressValue, setAddressValue] = useState("");
  const [plazoPago, setPlazoPago] = useState(DEFAULT_PLAZO_PAGO);
  const [currency, setCurrency] = useState<LedgerCurrency>(DEFAULT_LEDGER_CURRENCY);
  const [amountStr, setAmountStr] = useState("");
  // Controlled like every other field in this form now — it used to be the
  // one plain uncontrolled input, which is exactly the field a resubmit
  // after the duplicate-document warning could silently blank out.
  const [descriptionValue, setDescriptionValue] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(createClientWithMovement, initialState);
  const { errors, validate, recheck } = useFieldErrors({
    new_client_name: required,
    whatsapp: whatsappRule,
    document_id: required,
    amount: amountRule(),
  });

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return clients
      .filter((c) => c.name.toLowerCase().includes(q) || c.document_id?.toLowerCase().includes(q))
      .slice(0, 8);
  }, [clients, query]);

  // There is something to lose once the owner has actually typed something
  // into the registration form — not merely reached that step, since
  // "Nuevo cliente" with an empty search query lands here with nothing
  // filled in yet.
  const isDirty =
    step === "new" &&
    Boolean(
      nameValue.trim() ||
        documentIdValue.trim() ||
        addressValue.trim() ||
        amountStr.trim() ||
        descriptionValue.trim() ||
        photoPath,
    );
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  // Adjusting local state during render is the sanctioned React pattern for
  // "react to a changed prop", and setHandledState stays here because it only
  // touches this component. onDone does not: it is the parent's closeAndReset,
  // so calling it here updated ClientSearchDialog while ClientSearchDialogBody
  // was still rendering — React's "Cannot update a component while rendering a
  // different component" error, logged on every successful client creation.
  // It reads as harmless because the client is still created, but the reset it
  // triggers is no longer guaranteed to land in that pass.
  //
  // This line used to be setOpen(false) — local, and therefore legal. It became
  // cross-component when the close was lifted into the parent so the form could
  // be cleared on close, and the render-phase call came along unnoticed.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState && state.clientId) {
    setHandledState(state);
  }
  useEffect(() => {
    if (handledState.clientId) onDone(true);
  }, [handledState, onDone]);

  useEffect(() => {
    if (state === initialState || pending || state.error) return;
    if (state.clientId) {
      toast.success("Cliente registrado");
      // "Client Created" is tracked server-side in createClientWithMovement —
      // tracking it here too would double-count for every owner whose browser
      // isn't blocking Mixpanel, skewing the numbers unevenly.
      router.push(`/clients/${state.clientId}`);
    }
  }, [state, pending, router]);

  function selectExisting(id: string) {
    onDone(true);
    router.push(`/clients/${id}`);
  }

  // Every field the form needs is React-controlled now, so the live DOM
  // always matches current state — reading it fresh here (rather than a
  // FormData snapshot captured back when the duplicate warning first
  // appeared) is what makes a resubmit pick up anything edited since.
  function confirmDuplicateAndSubmit() {
    if (!formRef.current) return;
    if (!validate(formRef.current)) return;
    const data = new FormData(formRef.current);
    data.set("confirm_duplicate", "true");
    formAction(data);
  }

  return step === "search" ? (
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
        ref={setFormRef}
        action={formAction}
        onSubmit={(e) => {
          if (!validate(e.currentTarget)) e.preventDefault();
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
            onChange={(e) => {
              setNameValue(e.target.value);
              recheck("new_client_name", formRef.current);
            }}
            required
            aria-invalid={Boolean(errors.new_client_name)}
          />
          {errors.new_client_name ? (
            <p className="text-xs text-destructive">{errors.new_client_name}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="whatsapp">WhatsApp</Label>
          <WhatsappInput
            id="whatsapp"
            name="whatsapp"
            required
            preferredDialCode={OWNER_COUNTRY_DIAL_CODE[ownerCountry]}
            invalid={Boolean(errors.whatsapp)}
            onValueChange={() => recheck("whatsapp", formRef.current)}
          />
          {errors.whatsapp ? <p className="text-xs text-destructive">{errors.whatsapp}</p> : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="document_id">Cédula/documento</Label>
          <Input
            id="document_id"
            name="document_id"
            value={documentIdValue}
            onChange={(e) => {
              setDocumentIdValue(e.target.value);
              recheck("document_id", formRef.current);
            }}
            required
            aria-invalid={Boolean(errors.document_id)}
          />
          {errors.document_id ? (
            <p className="text-xs text-destructive">{errors.document_id}</p>
          ) : null}
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
            onChange={(e) => {
              setAmountStr(e.target.value);
              recheck("amount", formRef.current);
            }}
            required
            aria-invalid={Boolean(errors.amount)}
          />
          {rateContext ? (
            <BsAmountPreview amount={amountStr} currency={currency} rateContext={rateContext} />
          ) : null}
          {errors.amount ? <p className="text-xs text-destructive">{errors.amount}</p> : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="description">Detalle (opcional)</Label>
          <Input
            id="description"
            name="description"
            value={descriptionValue}
            onChange={(e) => setDescriptionValue(e.target.value)}
          />
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
  );
}
