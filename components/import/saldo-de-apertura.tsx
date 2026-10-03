"use client";

import { useState } from "react";
import { TriangleAlert, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { valorDeInputFecha } from "@/lib/fecha-de-libreta";
import type { AperturaDetectada } from "@/lib/saldo-de-apertura";
import type { LedgerCurrency, MovementType } from "@/lib/types";

function importeDe(n: number, currency: LedgerCurrency | null): string {
  return currency ? formatDisplayCurrency(n, currency) : formatCurrency(n);
}

// ─────────────────────────────────────────────────────────────────────────
// EL SALDO CON EL QUE ARRANCA LA PÁGINA — CT-12
//
// Dos caminos en un mismo sitio, a propósito:
//
//   detectado  las líneas con total escrito difieren TODAS en lo mismo, así que
//              esa cantidad es el saldo que la página traía de antes. Se
//              propone, con su cifra.
//   a mano     no se pudo deducir —una sola línea comprobable, o una libreta
//              sin totales escritos, que es lo más común— y el dueño lo sabe
//              porque tiene la foto delante.
//
// Dos pantallas distintas para lo mismo acabarían discrepando; y la de a mano
// sola no la encontraría nadie que no supiera ya que el problema existe.
export function SaldoDeApertura({
  currency,
  detectada,
  primerApunte,
  aceptada,
  fechaPorDefecto,
  onAceptar,
  onQuitar,
}: {
  currency: LedgerCurrency | null;
  detectada: AperturaDetectada | null;
  primerApunte: { descripcion: string | null; importe: number; tipo: MovementType } | null;
  aceptada: { importe: number; fecha: string | null } | null;
  fechaPorDefecto: string | null;
  onAceptar: (importe: number, fecha: string | null) => void;
  onQuitar: () => void;
}) {
  const [manual, setManual] = useState("");
  const [abierto, setAbierto] = useState(false);

  // ── Ya aceptada: se enseña lo que hay y se puede cambiar o quitar ──────
  if (aceptada) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">
            Saldo anterior: {importeDe(Math.abs(aceptada.importe), currency)}
            {aceptada.importe < 0 ? " a favor del cliente" : ""}
          </p>
          <Button type="button" variant="ghost" size="sm" onClick={onQuitar}>
            <Undo2 className="size-4" />
            Quitar
          </Button>
        </div>
        {/* LA FECHA ES EDITABLE, y no es un detalle de comodidad. Desde la
            migración 076, `created_at` decide el saldo corrido Y la mora. Esta
            línea nace con la fecha del primer apunte de la página porque es la
            aproximación honesta —la deuda es anterior a la página, no de hoy—,
            pero la libreta no dice cuándo nació de verdad, así que quien la
            tiene delante tiene que poder corregirla. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="apertura-fecha" className="text-xs">
            Desde cuándo
          </Label>
          <Input
            id="apertura-fecha"
            type="date"
            className="w-fit"
            value={valorDeInputFecha(aceptada.fecha)}
            onChange={(e) => onAceptar(aceptada.importe, e.target.value || null)}
          />
          <p className="text-xs text-muted-foreground">
            De esta fecha depende desde cuándo cuenta la mora de este cliente.
          </p>
        </div>
      </div>
    );
  }

  // ── Detectado: se propone, con la cifra y con el primer apunte al lado ──
  if (detectada) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
        <p className="flex items-start gap-1.5 text-sm">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <span>
            Tu libreta arranca con{" "}
            <strong>{importeDe(Math.abs(detectada.importe), currency)}</strong> que Sevenz no
            tiene.
            <span className="mt-1 block text-muted-foreground">
              Las {detectada.filas} líneas con total escrito difieren en esa misma cantidad, así
              que parece el saldo que esta página ya traía.
            </span>
          </span>
        </p>

        {/* EL PRIMER APUNTE, AL LADO DE LA CIFRA. Es la única defensa contra lo
            que la lógica no puede separar: un monto mal leído en la PRIMERA
            línea desfasa todas por igual, exactamente como un saldo de
            apertura. Quien tiene la foto delante sí puede ver cuál de los dos
            números está mal — pero solo si se le enseñan los dos. */}
        {primerApunte ? (
          <p className="rounded-md border bg-background p-2 text-xs text-muted-foreground">
            El primer apunte de la página es{" "}
            <strong className="text-foreground">
              {primerApunte.tipo === "charge" ? "Fiado" : "Abono"}
              {primerApunte.descripcion ? ` · ${primerApunte.descripcion}` : ""}{" "}
              {primerApunte.tipo === "charge" ? "+" : "−"}
              {importeDe(primerApunte.importe, currency)}
            </strong>
            . Compáralo con tu foto antes de aceptar: si ese monto se leyó mal, lo que falla es
            él y no el saldo anterior.
          </p>
        ) : null}

        <div className="flex flex-row flex-wrap gap-2">
          <Button
            type="button"
            className="h-10"
            onClick={() => onAceptar(detectada.importe, fechaPorDefecto)}
          >
            Sí, añádelo
          </Button>
          <Button type="button" variant="outline" className="h-10" onClick={() => setAbierto(true)}>
            Escribir otro monto
          </Button>
        </div>

        {abierto ? <CampoManual currency={currency} valor={manual} onValor={setManual} onGuardar={() => {
          const n = Number(manual.replace(",", "."));
          if (Number.isFinite(n) && n !== 0) onAceptar(n, fechaPorDefecto);
        }} /> : null}
      </div>
    );
  }

  // ── Sin detección: la salida manual, plegada ───────────────────────────
  if (!abierto) {
    return (
      <Button
        type="button"
        variant="link"
        className="h-auto w-fit p-0 text-sm"
        onClick={() => setAbierto(true)}
      >
        ¿Esta página viene de otra?
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="text-sm">
        Si esta página continúa otra, escribe el saldo con el que empieza. Lo añadiremos como una
        línea de <strong>Saldo anterior</strong> antes de los demás movimientos.
      </p>
      <CampoManual
        currency={currency}
        valor={manual}
        onValor={setManual}
        onGuardar={() => {
          const n = Number(manual.replace(",", "."));
          if (Number.isFinite(n) && n !== 0) onAceptar(n, fechaPorDefecto);
        }}
      />
    </div>
  );
}

function CampoManual({
  currency,
  valor,
  onValor,
  onGuardar,
}: {
  currency: LedgerCurrency | null;
  valor: string;
  onValor: (v: string) => void;
  onGuardar: () => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="apertura-monto" className="text-xs">
        Saldo con el que empieza esta página
      </Label>
      <div className="flex flex-row items-center gap-2">
        <Input
          id="apertura-monto"
          // `inputMode` y no `type="number"`: en un teléfono abre el teclado
          // numérico igual, y no trae las flechitas ni el scroll accidental que
          // cambia el valor — ese fallo ya costó un movimiento mal guardado.
          inputMode="decimal"
          placeholder="0,00"
          value={valor}
          onChange={(e) => onValor(e.target.value)}
          className="w-32"
        />
        <Button type="button" className="h-10" onClick={onGuardar} disabled={!valor.trim()}>
          Añadir
        </Button>
      </div>
      {/* SE DICE QUE SE PUEDE PONER EN NEGATIVO. Es raro y nadie lo adivina,
          pero existe: una página puede arrancar con el negocio debiéndole al
          cliente, por un adelanto o una devolución. Sin decirlo, esas libretas
          se quedan sin arreglo. */}
      <p className="text-xs text-muted-foreground">
        En {currency === "EUR" ? "euros" : currency === "USD" ? "dólares" : "pesos"}. Si eres tú
        quien le debe a este cliente, escríbelo con un menos delante.
      </p>
    </div>
  );
}
