"use client";

import { track } from "@/lib/mixpanel";
import { useEffect, useState, type ChangeEvent, type ReactNode } from "react";
import { ArrowUpDown, Share2, XIcon } from "lucide-react";
import { puedeCompartirArchivos, tarjetaDeTasa } from "@/lib/share-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Popover as PopoverPrimitive } from "radix-ui";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { getRateHistory } from "@/lib/exchange-rate/rate-history";
import {
  etiquetaDePrevista,
  tasaPrevistaDe,
  type TasaPrevista,
} from "@/lib/exchange-rate/tasa-prevista";
import { Input } from "@/components/ui/input";
import { useIsMobile } from "@/hooks/use-mobile";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { cn } from "@/lib/utils";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import {
  convertToAllCurrencies,
  type MovementCurrency,
} from "@/lib/exchange-rate/convert";
import { BS_DECIMALS, formatBs, formatBsAmount, formatDisplayCurrency, formatPlainAmount } from "@/lib/exchange-rate/format";
import type { LedgerCurrency } from "@/lib/types";

// THE RATE CALCULATOR, SHARED BY BOTH FACES OF THE APP since 2026-11-19.
//
// It lived inside `components/dashboard/exchange-rate-strip.tsx` as the owner's
// calculator on Inicio. The owner then asked for it on the client's balance
// link: «En el link compartido del cliente debemos agregar la calculadora,
// clientes mencionan que para poder pagar deben calcular los bolívares que
// pagarán en dólares o euros y desde el enlace no tienen como calcularlo». So
// it moved here, and both screens mount it (CLAUDE.md, «Un valor visual que
// sale en más de una pantalla NACE en un componente»): a fix to the arithmetic,
// the four-decimal mask or the USDT stamp now reaches the client too.
//
// `variant` is what differs, and only that (frames `2213:24204`, approved by
// the owner on 2026-11-19):
//
//   owner   «Tú pones» / «Tú cobras», seeded with 1,00, the tasa prevista
//           checkbox and «Compartir». Exactly what it did before the move.
//   client  «Monto» / «Equivale a», opens with the client's own balance written
//           in, and a sentence saying the shop records the payment at the rate
//           of the day it is made. No prevista (it is a rate for pricing a
//           future fiado, not for paying today) and no «Compartir»: the frames
//           do not draw either.

// La moneda que puede elegirse EN LA CALCULADORA. Es un tipo propio y no una
// ampliación de `LedgerCurrency` ni de `MovementCurrency` a propósito: esos
// dos los comparte el formulario de fiado, y `movements.currency` tiene un
// check que solo admite USD y EUR. Ensanchar aquellos metería el USDT en el
// camino del dinero, que es justo lo que `CT-17` todavía no autoriza.
export type MonedaCalculadora = LedgerCurrency | "USDT";

// What the client owes in each book, already rounded to cents. Only books with a
// debt (> 0) belong here: a book in the client's favour has nothing to pay.
export type SaldoDelCliente = Partial<Record<LedgerCurrency, number>>;

// The digits the cents mask holds for an amount: $23,00 -> "2300".
function digitsOf(amount: number): string {
  return String(Math.round(amount * 100));
}

// ===========================================================================
// THE SURFACE: a bottom sheet on the phone, a floating window on the web.
//
// Moved out of the owner's strip unchanged so the client's link opens the same
// way (frame `2213:24799`: «como la calculadora del dueño en escritorio»). The
// trigger is a render prop because the owner's row adds `sm:w-auto` only in the
// desktop branch, and moving it must not change a pixel of that screen.
// ===========================================================================
export function CalculatorSurface({
  open,
  onOpenChange,
  trigger,
  children,
  popoverClassName,
  popoverSide,
  popoverTitle = false,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  trigger: (isMobile: boolean) => ReactNode;
  children: ReactNode;
  popoverClassName?: string;
  popoverSide?: "top" | "bottom";
  // The client's window draws «Calculadora» and ✕ (frame `2213:24843`); the
  // owner's never had them and keeps not having them.
  popoverTitle?: boolean;
}) {
  const isMobile = useIsMobile();
  const { inset: keyboardInset, visibleHeight } = useKeyboardInset();

  if (isMobile) {
    // A Sheet (Radix Dialog) rather than vaul's Drawer. The Drawer positions
    // itself with a JS-driven transform, which fought the on-screen keyboard:
    // opening the calculator with the keyboard up left the sheet's top cut off
    // above the screen, and the only way back was to dismiss the keyboard and
    // refocus the input so the browser repositioned it.
    //
    // Switching primitives is not by itself the fix — a bottom sheet is still
    // `fixed bottom-0`, anchored to a layout viewport that does not shrink for
    // the keyboard. The sizing below is what actually fixes it: bottom is
    // lifted by however much the keyboard covers, and the height is capped to
    // the space actually visible, both measured from visualViewport rather
    // than assumed from vh units.
    return (
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetTrigger asChild>{trigger(true)}</SheetTrigger>
        <SheetContent
          side="bottom"
          className="max-h-[85dvh] rounded-t-xl"
          style={{
            bottom: keyboardInset || undefined,
            maxHeight: visibleHeight ? Math.round(visibleHeight * 0.85) : undefined,
          }}
        >
          <SheetHeader className="pb-0">
            <SheetTitle>Calculadora</SheetTitle>
          </SheetHeader>
          {/* The sheet is capped, so the body is what scrolls — otherwise the
              rate history table simply overflows past the top edge again. */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
            {children}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger(false)}</PopoverTrigger>
      {/* The 90-day table made this panel taller than the screen, so Radix
          pushed it up to fit and the calculator's own inputs ended up above the
          top edge — reachable by nobody. Radix publishes how much room it
          actually has as --radix-popover-content-available-height; bounding the
          panel to that and letting it scroll keeps the calculator at the top
          where it belongs. collisionPadding keeps it off the viewport edge. */}
      <PopoverContent
        align="start"
        side={popoverSide}
        collisionPadding={16}
        className={cn(
          "max-h-[var(--radix-popover-content-available-height)] w-[min(640px,calc(100vw-2rem))] overflow-y-auto",
          popoverClassName,
        )}
      >
        <div className="flex flex-col gap-4">
          {popoverTitle ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-base font-medium text-foreground">Calculadora</p>
              <PopoverPrimitive.Close asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Cerrar">
                  <XIcon />
                </Button>
              </PopoverPrimitive.Close>
            </div>
          ) : null}
          {children}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function RateCalculator({
  variant = "owner",
  rate,
  usdt,
  edadUsdt,
  pair,
  onPairChange,
  rateDate,
  rateStatus,
  rateFetchedAt,
  saldo,
}: {
  variant?: "owner" | "client";
  rate: { usd: number; eur: number };
  usdt: number | null;
  edadUsdt: number | null;
  pair: MonedaCalculadora;
  onPairChange: (next: MonedaCalculadora) => void;
  rateDate?: string | null;
  rateStatus?: "current" | "no_publication" | "unconfirmed";
  rateFetchedAt?: string | null;
  // Client only: what they owe per book. Ignored by the owner's variant.
  saldo?: SaldoDelCliente;
}) {
  const isClient = variant === "client";
  // The client's balance in the book a tab names, as mask digits. Null for
  // USDT and for a book they owe nothing in.
  const saldoDigits = (c: MonedaCalculadora): string | null => {
    if (!isClient || c === "USDT") return null;
    const amount = saldo?.[c];
    return amount && amount > 0 ? digitsOf(amount) : null;
  };

  // Digits-only "cents" mask — the same way a POS amount field works: typing
  // shifts digits in from the right, the last two are always the decimals.
  //
  // Seeded at 1.00 with the foreign currency on top, matching sevenz.site's
  // calculator. This reverses the original "start in bolívares" reasoning: it
  // was right when the field opened empty, because the shop's own question is
  // "esto cuesta Bs. X, ¿cuánto es en dólares?" — but a seeded example answers
  // "¿a cómo está el dólar?" in one glance, and Invertir is one tap away.
  //
  // THE CLIENT'S OPENS WITH WHAT THEY OWE instead (owner's decision of
  // 2026-11-19, frames `2213:24264` and `2213:24399`): the question a client
  // brings is «¿cuántos bolívares pago?», and their balance is the answer's
  // starting point. With nothing owed — a balance in their favour — it opens
  // empty: there is no figure of theirs to write, and a made-up 1,00 would read
  // as a debt.
  const [rawDigits, setRawDigits] = useState(() =>
    isClient ? (saldoDigits(pair) ?? "") : "100",
  );
  // Which currency sits in the TOP field. FOREIGN means the pair (USD/EUR) is
  // on top and bolívares below.
  const [entry, setEntry] = useState<"VES" | "FOREIGN">("FOREIGN");
  // Which of the two fields holds the number actually typed. Both are editable,
  // so this is what keeps the conversion from feeding on its own output: typing
  // 5 in the bolívares field must mean five bolívares, not "convert 5 up, round
  // it, then convert that back down".
  const [source, setSource] = useState<"put" | "get">("put");
  // True until the first edit. The seeded 1.00 is an example, not something the
  // owner entered, so the first tap clears it — otherwise the digits mask would
  // push a typed 5 onto the existing 1.00 and produce $10.05. Only the
  // untouched seed clears: once they have typed, tapping away and back keeps
  // their number.
  //
  // The client's preloaded balance is the same kind of figure — written by the
  // app, not by them — so it clears on the first tap the same way.
  const [pristine, setPristine] = useState(() => (isClient ? saldoDigits(pair) !== null : true));
  // Client only. Whether the figure in the field is theirs: typed, or turned
  // around with «Invertir». Until it is, each tab brings that book's balance
  // (owner's decision of 2026-11-19, asked when he removed the «Tu saldo» pills
  // from the frames: «Escribe su saldo en euros»). Once it is, a tab only
  // changes the currency and their figure stays, as in the owner's calculator.
  const [hasTyped, setHasTyped] = useState(false);
  const [shared, setShared] = useState(false);
  // La proxima tasa publicada, si toca ofrecerla. getRateHistory esta cacheado
  // a nivel de modulo y la tabla de abajo lo llama tambien, asi que esto no
  // añade una segunda peticion.
  const [prevista, setPrevista] = useState<TasaPrevista | null>(null);
  const [usarPrevista, setUsarPrevista] = useState(false);

  useEffect(() => {
    // The client's calculator offers no prevista, so it does not ask for the
    // history either: one less request on a phone that only came to pay.
    if (isClient) return;
    let cancelado = false;
    getRateHistory()
      .then((historial) => {
        if (!cancelado) setPrevista(tasaPrevistaDe(historial));
      })
      // Sin tasa prevista no se ofrece nada y la calculadora funciona igual:
      // esto es un extra, no una dependencia.
      .catch(() => {});
    return () => {
      cancelado = true;
    };
  }, [isClient]);

  // La tasa con la que se calcula de verdad. Toda la conversion cuelga de aqui,
  // asi que marcar la casilla cambia el numero grande y no solo una etiqueta.
  const tasaEnUso = usarPrevista && prevista ? { usd: prevista.usd, eur: prevista.eur } : rate;

  const pairRate =
    pair === "USD" ? tasaEnUso.usd : pair === "EUR" ? tasaEnUso.eur : (usdt ?? 0);
  const pairName = pair === "USD" ? "Dólar" : pair === "EUR" ? "Euro" : "USDT";

  type MonedaVisible = MovementCurrency | "USDT";
  const putCurrency: MonedaVisible = entry === "VES" ? "VES" : pair;
  const getCurrency: MonedaVisible = entry === "VES" ? pair : "VES";
  const labelFor = (c: MonedaVisible) =>
    c === "VES" ? "Bolívares" : c === "USD" ? "Dólares" : c === "EUR" ? "Euros" : "USDT";

  // FOUR DECIMALS WHEN THE TYPED FIELD IS IN BOLIVARS (owner's decision of 2026-11-17, see
  // `BS_DECIMALS`): the mask shifts digits in from the right and the last four are the decimals;
  // in dollars, euros or USDT the last two. The field's own text already prints that many, so the
  // digits read back from it always mean the figure on screen.
  const decimalsOf = (c: MonedaVisible) => (c === "VES" ? BS_DECIMALS : 2);
  const typedCurrency = source === "put" ? putCurrency : getCurrency;
  const cents = Number(rawDigits || "0");
  const typed = cents / 10 ** decimalsOf(typedCurrency);
  const hasAmount = typed > 0;

  // Con USDT de por medio la cuenta se hace AQUÍ y no en
  // `convertToAllCurrencies`, que es la misma función que alimenta la vista
  // previa del formulario de fiado. Ensancharla para que entienda USDT
  // metería la moneda en el camino del dinero por la puerta de atrás.
  //
  // La cuenta es la misma de siempre —pasar por bolívares— solo que con el
  // precio de Binance en vez de una tasa del BCV.
  const convertBetween = (amount: number, from: MonedaVisible, to: MonedaVisible) => {
    if (from === "USDT" || to === "USDT") {
      if (!usdt) return 0;
      // BOLIVARS ARE ALREADY BOLIVARS. Until 2026-11-20 this had two branches, USDT and
      // «anything else times a BCV rate», so bolivars typed after «Invertir» on the USDT
      // tab were multiplied by the EURO rate: Bs. 13.412,50 read as 12.613,40 USDT instead
      // of 12,50. In production in the owner's calculator since CT-16; found by the v0.11.0
      // checklist, typing it on the client's calculator, before it reached any client.
      const ves =
        from === "USDT"
          ? amount * usdt
          : from === "VES"
            ? amount
            : amount * (from === "USD" ? tasaEnUso.usd : tasaEnUso.eur);
      if (to === "USDT") return ves / usdt;
      return to === "VES" ? ves : ves / (to === "USD" ? tasaEnUso.usd : tasaEnUso.eur);
    }
    const all = convertToAllCurrencies(amount, from, tasaEnUso);
    return to === "VES" ? all.ves : to === "USD" ? all.usd : all.eur;
  };
  const putAmount = source === "put" ? typed : convertBetween(typed, getCurrency, putCurrency);
  const getAmount = source === "get" ? typed : convertBetween(typed, putCurrency, getCurrency);

  // El código detrás del número y no un símbolo delante: el USDT no tiene
  // símbolo propio, y "$" lo haría indistinguible del dólar — justo la
  // confusión que esta pestaña existe para evitar. Y `formatDisplayCurrency`
  // no puede recibirlo: Intl no conoce "USDT", no es una moneda ISO, y
  // pedírsela lanza.
  const money = (amount: number, currency: MonedaVisible) =>
    currency === "VES"
      ? `Bs. ${formatBsAmount(amount)}`
      : currency === "USDT"
        ? `${formatPlainAmount(amount)} USDT`
        : formatDisplayCurrency(amount, currency);

  // An empty field stays empty rather than snapping back to 0,00 — the owner is
  // mid-edit and a number reappearing under the cursor is its own bug.
  const putValue = rawDigits === "" && source === "put" ? "" : money(putAmount, putCurrency);
  const getValue = rawDigits === "" && source === "get" ? "" : money(getAmount, getCurrency);
  const putPlaceholder = money(0, putCurrency);
  const getPlaceholder = money(0, getCurrency);

  // Cuántos minutos tiene el precio de Binance. Solo se dice a partir de dos:
  // "hace 0 minutos" es ruido, y por debajo de eso el número es el de ahora.
  //
  // Existe porque iOS suspende las PWA: el dueño puede reabrir la app y
  // encontrarse la pantalla tal como la dejó. El hook vuelve a pedir el
  // precio al reanudar, pero si esa petición falla —sin señal— se conserva el
  // último conocido, y entonces hay que decir su edad en vez de enseñarlo
  // como si fuera de este momento.
  const minutosUsdt = edadUsdt !== null ? Math.floor(edadUsdt / 60) : null;

  // EL USDT NO LLEVA "TASA BCV", y no es un matiz de redacción: el BCV no
  // publica ninguna tasa de USDT. Ese sello le daría un respaldo oficial que
  // no tiene, en una pantalla que existe para que alguien se fíe de un número.
  // Tampoco lleva fecha — no es la tasa "del 24 de septiembre", es el precio
  // de hace un minuto. Lleva la casa, que es lo que sí se puede comprobar.
  const stampLabel = pair === "USDT"
    // Sin marca de tiempo no se dice "precio de ahora". CriptoYa la manda
    // siempre hoy, pero si algún día dejara de hacerlo, afirmar frescura que
    // no podemos comprobar es exactamente el tipo de promesa que esta
    // pantalla no puede permitirse.
    ? minutosUsdt === null
      ? "Binance P2P"
      : minutosUsdt >= 2
        ? `Binance P2P · hace ${minutosUsdt} min`
        : "Binance P2P · precio de ahora"
    : usarPrevista && prevista
      ? `Tasa BCV prevista para ${etiquetaDePrevista(prevista.fecha)}`
      : rateDate
        ? `Tasa BCV del ${formatRateDate(rateDate)}`
        : "Tasa BCV";
  // Only when the rate is not today's. Two causes, two sentences, because
  // telling an owner "the BCV doesn't publish on weekends" while the real
  // problem is our own fetch would hide the failure precisely when it costs
  // money — they would price a fiado against a rate they think is confirmed.
  const stampNote = pair === "USDT"
    // Las notas de abajo explican por qué la tasa del BCV puede no ser de hoy
    // (fin de semana, festivo, fallo nuestro). Ninguna aplica a un precio de
    // mercado continuo, y enseñarlas ahí confundiría dos cosas distintas.
    ? null
    : usarPrevista
    ? null
    : rateStatus === "no_publication"
      ? "El BCV no publica sábados, domingos ni festivos. Esta es la última tasa publicada."
      : rateStatus === "unconfirmed"
        ? // A fact, not a status. "Estamos reintentando" read like a spinner —
          // it asked the owner to wait for something that may never change, and
          // still did not tell them the one thing they needed: when this number
          // was last checked. Safe to show fetch time here precisely because
          // the sentence says it is the fetch time.
          `Última actualización: ${formatFetchStamp(rateFetchedAt)}`
        : null;

  function editHandler(field: "put" | "get") {
    return (e: ChangeEvent<HTMLInputElement>) => {
      setSource(field);
      setPristine(false);
      setHasTyped(true);
      setRawDigits(e.target.value.replace(/[^0-9]/g, "").slice(0, 15));
    };
  }

  // Focus only ever clears the seeded example. It deliberately does NOT change
  // which field is authoritative — typing does that.
  //
  // Making focus set `source` looked equivalent and was not: with Bs. 0,50 in
  // the bottom card, merely tapping the top field reinterpreted those same
  // digits as dollars and the card jumped to Bs. 406,87. Tapping a field is not
  // a statement about what the number means, and a converter that changes its
  // answer because you looked at it is worse than one that is hard to use.
  function focusHandler(field: "put" | "get") {
    return () => {
      if (!pristine) return;
      setSource(field);
      setRawDigits("");
      setPristine(false);
    };
  }

  // A tab. The owner's only changes the currency, as it always did. The
  // client's also writes that book's balance while the figure is not theirs yet
  // — empty for USDT or a book they owe nothing in, so the field never shows a
  // dollar debt relabelled as euros.
  function selectPair(next: MonedaCalculadora) {
    onPairChange(next);
    if (!isClient || hasTyped) return;
    const digits = saldoDigits(next);
    setEntry("FOREIGN");
    setSource("put");
    setRawDigits(digits ?? "");
    setPristine(digits !== null);
  }

  async function handleShare() {
    track("Calculator Used", { action: "shared" });
    // With nothing typed there is no conversion to send, but the rate itself is
    // still worth sharing — and it is the thing an owner is most often asked
    // for. Sharing "Bs. 0,00 = $0.00" instead, or disabling the button with no
    // explanation, both waste the tap.
    const text = hasAmount
      ? `${money(putAmount, putCurrency)} ${labelFor(putCurrency)} = ${money(getAmount, getCurrency)} ${labelFor(getCurrency)} · ${stampLabel}`
      : `1 ${pairName} = ${formatBs(pairRate)} · ${stampLabel}`;

    try {
      // La tarjeta primero. Lo que se comparte acaba en un WhatsApp, y ahi un
      // texto plano no lo respalda nadie: cualquiera escribe "$1 = Bs. 832,49".
      const tarjeta = await tarjetaDeTasa(datosDeLaTarjeta());
      if (tarjeta && puedeCompartirArchivos([tarjeta])) {
        // Sin `text` junto al archivo, a peticion: un mensaje reenviado con una
        // URL dentro es la forma que copia un estafador cambiando el dominio
        // por uno parecido. La tarjeta lleva "Sevenz.site" impreso — se lee, no
        // se pulsa.
        await navigator.share({ files: [tarjeta] });
        return;
      }
    } catch (error) {
      // Cerrar el menu de compartir rechaza la promesa, y eso NO es un fallo:
      // el dueño cambio de idea. Solo entonces hay que parar aqui — en
      // cualquier otro error se sigue al texto, que es mejor que nada.
      if (error instanceof DOMException && error.name === "AbortError") return;
    }

    try {
      // El texto de siempre, para quien no puede mandar imagenes: Firefox no lo
      // hace nunca y varios escritorios tienen share pero rechazan archivos.
      // The native sheet is what gets this into WhatsApp, which is where these
      // quotes actually go. Clipboard is the fallback for desktop, where
      // navigator.share often does not exist.
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setShared(true);
        setTimeout(() => setShared(false), 2000);
      }
    } catch {
      // A dismissed share sheet rejects; that is a normal outcome, not an error.
    }
  }

  // Lo mismo que se ve en pantalla, no una segunda version: los textos salen de
  // `money` y `labelFor`, los mismos que dibujan las dos tarjetas de arriba. Si
  // esto formateara por su cuenta, la imagen compartida y lo que el dueño esta
  // mirando podrian decir cifras distintas.
  function datosDeLaTarjeta() {
    // Sin el nombre de la moneda, ni en singular ni en plural. La bandera ya dice
    // de que pais es y el simbolo ya dice que moneda es: "$1.00 Dolar" con una
    // bandera de Estados Unidos al lado dice lo mismo tres veces. Y lo que
    // sobra en una tarjeta es justo lo que le quita autoridad.
    // UN `Record` Y NO UNA CADENA DE TERNARIOS, y el motivo es un bug real.
    //
    // Antes esto era `VES ? ... : USD ? ... : "/flag-eur.svg"`. Sin caso para
    // USDT, que cayó al último `else`: al compartir el cálculo de USDT la
    // imagen salía con la bandera de la UNIÓN EUROPEA al lado de "1,00 USDT".
    // La cifra era correcta; la bandera mentía. Encontrado por el usuario el
    // 2026-09-28, compartiendo de verdad desde el teléfono — en la web no
    // pasaba porque allí la cadena sí tenía las cuatro ramas.
    //
    // Con un Record sobre `MonedaVisible`, TypeScript no compila si aparece una
    // moneda sin bandera. La cadena de ternarios no podía avisar de nada: su
    // `else` siempre tiene respuesta, y esa respuesta era el euro.
    const BANDERAS: Record<MonedaVisible, string> = {
      VES: "/flag-ves.svg",
      USD: "/flag-usd.svg",
      EUR: "/flag-eur.svg",
      USDT: "/flag-usdt.svg",
    };
    const lado = (amount: number, currency: MonedaVisible) => ({
      texto: money(amount, currency),
      bandera: BANDERAS[currency],
    });
    return {
      izquierda: hasAmount ? lado(putAmount, putCurrency) : lado(1, pair),
      derecha: hasAmount ? lado(getAmount, getCurrency) : lado(pairRate, "VES"),
      pie: rateFetchedAt ? `${stampLabel} · consultada ${formatFetchStamp(rateFetchedAt)}` : stampLabel,
    };
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Which pair, not which source currency. Converting dollars straight to
          euros is gone with the old three-way select: a shop converts one
          foreign currency against bolívares, never one against the other. */}
      <div className="flex gap-2">
        {/* USDT solo si hay precio. Sin él no se dibuja una pestaña muerta:
            la calculadora se ve exactamente como antes. */}
        {(["USD", "EUR", ...(usdt ? (["USDT"] as const) : [])] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => selectPair(c)}
            aria-pressed={pair === c}
            className={cn(
              "flex h-10 items-center gap-2 rounded-full border px-3 text-sm font-medium transition-colors",
              pair === c
                ? "border-transparent bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground",
            )}
          >
            <CurrencyFlagIcon currency={c} />
            {c === "USD" ? "Dólares" : c === "EUR" ? "Euro" : "USDT"}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-1 rounded-lg border px-3 py-2">
        <label htmlFor="calc-put" className="text-xs text-muted-foreground">
          {isClient ? "Monto" : "Tú pones"}
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="calc-put"
            type="text"
            inputMode="numeric"
            placeholder={putPlaceholder}
            value={putValue}
            onChange={editHandler("put")}
            onFocus={focusHandler("put")}
            // md:text-2xl no es redundante. El Input de shadcn trae md:text-sm
            // en su clase base, tailwind-merge no lo quita porque es otro
            // grupo de variante, y Tailwind emite las responsive DESPUÉS de
            // las utilidades base — así que desde 768px ganaba y el monto se
            // renderizaba a 14px, el texto MÁS PEQUEÑO de la tarjeta. En móvil
            // siempre midió 24, que es por lo que pasó desapercibido desde que
            // se escribió esta calculadora.
            className="h-auto border-0 bg-transparent p-0 text-2xl font-semibold shadow-none focus-visible:ring-0 md:text-2xl"
          />
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            {labelFor(putCurrency)}
            <CurrencyFlagIcon currency={putCurrency} />
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            // Carry the equivalence across rather than only flipping the
            // labels. Keeping the digits would turn "Bs. 100.000" into
            // "€100.000" — the same number meaning something a thousand times
            // larger, with nothing on screen to say so.
            setRawDigits(String(Math.round(getAmount * 10 ** decimalsOf(getCurrency))));
            setSource("put");
            setPristine(false);
            // The turned-around figure is the client's now: a tab after this
            // only changes the currency, it does not throw their bolívares away.
            setHasTyped(true);
            setEntry((e) => (e === "VES" ? "FOREIGN" : "VES"));
          }}
        >
          <ArrowUpDown className="size-4" />
          Invertir
        </Button>
        <span className="h-px flex-1 bg-border" />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          1 {pairName} = {formatBs(pairRate)}
        </span>
      </div>

      {/* Editable too, in both directions: typing here sets the equivalent
          above. The card names its currency and shows its flag, so it reads the
          same whichever way round it is — before this, bolívares showed a bare
          "Bs. 813,74" while dollars showed "$1.00 Dólares". */}
      <div className="flex flex-col gap-0.5 rounded-lg bg-primary px-3 py-2 text-primary-foreground">
        <label htmlFor="calc-get" className="text-xs opacity-70">
          {isClient ? "Equivale a" : "Tú cobras"}
        </label>
        <div className="flex items-center gap-2">
          <Input
            id="calc-get"
            type="text"
            inputMode="numeric"
            placeholder={getPlaceholder}
            value={getValue}
            onChange={editHandler("get")}
            onFocus={focusHandler("get")}
            className="h-auto border-0 bg-transparent p-0 text-2xl font-semibold tabular-nums shadow-none placeholder:text-primary-foreground/50 focus-visible:ring-0 md:text-2xl"
          />
          {/* Label y bandera juntos a la derecha, igual que en "Tú pones".
              Estuvieron separados un rato — label pegado al monto, bandera al
              borde — lo que exigía un input dimensionado con size para que
              abrazara su texto, y truncaba el label a 375px. Agruparlos hace
              que las dos tarjetas se lean igual y elimina todo ese truco. */}
          <span className="flex shrink-0 items-center gap-1.5 text-xs opacity-70">
            {labelFor(getCurrency)}
            <CurrencyFlagIcon currency={getCurrency} />
          </span>
        </div>
        <span className="text-xs opacity-70">{stampLabel}</span>
        {stampNote ? <span className="text-xs opacity-70">{stampNote}</span> : null}
      </div>

      {/* Solo aparece cuando hay una tasa futura publicada y estamos en la
          ventana del fin de semana. El resto del tiempo no existe: una casilla
          que casi siempre esta apagada se vuelve parte del decorado y deja de
          leerse justo el dia que importa.

          Fuera de la tarjeta oscura, no dentro: es una decision del dueño sobre
          el calculo, no un dato mas del resultado. */}
      {/* EN USDT NO SE OFRECE, y no es cosmético: la tasa prevista es la
          PRÓXIMA TASA DEL BCV, y el BCV no publica ninguna tasa de USDT. El
          cálculo del USDT ya ignora `usarPrevista` —`pairRate` va a `usdt`
          directamente—, así que marcarla aquí cambiaba la casilla y no movía
          la cifra: una acción que parece hacer algo y no hace nada, justo al
          lado de un número que el dueño está a punto de usar para fiar.

          Encontrado el 2026-09-27 probando la pestaña en el navegador, no
          leyendo el código. La web tenía lo mismo y además enseñaba el aviso
          de que el BCV no publica los domingos; ese ya estaba condicionado
          aquí. Ver CT-23. */}
      {!isClient && prevista && pair !== "USDT" ? (
        <label className="mb-1 flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox
            checked={usarPrevista}
            onCheckedChange={(v) => setUsarPrevista(v === true)}
            className="mt-0.5"
          />
          <span>Aplicar tasa BCV prevista para {etiquetaDePrevista(prevista.fecha)}</span>
        </label>
      ) : null}

      {isClient ? (
        // Frame `2213:24395`, verbatim. The calculator shows today's rate, but
        // what the client owes is in dollars or euros and the shop converts the
        // payment at the rate of the day it arrives. Without this sentence a
        // client who calculates on Monday and pays on Wednesday reads the
        // difference as the shop overcharging.
        <p className="text-xs text-muted-foreground">
          Lo que pagues lo anota el negocio con la tasa del día en que pagas.
        </p>
      ) : (
        <Button type="button" variant="outline" onClick={handleShare}>
          {shared ? "Copiado" : "Compartir"}
          <Share2 className="size-4" />
        </Button>
      )}
    </div>
  );
}


const MONTH_ABBR = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

// "2026-09-04" -> "4 sep 2026", the same shape the 90-day table right below
// prints, because the whole point of this stamp is that the two agree.
//
// Split on the string, never parsed into a Date. The value is already a
// Venezuelan calendar day with no time in it; handing it to `new Date()` reads
// it as UTC midnight and renders the day before for anyone west of Greenwich.
// The previous version formatted a real timestamp and had to name
// America/Caracas for that reason — with a plain date there is no instant to
// place in a zone, so the safe move is not to try.
// "7 sep 2026, 11:36 a. m." in Venezuela. This one IS a real instant, so it
// has to name a zone: Vercel runs in UTC and would report a rate stored at
// 11:36 p.m. Caracas as 3:36 a.m. the next day.
function formatFetchStamp(iso?: string | null): string {
  if (!iso) return "desconocida";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "desconocida";
  return new Intl.DateTimeFormat("es-VE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "America/Caracas",
  }).format(d);
}

function formatRateDate(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) return ymd;
  return `${day} ${MONTH_ABBR[month - 1]} ${year}`;
}
