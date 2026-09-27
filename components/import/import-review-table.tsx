"use client";

import { Fragment } from "react";

import { Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ExtractedMovement, LedgerCurrency } from "@/lib/types";
import type { ReviewRow } from "@/lib/reconcile";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { DocumentIdInput } from "@/components/dashboard/document-id-input";
import { WhatsappInput } from "@/components/whatsapp-input";
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import type { OwnerCountry } from "@/lib/types";

// El porqué de cada fila marcada, en una frase. Se pinta debajo de la fila y
// no en una columna: una columna más es más scroll horizontal, y esto es texto
// corrido que necesita ancho, no una celda de 100px.
//
// SOLO "no_cuadra" VA EN ROJO. Es la única que significa "esta cuenta está
// mal". Las otras dos son un aviso: la libreta no traía saldo en esa línea, o
// la IA dudó. Pintarlas del mismo rojo dejaba una libreta normal —sin totales
// escritos, que es como son casi todas— con todas las filas en rojo, y un
// aviso que sale siempre deja de leerse.
function avisoDeLaFila(row: ReviewRow): { texto: string; rojo: boolean } | null {
  const importe = (n: number) =>
    row.currency ? formatDisplayCurrency(n, row.currency) : formatCurrency(n);

  if (row.review_reason === "no_cuadra") {
    return {
      rojo: true,
      texto: `No cuadra: tu libreta dice ${importe(row.read_balance!)} y con estos montos da ${importe(row.computed_balance)}.`,
    };
  }
  if (row.review_reason === "lectura_dudosa") {
    return { rojo: false, texto: "La IA no leyó esta línea con seguridad — revisa el monto y el nombre." };
  }
  if (row.review_reason === "sin_saldo") {
    return { rojo: false, texto: "Esta línea no traía un saldo escrito con el que comparar." };
  }
  return null;
}

export function ImportReviewTable({
  rows,
  country,
  onUpdate,
  onRemove,
  existingClients,
  showCurrency,
  sharedClientActive,
  isLinked,
  onToggleLinked,
}: {
  rows: ReviewRow[];
  // Decides the document prefix: "V-" in Venezuela, none in Colombia.
  country: OwnerCountry;
  onUpdate: (index: number, patch: Partial<ExtractedMovement>) => void;
  onRemove: (index: number) => void;
  existingClients: { id: string; name: string }[];
  // False for a CO owner, whose ledger has no currency dimension.
  showCurrency: boolean;
  // True while "todas las filas son del mismo cliente" is ticked, which adds a
  // per-row checkbox: a page usually holds one client but can mix, so the
  // shared value is a default any row can refuse.
  sharedClientActive: boolean;
  // Whether this row is still taking the shared client. A linked row shows the
  // shared name and document as plain text — editing them per row would
  // silently contradict the field above the table. An opted-out row gets its
  // own inputs back, holding whatever was read from the photo.
  isLinked: (rowId: string) => boolean;
  onToggleLinked: (rowId: string) => void;
}) {
  // Siete en los dos casos, y que coincidan es casualidad, no una
  // simplificación: con cliente compartido son Vincular, Cliente, Documento,
  // Tipo, Monto, Detalle y la papelera; sin él, Vincular se va y entra
  // WhatsApp. Se deja escrito como dos ramas para que añadir una columna a
  // una sola no deje la fila del aviso corta sin que nadie lo note.
  const columnas = sharedClientActive ? 7 : 7;

  return (
    <div className="overflow-x-auto rounded-lg border">
      <datalist id="known-clients">
        {existingClients.map((c) => (
          <option key={c.id} value={c.name} />
        ))}
      </datalist>
      {/* Márgenes de celda a 6px en vez de los 8 de serie, y solo aquí. Son
          siete columnas de campos editables, así que cada 2px de gutter se
          multiplica por catorce bordes: 28px de scroll menos. No se toca
          `components/ui/table.tsx` — el resto de las tablas del app no tiene
          este problema y no debe pagar por él. */}
      <Table className="[&_td]:px-1.5 [&_th]:px-1.5">
        <TableHeader>
          <TableRow>
            {sharedClientActive ? (
              <TableHead className="w-20 whitespace-nowrap">Vincular</TableHead>
            ) : null}
            <TableHead className="min-w-[7.5rem]">Cliente</TableHead>
            {/* `min-w` y no `w`: con `table-layout: auto` un `width` es una
                sugerencia que el navegador reparte como quiere, y esta columna
                acababa en 88px con el input a 52 — tres dígitos de una cédula
                de nueve. Un mínimo sí se respeta.

                150px salen de medir, no de tantear: nueve dígitos anchos en
                Geist de 16px ocupan 87, el relleno del input 22, el "V-" 18,
                el hueco 8 y los márgenes de celda 12. Bajar la fuente a 14px
                ahorraría 16px y está descartado — iOS Safari hace zoom al
                enfocar cualquier campo por debajo de 16px. */}
            <TableHead className="min-w-[9.5rem]">Documento</TableHead>
            {/* WhatsApp solo cuando NO hay cliente compartido. Con la casilla
                marcada el número se escribe una vez arriba, igual que el
                nombre y la cédula, y repetirlo por fila serían veintitrés
                copias del mismo dato — más 176px de scroll para nada.

                176px y `compact`, las dos cosas juntas, medidas: el selector
                de país entero mide 112 y dejaba al número 22px de ancho —dos
                dígitos de diez, ilegible—, porque en un flex el input sí
                encoge y el botón no. Con solo la bandera el selector baja a
                44 y el número se queda con 116, que muestra los diez. */}
            {sharedClientActive ? null : (
              <TableHead className="min-w-[11rem]">WhatsApp</TableHead>
            )}
            <TableHead>Tipo</TableHead>
            <TableHead>Monto</TableHead>
            <TableHead className="min-w-[7.5rem]">Detalle</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
            const aviso = avisoDeLaFila(row);
            return (
            <Fragment key={row.rowId}>
            <TableRow
              className={
                row.review_reason === "no_cuadra"
                  ? "bg-destructive/10 dark:bg-destructive/20"
                  : row.needs_review
                    ? "bg-amber-50 dark:bg-amber-950/20"
                    : undefined
              }
            >
              {sharedClientActive ? (
                <TableCell>
                  <Checkbox
                    checked={isLinked(row.rowId)}
                    onCheckedChange={() => onToggleLinked(row.rowId)}
                    aria-label={`Usar el cliente compartido para la fila de ${row.client_name}`}
                  />
                </TableCell>
              ) : null}
              <TableCell>
                {sharedClientActive && isLinked(row.rowId) ? (
                  <span className="text-sm whitespace-nowrap text-muted-foreground">
                    {row.client_name}
                  </span>
                ) : (
                  <Input
                    list="known-clients"
                    value={row.client_name}
                    onChange={(e) => onUpdate(index, { client_name: e.target.value })}
                  />
                )}
              </TableCell>
              <TableCell>
                {(sharedClientActive && isLinked(row.rowId)) || !row.needs_document_id ? (
                  <span className="text-sm whitespace-nowrap text-muted-foreground">
                    {row.document_id}
                  </span>
                ) : (
                  <DocumentIdInput
                    id={`import-document-${index}`}
                    country={country}
                    value={row.document_id ?? ""}
                    onChange={(next) => onUpdate(index, { document_id: next || null })}
                    invalid={!row.document_id?.trim()}
                  />
                )}
              </TableCell>
              {sharedClientActive ? null : (
                <TableCell>
                  <WhatsappInput
                    id={`import-whatsapp-${index}`}
                    name={`import-whatsapp-${index}`}
                    preferredDialCode={OWNER_COUNTRY_DIAL_CODE[country]}
                    defaultValue={row.whatsapp}
                    compact
                    onValueChange={(v) => onUpdate(index, { whatsapp: v.trim() || null })}
                  />
                </TableCell>
              )}
              <TableCell>
                <Select
                  value={row.type}
                  onValueChange={(v) => onUpdate(index, { type: v as "charge" | "payment" })}
                >
                  <SelectTrigger className="w-[5.5rem]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="charge">Cargo</SelectItem>
                    <SelectItem value="payment">Abono</SelectItem>
                  </SelectContent>
                </Select>
              </TableCell>
              {/* Currency sits with the amount rather than in its own column:
                  it is a property of that number, and on a phone an extra
                  column is one more thing to scroll past to reach it. */}
              <TableCell>
                <div className="flex items-center gap-1.5">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    className="w-20"
                    value={row.amount}
                    onChange={(e) => onUpdate(index, { amount: Number(e.target.value) || 0 })}
                  />
                  {/* Sin moneda no se muestra ninguna, en vez de enseñar USD
                      sin haberlo guardado: la fila diría "USD" mientras el
                      servidor responde que no sabe en qué moneda está. El
                      selector se ensancha solo mientras está vacío, y vuelve a
                      su tamaño en cuanto hay una elegida — que es lo normal
                      tras pulsar "Todo en USD/EUR". */}
                  {showCurrency ? (
                    <Select
                      value={row.currency ?? undefined}
                      onValueChange={(v) => onUpdate(index, { currency: v as LedgerCurrency })}
                    >
                      <SelectTrigger
                        className={row.currency ? "w-[4.25rem]" : "w-[6.5rem]"}
                        aria-label={`Moneda de ${row.client_name}`}
                      >
                        <SelectValue placeholder="Moneda" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="EUR">EUR</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <Input
                  value={row.description ?? ""}
                  onChange={(e) => onUpdate(index, { description: e.target.value || null })}
                />
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="icon" onClick={() => onRemove(index)}>
                  <Trash2 className="size-4" />
                </Button>
              </TableCell>
            </TableRow>
            {/* El porqué, en su propia fila a todo lo ancho. Así la frase cabe
                sin ensanchar ninguna columna: la tabla ya se desplaza de lado
                y una columna de texto la habría empeorado. `border-0` porque
                pertenece a la fila de arriba, no es una fila más. */}
            {aviso ? (
              <TableRow
                className={
                  aviso.rojo
                    ? "bg-destructive/10 hover:bg-destructive/10 dark:bg-destructive/20"
                    : "bg-amber-50 hover:bg-amber-50 dark:bg-amber-950/20"
                }
              >
                {/* `whitespace-normal` deshace el `whitespace-nowrap` que TableCell
                    trae de serie (components/ui/table.tsx:86). Tiene sentido
                    en una celda de datos —un monto partido en dos líneas es
                    ilegible— y ninguno en una frase, que sin esto se quedaba
                    en una sola línea de 353px dentro de 299 y se cortaba
                    justo antes de la cifra. */}
                <TableCell colSpan={columnas} className="border-0 pt-0 pb-2 whitespace-normal">
                  {/* `sticky left-0`, y esto no es un detalle: la celda ocupa
                      el ancho ENTERO de la tabla (~700px) y la pantalla de un
                      teléfono enseña 340. Sin anclarla, la frase empezaba
                      visible y terminaba fuera —"...y con estos montos da $"—
                      y había que desplazarse de lado para leer el número que
                      es justo el motivo del aviso. Anclada, se queda a la
                      vista esté donde esté el scroll horizontal.

                      El ancho se limita al hueco de la pantalla menos los
                      márgenes de la página; de `sm:` en adelante la tabla ya
                      cabe entera y el tope deja de morder. */}
                  <span
                    className={`sticky left-0 flex max-w-[calc(100vw-3.5rem)] items-start gap-1.5 text-xs sm:max-w-none ${
                      aviso.rojo ? "text-destructive" : "text-amber-700 dark:text-amber-500"
                    }`}
                  >
                    <TriangleAlert className="mt-px size-3.5 shrink-0" />
                    {/* `min-w-0` en el texto, y hace falta: un ítem de flex no
                        baja de la anchura de su contenido salvo que se le diga,
                        así que la frase se quedaba en una línea de 373px dentro
                        de una caja de 319 y se cortaba en "...da $" — justo
                        antes de la cifra por la que existe el aviso. Con esto
                        pasa a dos líneas y se lee entera. */}
                    <span className="min-w-0">{aviso.texto}</span>
                  </span>
                </TableCell>
              </TableRow>
            ) : null}
            </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
