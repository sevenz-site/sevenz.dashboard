"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowDownLeft, ArrowUpRight, ImageOff, Share2 } from "lucide-react";
import { formatBs } from "@/lib/exchange-rate/format";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
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
import { Button } from "@/components/ui/button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { deleteMovement } from "@/app/(app)/dashboard/actions";
import { formatDate, formatPlazoDias } from "@/lib/format";
import { formatDisplayCurrency, formatRateEquivalence } from "@/lib/exchange-rate/format";
import { formatLedgerAmount, type LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { textoParaCompartir } from "@/lib/movement-share";
import type { LedgerCurrency, MovementCurrencyCode, MovementType } from "@/lib/types";

const NOMBRE_DE_MONEDA: Record<MovementCurrencyCode, string> = {
  VES: "Bolívares",
  USD: "Dólares",
  EUR: "Euros",
};

// Una fila de la ficha: nombre a la izquierda, dato a la derecha.
//
// El dato va alineado a la derecha y no pegado al nombre porque esta ficha se
// lee en vertical: con todos los datos en el mismo margen, el ojo baja por una
// columna en vez de ir saltando al final de cada etiqueta.
//
// leading-5 —20px de alto de linea— y no el 16px que trae text-xs por defecto.
// El motivo no es el aire: es que las filas midan TODAS lo mismo. Las que
// llevan bandera o flecha crecian hasta los 20px del icono y las de solo texto
// se quedaban en 16, asi que la separacion entre filas cambiaba segun lo que
// hubiera dentro y la columna de la derecha no caia a un ritmo constante. Con
// 20px fijos el icono ya cabe sin empujar nada, y un dato que ocupe dos lineas
// mide exactamente el doble en vez de una cifra intermedia.
function Fila({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-xs leading-5">
      <dt className="shrink-0 text-muted-foreground">{nombre}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}

// Un grupo de filas. Los grupos van separados por aire y no por una raya: son
// tres respuestas a tres preguntas distintas —cuándo y qué fue, cuánto dinero,
// y qué se acordó alrededor—, y una raya entre ellos convertiría la ficha en
// una tabla de tres tablas.
function Grupo({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-1.5">{children}</div>;
}

export function MovementDetailPopover({
  movementId,
  type,
  amount,
  currency = null,
  description,
  plazoDias,
  createdAt,
  runningBalance,
  balanceLabel = "Por cobrar",
  photoUrl,
  entryCurrency = null,
  entryAmount = null,
  exchangeRateUsed = null,
  ledger = null,
  children,
}: {
  // Only the owner's dashboard passes this — it's what shows the "Eliminar
  // movimiento" action. The public client page omits it entirely.
  movementId?: string;
  type: MovementType;
  amount: number;
  // Which ledger this movement belongs to (USD/EUR) — null for a 'CO' owner.
  // The authoritative source for which currency to format amount/
  // runningBalance in; entryCurrency below is only the historical "what was
  // typed" record and can't be relied on for that (older rows may say 'VES'
  // even though the stored amount was migrated to USD).
  currency?: LedgerCurrency | null;
  description: string | null;
  plazoDias: number | null;
  createdAt: string;
  runningBalance: number;
  // Label for the running-balance row — the owner's dashboard says "Por
  // cobrar"; the public client page says "Debe"/"A favor"/"Sin deuda".
  balanceLabel?: string;
  // undefined omits the "Foto" row entirely (e.g. the public share page,
  // which never exposes attachment photos). null means "no photo attached",
  // and that now draws an empty state instead of a dash: el hueco dibujado
  // dice "aquí va una foto y este movimiento no tiene", que es justo lo que el
  // dueño necesita saber cuando busca el respaldo de un fiado.
  photoUrl?: string | null;
  // Conversion trail — all null for a country='CO' owner and for every
  // movement recorded before the exchange-rate feature existed, in which
  // case none of these rows render at all.
  entryCurrency?: MovementCurrencyCode | null;
  entryAmount?: number | null;
  exchangeRateUsed?: number | null;
  // null = plain COP ledger (every country='CO' owner), which formats
  // exactly as it always has.
  ledger?: LedgerDisplay | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const ledgerAmount = formatLedgerAmount(amount, currency, ledger);
  const balance = formatLedgerAmount(runningBalance, currency, ledger);

  // En qué moneda se escribió este movimiento. Solo tiene sentido en un negocio
  // que lleva divisas; en uno colombiano hay una sola moneda y decirlo sería
  // responder una pregunta que nadie se hace.
  //
  // entryCurrency puede venir vacío en movimientos anteriores a que existiera
  // la columna: entonces lo escrito fue la moneda del libro, porque escribir en
  // bolívares es posterior a esos movimientos.
  const monedaRegistrada: MovementCurrencyCode | null = currency ? (entryCurrency ?? currency) : null;

  // LO QUE SE TECLEÓ, no lo que se guardó. Son la misma cifra salvo cuando se
  // escribió en bolívares, y ahí la diferencia importa: un fiado tecleado como
  // Bs. 900 se guarda como $1,08, y $1,08 valen 899,09 y no 900 porque los
  // céntimos no dan para más. Esos 91 céntimos son redondeo, pero sin ver el
  // 900 al lado parecen un error de la app.
  //
  // entry_amount y entry_currency existen desde la 022 justo para esto, y su
  // propio comentario dice que lo que el dueño tecleó "es el respaldo más
  // defendible en una disputa que una cifra derivada después".
  const monto =
    monedaRegistrada === "VES" && entryAmount != null
      ? formatBs(entryAmount)
      : ledgerAmount.primary;

  // LA OTRA CARA, con la tasa SELLADA en el movimiento — no con la de hoy.
  //
  // Las tres filas de este grupo tienen que multiplicar entre sí: monto por
  // tasa da el equivalente. Si el equivalente se calculara con la tasa de hoy y
  // la tasa mostrada fuera la del día, las tres filas no cuadrarían y quien
  // rehiciera la cuenta creería que la app se equivocó. El valor de HOY vive
  // abajo, en la tarjeta del saldo, que es donde esa pregunta se hace.
  const equivalente =
    currency && exchangeRateUsed != null
      ? monedaRegistrada === "VES"
        ? { texto: formatDisplayCurrency(amount, currency), moneda: currency as MovementCurrencyCode }
        : { texto: formatBs(amount * exchangeRateUsed), moneda: "VES" as MovementCurrencyCode }
      : null;

  const tasa =
    currency && exchangeRateUsed != null ? formatRateEquivalence(currency, exchangeRateUsed) : null;

  // Se enseña siempre, tambien en un abono, igual que hasta ahora. Un abono no
  // lleva plazo y la fila dira "—", pero quitarla cambiaria una ficha que el
  // dueño ya conoce sin que nadie lo haya pedido.
  const plazo = formatPlazoDias(plazoDias);

  // El saldo manda el color: rojo lo que queda por cobrar, verde el saldo a
  // favor. Es el mismo par de colores que el formulario y el historial, y por
  // el mismo motivo — aprenderlo una vez tiene que servir en toda la app.
  const colorSaldo =
    runningBalance > 0 ? "text-destructive" : runningBalance < 0 ? "text-money-in" : "";

  async function handleDelete() {
    if (!movementId) return;
    setDeleting(true);
    const result = await deleteMovement(movementId);
    setDeleting(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success("Movimiento eliminado");
    setOpen(false);
    router.refresh();
  }

  // El menú de compartir del propio teléfono: WhatsApp, Telegram, copiar,
  // guardar en notas. No se elige por el dueño a qué app va — la lista de
  // "compartir por WhatsApp" que tantas apps ponen acaba siendo más corta que
  // la que el teléfono ya sabe.
  async function handleShare() {
    const texto = textoParaCompartir({
      tipo: type,
      fecha: formatDate(createdAt),
      monto,
      equivalente: equivalente?.texto ?? null,
      tasa,
      plazo,
      detalle: description,
      saldoEtiqueta: balanceLabel,
      saldo: balance.primary,
    });

    try {
      // navigator.share no existe en el escritorio de casi nadie y en iPhone
      // solo responde dentro de un gesto del usuario. Portapapeles como
      // respaldo: el texto acaba igualmente donde el dueño lo quiera pegar.
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ text: texto });
        return;
      }
      await navigator.clipboard.writeText(texto);
      toast.success("Movimiento copiado. Pégalo donde quieras.");
    } catch (error) {
      // Cerrar el menú de compartir cuenta como un error para el navegador, y
      // no lo es: el dueño cambió de idea. Avisarle de un fallo que no existe
      // es peor que callarse.
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error("No pudimos compartir el movimiento. Inténtalo de nuevo.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Detalle de movimiento</DialogTitle>
        </DialogHeader>

        {/* gap-4 entre grupos, gap-1.5 dentro. Esa diferencia es toda la
            estructura: sin ella son nueve filas seguidas y hay que leerlas
            todas para encontrar una. */}
        <dl className="flex flex-col gap-4">
          <Grupo>
            <Fila nombre="Fecha">{formatDate(createdAt)}</Fila>
            <Fila nombre="Tipo">
              <span className="inline-flex items-center gap-1.5">
                {type === "charge" ? "Cargo (fía)" : "Abono (paga)"}
                {type === "charge" ? (
                  <ArrowUpRight className="size-3.5 text-destructive" aria-hidden />
                ) : (
                  <ArrowDownLeft className="size-3.5 text-money-in" aria-hidden />
                )}
              </span>
            </Fila>
            {monedaRegistrada ? (
              <Fila nombre="Moneda registrada">
                <span className="inline-flex items-center gap-1.5">
                  {NOMBRE_DE_MONEDA[monedaRegistrada]}
                  <CurrencyFlagIcon currency={monedaRegistrada} />
                </span>
              </Fila>
            ) : null}
          </Grupo>

          <Grupo>
            <Fila nombre="Monto">
              <span className="tabular-nums">{monto}</span>
            </Fila>
            {tasa ? (
              <Fila nombre="Tasa del día">
                <span className="tabular-nums">{tasa}</span>
              </Fila>
            ) : null}
            {equivalente ? (
              <Fila nombre="Equivalente">
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  {equivalente.texto}
                  <CurrencyFlagIcon currency={equivalente.moneda} />
                </span>
              </Fila>
            ) : null}
          </Grupo>

          <Grupo>
            <Fila nombre="Plazo de pago">{plazo}</Fila>
            <Fila nombre="Detalle">
              <span className="break-words">{description || "—"}</span>
            </Fila>
            {photoUrl !== undefined ? (
              <>
                <dt className="text-xs leading-5 text-muted-foreground">Foto</dt>
                <dd>
                  {photoUrl ? (
                    <a href={photoUrl} target="_blank" rel="noopener noreferrer">
                      <Image
                        src={photoUrl}
                        alt="Foto del movimiento"
                        width={640}
                        height={360}
                        unoptimized
                        className="h-40 w-full rounded-lg border object-cover"
                      />
                    </a>
                  ) : (
                    // El hueco dibujado en vez de una raya. Un "—" se lee como
                    // "este dato no aplica"; el recuadro dice que aquí cabe una
                    // foto y este movimiento no la tiene, que es lo que el
                    // dueño necesita saber cuando busca el respaldo de un fiado
                    // y no lo encuentra.
                    <div className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed bg-muted/40 text-muted-foreground">
                      <ImageOff className="size-5" aria-hidden />
                      <span className="text-xs">Sin foto adjunta</span>
                    </div>
                  )}
                </dd>
              </>
            ) : null}
          </Grupo>
        </dl>

        {/* El saldo sale de la lista y se vuelve tarjeta. No es un dato más del
            movimiento: es en qué queda la cuenta después de él, y es lo que casi
            todo el mundo abre esta ficha para mirar. Misma anatomía que las
            tarjetas del formulario —etiqueta arriba, cifra grande, moneda a la
            derecha— para que se reconozca sin leerla. */}
        <div className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">{balanceLabel}</span>
            <span className={`text-2xl font-semibold tabular-nums ${colorSaldo}`}>
              {balance.primary}
            </span>
            {balance.secondary ? (
              <span className="text-xs text-muted-foreground">= {balance.secondary}</span>
            ) : null}
          </div>
          {currency ? (
            <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              {NOMBRE_DE_MONEDA[currency]}
              <CurrencyFlagIcon currency={currency} />
            </span>
          ) : null}
        </div>

        <div className="flex flex-col gap-1">
          <Button type="button" variant="outline" onClick={handleShare} className="w-full">
            Compartir
            <Share2 className="size-4" />
          </Button>

          {movementId ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                {/* Discreto a propósito. Borrar y compartir no son dos acciones
                    del mismo peso: una manda un mensaje, la otra deshace un
                    apunte de dinero. Un botón rojo del mismo tamaño al lado
                    invita a pulsarlo por simetría. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground hover:text-destructive"
                >
                  Eliminar movimiento
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>¿Eliminar este movimiento?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Se recalculará el saldo de este cliente y el capital por cobrar. Podrás
                    restaurarlo después desde Notificaciones.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={deleting}>
                    {deleting ? "Eliminando..." : "Eliminar"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
