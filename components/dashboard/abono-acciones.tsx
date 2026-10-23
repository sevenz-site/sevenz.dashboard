"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { editarAbonoDirigido } from "@/app/(app)/abonos/actions";
import { deleteMovement } from "@/app/(app)/dashboard/actions";
import { avisarCuentaPausada } from "@/lib/cuenta-pausada";
import { useGuardiaDeCuentaPausada } from "@/components/dashboard/cuenta-pausada";
import { formatBs } from "@/lib/exchange-rate/format";
import { formatPriceAmount, parseAmount, type PriceCurrency } from "@/lib/products/price";

// EL «⋮» DE CADA ABONO, dentro de la ficha de su fiado.
//
// Frame `1489:10209`, nodos `1489:10457` y `1489:10468`, y las dos opciones
// que el dueño nombró el 2026-10-20: «Editar abono» y «Eliminar abono».
//
// ===========================================================================
// ES UN BOTÓN AL LADO DE UN ENLACE, NO DENTRO
//
// La tarjeta entera lleva a la ficha del abono. Meter el «⋮» dentro de ese
// `<a>` sería un `<button>` dentro de un enlace: HTML inválido, y el navegador
// decide por su cuenta qué pasa al tocarlo. Así que la tarjeta pasa a ser un
// contenedor con dos hijos — el enlace, que ocupa todo lo que puede, y este
// botón al final.
export function AbonoAcciones({
  movementId,
  // En la moneda en que se tecleó: bolívares si se escribió así, la del libro
  // si no. Es lo que el diálogo pide, porque es lo que el respaldo guarda.
  montoTecleado,
  monedaTecleada,
  // Lo máximo que admite el fiado al que va, contando lo que este abono vale
  // hoy. `null` en un abono sin dirigir: no hay fiado contra el que topar.
  techo,
  monedaDelLibro,
}: {
  movementId: string;
  montoTecleado: number;
  monedaTecleada: "VES" | PriceCurrency | null;
  techo: number | null;
  monedaDelLibro: PriceCurrency | null;
}) {
  const router = useRouter();
  const guardia = useGuardiaDeCuentaPausada();
  const [editando, setEditando] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [borrando, setBorrando] = useState(false);
  const [monto, setMonto] = useState(String(montoTecleado));
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();

  const enBolivares = monedaTecleada === "VES";
  const formatear = (n: number) =>
    enBolivares ? formatBs(n) : formatPriceAmount(n, (monedaDelLibro ?? "COP") as PriceCurrency);

  function guardar() {
    setError(null);
    // `parseAmount` Y NO `Number(...)`: con coma devolvía `NaN` y la pantalla
    // contestaba «Escribe cuánto te pagó» CON LA CIFRA ESCRITA DELANTE, que es
    // de los mensajes que más desconciertan. Defecto anterior al formateo del
    // 2026-10-23; arreglado el mismo día al encontrarlo.
    const valor = parseAmount(monto) ?? Number.NaN;
    if (!Number.isFinite(valor) || valor <= 0) {
      setError("Escribe cuánto te pagó.");
      return;
    }
    startTransition(async () => {
      const r = await editarAbonoDirigido({ movementId, monto: valor });
      if (!r.ok) {
        if (!avisarCuentaPausada(r.error)) setError(r.error);
        return;
      }
      setEditando(false);
      toast.success("Abono actualizado");
      router.refresh();
    });
  }

  async function borrar() {
    if (guardia()) return;
    setBorrando(true);
    const r = await deleteMovement(movementId);
    setBorrando(false);
    if (r.error) {
      if (!avisarCuentaPausada(r.error)) toast.error(r.error);
      return;
    }
    toast.success("Abono eliminado");
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-mr-2 size-8 shrink-0"
            aria-label="Más opciones de este abono"
          >
            <MoreVertical className="size-5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              if (guardia()) return;
              setMonto(String(montoTecleado));
              setError(null);
              setEditando(true);
            }}
          >
            <Pencil className="size-4" />
            Editar abono
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={(e) => {
              e.preventDefault();
              setConfirmando(true);
            }}
          >
            <Trash2 className="size-4" />
            Eliminar abono
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={editando} onOpenChange={setEditando}>
        <DialogContent className="grid-cols-[minmax(0,1fr)]">
          <DialogHeader>
            <DialogTitle>Editar abono</DialogTitle>
            {/* SOLO EL MONTO, Y SE DICE. Decisión del dueño el 2026-10-20:
                *«solo saldo, no toca fecha»*. La fecha manda sobre la tasa, así
                que dejarla quieta es lo que mantiene el respaldo verdadero —y
                el tendero tiene que saber por qué no puede cambiarla. */}
            <DialogDescription>
              Solo se puede cambiar el monto. La fecha y la tasa de ese día se quedan como están.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor="monto-abono">
              Monto {enBolivares ? "en bolívares" : null}
            </Label>
            <Input
              id="monto-abono"
              type="number"
              min="0"
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
              className="h-10 tabular-nums"
              autoFocus
            />
            {techo != null ? (
              <p className="text-xs text-muted-foreground">
                Máximo {formatPriceAmount(techo, (monedaDelLibro ?? "COP") as PriceCurrency)} — lo
                que admite ese fiado contando este abono.
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              Estaba en {formatear(montoTecleado)}.
            </p>
          </div>

          {/* EL AVISO QUE TODAVÍA NO SALE, dicho en la propia pantalla.
              El dueño pidió el 2026-10-20 que editar un abono le avise al
              cliente por WhatsApp. Hace falta una plantilla de Meta que no
              existe --`CT-114`-- y prometer aquí un aviso que no va a salir es
              peor que no ofrecerlo: el tendero creería que su cliente ya se
              enteró. Esta línea se borra el día que la plantilla exista. */}
          <p className="rounded-lg border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
            Por ahora el cliente no recibe aviso de este cambio. Si ya le compartiste el abono,
            cuéntaselo tú.
          </p>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditando(false)}>
              Cancelar
            </Button>
            <Button type="button" onClick={guardar} disabled={guardando}>
              {guardando ? "Guardando…" : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmando} onOpenChange={setConfirmando}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar este abono?</AlertDialogTitle>
            <AlertDialogDescription>
              La deuda de ese fiado vuelve a subir {formatear(montoTecleado)}. Podrás restaurarlo
              después desde Notificaciones.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={borrar} disabled={borrando}>
              {borrando ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
