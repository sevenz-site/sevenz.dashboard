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
import { toast } from "sonner";
import { addMovement, type MovementFormState } from "@/app/(app)/dashboard/actions";
import { AttachmentUploader } from "@/components/dashboard/attachment-uploader";
import { PlazoPagoSelect } from "@/components/dashboard/plazo-pago-select";
import {
  MontoCard,
  TipoButtons,
  MonedaTecleadaButtons,
  MontoARegistrarRow,
  ResumenMonto,
  montoConvertido,
  BsAmountPreview,
  PrevistaCheckbox,
} from "@/components/dashboard/movement-currency-field";
import { WhatsappInput } from "@/components/whatsapp-input";
import { formatCurrency } from "@/lib/format";
import { formatBs, formatDisplayCurrency } from "@/lib/exchange-rate/format";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import { topeEnBolivares } from "@/lib/exchange-rate/monto-en-bolivares";
import { cn } from "@/lib/utils";
import {
  DEFAULT_PLAZO_PAGO,
  DEFAULT_LEDGER_CURRENCY,
  type LedgerCurrency,
  type OwnerCountry,
  type MonedaTecleada,
} from "@/lib/types";
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import { libroParaAbono, type MonedaHabitual } from "@/lib/moneda-habitual";
import { useFieldErrors, useFormRef } from "@/hooks/use-field-errors";
import { amount as amountRule, whatsapp as whatsappRule } from "@/lib/form-validation";
import {
  useErrorDeCuentaPausada,
  useGuardiaAlAbrir,
  useGuardiaDeCuentaPausada,
} from "@/components/dashboard/cuenta-pausada";

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
  monedaHabitual,
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
  // COP debt — used for a 'CO' owner.
  currentDebtCop: number;
  // Independent per-currency debts — used for a 'VE' owner. A
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
  // En que moneda escribio este negocio la ultima vez, deducida del ultimo
  // movimiento guardado. Null mientras no haya ninguno: sin costumbre que
  // recordar, el formulario abre como abria siempre.
  monedaHabitual: MonedaHabitual | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [formRef, setFormRef] = useFormRef();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"charge" | "payment">("charge");
  const [plazoPago, setPlazoPago] = useState(DEFAULT_PLAZO_PAGO);
  const [currency, setCurrency] = useState<LedgerCurrency>(monedaHabitual?.libro ?? DEFAULT_LEDGER_CURRENCY);
  const [amountStr, setAmountStr] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [usarPrevista, setUsarPrevista] = useState(false);
  // En que moneda escribe, que no es lo mismo que el libro donde entra la
  // deuda. Arranca en la que uso la ultima vez: el bodeguero que cobra todo en
  // bolivares tenia que pulsar "Bolivares" en cada movimiento, y son decenas al
  // dia. Sin historial se queda en dolares, como siempre.
  const [monedaTecleada, setMonedaTecleada] = useState<MonedaTecleada>(monedaHabitual?.tecleada ?? "USD");
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
  // Qué libro lleva este negocio lo decide el PAÍS, que el dueño eligió al
  // registrarse y no puede cambiar. rateContext solo dice si hay una tasa que
  // enseñar, y eso es una pregunta distinta: un dueño venezolano sigue
  // llevando dólares y euros aunque el BCV no responda ahorita.
  //
  // Mezclarlas fue el fallo: el selector de moneda se pintaba con rateContext,
  // así que sin tasa no aparecía, el formulario no mandaba moneda y el
  // servidor —que ahora rechaza en vez de adivinar— dejaba al bodeguero sin
  // poder fiar. Antes de rechazar, archivaba el fiado en el libro COP.
  const llevaDivisas = ownerCountry === "VE";

  const currentDebt = llevaDivisas ? (currency === "USD" ? currentDebtUsd : currentDebtEur) : currentDebtCop;
  const canPay = currentDebt > 0;

  // La misma tasa que se usa para convertir el monto: la vigente, o la prevista
  // si el dueño marcó la casilla. Si el tope usara una tasa y el monto otra, el
  // formulario se contradiría solo.
  const tasaActiva =
    usarPrevista && rateContext?.prevista
      ? { usd: rateContext.prevista.usd, eur: rateContext.prevista.eur }
      : rateContext?.effectiveRate;

  // El tope, EN LA MONEDA EN LA QUE SE ESTÁ ESCRIBIENDO.
  //
  // Esto era un fallo de verdad, no un detalle: la deuda vive en dólares y el
  // tope se comparaba contra la cifra tecleada fuera cual fuera su moneda. Con
  // una deuda de $55, escribir "Bs. 100" —doce céntimos— daba error, porque 100
  // es mayor que 55. Un abono legítimo rechazado por comparar bolívares con
  // dólares.
  //
  // Se redondea hacia ABAJO a céntimos para que el tope que se enseña se pueda
  // teclear de verdad: hacia arriba, el dueño copia la cifra exacta, el
  // servidor la vuelve a dólares y le sale un céntimo por encima de la deuda.
  const topeTecleado: number | null =
    monedaTecleada !== "VES"
      ? currentDebt
      : llevaDivisas
        ? // Devuelve null sin tasa, y eso es lo correcto: sin tasa no hay tope
          // que enseñar, y compararlo contra los dólares sería volver al fallo
          // de arriba. El servidor rechaza igual.
          topeEnBolivares(currentDebt, currency, tasaActiva)
        : null;

  const formattedMaxDebt =
    monedaTecleada === "VES"
      ? formatBs(topeTecleado ?? 0)
      : llevaDivisas
        ? formatDisplayCurrency(currentDebt, currency)
        : formatCurrency(currentDebt);

  const { errors, validate, recheck, reset: resetErrors } = useFieldErrors({
    // Only a real field when the client has no number on file at all — see
    // clientWhatsapp above.
    ...(!clientWhatsapp ? { whatsapp: whatsappRule } : {}),
    amount: amountRule({
      max: type === "payment" ? topeTecleado : null,
      maxMessage: `Máximo ${formattedMaxDebt} — lo que ${clientName} debe hoy.`,
    }),
  });

  // The amount cap depends on type and currency (no cap for a charge,
  // currentDebt for a payment in whichever currency is selected) — an
  // effect, not a call inline in the handlers that change either one,
  // because it needs to run AFTER the render that rebuilds the rule above
  // with the new type/currentDebt; calling recheck synchronously inside
  // setType's own handler would still see the previous render's rule.
  //
  // topeTecleado y no currentDebt: el tope ya no es solo la deuda, también
  // cambia al cambiar de moneda tecleada o al marcar la tasa prevista, y esos
  // dos movimientos tienen que revalidar lo que ya esté escrito.
  useEffect(() => {
    recheck("amount", formRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, topeTecleado]);

  // Whether "Agregar abono" should even be clickable — checked against
  // whichever currency actually has debt, not just the one currently
  // selected (which defaults to USD before the dialog has ever opened).
  const canPayAny = llevaDivisas ? currentDebtUsd > 0 || currentDebtEur > 0 : currentDebtCop > 0;

  function openForCharge() {
    if (guardia()) return;
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


  // En un ABONO manda la deuda, no la costumbre.
  //
  // De nada sirve abrir en euros porque fue lo ultimo que uso si lo que este
  // cliente debe son dolares: el dueño leeria "Maximo 0,00" y tendria que
  // cambiar de moneda a mano, que es justo el toque que esto venia a ahorrar.
  //
  // La costumbre solo desempata: si debe en las dos, se abre en la que suele
  // usar en vez de en dolares por orden alfabetico.
  //
  // Los bolivares no chocan nunca — son una forma de ESCRIBIR, no un libro—,
  // asi que quien teclea en bolivares sigue tecleando en bolivares y lo unico
  // que se corrige es a que libro va.
  function abrirEnLaMonedaQueSeDebe() {
    if (!llevaDivisas) return;
    const libro = libroParaAbono(monedaHabitual?.libro ?? currency, currentDebtUsd, currentDebtEur);
    setCurrency(libro);
    if (monedaTecleada !== "VES") setMonedaTecleada(libro);
  }

  function openForPayment() {
    if (guardia()) return;
    // Land on whichever currency actually has debt, so the in-dialog
    // Select isn't immediately reverted back to "charge" by the
    // type === "payment" && !canPay guard below. Corrects in either
    // direction — currency may already be sitting on the wrong one from
    // a previous open (e.g. left on EUR while USD is what's now owed).
    abrirEnLaMonedaQueSeDebe();
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
  const abrirBloqueado = useGuardiaAlAbrir(wantsOpen);
  const [prevAutoOpen, setPrevAutoOpen] = useState(false);
  if (wantsOpen !== prevAutoOpen) {
    setPrevAutoOpen(wantsOpen);
    if (wantsOpen && !abrirBloqueado) {
      // Always set explicitly, never inherited. Closing this dialog does NOT
      // reset `type`, so an owner whose last action was "Agregar abono" would
      // find the bar opening on Abono — registering a payment when a charge was
      // meant is a money error, not a navigation one.
      if (autoOpen === "payment" && canPayAny) {
        // Mirrors openForPayment(): land on a currency that actually has debt,
        // or the guard further down would bounce this straight back to charge.
        abrirEnLaMonedaQueSeDebe();
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

  // Cuenta pausada: lo dice el dialogo, no un parrafo rojo aqui debajo.
  const errorPausada = useErrorDeCuentaPausada(state.error);
  const guardia = useGuardiaDeCuentaPausada();

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
        // Abono left, fiado right — the order owners already learned from the
        // phone bar these buttons replaced. Desktop follows the same order so
        // the two viewports do not disagree about which side is which.
        <div className={cn("flex gap-2", triggerClassName)}>
          <Button size="sm" variant="outline" className="flex-1" disabled={!canPayAny} onClick={openForPayment}>
            <Plus className="size-4" />
            Agregar abono
          </Button>
          <Button size="sm" className="flex-1" onClick={openForCharge}>
            <Plus className="size-4" />
            Agregar fiado
          </Button>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next && guardia()) return;
          setOpen(next);
        }}
      >
      {/* svh y no vh. `vh` mide el viewport GRANDE —el que habría si la barra
          del navegador estuviera escondida— así que en un teléfono con la barra
          a la vista el 90% de esa medida es más alto que la pantalla, y el
          diálogo se centra sobre un alto que no existe: el título queda por
          encima del borde y no hay forma de subir hasta él. `svh` mide el
          viewport PEQUEÑO, el que de verdad se ve. Es el mismo problema del
          100vh que CLAUDE.md ya nombra para iPhone. */}
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Agregar movimiento</DialogTitle>
          <DialogDescription>Para {clientName} · el saldo se recalcula automáticamente.</DialogDescription>
        </DialogHeader>
        {/* gap-8 y no gap-4: los bloques del formulario son cajas con su propio
            borde —los botones de moneda, la tarjeta del monto, el resumen— y a
            gap-4 quedaban demasiado juntas para distinguir dónde acaba una
            pregunta y empieza la siguiente. */}
        <form
          ref={setFormRef}
          action={formAction}
          onSubmit={(e) => {
            if (!validate(e.currentTarget)) e.preventDefault();
          }}
          className="flex flex-col gap-8"
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
            <TipoButtons value={type} onValueChange={handleTypeChange} canPay={canPay} />
            {paymentBlocked ? (
              <p className="text-xs text-destructive">
                {`${clientName} no debe nada${llevaDivisas ? ` en ${currency === "EUR" ? "EUROS" : currency}` : ""}, por eso no se puede registrar un abono.`}
              </p>
            ) : null}
          </div>

          {type === "charge" ? <PlazoPagoSelect value={plazoPago} onValueChange={setPlazoPago} /> : null}

          {llevaDivisas ? (
            <MonedaTecleadaButtons
              value={monedaTecleada}
              onValueChange={(v) => {
                setMonedaTecleada(v);
                // Tecleando dolares o euros, el libro es ese mismo. Tecleando
                // bolivares, el libro lo decide el desplegable de abajo y se
                // queda con el que hubiera.
                if (v !== "VES") setCurrency(v);
              }}
            />
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="amount">Monto</Label>
            <MontoCard
              id="amount"
              name="amount"
              value={amountStr}
              onChange={(e) => {
                setAmountStr(e.target.value);
                recheck("amount", formRef.current);
              }}
              moneda={llevaDivisas ? monedaTecleada : null}
              max={type === "payment" && topeTecleado != null ? topeTecleado : undefined}
              invalid={Boolean(errors.amount)}
              // Un solo renglón debajo de la cifra, no dos. El tope en gris
              // mientras va bien, y el error en rojo EN SU LUGAR cuando se
              // pasa: antes se dibujaban los dos a la vez y el dueño leía el
              // mismo aviso repetido, uno gris y otro rojo.
              //
              // Dentro de la tarjeta y no debajo del bloque porque es una
              // propiedad de lo que se está escribiendo ahí, y a media pantalla
              // de distancia no se relaciona con el campo.
              ayuda={
                errors.amount ??
                (type === "payment" && topeTecleado != null
                  ? `Máximo ${formattedMaxDebt} — lo que ${clientName} debe hoy.`
                  : null)
              }
            />
            {/* Tecleando bolivares, la cifra que importa es la convertida:
                la deuda no vive en bolivares. Tecleando dolares o euros no hace
                falta, porque lo escrito ya es lo que se guarda. */}
            {llevaDivisas && monedaTecleada === "VES" && rateContext ? (
              <MontoARegistrarRow
                bolivares={amountStr}
                destino={currency}
                onDestinoChange={setCurrency}
                rateContext={rateContext}
                usarPrevista={usarPrevista}
                type={type}
              />
            ) : null}
            {rateContext ? (
              <>
                {monedaTecleada === "VES" ? null : (
                <BsAmountPreview
                  amount={amountStr}
                  currency={currency}
                  rateContext={rateContext}
                  usarPrevista={usarPrevista}
                />
                )}
                <PrevistaCheckbox
                  rateContext={rateContext}
                  checked={usarPrevista}
                  onCheckedChange={setUsarPrevista}
                />
              </>
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

          {/* El resumen, justo antes del boton. Repite la cifra que se va a
              anotar y no se toca: es lo último que el dueño lee antes de
              pulsar, no otro sitio donde cambiar algo.

              Tecleando dólares o euros repite lo escrito, que parece redundante
              y no lo es: con el monto arriba y la foto en medio, en un teléfono
              el número ya no se ve cuando el dedo llega al botón. */}
          <ResumenMonto
            type={type}
            monto={
              monedaTecleada === "VES" && rateContext
                ? montoConvertido(amountStr, currency, rateContext, usarPrevista)
                : Number(amountStr) || null
            }
            moneda={llevaDivisas ? currency : null}
            rateContext={rateContext}
            usarPrevista={usarPrevista}
            bolivaresTecleados={monedaTecleada === "VES" ? amountStr : null}
          />
          {/* El libro donde entra la deuda. Antes lo mandaba el radio de moneda;
              ahora sale de los botones o del desplegable, así que viaja aquí. */}
          {llevaDivisas ? <input type="hidden" name="movement_currency" value={currency} /> : null}

          {state.error && !errorPausada ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}

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
