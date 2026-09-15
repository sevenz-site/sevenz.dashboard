"use client";

import type React from "react";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { Checkbox } from "@/components/ui/checkbox";
import { toBs, type MovementRateContext } from "@/lib/exchange-rate/convert";
import { etiquetaDePrevista, tocaOfrecerPrevista } from "@/lib/exchange-rate/tasa-prevista";
import { formatBs, formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { formatCurrency } from "@/lib/format";
import { LEDGER_CURRENCIES, MONEDAS_TECLEABLES, type LedgerCurrency, type MonedaTecleada } from "@/lib/types";

// En qué moneda ESCRIBE el dueño: bolívares, dólares o euros.
//
// Es distinto de en qué libro entra la deuda. El cliente paga en bolívares y la
// deuda vive en dólares o en euros, así que "bolívares" aquí no crea un tercer
// libro — es una forma de teclear el monto. Cuál de los dos libros recibe la
// deuda se elige en el desplegable de abajo, que solo aparece en ese caso.
//
// Botones y no radios porque es la misma decisión que la calculadora ya
// presenta así, y porque tres opciones con nombre completo en una fila de
// teléfono necesitan área de toque, no un circulito de 16px.
export function MonedaTecleadaButtons({
  value,
  onValueChange,
}: {
  value: MonedaTecleada;
  onValueChange: (value: MonedaTecleada) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>Moneda a registrar</Label>
      <div className="flex flex-row flex-wrap gap-2">
        {MONEDAS_TECLEABLES.map((m) => (
          <Button
            key={m.value}
            type="button"
            variant={value === m.value ? "default" : "outline"}
            size="sm"
            // Redondeadas del todo, igual que las pastillas de "Tipo": son la
            // misma clase de pregunta —elige una de estas— y a esquinas
            // distintas se leen como controles distintos.
            className="rounded-full px-3.5"
            onClick={() => onValueChange(m.value)}
            aria-pressed={value === m.value}
          >
            <CurrencyFlagIcon currency={m.value === "VES" ? "VES" : m.value} />
            {m.label}
          </Button>
        ))}
      </div>
      {/* El libro al que va la deuda. Cuando se teclea en dólares o en euros es
          el mismo que la moneda tecleada; cuando se teclea en bolívares lo
          decide el desplegable. */}
      <input type="hidden" name="moneda_tecleada" value={value} />
    </div>
  );
}

// El libro donde entra la deuda, cuando el monto se escribió en bolívares.
// Solo aparece en ese caso: tecleando dólares, el libro es el de dólares y
// preguntarlo sería ofrecer una decisión que no existe.
export function LibroDestinoSelect({
  value,
  onValueChange,
}: {
  value: LedgerCurrency;
  onValueChange: (value: LedgerCurrency) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as LedgerCurrency)}>
      {/* Sin borde: ya lo pone la tarjeta que lo contiene, y dos marcos
          anidados hacen que parezca un campo dentro de otro campo. */}
      <SelectTrigger
        className="w-auto shrink-0 gap-1.5 border-0 bg-transparent px-1 text-xs text-muted-foreground shadow-none focus-visible:ring-0"
        aria-label="Moneda en la que se guarda"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LEDGER_CURRENCIES.map((c) => (
          <SelectItem key={c} value={c}>
            <CurrencyFlagIcon currency={c} />
            {c === "USD" ? "Dólares" : "Euros"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// The live "≈ Bs. X" preview, shown directly below the amount input — it's
// a property of what was just typed there, recomputed client-side as the
// owner types using the rate already loaded when the dialog opened (no
// network call per keystroke).
export function BsAmountPreview({
  amount,
  currency,
  rateContext,
  usarPrevista = false,
}: {
  amount: string;
  currency: LedgerCurrency;
  rateContext: MovementRateContext;
  usarPrevista?: boolean;
}) {
  const parsed = Number(amount);
  const hasAmount = Number.isFinite(parsed) && parsed > 0;
  // La misma tasa que el servidor va a sellar, no una copia calculada aparte:
  // el objeto viene del servidor y la casilla solo elige cuál de las dos usar.
  const prevista = rateContext.prevista;
  const tasa =
    usarPrevista && prevista ? { usd: prevista.usd, eur: prevista.eur } : rateContext.effectiveRate;
  const bsPreview = hasAmount ? toBs(parsed, currency, tasa) : null;

  return bsPreview !== null ? <p className="text-xs text-muted-foreground">≈ {formatBs(bsPreview)}</p> : null;
}

// La casilla que aplica la tasa prevista, debajo del equivalente en bolívares.
//
// Solo se dibuja dentro de la ventana —viernes al mediodía, fin de semana— y
// solo si hay una tasa futura publicada. Es la misma regla que usan las dos
// calculadoras, importada del mismo sitio para que no puedan separarse.
//
// Manda "1", no la cifra: el servidor busca la tasa en lo que ya tiene guardado.
// Si mandara el número, una petición hecha a mano podría sellar cualquier cosa.
export function PrevistaCheckbox({
  rateContext,
  checked,
  onCheckedChange,
}: {
  rateContext: MovementRateContext;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const prevista = rateContext.prevista;
  if (!tocaOfrecerPrevista(prevista?.fecha, rateContext.rateDate)) return null;

  return (
    <>
      {/* mb-1 sobre el gap del formulario, igual que en la calculadora: el
          label ocupa todo el ancho y sin ese aire el dedo cae en el campo de
          abajo al intentar marcarla. */}
      <label className="mb-1 flex cursor-pointer items-start gap-2 text-sm">
        <Checkbox checked={checked} onCheckedChange={(v) => onCheckedChange(v === true)} className="mt-0.5" />
        <span>Aplicar tasa BCV prevista para {etiquetaDePrevista(prevista!.fecha)}</span>
      </label>
      {checked ? <input type="hidden" name="usar_tasa_prevista" value="1" /> : null}
    </>
  );
}

// Cuánto se va a guardar de verdad, en la moneda del libro.
//
// Cuando el dueño teclea bolívares, esta es la única cifra que le dice qué va a
// quedar anotado: la deuda vive en dólares o en euros, no en bolívares. Se
// calcula con la MISMA tasa que el servidor va a sellar —la vigente, o la
// prevista si marcó la casilla— para que lo que ve y lo que se guarda no puedan
// discrepar.
export function montoConvertido(
  bolivares: string,
  destino: LedgerCurrency,
  rateContext: MovementRateContext,
  usarPrevista: boolean,
): number | null {
  const bs = Number(bolivares);
  if (!Number.isFinite(bs) || bs <= 0) return null;
  const prevista = rateContext.prevista;
  const tasa = usarPrevista && prevista ? { usd: prevista.usd, eur: prevista.eur } : rateContext.effectiveRate;
  const porUnidad = destino === "USD" ? tasa.usd : tasa.eur;
  if (!porUnidad || porUnidad <= 0) return null;
  // Los mismos dos decimales que aplica el servidor. Si esta línea y la del
  // servidor se separaran, el dueño vería una cifra y se guardaría otra.
  return Math.round((bs / porUnidad) * 100) / 100;
}

// Como se llama lo que se esta registrando, para que las dos tarjetas digan
// "Fiado a registrar" o "Abono a registrar" en vez de un "Monto" que sirve
// para las dos cosas.
//
// El boton de arriba dice "Cargo (fia)" y aqui se dice "Fiado" a proposito: no
// son sinonimos sueltos, es que el boton de guardar de abajo ya dice "Guardar
// fiado". La tarjeta queda entre esos dos y tiene que leerse con ellos.
function nombreDelMovimiento(type: "charge" | "payment"): string {
  return type === "charge" ? "Fiado" : "Abono";
}

// La tarjeta "Fiado a registrar" / "Abono a registrar", con el desplegable del
// libro al lado. Solo aparece cuando se tecleó en bolívares.
//
// Misma anatomía que las dos tarjetas de la calculadora —etiqueta pequeña
// arriba, cifra grande, moneda a la derecha— porque es la misma pregunta:
// "esto que escribí, ¿cuánto es en la otra moneda?". Un tendero que ya entendió
// la calculadora no tiene que aprender nada nuevo aquí.
export function MontoARegistrarRow({
  bolivares,
  destino,
  onDestinoChange,
  rateContext,
  usarPrevista,
  type,
}: {
  bolivares: string;
  destino: LedgerCurrency;
  onDestinoChange: (value: LedgerCurrency) => void;
  rateContext: MovementRateContext;
  usarPrevista: boolean;
  type: "charge" | "payment";
}) {
  const monto = montoConvertido(bolivares, destino, rateContext, usarPrevista);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">
            {nombreDelMovimiento(type)} a registrar:
          </span>
          <span
            className={`text-2xl font-semibold tabular-nums ${
              type === "payment" ? "text-money-in" : "text-destructive"
            }`}
          >
            {monto === null ? "—" : formatDisplayCurrency(monto, destino)}
          </span>
        </div>
        <LibroDestinoSelect value={destino} onValueChange={onDestinoChange} />
      </div>
      <p className="text-xs text-muted-foreground">
        El fiado o abono queda guardado en {destino === "USD" ? "dólares" : "euros"} a la tasa
        equivalente. Los bolívares que escribiste quedan anotados en el respaldo.
      </p>
    </div>
  );
}

// El resumen de antes de guardar. Repite la cifra que se va a anotar, en verde
// si el dinero entra y en rojo si sale. No se toca: es lo último que el dueño
// lee antes de pulsar, no otro sitio donde cambiar algo.
export function ResumenMonto({
  type,
  monto,
  moneda,
  rateContext,
  usarPrevista,
  bolivaresTecleados = null,
}: {
  type: "charge" | "payment";
  monto: number | null;
  moneda: LedgerCurrency | null;
  rateContext: MovementRateContext | null;
  usarPrevista: boolean;
  // Los bolívares que el dueño escribió, cuando escribió en bolívares.
  //
  // Está aquí por un fallo real: sin este dato, la línea de abajo hacía el
  // VIAJE DE VUELTA —convertir los bolívares a dólares, redondear a céntimos y
  // volver a convertirlos— y con Bs. 850 mostraba Bs. 849,14. El dueño teclea
  // 850 y la app le responde 849,14: parece que perdió 86 céntimos.
  //
  // La diferencia es real (1,02 dólares valen 849,14 y no 850, porque los
  // céntimos no dan para más), pero el resumen no es el sitio donde sacarla. Lo
  // que el dueño necesita confirmar antes de pulsar es lo que escribió.
  bolivaresTecleados?: string | null;
}) {
  if (monto === null || monto <= 0) return null;

  const prevista = rateContext?.prevista;
  const tasa =
    usarPrevista && prevista ? { usd: prevista.usd, eur: prevista.eur } : rateContext?.effectiveRate;
  // Lo tecleado gana siempre sobre lo calculado.
  const tecleados = Number(bolivaresTecleados);
  const bs =
    bolivaresTecleados && Number.isFinite(tecleados) && tecleados > 0
      ? tecleados
      : moneda && tasa
        ? toBs(monto, moneda, tasa)
        : null;

  return (
    <div className="flex flex-col gap-2">
      <Label>Resumen</Label>
      <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <div className="flex min-w-0 flex-col">
        <span className="text-xs text-muted-foreground">{nombreDelMovimiento(type)} a registrar</span>
        <span
          className={`text-2xl font-semibold tabular-nums ${
            type === "payment" ? "text-money-in" : "text-destructive"
          }`}
        >
          {moneda ? formatDisplayCurrency(monto, moneda) : formatCurrency(monto)}
        </span>
        {bs !== null ? <span className="text-xs text-muted-foreground">≈ {formatBs(bs)}</span> : null}
      </div>
      {moneda ? (
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          {moneda === "USD" ? "Dólares" : "Euros"}
          <CurrencyFlagIcon currency={moneda} />
        </span>
      ) : null}
      </div>
    </div>
  );
}

// El campo del monto, como tarjeta: etiqueta pequeña arriba, cifra grande, y la
// moneda con su bandera a la derecha.
//
// Misma anatomía que "Tú pones" en la calculadora, y por el mismo motivo: sin
// la moneda AL LADO del número, un 850 no dice si son bolívares o dólares, y
// esa confusión aquí cuesta dinero.
export function MontoCard({
  id,
  name,
  value,
  onChange,
  moneda,
  max,
  invalid,
  ayuda = null,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  moneda: MonedaTecleada | null;
  max?: number;
  invalid?: boolean;
  // El renglón de debajo de la cifra: el tope mientras va bien, el error
  // cuando no. Es UNO, no dos — quien lo llama decide cuál toca, para que no
  // puedan salir los dos a la vez diciendo lo mismo.
  ayuda?: React.ReactNode;
}) {
  const etiqueta =
    moneda === "VES" ? "Bolívares" : moneda === "EUR" ? "Euros" : moneda === "USD" ? "Dólares" : null;

  return (
    <div
      className={`flex flex-col gap-1 rounded-lg border px-3 py-2 ${
        invalid ? "border-destructive" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
            Escriba monto:
          </Label>
          <Input
            id={id}
            name={name}
            type="number"
            min="0"
            max={max}
            step="0.01"
            value={value}
            onChange={onChange}
            required
            aria-invalid={invalid}
            aria-describedby={ayuda ? `${id}-ayuda` : undefined}
            placeholder="0,00"
            // Sin borde ni fondo propios: el marco lo pone la tarjeta. Dos marcos
            // anidados se leen como un campo dentro de otro campo.
            className="h-auto border-0 bg-transparent p-0 text-2xl font-semibold tabular-nums shadow-none focus-visible:ring-0 md:text-2xl"
          />
        </div>
        {etiqueta ? (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            {etiqueta}
            <CurrencyFlagIcon currency={moneda === "VES" ? "VES" : (moneda as LedgerCurrency)} />
          </span>
        ) : null}
      </div>
      {/* Dentro de la tarjeta, debajo de la cifra: el tope es una propiedad de
          lo que se escribe aquí, y colgado del bloque entero quedaba a media
          pantalla del campo al que se refiere.

          role="alert" solo cuando es un error, para que el lector de pantalla
          lo anuncie al saltar; el tope en gris ya lo lee por aria-describedby
          al entrar en el campo, y anunciarlo cada vez sería ruido. */}
      {ayuda ? (
        <p
          id={`${id}-ayuda`}
          role={invalid ? "alert" : undefined}
          className={`text-xs ${invalid ? "text-destructive" : "text-muted-foreground"}`}
        >
          {ayuda}
        </p>
      ) : null}
    </div>
  );
}

// Los dos tipos, con el control de siempre dentro de una pastilla.
//
// Fueron botones un rato y se volvieron atrás a petición: dos opciones
// excluyentes se leen mejor con el control que la gente ya reconoce como "elige
// una", y los botones las hacían parecer dos acciones distintas.
//
// El marco redondeado alrededor del radio es lo que devuelve el área de toque
// que el botón tenía y el circulito de 16px no da: en un teléfono se pulsa la
// pastilla entera, no el punto. Sigue siendo un radio —el punto relleno dice
// cuál está elegida—, solo que con dónde apretar dibujado alrededor.
//
// Todo el texto en negro y el color solo en la flecha. El paréntesis estuvo
// coloreado un rato y se quitó a petición: con la flecha al lado, pintar
// también las palabras es decir lo mismo dos veces, y una frase de color dentro
// de una frase negra se lee como un enlace o como un error.
//
// Con lo que el color no se pierde: sigue ahí, rojo hacia fuera el dinero que
// sale y verde hacia dentro el que entra, en la flecha. Y la flecha lo dice por
// la forma además de por el color, que es lo único que le sirve a quien no
// distingue el rojo del verde.
export function TipoButtons({
  value,
  onValueChange,
  canPay,
}: {
  value: "charge" | "payment";
  onValueChange: (value: "charge" | "payment") => void;
  // Un abono imposible no se deshabilita: hacerlo significaría que pulsarlo no
  // hace nada, y lo que hace falta es que EXPLIQUE por qué no se puede.
  canPay: boolean;
}) {
  const opciones = [
    {
      value: "charge" as const,
      nombre: "Cargo",
      aclara: "(fía)",
      color: "text-destructive",
      Flecha: ArrowUpRight,
    },
    {
      value: "payment" as const,
      nombre: "Abono",
      aclara: "(paga)",
      color: "text-money-in",
      Flecha: ArrowDownLeft,
    },
  ];
  return (
    <div className="flex flex-col gap-2">
      <Label>Tipo</Label>
      <RadioGroup
        name="type"
        value={value}
        onValueChange={(v) => onValueChange(v as "charge" | "payment")}
        className="flex flex-row flex-wrap gap-2"
      >
        {opciones.map((o) => (
          <label
            key={o.value}
            className={`flex h-10 items-center gap-2 rounded-full border border-border bg-background px-3.5 text-sm ${
              o.value === "payment" && !canPay ? "cursor-not-allowed opacity-50" : "cursor-pointer"
            }`}
          >
            <RadioGroupItem value={o.value} />
            <span className="whitespace-nowrap">
              {o.nombre} {o.aclara}
            </span>
            <o.Flecha className={`size-4 ${o.color}`} aria-hidden />
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}
