"use client";

import { useActionState, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  WhatsappConsentDialog,
  WhatsappConsentField,
} from "@/components/dashboard/whatsapp-consent-field";
import { AvisoNumeroYaAcepta } from "@/components/dashboard/aviso-numero-ya-acepta";
import { CONSENT_FIELD, CONSENT_SHOWN_FIELD } from "@/lib/whatsapp-opt-in";
import { consentPhoneKey } from "@/lib/phone";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Plus } from "lucide-react";
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
import { CuotasSelect } from "@/components/dashboard/cuotas-select";
import { MovementProductsField } from "@/components/dashboard/movement-products-field";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { formatCurrency } from "@/lib/format";
import { totalDeLineas, type LineaDeProducto } from "@/lib/sale-lines";
import {
  MontoCard,
  MonedaTecleadaButtons,
  MontoARegistrarRow,
  ResumenMonto,
  montoConvertido,
  BsAmountPreview,
  PrevistaCheckbox,
} from "@/components/dashboard/movement-currency-field";
import { WhatsappInput } from "@/components/whatsapp-input";
import { usePermisoDelNumero } from "@/hooks/use-permiso-del-numero";
import { useTour } from "@/components/dashboard/tour-context";
import {
  DEFAULT_PLAZO_PAGO,
  DEFAULT_LEDGER_CURRENCY,
  type LedgerCurrency,
  type OwnerCountry,
  type MonedaTecleada,
} from "@/lib/types";
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import { useFieldErrors, useFormRef } from "@/hooks/use-field-errors";
import { FaltaPorCompletar } from "@/components/dashboard/falta-por-completar";
import type { MonedaHabitual } from "@/lib/moneda-habitual";
import { required, amount as amountRule } from "@/lib/form-validation";
import {
  useErrorDeCuentaPausada,
  useGuardiaAlAbrir,
  useGuardiaDeCuentaPausada,
} from "@/components/dashboard/cuenta-pausada";
import { DocumentIdInput } from "@/components/dashboard/document-id-input";
import {
  ClientResultList,
  CLIENT_RESULT_LIMIT,
} from "@/components/dashboard/client-result-list";

const initialState: MovementFormState = { error: null, clientId: null };

type ClientOption = { id: string; name: string; document_id: string | null };

export function ClientSearchDialog({
  clients,
  ownerId,
  businessName,
  ownerCountry,
  autoOpen,
  hideTrigger = false,
  showTourTarget = true,
  rateContext,
  monedaHabitual,
  pasoInicial = "search",
  movimientoAlElegir,
}: {
  clients: ClientOption[];
  ownerId: string;
  businessName: string;
  // Defaults the phone country picker to the shop's own country. Without it
  // a Venezuelan owner silently saves every client under +57.
  ownerCountry: OwnerCountry;
  // True when the mobile bar navigated here asking for the dialog.
  autoOpen?: boolean;
  // Mounts the dialog WITHOUT its button. Inicio uses it on a phone since
  // delivery 3 of the redesign: the floating "Agregar" took over as the
  // trigger, but something still has to host the dialog that `?nuevo=1` opens,
  // and that is this instance. Dropping the component instead of its button
  // would leave the floating button navigating to a screen with nothing to
  // open.
  hideTrigger?: boolean;
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
  // La moneda que este negocio uso la ultima vez. Ver lib/moneda-habitual.ts.
  monedaHabitual: MonedaHabitual | null;
  // EN QUE PASO ABRE. La hoja de «Registrar» (frame `1389:11227`, 2026-10-18)
  // tiene una opcion que es literalmente «Nuevo cliente», y llevarla al
  // buscador para que el tendero pulse otro boton que dice lo mismo seria un
  // paso de mas en el unico sitio donde ya dijo lo que queria.
  pasoInicial?: "search" | "new";
  // QUE DIALOGO ABRIR EN LA FICHA DEL CLIENTE QUE SE ELIJA. La opcion «Abono»
  // de esa misma hoja necesita saber de quien es el abono antes de poder
  // registrarlo, asi que pasa por el buscador y el proposito viaja con el:
  // `/clients/<id>?movimiento=abono` es el marcador que esa pagina ya lee.
  movimientoAlElegir?: "abono" | "fiado";
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
  const abrirBloqueado = useGuardiaAlAbrir(wantsOpen);
  const guardia = useGuardiaDeCuentaPausada();
  const [prevAutoOpen, setPrevAutoOpen] = useState(false);
  if (wantsOpen !== prevAutoOpen) {
    setPrevAutoOpen(wantsOpen);
    if (wantsOpen && !abrirBloqueado) setOpen(true);
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
            if (guardia()) return;
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
        {hideTrigger ? null : (
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
        )}
        {/* svh y no vh. `vh` mide el viewport GRANDE —el que habría si la barra
          del navegador estuviera escondida— así que en un teléfono con la barra
          a la vista el 90% de esa medida es más alto que la pantalla, y el
          diálogo se centra sobre un alto que no existe: el título queda por
          encima del borde y no hay forma de subir hasta él. `svh` mide el
          viewport PEQUEÑO, el que de verdad se ve. Es el mismo problema del
          100vh que CLAUDE.md ya nombra para iPhone. */}
      <DialogContent className="max-h-[90svh] overflow-y-auto">
          <ClientSearchDialogBody
            key={instanceKey}
            pasoInicial={pasoInicial}
            movimientoAlElegir={movimientoAlElegir}
            clients={clients}
            ownerId={ownerId}
            businessName={businessName}
            ownerCountry={ownerCountry}
            rateContext={rateContext}
            monedaHabitual={monedaHabitual}
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
  monedaHabitual,
  pasoInicial,
  movimientoAlElegir,
  onDirtyChange,
  onDone,
}: {
  clients: ClientOption[];
  ownerId: string;
  businessName: string;
  ownerCountry: OwnerCountry;
  rateContext: MovementRateContext | null;
  // La moneda que este negocio uso la ultima vez. Ver lib/moneda-habitual.ts.
  monedaHabitual: MonedaHabitual | null;
  pasoInicial: "search" | "new";
  movimientoAlElegir?: "abono" | "fiado";
  onDirtyChange: (dirty: boolean) => void;
  // Called once this instance is done with the dialog — a client was
  // created, an existing one was picked, or the owner confirmed abandoning
  // the registration. The parent closes and remounts a fresh instance.
  // `true` means "I am navigating to a client page" — see closeAndReset.
  onDone: (navigating?: boolean) => void;
}) {
  const router = useRouter();
  const [formRef, setFormRef] = useFormRef();
  // El valor inicial y no un efecto: el cuerpo se REMONTA con `instanceKey`
  // cada vez que el dialogo se cierra del todo, asi que un estado sembrado
  // aqui ya es «otra vez el que toca» en la siguiente apertura.
  const [step, setStep] = useState<"search" | "new">(pasoInicial);
  const [query, setQuery] = useState("");
  const [nameValue, setNameValue] = useState("");

  // EL PERMISO DE WHATSAPP (MS-34), en el alta de cliente nuevo.
  //
  // Aqui SIEMPRE se pregunta: un cliente que acaba de nacer no puede haber
  // sido preguntado antes, asi que no hay equivalente del `consentAsked` del
  // alta de movimiento.
  const [consent, setConsent] = useState(false);
  // SI EL NÚMERO QUE SE ESTÁ TECLEANDO YA ACEPTÓ. `WhatsappConsentField` sabe
  // esconder la casilla desde el 2026-10-10 con `yaTienePermiso`, pero esta
  // puerta nunca se lo pasaba: de sus cuatro usuarios solo dos lo hacían, y
  // las dos que faltaban son altas, que es justo donde el tendero cree estar
  // decidiendo algo. Reportado desde producción el 2026-10-21.
  const [consentDialog, setConsentDialog] = useState(false);
  // El numero, solo para poder decir "falta registrar el WhatsApp". WhatsappInput
  // no es controlado desde aqui, asi que se escucha su onValueChange.
  const [whatsappValue, setWhatsappValue] = useState("");
  const permisoDelNuevo = usePermisoDelNumero(whatsappValue);

  // UNA REF Y NO ESTADO, y la diferencia importa. El envio del camino de
  // duplicados no pasa por <form onSubmit>: `confirmDuplicateAndSubmit` llama
  // a formAction() directamente. Al reintentarlo desde el dialogo del permiso
  // esa funcion se lee desde el closure del render ANTERIOR, donde un useState
  // seguiria valiendo false y volveria a abrir el dialogo, en bucle. Una ref
  // la leen todos los closures igual.
  const consentResuelto = useRef(false);
  // Que hacer cuando el dialogo del permiso se cierre: reenviar el formulario
  // normal, o rehacer el camino de duplicados que lo abrio.
  const trasPermiso = useRef<"form" | "duplicado">("form");
  const [documentIdValue, setDocumentIdValue] = useState("");
  const [addressValue, setAddressValue] = useState("");
  const [plazoPago, setPlazoPago] = useState(DEFAULT_PLAZO_PAGO);
  // "1" = pago único, which the server stores as null. Same default as the
  // other form -- this one was missing the field entirely until 2026-10-16,
  // even though `createClientWithMovement` has always read `cuotas` from the
  // form, so a new client's first fiado silently could not be split.
  const [cuotas, setCuotas] = useState("1");
  const [currency, setCurrency] = useState<LedgerCurrency>(monedaHabitual?.libro ?? DEFAULT_LEDGER_CURRENCY);
  const [amountStr, setAmountStr] = useState("");
  // QUÉ SE LLEVÓ. Entra por ESTA puerta también y no solo por la otra: las dos
  // mandan a la misma acción del servidor, y el 2026-10-16 el campo de cuotas
  // se puso en una sola -- un cliente nuevo a crédito se guardaba siempre sin
  // cuotas, en silencio. Es la regla de CLAUDE.md sobre entrar por todas las
  // puertas de una acción.
  const [productos, setProductos] = useState<LineaDeProducto[]>([]);
  // Controlled like every other field in this form now — it used to be the
  // one plain uncontrolled input, which is exactly the field a resubmit
  // after the duplicate-document warning could silently blank out.
  const [descriptionValue, setDescriptionValue] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [usarPrevista, setUsarPrevista] = useState(false);
  // En que moneda escribe, que no es lo mismo que el libro donde entra la
  // deuda. Arranca en la moneda del libro para que quien siempre teclea dolares
  // no note ningun cambio.
  // Arranca en la que uso la ultima vez. Aqui no hay choque posible con la
  // deuda como en el abono: un cliente nuevo no debe nada todavia, y esto
  // siempre es un fiado.
  const [monedaTecleada, setMonedaTecleada] = useState<MonedaTecleada>(monedaHabitual?.tecleada ?? "USD");
  const [state, formAction, pending] = useActionState(createClientWithMovement, initialState);
  const { errors, validate, recheck } = useFieldErrors({
    new_client_name: required,
    document_id: required,
    amount: amountRule(),
  });

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return clients
      .filter((c) => c.name.toLowerCase().includes(q) || c.document_id?.toLowerCase().includes(q))
      .slice(0, CLIENT_RESULT_LIMIT);
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

  // Cuenta pausada: lo dice el dialogo, no un parrafo rojo aqui debajo.
  const errorPausada = useErrorDeCuentaPausada(state.error);

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
    // ── «ABONO» ENTRA EN SU PROPIO FLUJO, NO EN LA FICHA ────────────────
    //
    // Hasta el 2026-10-20 iba a `/clients/<id>?movimiento=abono`, que abre el
    // diálogo «Agregar transacción» de siempre. O sea que elegir a alguien en
    // el buscador desembocaba en el flujo ANTERIOR, con su selector de tipo
    // —Cargo o Abono— ya resuelto pero todo lo demás igual que antes.
    //
    // Lo reportó el dueño ese día: *«al seleccionarlo abre el primer paso del
    // flujo "Registrar abono: 1/3 Seleccionar fiado / crédito", toda la
    // transacción se asignará al cliente seleccionado»*.
    //
    // `/abonos/nuevo?cliente=<id>` ES ESE PASO 1/3, y ya existía: lo usa el
    // botón «Agregar abono» de la ficha del cliente desde el 2026-10-19. Lo
    // único que faltaba era que esta puerta llevara allí.
    //
    // `fiado` SE QUEDA COMO ESTABA: su flujo propio es `/ventas/nueva`, que no
    // admite un cliente por la dirección, así que mandarlo a la ficha sigue
    // siendo lo correcto hasta que eso cambie.
    if (movimientoAlElegir === "abono") {
      router.push(`/abonos/nuevo?cliente=${id}`);
      return;
    }
    // El proposito viaja con la navegacion: sin el, «Abono» dejaria al tendero
    // en la ficha del cliente teniendo que buscar el boton que acaba de pedir.
    router.push(movimientoAlElegir ? `/clients/${id}?movimiento=${movimientoAlElegir}` : `/clients/${id}`);
  }

  // Every field the form needs is React-controlled now, so the live DOM
  // always matches current state — reading it fresh here (rather than a
  // FormData snapshot captured back when the duplicate warning first
  // appeared) is what makes a resubmit pick up anything edited since.
  function confirmDuplicateAndSubmit() {
    if (!formRef.current) return;
    if (!validate(formRef.current)) return;
    // Este camino NO pasa por <form onSubmit>, asi que la pregunta del permiso
    // se repite aqui. Sin esto, crear un cliente duplicado se saltaria la
    // unica vez que se iba a preguntar por el.
    if (!consent && !consentResuelto.current) {
      trasPermiso.current = "duplicado";
      setConsentDialog(true);
      return;
    }
    const data = new FormData(formRef.current);
    data.set("confirm_duplicate", "true");
    formAction(data);
  }

  return step === "search" ? (
    <>
      {/* ── LA CABECERA DEL ABONO ES MÁS CORTA, Y SALE DEL FRAME ─────────
          Frame `1471:21576`: para el abono la modal lleva SOLO el título, la
          ✕ y el campo. Ni la línea del negocio ni «+ Nuevo cliente».
          Confirmado con el dueño el 2026-10-20 al enseñarle la diferencia.

          Y «+ Nuevo cliente» no es solo que el frame no lo dibuje: un cliente
          recién creado no tiene ningún fiado que pagar, así que ese botón
          lleva a un callejón sin salida en este camino concreto. En el de
          «Venta o fiado» es justo al revés --dar de alta y venderle en el
          mismo gesto es lo corriente-- y por eso la diferencia es por camino
          y no por pantalla. */}
      <DialogHeader>
        <DialogTitle>Buscar cliente</DialogTitle>
        {movimientoAlElegir === "abono" ? null : (
          <DialogDescription>Negocio: {businessName} · busca por nombre o cédula.</DialogDescription>
        )}
      </DialogHeader>
      <div className="flex flex-col gap-3">
        <Input
          autoFocus
          placeholder="Nombre o cédula del cliente"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />

        {results.length > 0 ? (
          <ClientResultList
            results={results.map((c) => ({ id: c.id, name: c.name, documentId: c.document_id }))}
            onSelect={selectExisting}
          />
        ) : query.trim() ? (
          <p className="text-sm text-muted-foreground">Sin resultados para &quot;{query}&quot;.</p>
        ) : null}

        {movimientoAlElegir === "abono" ? null : (
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
        )}
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
          if (!validate(e.currentTarget)) {
            e.preventDefault();
            return;
          }
          if (!consent && !consentResuelto.current) {
            e.preventDefault();
            trasPermiso.current = "form";
            setConsentDialog(true);
          }
        }}
        className="flex flex-col gap-4"
      >
        <input type="hidden" name="confirm_duplicate" defaultValue="false" />
        {/* Viaja siempre: en el alta de cliente la casilla se ensena siempre,
            asi que el cliente nuevo nace con `whatsapp_consent_asked_at`
            puesto y el alta de movimiento ya no vuelve a preguntar. */}
        <input type="hidden" name={CONSENT_SHOWN_FIELD} value="1" />
        {consent ? <input type="hidden" name={CONSENT_FIELD} value="1" /> : null}
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
        {/* Orden: nombre -> documento -> WhatsApp. Los dos obligatorios van
            juntos y el opcional detrás, así el dueño con prisa llena de
            corrido lo que no puede saltarse y decide una sola vez si sigue.
            Con el WhatsApp en medio, el formulario pedía obligatorio,
            opcional, obligatorio. */}
        <div className="flex flex-col gap-2">
          <Label htmlFor="document_id">Cédula</Label>
          <DocumentIdInput
            id="document_id"
            country={ownerCountry}
            value={documentIdValue}
            onChange={(next) => {
              setDocumentIdValue(next);
              recheck("document_id", formRef.current);
            }}
            required
            invalid={Boolean(errors.document_id)}
          />
          {errors.document_id ? (
            <p className="text-xs text-destructive">{errors.document_id}</p>
          ) : null}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="whatsapp">WhatsApp (opcional)</Label>
          <WhatsappInput
            id="whatsapp"
            name="whatsapp"
            preferredDialCode={OWNER_COUNTRY_DIAL_CODE[ownerCountry]}
            invalid={Boolean(errors.whatsapp)}
            onValueChange={(v) => {
              setWhatsappValue(v ?? "");
              recheck("whatsapp", formRef.current);
            }}
          />
          {errors.whatsapp ? <p className="text-xs text-destructive">{errors.whatsapp}</p> : null}
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
            Cargo (fía) — un cliente nuevo siempre empieza debiendo. Para registrar un
            abono, hazlo después desde el detalle del cliente.
          </p>
        </div>

        {/* This form always registers a charge (the hidden `type` above), so
            there is no `type === "charge"` guard here as there is in
            add-movement-dialog -- a new client always starts owing. */}
        <PlazoPagoSelect
          value={plazoPago}
          onValueChange={(v) => {
            setPlazoPago(v);
            // Losing the plazo sends cuotas back to "pago único", same as the
            // other form: otherwise the field hides holding a "4", the fiado
            // saves with no cuotas because the server ignores them without a
            // plazo, and re-picking a plazo brings back a number nobody just
            // chose.
            if (v === "" || v === "sin_especificar") setCuotas("1");
          }}
        />
        <CuotasSelect
          value={cuotas}
          onValueChange={setCuotas}
          plazoDias={
            plazoPago && plazoPago !== "sin_especificar" && Number.isFinite(Number(plazoPago))
              ? Number(plazoPago)
              : null
          }
        />
        {/* Este formulario SIEMPRE registra un cargo --el `type` oculto de
            arriba-- así que no lleva la guarda de "solo fiados" que sí tiene
            el otro: un cliente nuevo siempre empieza debiendo. */}
        <MovementProductsField
          value={productos}
          onValueChange={(lineas) => {
            setProductos(lineas);
            const total = totalDeLineas(lineas);
            if (lineas.length > 0) setAmountStr(String(total));
          }}
          moneda={(n) =>
            ownerCountry === "VE" ? formatDisplayCurrency(n, currency) : formatCurrency(n)
          }
        />

        {/* Por país, no por tasa: ver la nota larga en add-movement-dialog.
            Un dueño venezolano lleva dólares y euros aunque el BCV no
            responda, y sin este selector el formulario no manda moneda. */}
        {ownerCountry === "VE" ? (
          <MonedaTecleadaButtons
            value={monedaTecleada}
            onValueChange={(v) => {
              setMonedaTecleada(v);
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
            moneda={ownerCountry === "VE" ? monedaTecleada : null}
            invalid={Boolean(errors.amount)}
          />
          {ownerCountry === "VE" && monedaTecleada === "VES" && rateContext ? (
            <MontoARegistrarRow
              bolivares={amountStr}
              destino={currency}
              onDestinoChange={setCurrency}
              rateContext={rateContext}
              usarPrevista={usarPrevista}
              type="charge"
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
          {errors.amount ? <p className="text-xs text-destructive">{errors.amount}</p> : null}
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="description">Descripción (opcional)</Label>
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

        {/* El resumen, justo antes del boton. Repite la cifra que se va a
            anotar y no se toca: es lo último que el dueño lee antes de
            pulsar, no otro sitio donde cambiar algo.

            Tecleando dólares o euros repite lo escrito, que parece redundante
            y no lo es: con el monto arriba y la foto en medio, en un teléfono
            el número ya no se ve cuando el dedo llega al botón. */}
        {/* Siempre un fiado: el primer movimiento de un cliente nuevo no puede
            ser un abono, porque todavía no debe nada. */}
        <ResumenMonto
          type="charge"
          monto={
            monedaTecleada === "VES" && rateContext
              ? montoConvertido(amountStr, currency, rateContext, usarPrevista)
              : Number(amountStr) || null
          }
          moneda={ownerCountry === "VE" ? currency : null}
          rateContext={rateContext}
          usarPrevista={usarPrevista}
          bolivaresTecleados={monedaTecleada === "VES" ? amountStr : null}
        />
        {/* El libro donde entra la deuda. Antes lo mandaba el radio de moneda;
            ahora sale de los botones o del desplegable, así que viaja aquí. */}
        {ownerCountry === "VE" ? <input type="hidden" name="movement_currency" value={currency} /> : null}

        {state.error && !errorPausada ? (
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

        {/* Mismo botón "Guardar fiado" que el alta de movimiento, y el mismo
            problema: aquí el formulario es aún más largo —nombre, cédula,
            WhatsApp, tipo, plazo, monto— así que con el teclado abierto el
            campo que falta está casi siempre fuera de la pantalla. */}
        <FaltaPorCompletar
          errors={errors}
          etiquetas={{
            new_client_name: "Nombre",
            document_id: "Cédula",
            whatsapp: "WhatsApp",
            amount: "Monto",
          }}
        />

        {/* Encima de "Guardar fiado", donde el dueño está mirando cuando
            decide. El cliente todavía no existe, así que el nombre sale del
            campo que se está tecleando y la frase se arma con él.

            EL AVISO ES EL DE UN ALTA, Y NO EL DEL CAMPO. Esto se hacía con
            `WhatsappConsentField` y su propia frase de «ya tiene permiso», que
            está escrita para un cliente que YA EXISTE. Cuando el número acepta
            pero la ficha es de OTRA bodega no hay nombre que poner, y la frase
            caía en «Este cliente ya tiene activadas las notificaciones» — sobre
            un cliente que todavía no existe, y atribuyéndole a él un permiso
            que es del número. Visto en pantalla el 2026-10-21.

            `AvisoNumeroYaAcepta` es el que ya usan las otras dos altas y dice
            las dos cosas bien: con nombre cuando la ficha es del propio
            tendero, y «este número» cuando no lo es. */}
        {permisoDelNuevo?.granted === true ? (
          <AvisoNumeroYaAcepta clientName={permisoDelNuevo.clientName} />
        ) : (
          <WhatsappConsentField
            clientName={nameValue}
            hasWhatsapp={consentPhoneKey(whatsappValue) !== null}
            yaTienePermiso={false}
            checked={consent}
            onCheckedChange={setConsent}
            disabled={pending}
          />
        )}

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

      <WhatsappConsentDialog
        open={consentDialog}
        onOpenChange={setConsentDialog}
        clientName={nameValue}
        hasWhatsapp={consentPhoneKey(whatsappValue) !== null}
        checked={consent}
        onCheckedChange={setConsent}
        onContinue={() => {
          consentResuelto.current = true;
          setConsentDialog(false);
          // El siguiente frame, para que el <input> oculto del permiso ya este
          // en el DOM cuando se lea el FormData.
          requestAnimationFrame(() => {
            if (trasPermiso.current === "duplicado") confirmDuplicateAndSubmit();
            else formRef.current?.requestSubmit();
          });
        }}
      />
    </>
  );
}
