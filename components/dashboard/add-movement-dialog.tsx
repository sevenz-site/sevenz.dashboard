"use client";

import { useActionState, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Plus } from "lucide-react";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "sonner";
import { addMovement, type MovementFormState } from "@/app/(app)/dashboard/actions";
import { AttachmentUploader } from "@/components/dashboard/attachment-uploader";
import { PlazoPagoSelect } from "@/components/dashboard/plazo-pago-select";
import { LedgerCurrencyRadio, BsAmountPreview } from "@/components/dashboard/movement-currency-field";
import { WhatsappInput } from "@/components/whatsapp-input";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PLAZO_PAGO,
  DEFAULT_LEDGER_CURRENCY,
  type LedgerCurrency,
  type OwnerCountry,
} from "@/lib/types";
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import { useFieldErrors, useFormRef } from "@/hooks/use-field-errors";
import { amount as amountRule, whatsapp as whatsappRule } from "@/lib/form-validation";

const initialState: MovementFormState = { error: null, clientId: null };

export function AddMovementDialog({
  clientId,
  clientName,
  clientWhatsapp,
  ownerId,
  ownerCountry,
  currentDebtCop,
  currentDebtUsd,
  currentDebtEur,
  isFlagged,
  triggerClassName,
  autoOpen,
  hideTriggers,
  rateContext,
}: {
  clientId: string;
  clientName: string;
  // Only rendered as a required field when this is null — a client who
  // already has one on file sees no change to this form at all.
  clientWhatsapp: string | null;
  ownerId: string;
  // Same reason as in client-search-dialog: the picker must start on the
  // shop's country, not on Colombia.
  ownerCountry: OwnerCountry;
  // COP debt — used when rateContext is null (a 'CO' owner).
  currentDebtCop: number;
  // Independent per-currency debts — used when rateContext is present. A
  // client can owe in one currency, the other, both, or neither.
  currentDebtUsd: number;
  currentDebtEur: number;
  isFlagged: boolean;
  // Lets the client detail page's mobile layout make this button full-width
  // without affecting the default (desktop) trigger.
  triggerClassName?: string;
  // Which movement the mobile bar asked for while the owner is looking at
  // this client. Only ever passed to the mobile instance of this dialog —
  // the page renders a second one for the sm+ layout, and both receiving it
  // would open two stacked dialogs.
  autoOpen?: "charge" | "payment";
  // The mobile bar now carries "Agregar fiado" / "Agregar abono" itself, so
  // the in-page pair would be the same two actions twice on one screen. The
  // dialog still has to mount to be opened by the bar — only its triggers go.
  hideTriggers?: boolean;
  // Only present for a country='VE' owner with a rate already fetched —
  // null means "behave exactly like today's COP flow", no currency select.
  rateContext: MovementRateContext | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [formRef, setFormRef] = useFormRef();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"charge" | "payment">("charge");
  const [plazoPago, setPlazoPago] = useState(DEFAULT_PLAZO_PAGO);
  const [currency, setCurrency] = useState<LedgerCurrency>(DEFAULT_LEDGER_CURRENCY);
  const [amountStr, setAmountStr] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  // True right after the owner clicks "Abono (paga)" while it isn't actually
  // available — shows the red explanation below the radio group. Not the
  // same as canPay itself: this tracks a real click attempt, not just the
  // current (in)validity, so the message only appears when it's actually
  // relevant to what just happened.
  const [paymentBlocked, setPaymentBlocked] = useState(false);
  const [state, formAction, pending] = useActionState(addMovement, initialState);
  const [prevOpen, setPrevOpen] = useState(open);

  // The debt each currency owes is independent — no conversion, since the
  // cap is the currency the owner is actively typing in. Switching between
  // USD/EUR while "Abono" is open picks a different cap live.
  const currentDebt = rateContext ? (currency === "USD" ? currentDebtUsd : currentDebtEur) : currentDebtCop;
  const canPay = currentDebt > 0;
  const formattedMaxDebt = rateContext ? formatDisplayCurrency(currentDebt, currency) : formatCurrency(currentDebt);

  const { errors, validate, recheck, reset: resetErrors } = useFieldErrors({
    // Only a real field when the client has no number on file at all — see
    // clientWhatsapp above.
    ...(!clientWhatsapp ? { whatsapp: whatsappRule } : {}),
    amount: amountRule({
      max: type === "payment" ? currentDebt : null,
      maxMessage: `Máximo ${formattedMaxDebt} — lo que ${clientName} debe hoy.`,
    }),
  });

  // The amount cap depends on type and currency (no cap for a charge,
  // currentDebt for a payment in whichever currency is selected) — an
  // effect, not a call inline in the handlers that change either one,
  // because it needs to run AFTER the render that rebuilds the rule above
  // with the new type/currentDebt; calling recheck synchronously inside
  // setType's own handler would still see the previous render's rule.
  useEffect(() => {
    recheck("amount", formRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, currentDebt]);

  // Whether "Agregar abono" should even be clickable — checked against
  // whichever currency actually has debt, not just the one currently
  // selected (which defaults to USD before the dialog has ever opened).
  const canPayAny = rateContext ? currentDebtUsd > 0 || currentDebtEur > 0 : currentDebtCop > 0;

  function openForCharge() {
    setType("charge");
    setOpen(true);
  }

  // "Abono" is never natively disabled (see the radio markup below) — this
  // is what actually gates it. Selecting it while unavailable shows the red
  // explanation instead of changing the value.
  function handleTypeChange(value: string) {
    if (value === "payment" && !canPay) {
      setPaymentBlocked(true);
      return;
    }
    setPaymentBlocked(false);
    setType(value as "charge" | "payment");
  }

  function openForPayment() {
    // Land on whichever currency actually has debt, so the in-dialog
    // Select isn't immediately reverted back to "charge" by the
    // type === "payment" && !canPay guard below. Corrects in either
    // direction — currency may already be sitting on the wrong one from
    // a previous open (e.g. left on EUR while USD is what's now owed).
    if (rateContext) {
      if (currentDebtUsd > 0) setCurrency("USD");
      else if (currentDebtEur > 0) setCurrency("EUR");
    }
    setType("payment");
    setOpen(true);
  }

  // "Abono" only makes sense for a currency that's actually owed — if the
  // owner picks payment then switches to a currency with no debt, fall back
  // to a charge rather than leaving an invalid combination selected.
  if (type === "payment" && !canPay) {
    setType("charge");
  }

  // Clears the red explanation the moment it stops being relevant — e.g.
  // switching currency makes "Abono" valid again without the owner having
  // to touch the radio group at all.
  if (paymentBlocked && canPay) {
    setPaymentBlocked(false);
  }

  // Opens on each false -> true transition of autoOpen, seeded false so that
  // arriving with the marker already in the address counts as a transition in
  // its own right — the same pattern client-search-dialog.tsx uses, and for
  // the same reason: a one-shot latch fires once and never again, and seeding
  // from the prop means a fresh mount carrying the marker never opens at all.
  const wantsOpen = autoOpen === "charge" || autoOpen === "payment";
  const [prevAutoOpen, setPrevAutoOpen] = useState(false);
  if (wantsOpen !== prevAutoOpen) {
    setPrevAutoOpen(wantsOpen);
    if (wantsOpen) {
      // Always set explicitly, never inherited. Closing this dialog does NOT
      // reset `type`, so an owner whose last action was "Agregar abono" would
      // find the bar opening on Abono — registering a payment when a charge was
      // meant is a money error, not a navigation one.
      if (autoOpen === "payment" && canPayAny) {
        // Mirrors openForPayment(): land on a currency that actually has debt,
        // or the guard further down would bounce this straight back to charge.
        if (rateContext) {
          if (currentDebtUsd > 0) setCurrency("USD");
          else if (currentDebtEur > 0) setCurrency("EUR");
        }
        setType("payment");
        setPaymentBlocked(false);
      } else if (autoOpen === "payment") {
        // Abono asked for on a client who owes nothing. The bar can't know the
        // balance, so it always offers the button and this is where the answer
        // comes: open on charge and show the same explanation the in-dialog
        // radio gives, rather than silently substituting a different action.
        setType("charge");
        setPaymentBlocked(true);
      } else {
        setType("charge");
        setPaymentBlocked(false);
      }
      setOpen(true);
    }
  }

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) {
      setPhotoPath(null);
      setAmountStr("");
      setPaymentBlocked(false);
      resetErrors();
    }
  }

  const [handledState, setHandledState] = useState(state);
  if (state !== handledState && state.clientId) {
    setHandledState(state);
    setOpen(false);
  }

  // Clears the marker only once the dialog is CLOSED, and through the router
  // rather than history.replaceState — replaceState moves the address bar
  // behind Next's back, leaving the router believing it is still on the marked
  // URL, so the next tap navigates to where it thinks it already is and
  // nothing opens. Leaving the marker instead makes a refresh reopen the
  // dialog on its own.
  useEffect(() => {
    if (wantsOpen && !open) router.replace(pathname, { scroll: false });
  }, [wantsOpen, open, router, pathname]);

  useEffect(() => {
    if (state === initialState || pending || state.error) return;
    if (state.clientId) {
      toast.success("Movimiento registrado");
      // "Movement Added" is tracked server-side in addMovement — see the note
      // in client-search-dialog.tsx on why it isn't tracked here too.
      router.refresh();
    }
  }, [state, pending, router]);

  return (
    <>
      {/* Not hidden with a class: "flex" and "hidden" in one list is a CSS
          conflict resolved by stylesheet order, not class order, so it is not
          reliably one or the other. Rendered or not rendered instead. */}
      {hideTriggers ? null : (
        <div className={cn("flex gap-2", triggerClassName)}>
          <Button size="sm" className="flex-1" onClick={openForCharge}>
            <Plus className="size-4" />
            Agregar fiado
          </Button>
          <Button size="sm" variant="outline" className="flex-1" disabled={!canPayAny} onClick={openForPayment}>
            <Plus className="size-4" />
            Agregar abono
          </Button>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agregar movimiento</DialogTitle>
          <DialogDescription>Para {clientName} · el saldo se recalcula automáticamente.</DialogDescription>
        </DialogHeader>
        <form
          ref={setFormRef}
          action={formAction}
          onSubmit={(e) => {
            if (!validate(e.currentTarget)) e.preventDefault();
          }}
          className="flex flex-col gap-4"
        >
          <input type="hidden" name="client_id" value={clientId} />

          {!clientWhatsapp ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="whatsapp">WhatsApp de {clientName}</Label>
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
          ) : null}

          <div className="flex flex-col gap-2">
            <Label>Tipo</Label>
            <RadioGroup name="type" value={type} onValueChange={handleTypeChange} className="flex flex-row gap-4">
              <label className="flex items-center gap-2 text-sm">
                <RadioGroupItem value="charge" />
                Cargo (fía algo)
              </label>
              <label
                className={cn("flex items-center gap-2 text-sm", !canPay && "cursor-not-allowed opacity-50")}
              >
                {/* Not natively disabled — a disabled control never fires a
                    click at all, and the whole point is that clicking this
                    while blocked explains why instead of doing nothing. */}
                <RadioGroupItem value="payment" />
                Abono (paga)
              </label>
            </RadioGroup>
            {paymentBlocked ? (
              <p className="text-xs text-destructive">
                {`${clientName} no debe nada${rateContext ? ` en ${currency === "EUR" ? "EUROS" : currency}` : ""}, por eso no se puede registrar un abono.`}
              </p>
            ) : null}
          </div>

          {type === "charge" ? <PlazoPagoSelect value={plazoPago} onValueChange={setPlazoPago} /> : null}

          {rateContext ? <LedgerCurrencyRadio currency={currency} onCurrencyChange={setCurrency} /> : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="amount">Monto</Label>
            <Input
              id="amount"
              name="amount"
              type="number"
              min="0"
              max={type === "payment" ? currentDebt : undefined}
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
            {type === "payment" ? (
              <p className="text-xs text-muted-foreground">
                Máximo {formattedMaxDebt} — lo que {clientName} debe hoy.
              </p>
            ) : null}
            {errors.amount ? <p className="text-xs text-destructive">{errors.amount}</p> : null}
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
            {isFlagged && type === "charge" ? (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" disabled={pending}>
                    {pending ? "Guardando fiado..." : "Guardar fiado"}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{clientName} está marcado como Mala paga</AlertDialogTitle>
                    <AlertDialogDescription>
                      Revisa el motivo en su historial. ¿Fiarle de todas formas?
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      variant="destructive"
                      onClick={() => formRef.current?.requestSubmit()}
                    >
                      Fiar de todas formas
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <Button type="submit" disabled={pending}>
                {pending
                  ? type === "charge"
                    ? "Guardando fiado..."
                    : "Guardando abono..."
                  : type === "charge"
                    ? "Guardar fiado"
                    : "Guardar abono"}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
      </Dialog>
    </>
  );
}
