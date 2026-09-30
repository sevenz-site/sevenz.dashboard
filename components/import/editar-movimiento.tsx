"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { TipoButtons } from "@/components/dashboard/movement-currency-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TriangleAlert } from "lucide-react";
import { formatDate } from "@/lib/format";
import type { ExtractedMovement, LedgerCurrency } from "@/lib/types";
import type { ReviewRow } from "@/lib/reconcile";

// ─────────────────────────────────────────────────────────────────────────
// LA FECHA DE LA LIBRETA
//
// Desde la migración 076 el movimiento SE GUARDA con la fecha que la IA leyó en
// la página, si la leyó; si no, con la de la subida. Y el campo es editable,
// porque el dato lo saca una IA de algo escrito a mano.
//
// No es decoración: `created_at` decide el saldo corrido y la mora. Ver la
// cabecera de `supabase/076_import_libreta_fecha.sql`.

function alMediodia(anio: number, mes: number, dia: number): Date | null {
  const d = new Date(anio, mes - 1, dia, 12);
  // `new Date(2026, 1, 30)` no falla: se desborda a marzo. Se comprueba que
  // salga lo que entró, o un "30/2" acabaría guardado como 2 de marzo.
  return d.getFullYear() === anio && d.getMonth() === mes - 1 && d.getDate() === dia ? d : null;
}

// El día que leyó la IA, como Date local. Null si no hay nada parseable.
//
// UN "2026-08-30" SUELTO ES UTC, Y AQUÍ ESO RESTA UN DÍA.
// `new Date("2026-08-30")` es medianoche UTC; en Venezuela (UTC-4) sale el 29.
// Medido en dev el 2026-09-29: la libreta decía 30 y la pantalla decía 29. Una
// fecha escrita a mano en un cuaderno es un DÍA, sin hora y sin zona.
//
// Y se construye AL MEDIODÍA, no a medianoche. Ese Date acaba viajando al
// servidor como instante UTC: a medianoche local, cualquier zona lo devuelve al
// día anterior en cuanto alguien lo lea desde otro sitio. Al mediodía hay doce
// horas de margen por cada lado, que cubre el planeta entero.
function diaLeido(date: string | null): Date | null {
  const bruto = date?.trim();
  if (!bruto) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(bruto);
  if (iso) return alMediodia(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // RESPALDO PARA "30/8/2026" Y "30-8-26".
  //
  // El prompt de `/api/extract` pide ISO, pero un modelo puede desobedecer y en
  // una libreta venezolana la fecha se escribe así. Sin esto, `new Date()` lo
  // interpreta a la americana —mes/día— o devuelve NaN, y la fecha se perdía en
  // silencio: el campo salía vacío y el movimiento se guardaba con la de hoy.
  //
  // DÍA PRIMERO, que es como se escribe en Venezuela y Colombia. Con "8/3" no
  // hay forma de saberlo y se elige lo que acierta en este mercado.
  const suelto = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/.exec(bruto);
  if (suelto) {
    const anio = Number(suelto[3]);
    return alMediodia(anio < 100 ? 2000 + anio : anio, Number(suelto[2]), Number(suelto[1]));
  }

  const d = new Date(bruto);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(12, 0, 0, 0);
  return d;
}

// Lo que se enseña. Si la IA escribió algo que no es una fecha —"lunes"— se
// enseña tal cual: mejor eso que nada, y el dueño ve que hay que corregirlo.
export function fechaDeLaLibreta(date: string | null): string | null {
  const bruto = date?.trim();
  if (!bruto) return null;
  const d = diaLeido(date);
  return d ? formatDate(d.toISOString()) : bruto;
}

// Lo que va en un `<input type="date">`, que solo entiende "YYYY-MM-DD".
export function valorDeInputFecha(date: string | null): string {
  const d = diaLeido(date);
  if (!d) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Lo que se manda al servidor. Null cuando no hay fecha que valga: entonces la
// migración 076 usa la de la subida.
export function isoDeLaFecha(date: string | null): string | null {
  return diaLeido(date)?.toISOString() ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// EDITAR UN MOVIMIENTO, en su propia hoja
//
// El historial es una lista de renglones que se leen de un vistazo —"Fiado ·
// Bulto de jabón / +$40,00"— y lo que se edita de cada uno vive aquí. El motivo
// es de volumen: una libreta de seis páginas son cuarenta renglones, y con
// cuatro campos abiertos en cada uno la pantalla medía metros.
//
// TIENE SU PROPIO BORRADOR. Antes cada tecla se aplicaba en vivo al movimiento
// de verdad, así que no había forma de arrepentirse: abrir la hoja, teclear un
// monto y cerrar ya lo había cambiado. Ahora se edita una copia y no pasa nada
// hasta "Confirmar" — la X, Esc o tocar fuera descartan.
//
// El componente se monta con `key={rowId}` desde el detalle, así que el borrador
// nace con los valores de ese movimiento sin necesidad de un efecto que los
// copie — que además es lo que prohíbe `react-hooks/set-state-in-effect`.
export function EditarMovimiento({
  fila,
  esAjuste,
  onCerrar,
  showCurrency,
  onUpdate,
  onEliminar,
}: {
  fila: ReviewRow;
  // La línea que puso Sevenz para cuadrar. Se puede ABRIR — para ver de dónde
  // salió y qué implica — pero no se edita ni se borra desde aquí.
  esAjuste: boolean;
  onCerrar: () => void;
  showCurrency: boolean;
  onUpdate: (rowId: string, patch: Partial<ExtractedMovement>) => void;
  onEliminar: (rowId: string) => void;
}) {
  const [borrador, setBorrador] = useState<{
    type: "charge" | "payment";
    amount: number;
    description: string | null;
    currency: LedgerCurrency | null;
    date: string | null;
  }>({
    type: fila.type,
    amount: fila.amount,
    description: fila.description,
    currency: fila.currency,
    date: fila.date,
  });

  const cambiar = (patch: Partial<typeof borrador>) =>
    setBorrador((prev) => ({ ...prev, ...patch }));

  function confirmar() {
    onUpdate(fila.rowId, borrador);
    onCerrar();
  }

  if (esAjuste) {
    return (
      <Dialog open onOpenChange={(v) => !v && onCerrar()}>
        <DialogContent className="max-w-[min(92vw,420px)]">
          <DialogHeader>
            <DialogTitle>Ajuste al subir la libreta</DialogTitle>
          </DialogHeader>

          {/* SE VE, NO SE TOCA. Los mismos campos y en el mismo orden que un
              movimiento normal, pero desactivados: la caja es la misma y lo
              único que cambia es que no se puede escribir en ella, que es
              exactamente lo que pasa. No es un movimiento que el dueño leyó en
              su libreta — es la resta que hizo Sevenz para llegar al total que
              él dijo que era el bueno, y cambiarla rompe justo esa cuenta. */}
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label>Tipo</Label>
              <p className="text-sm">{fila.type === "charge" ? "Cargo (fía)" : "Abono (paga)"}</p>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ajuste-monto">Monto</Label>
              <div className="flex items-center gap-2">
                <Input id="ajuste-monto" className="flex-1" value={fila.amount} disabled readOnly />
                {fila.currency ? (
                  <span className="flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm text-muted-foreground">
                    <CurrencyFlagIcon currency={fila.currency} />
                    {fila.currency === "USD" ? "Dólares" : "Euros"}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="ajuste-descripcion">Descripción</Label>
              <Input id="ajuste-descripcion" value={fila.description ?? ""} disabled readOnly />
            </div>

            {/* LO QUE EL DUEÑO TIENE QUE SABER, y no se deduce de nada: que esta
                línea la verá su cliente. `description` es el único campo del
                movimiento que viaja a la página pública /s/[token]. */}
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <strong>Nota:</strong> este movimiento se agrega para poder cuadrar las cuentas de
                la suma en tu libreta. El cliente podrá ver este movimiento adicional; si no
                quieres que lo vea, debes seleccionar la cuenta calculada por Sevenz.
              </span>
            </p>
          </div>

          <Button type="button" className="h-11 w-full" onClick={onCerrar}>
            Entendido
          </Button>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-w-[min(92vw,420px)]">
        <DialogHeader>
          {/* "Fiado" y "Abono", que es como los nombra el historial del cliente
              (`movement-history-list.tsx`), no "Cargo"/"Abono" del formulario.
              Son los dos vocabularios que ya existen y cada uno manda en su
              sitio: al REGISTRAR se pregunta "cargo o abono", al LEER se dice
              "fiado". Sigue al tipo del BORRADOR, para que cambiarlo se vea. */}
          <DialogTitle>{borrador.type === "charge" ? "Fiado" : "Abono"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <TipoButtons value={borrador.type} onValueChange={(v) => cambiar({ type: v })} canPay />

          <div className="flex flex-col gap-2">
            <Label htmlFor="editar-monto">Monto</Label>
            <div className="flex items-center gap-2">
              <Input
                id="editar-monto"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                className="flex-1"
                value={borrador.amount}
                onChange={(e) => cambiar({ amount: Number(e.target.value) || 0 })}
              />
              {/* La moneda pegada al monto, como en el alta de movimiento: es
                  una propiedad de ese número, no un campo aparte. */}
              {showCurrency ? (
                <Select
                  value={borrador.currency ?? undefined}
                  onValueChange={(v) => cambiar({ currency: v as LedgerCurrency })}
                >
                  <SelectTrigger className="w-[8.5rem]" aria-label="Moneda de este movimiento">
                    <SelectValue placeholder="Moneda" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="USD">
                      <CurrencyFlagIcon currency="USD" />
                      Dólares
                    </SelectItem>
                    <SelectItem value="EUR">
                      <CurrencyFlagIcon currency="EUR" />
                      Euros
                    </SelectItem>
                  </SelectContent>
                </Select>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="editar-descripcion">Descripción</Label>
            <Input
              id="editar-descripcion"
              placeholder="Qué se llevó"
              value={borrador.description ?? ""}
              onChange={(e) => cambiar({ description: e.target.value || null })}
            />
          </div>

          {borrador.date && !valorDeInputFecha(borrador.date) ? (
            // La IA escribió algo en la fecha que no sabemos leer —"lunes", un
            // borrón—. Se dice, y se ofrece el campo vacío para escribirla: lo
            // que no se hace es prometer que se guardará "con ella".
            <div className="flex flex-col gap-2">
              <Label htmlFor="editar-fecha">Fecha</Label>
              <Input
                id="editar-fecha"
                type="date"
                value=""
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => cambiar({ date: e.target.value || null })}
              />
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-px size-3.5 shrink-0" />
                En tu libreta leímos &ldquo;{borrador.date}&rdquo; y no sabemos qué fecha es.
                Escríbela o se guardará con la de hoy.
              </p>
            </div>
          ) : borrador.date ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="editar-fecha">Fecha</Label>
              <Input
                id="editar-fecha"
                type="date"
                value={valorDeInputFecha(borrador.date)}
                // `max`: una fecha futura la rechaza igualmente el servidor y se
                // guardaría con la de hoy, pero es mejor no dejar escribirla que
                // aceptarla y cambiarla por detrás.
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => cambiar({ date: e.target.value || null })}
              />
              <p className="text-xs text-muted-foreground">
                Es la fecha que leímos en tu libreta. Se guardará con ella.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Tu libreta no traía fecha en esta línea, así que se guardará con la de hoy.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 pt-1">
          {/* Eliminar no pasa por el borrador: se lleva el movimiento entero, así
              que lo que se hubiera tecleado da igual. */}
          <Button
            type="button"
            variant="ghost"
            className="h-11 w-full bg-destructive/10 text-destructive hover:bg-destructive/15 hover:text-destructive"
            onClick={() => {
              onEliminar(fila.rowId);
              onCerrar();
            }}
          >
            Eliminar
          </Button>
          <Button type="button" className="h-11 w-full" onClick={confirmar}>
            Confirmar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
