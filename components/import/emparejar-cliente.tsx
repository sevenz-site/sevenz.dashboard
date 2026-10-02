"use client";

import { ArrowDown, UserRoundSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { formatCurrency, formatDocumentId } from "@/lib/format";
import type { CandidatoDuplicado } from "@/lib/reconcile";

// ─────────────────────────────────────────────────────────────────────────
// EMPAREJAR UN RENGLÓN CON UN CLIENTE QUE YA EXISTE — CT-29
//
// Una persona puede tener VARIAS fichas a propósito: "Karina castillo (negocio
// lomas)" y "Karina castillo (kari)" comparten cédula en producción, y la
// migración 034 tiró el índice único justamente para permitirlo.
//
// Hasta el 2026-10-02 la revisión preguntaba "¿es el mismo?" en singular, con
// dos botones, y solo cuando la grafía coincidía ENTERA. Con dos fichas
// candidatas no coincidía ninguna: no se preguntaba nada, la tarjeta salía como
// cliente nuevo, y el choque aparecía al final —al confirmar la cédula— parando
// la subida en seco con un mensaje que mandaba a una tabla borrada.
//
// Ahora: cuando hay uno se pregunta como siempre, cuando hay varios se abre la
// lista, y en los dos casos se confirma. Confirmar no es ceremonia: el
// emparejamiento decide a QUIÉN le cae la deuda de esa página y no se deshace
// desde esta pantalla una vez subida.

function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  return (partes[0][0] + (partes[1]?.[0] ?? "")).toUpperCase();
}

// Lo que debe, en las monedas que tenga. Un cliente VE puede deber en las dos y
// NUNCA se suman: son deudas independientes, la regla que sigue toda la app.
function loQueDebe(c: Pick<CandidatoDuplicado, "balance" | "balance_usd" | "balance_eur">): string {
  const partes: string[] = [];
  if (c.balance_usd) partes.push(formatDisplayCurrency(c.balance_usd, "USD"));
  if (c.balance_eur) partes.push(formatDisplayCurrency(c.balance_eur, "EUR"));
  if (partes.length === 0) partes.push(formatCurrency(c.balance ?? 0));
  return partes.join(" · ");
}

// La ficha de un cliente, igual en la lista y en la confirmación. Se escribe una
// vez porque en la confirmación aparecen DOS, una encima de otra, y que no se
// vean idénticas sería justo lo que haría dudar de cuál es cuál.
function FichaDeCliente({
  nombre,
  documento,
  whatsapp,
  debe,
  conInicial = true,
}: {
  nombre: string;
  documento: string | null;
  whatsapp: string | null;
  debe: string;
  conInicial?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-l-4 border-l-primary bg-background p-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-semibold">{nombre}</span>
        <span className="text-xs text-muted-foreground">
          Cédula: {documento ? formatDocumentId(documento) : "—"}
        </span>
        <span className="text-xs text-muted-foreground">WhatsApp: {whatsapp?.trim() || "—"}</span>
        <span className="pt-1 text-xs font-medium">Debe: {debe}</span>
      </div>
      {conInicial ? (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border text-xs font-medium text-muted-foreground">
          {iniciales(nombre)}
        </span>
      ) : null}
    </div>
  );
}

// El recuadro ámbar, que es el MISMO en la tarjeta, en la hoja y en el detalle.
// Lo que cambia es el texto y qué botones lleva al lado — por eso vive aquí y no
// copiado en tres sitios, que es como dos de los tres se quedan viejos.
// LA ELECCIÓN SE MARCA, NO SE PULSA — 2026-10-02.
//
// Esto nació con dos `Button`, y era un error mío: CT-29 razonó que, como elegir
// abre una confirmación, era una acción. Pero lo que queda guardado es un VALOR
// —esta persona es la misma, o no lo es— y `DESIGN-SYSTEM.md` ya tenía la regla
// escrita: "si dos botones representan un valor elegido, son un RadioGroup".
//
// El síntoma que lo destapó: tras pulsar "Es otra persona" los dos botones
// seguían ahí, iguales, sin ninguna marca de lo que se acababa de elegir. La
// pantalla se veía igual antes y después — exactamente el fallo que la regla
// describe con el selector de moneda.
//
// NINGUNA MARCADA DE SALIDA, a propósito: las dos respuestas se equivocan en
// silencio y en direcciones opuestas —una funde a dos personas, la otra parte el
// historial de una—, así que marcar una por defecto sería responder por el dueño.
export function AvisoDeDuplicado({
  nombreEnLaLibreta,
  candidatos,
  elegido,
  onElegirMismo,
  onElegirOtra,
}: {
  nombreEnLaLibreta: string;
  candidatos: CandidatoDuplicado[];
  // "mismo" | "otra" | undefined. Sin decidir no marca ninguna.
  elegido?: "mismo" | "otra";
  // Con un candidato confirma directo; con varios abre la lista para elegir cuál.
  // Sin ellos no se pintan las opciones: dentro de la hoja de candidatos el aviso
  // es solo el texto, porque elegir se hace tocando una ficha de la lista.
  onElegirMismo?: () => void;
  onElegirOtra?: () => void;
}) {
  const varios = candidatos.length > 1;
  const uno = candidatos[0];
  return (
    <div className="flex flex-col gap-2">
      <p className="flex items-start gap-1.5 text-sm">
        <UserRoundSearch className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
        <span>
          {varios ? (
            <>
              Ya tienes varios &ldquo;{nombreEnLaLibreta}&rdquo; en tu cartera.
              <span className="mt-1 block text-muted-foreground">
                Revisa la lista de clientes existentes para asignar los movimientos a alguno de los
                que ya tienes.
              </span>
            </>
          ) : (
            <>
              Ya tienes un &ldquo;{uno?.name}&rdquo; en tu cartera.
              <span className="mt-1 block text-muted-foreground">
                Cédula: {uno?.document_id ? formatDocumentId(uno.document_id) : "—"}. Debe{" "}
                {uno ? loQueDebe(uno) : "—"}.
              </span>
            </>
          )}
        </span>
      </p>
      {onElegirMismo && onElegirOtra ? (
      <RadioGroup
        value={elegido ?? ""}
        onValueChange={(v) => (v === "mismo" ? onElegirMismo() : onElegirOtra())}
        className="flex flex-row flex-wrap gap-2"
      >
        {/* `h-10` y `rounded-full`, la forma de `TipoButtons`, que es la que el
            design system fija para una elección. */}
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-3.5 text-sm">
          <RadioGroupItem value="mismo" />
          <span className="whitespace-nowrap">Es el mismo</span>
        </label>
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-3.5 text-sm">
          <RadioGroupItem value="otra" />
          <span className="whitespace-nowrap">Es otra persona</span>
        </label>
      </RadioGroup>
      ) : null}
    </div>
  );
}

// LA LISTA, cuando hay varios. Misma forma de navegación que el detalle del
// cliente: una hoja desde abajo, no un diálogo centrado — se abre desde una
// tarjeta y se vuelve a ella.
export function ListaDeCandidatos({
  abierta,
  onCerrar,
  nombreEnLaLibreta,
  candidatos,
  onElegir,
  onEsOtraPersona,
}: {
  abierta: boolean;
  onCerrar: () => void;
  nombreEnLaLibreta: string;
  candidatos: CandidatoDuplicado[];
  onElegir: (c: CandidatoDuplicado) => void;
  onEsOtraPersona: () => void;
}) {
  return (
    <Sheet open={abierta} onOpenChange={(v) => !v && onCerrar()}>
      <SheetContent side="bottom" className="max-h-[92dvh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle>Clientes</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/20 dark:bg-amber-500/10">
            <p className="text-sm font-semibold">¿Es el mismo?</p>
            <AvisoDeDuplicado nombreEnLaLibreta={nombreEnLaLibreta} candidatos={candidatos} />
            <div>
              <Button type="button" size="sm" variant="outline" onClick={onEsOtraPersona}>
                Es otra persona
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">¿Es alguno de estos?</p>
            <ul className="flex flex-col gap-2">
              {candidatos.map((c) => (
                <li key={c.id}>
                  {/* Toda la ficha es el botón: en un teléfono, un objetivo del
                      tamaño de la tarjeta se acierta y uno del tamaño de un
                      enlace no. */}
                  <button
                    type="button"
                    className="w-full rounded-lg text-left ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    onClick={() => onElegir(c)}
                  >
                    <FichaDeCliente
                      nombre={c.name}
                      documento={c.document_id}
                      whatsapp={c.whatsapp}
                      debe={loQueDebe(c)}
                    />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// LA CONFIRMACIÓN, que sale en los dos caminos: al elegir de la lista y al
// pulsar "Es el mismo" cuando el candidato es uno solo.
//
// Enseña las DOS fichas, la de la libreta arriba y la existente abajo, porque la
// pregunta real no es "¿seguro?" sino "¿estas dos son la misma persona?" — y esa
// no se puede responder sin verlas juntas.
export function ConfirmarEmparejamiento({
  abierta,
  onCerrar,
  onConfirmar,
  nombreEnLaLibreta,
  documentoEnLaLibreta,
  whatsappEnLaLibreta,
  loQueTraeLaLibreta,
  candidato,
}: {
  abierta: boolean;
  onCerrar: () => void;
  onConfirmar: () => void;
  nombreEnLaLibreta: string;
  documentoEnLaLibreta: string | null;
  whatsappEnLaLibreta: string | null;
  loQueTraeLaLibreta: string;
  candidato: CandidatoDuplicado | null;
}) {
  return (
    <Dialog open={abierta && candidato !== null} onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Confirma emparejamiento</DialogTitle>
          {/* En rojo y dentro del título, no como una nota al pie: es la única
              parte de este diálogo que el dueño tiene que leer antes de pulsar. */}
          <DialogDescription className="font-medium text-destructive">
            Esta acción es irreversible
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Cliente identificado</p>
          <FichaDeCliente
            nombre={nombreEnLaLibreta}
            documento={documentoEnLaLibreta}
            whatsapp={whatsappEnLaLibreta}
            debe={loQueTraeLaLibreta}
            conInicial={false}
          />

          <div className="flex justify-center py-1">
            <span className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs text-muted-foreground">
              A emparejar con <ArrowDown className="size-3.5" aria-hidden />
            </span>
          </div>

          {candidato ? (
            <FichaDeCliente
              nombre={candidato.name}
              documento={candidato.document_id}
              whatsapp={candidato.whatsapp}
              debe={loQueDebe(candidato)}
            />
          ) : null}
        </div>

        {/* Apilados y a lo ancho, como en el diseño: en un teléfono dos botones
            en fila con estos textos se parten en dos líneas cada uno. */}
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          <Button type="button" className="w-full" onClick={onConfirmar}>
            Confirmar
          </Button>
          <Button type="button" variant="outline" className="w-full" onClick={onCerrar}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

