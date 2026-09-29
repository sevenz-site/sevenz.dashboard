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
export function fechaDeLaLibreta(date: string | null): string | null {
  const bruto = date?.trim();
  if (!bruto) return null;

  // UN "2026-08-30" SUELTO ES UTC, Y AQUI ESO RESTA UN DIA.
  //
  // `new Date("2026-08-30")` es medianoche UTC; formateado en Venezuela (UTC-4)
  // sale "29 de agosto". Medido en dev el 2026-09-29: la libreta decia 30 y la
  // pantalla decia 29. Una fecha escrita a mano en un cuaderno es un DIA, sin
  // hora y sin zona, asi que se construye como fecha local.
  const soloDia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(bruto);
  const d = soloDia
    ? new Date(Number(soloDia[1]), Number(soloDia[2]) - 1, Number(soloDia[3]))
    : new Date(bruto);

  // Lo que la IA leyo tal cual si no es una fecha reconocible: puede haber
  // escrito "30/8" o "lunes". Mejor ensenar eso que no ensenar nada.
  return Number.isNaN(d.getTime()) ? bruto : formatDate(d.toISOString());
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
  const fecha = fechaDeLaLibreta(fila.date);

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

          {/* Solo si la IA leyó una fecha. Inventar "hoy" aquí sería enseñar como
              dato de la libreta algo que sale de nuestro reloj. */}
          {fecha ? (
            <p className="text-xs text-muted-foreground">
              Fecha en la libreta: {fecha}. El movimiento se guardará con la fecha de hoy.
            </p>
          ) : null}
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
