"use client";

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

// La fecha que leyó la IA, en bonito si se puede.
//
// SE ENSEÑA Y NO SE GUARDA — decidido el 2026-09-29. El movimiento se crea con
// la fecha en que se sube la libreta, porque guardar la de la página cambiaría
// dos cosas que hoy dependen de `created_at`: el orden de los saldos y el
// cálculo de mora. Está anotado como pendiente.
//
// Por eso el campo es de SOLO LECTURA y dice de dónde sale. Un campo editable
// aceptaría una corrección y la tiraría, que es peor que no ofrecerlo; y una
// fecha a secas se leería como la fecha del movimiento en Sevenz, que no es.
// El dia que leyo la IA, como Date local. Null si no hay nada parseable.
//
// UN "2026-08-30" SUELTO ES UTC, Y AQUI ESO RESTA UN DIA.
// `new Date("2026-08-30")` es medianoche UTC; en Venezuela (UTC-4) sale el 29.
// Medido en dev el 2026-09-29: la libreta decia 30 y la pantalla decia 29. Una
// fecha escrita a mano en un cuaderno es un DIA, sin hora y sin zona.
//
// Y se construye AL MEDIODIA, no a medianoche. Ese Date acaba viajando al
// servidor como instante UTC: a medianoche local, cualquier zona al este del
// meridiano lo devuelve al dia anterior en cuanto alguien lo lea desde otro
// sitio. Al mediodia hay doce horas de margen por cada lado, que cubre el
// planeta entero.
function alMediodia(anio: number, mes: number, dia: number): Date | null {
  const d = new Date(anio, mes - 1, dia, 12);
  // `new Date(2026, 12, 40)` no falla: se desborda a otro mes. Se comprueba que
  // salga lo que entro, o un "30/2" acabaria guardado como 2 de marzo.
  return d.getFullYear() === anio && d.getMonth() === mes - 1 && d.getDate() === dia ? d : null;
}

function diaLeido(date: string | null): Date | null {
  const bruto = date?.trim();
  if (!bruto) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(bruto);
  if (iso) return alMediodia(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // RESPALDO PARA "30/8/2026" Y "30-8-26".
  //
  // El prompt de `/api/extract` pide ISO, pero un modelo puede desobedecer y en
  // una libreta venezolana la fecha se escribe asi. Sin esto, `new Date()` lo
  // interpreta a la americana —mes/dia— o devuelve NaN, y la fecha se perdia en
  // silencio: el campo salia vacio y el movimiento se guardaba con la de hoy.
  //
  // DIA PRIMERO, que es como se escribe en Venezuela y Colombia. Con "8/3" no
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

// Lo que se ensena. Si la IA escribio algo que no es una fecha —"30/8", "lunes"—
// se ensena tal cual: mejor eso que nada, y el dueno ve que hay que corregirlo.
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
// migracion 076 usa la de la subida.
export function isoDeLaFecha(date: string | null): string | null {
  return diaLeido(date)?.toISOString() ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// EDITAR UN MOVIMIENTO, en su propia hoja
//
// El historial pasa a ser una lista de renglones que se leen de un vistazo
// —"Fiado · Bulto de jabón / +$40,00"— y lo que antes estaba desplegado en cada
// tarjeta (tipo, monto, moneda, detalle) se edita aquí dentro.
//
// El motivo es de volumen: una libreta de seis páginas son cuarenta renglones, y
// con cuatro campos abiertos en cada uno la pantalla medía metros. Con la lista
// compacta, revisar es leer; corregir es entrar.
//
// Los cambios se aplican EN VIVO según se teclean, así que este diálogo no tiene
// "guardar": lo que hay abajo es la misma acción de subir la tanda que el pie
// del detalle, para no obligar a salir de aquí cuando ya está todo bien.
export function EditarMovimiento({
  fila,
  abierta,
  onCerrar,
  showCurrency,
  onUpdate,
  onEliminar,
  accionSubir,
}: {
  fila: ReviewRow | null;
  abierta: boolean;
  onCerrar: () => void;
  showCurrency: boolean;
  onUpdate: (rowId: string, patch: Partial<ExtractedMovement>) => void;
  onEliminar: (rowId: string) => void;
  // El mismo botón de subir de la lista, pasado entero para que no haya dos
  // definiciones de "se puede guardar ya" que puedan discrepar.
  accionSubir: React.ReactNode;
}) {
  if (!fila) return null;

  return (
    <Dialog open={abierta} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-w-[min(92vw,420px)]">
        <DialogHeader>
          {/* "Fiado" y "Abono", que es como los nombra el historial del cliente
              (`movement-history-list.tsx`), no "Cargo"/"Abono" del formulario.
              Son los dos vocabularios que ya existen y cada uno manda en su
              sitio: al REGISTRAR se pregunta "cargo o abono", al LEER se dice
              "fiado". */}
          <DialogTitle>{fila.type === "charge" ? "Fiado" : "Abono"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <TipoButtons
            value={fila.type}
            onValueChange={(v) => onUpdate(fila.rowId, { type: v })}
            canPay
          />

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
                value={fila.amount}
                onChange={(e) => onUpdate(fila.rowId, { amount: Number(e.target.value) || 0 })}
              />
              {/* La moneda pegada al monto, como en el alta de movimiento: es una
                  propiedad de ese número, no un campo aparte. */}
              {showCurrency ? (
                <Select
                  value={fila.currency ?? undefined}
                  onValueChange={(v) => onUpdate(fila.rowId, { currency: v as LedgerCurrency })}
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
              value={fila.description ?? ""}
              onChange={(e) => onUpdate(fila.rowId, { description: e.target.value || null })}
            />
          </div>

          {/* Solo si la IA leyó una fecha, y entonces EDITABLE: el movimiento se
              guarda con ella. Cuando la página no traía fecha no se ofrece el
              campo — se guardará con la de hoy, y un campo vacío invitaría a
              escribir una fecha inventada en algo que decide la mora. */}
          {fila.date && !valorDeInputFecha(fila.date) ? (
            // La IA escribio algo en la fecha que no sabemos leer —"lunes", un
            // borron—. Se dice, y se ofrece el campo vacio para escribirla: lo
            // que no se hace es prometer que se guardara con "ella".
            <div className="flex flex-col gap-2">
              <Label htmlFor="editar-fecha">Fecha</Label>
              <Input
                id="editar-fecha"
                type="date"
                value=""
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => onUpdate(fila.rowId, { date: e.target.value || null })}
              />
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-px size-3.5 shrink-0" />
                En tu libreta leimos &ldquo;{fila.date}&rdquo; y no sabemos qué fecha es. Escríbela
                o se guardará con la de hoy.
              </p>
            </div>
          ) : fila.date ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="editar-fecha">Fecha</Label>
              <Input
                id="editar-fecha"
                type="date"
                value={valorDeInputFecha(fila.date)}
                // `max`: una fecha futura la rechaza igualmente el servidor y se
                // guardaría con la de hoy, pero es mejor no dejar escribirla que
                // aceptarla y cambiarla por detrás.
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => onUpdate(fila.rowId, { date: e.target.value || null })}
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
          {accionSubir}
        </div>
      </DialogContent>
    </Dialog>
  );
}
