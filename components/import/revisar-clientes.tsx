"use client";

import {
  ChevronRight,
  CircleAlert,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { cn } from "@/lib/utils";
import type { LibroDelCliente } from "@/lib/reconcile";

// ─────────────────────────────────────────────────────────────────────────
// CT-22: QUIÉN ES QUIÉN LO DECIDE EL DUEÑO
//
// El importador emparejaba ÚNICAMENTE por nombre normalizado y mandaba ese id
// a `confirmImport` sin que nadie confirmara nada. En Venezuela y Colombia
// "María González" se repite: las deudas de dos personas distintas se juntaban
// en una sola ficha, sin aviso y sin vuelta atrás — los movimientos quedan
// mezclados y no hay pantalla que los separe después.
//
// Lo que lo empeoraba: la comprobación de cédula duplicada de `confirmImport`
// vive en la rama de CREAR cliente nuevo, así que cuando el nombre coincidía no
// llegaba a ejecutarse. El documento, que es el dato que decide identidad, era
// el único que no se consultaba.
//
// NO HAY OPCIÓN POR DEFECTO, y esto bloquea la confirmación mientras quede
// alguno sin decidir. Las dos respuestas se equivocan en silencio y en
// direcciones opuestas: una funde dos personas, la otra parte el historial de
// una. Un valor por defecto convierte la pregunta en un trámite que se pasa de
// largo, que es exactamente como llegamos aquí.
export type {
  DecisionDuplicado,
  EstadoTarjeta,
  ClienteConEstado,
} from "@/lib/estado-de-tarjeta";
export { conEstado } from "@/lib/estado-de-tarjeta";

import type {
  DecisionDuplicado,
  EstadoTarjeta,
  ClienteConEstado,
} from "@/lib/estado-de-tarjeta";
import { AvisoDeDuplicado } from "@/components/import/emparejar-cliente";
import type { CandidatoDuplicado } from "@/lib/reconcile";

export const CHIP: Record<EstadoTarjeta, { texto: string; clase: string }> = {
  subido: { texto: "Subido", clase: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" },
  faltan_datos: { texto: "Faltan datos", clase: "border-destructive/40 text-destructive" },
  duplicado: { texto: "¿Es el mismo?", clase: "border-amber-400/60 text-amber-700 dark:text-amber-400" },
  revisar_suma: { texto: "Revisar suma", clase: "border-destructive/40 text-destructive" },
  sin_verificar: { texto: "Sin verificar", clase: "border-amber-400/60 text-amber-700 dark:text-amber-400" },
  cuadra: { texto: "Todo cuadra", clase: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" },
};

const FONDO: Record<EstadoTarjeta, string> = {
  // Mismo verde que "Todo cuadra" pero apagado: ya no pide nada, solo deja ver
  // lo que llevas hecho.
  subido: "border-emerald-500/30 bg-emerald-50/60 dark:border-emerald-500/20 dark:bg-emerald-500/5",
  faltan_datos: "border-destructive/30 bg-destructive/5",
  duplicado: "border-amber-300 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10",
  revisar_suma: "border-destructive/30 bg-destructive/5",
  sin_verificar: "border-amber-300 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10",
  cuadra: "border-emerald-500/30 bg-emerald-50 dark:border-emerald-500/20 dark:bg-emerald-500/10",
};

function montoDeLibro(l: LibroDelCliente): string {
  return l.currency ? formatDisplayCurrency(l.totalPagina, l.currency) : formatCurrency(l.totalPagina);
}

function TarjetaCliente({
  onSubir,
  subiendo,
  cliente,
  decision,
  onDecidir,
  onVerClientes,
  onConfirmarCon,
  onAbrir,
}: {
  cliente: ClienteConEstado;
  decision: DecisionDuplicado | undefined;
  onDecidir: (d: DecisionDuplicado) => void;
  onVerClientes: () => void;
  onConfirmarCon: (c: CandidatoDuplicado) => void;
  onAbrir: () => void;
  onSubir: () => void;
  subiendo: boolean;
}) {
  const chip = CHIP[cliente.estado];
  const desajustado = cliente.libros.find((l) => l.estado === "no_cuadra");

  return (
    <div className={cn("flex flex-col gap-2 rounded-lg border p-3", FONDO[cliente.estado])}>
      {/* La cabecera entera es el botón que abre el detalle: en un teléfono, un
          objetivo de 44px de alto se acierta y una flecha de 16px no. */}
      <button
        type="button"
        onClick={onAbrir}
        className="-m-1 flex items-center gap-3 rounded-md p-1 text-left"
      >
        {/* Un cuadro con la inicial y no la miniatura de la foto: los
            movimientos no guardan de qué foto salieron, así que enseñar una
            sería elegir cualquiera. Queda anotado como pendiente. */}
        <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-background/70 text-base font-semibold text-muted-foreground">
          {cliente.name.trim().charAt(0).toUpperCase() || "?"}
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate font-semibold">{cliente.name}</span>
          <span className="text-sm text-muted-foreground">
            {cliente.movimientos} {cliente.movimientos === 1 ? "movimiento" : "movimientos"}
          </span>
        </span>

        {/* UN IMPORTE POR MONEDA, nunca sumados. Un $50 y un €20 son dos deudas
            independientes; un solo número sería inventarlo. */}
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          {cliente.libros.map((l) => (
            <span key={l.currency ?? "COP"} className="flex items-center gap-1.5 font-semibold tabular-nums">
              {montoDeLibro(l)}
              {l.currency ? <CurrencyFlagIcon currency={l.currency} className="size-4" /> : null}
            </span>
          ))}
          <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", chip.clase)}>
            {chip.texto}
          </span>
        </span>

        <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
      </button>

      {/* Lo que impide importar, en rojo y con su icono. */}
      {cliente.bloqueos.map((b) => (
        <p key={b} className="flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {b}
        </p>
      ))}

      {/* El desajuste trae las DOS cifras. Decir solo "no cuadra" obliga al
          dueño a rehacer la suma para saber de cuánto habla. */}
      {desajustado && desajustado.escrito !== null && desajustado.calculado !== null ? (
        <p className="flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          <span>
            Suma da: <strong>{montoDeLibro({ ...desajustado, totalPagina: desajustado.calculado })}</strong>
            {" | "}Tu cuenta en libreta da:{" "}
            <strong>{montoDeLibro({ ...desajustado, totalPagina: desajustado.escrito })}</strong>
          </span>
        </p>
      ) : null}

      {/* SUBIR SOLO A ESTA PERSONA. Desde el 2026-10-01 no hace falta que la
          libreta entera este perfecta para empezar a guardar: en cuanto un
          cliente tiene lo suyo, entra. La tarjeta de quien ya entro se queda en
          su sitio, sin boton y en verde apagado, para que se vea lo hecho — y
          se puede seguir abriendo para mirar lo que se subio. */}
      {cliente.subido ? null : cliente.puedeSubir ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          disabled={subiendo}
          onClick={onSubir}
        >
          Subir este cliente
        </Button>
      ) : null}

      {/* Lo que conviene mirar pero no impide nada, en ámbar. */}
      {cliente.avisos.map((a) => (
        <p key={a} className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {a}
        </p>
      ))}

      {/* El duplicado. Un candidato pregunta; varios abren la lista (CT-29).
          Sin opción marcada por defecto: ver la nota de `DecisionDuplicado`. */}
      {cliente.candidatosVisibles.length > 0 && !decision ? (
        <div className="flex flex-col gap-2 border-t border-amber-300/60 pt-2 dark:border-amber-500/20">
          <AvisoDeDuplicado
            nombreEnLaLibreta={cliente.name}
            candidatos={cliente.candidatosVisibles}
          >
            {cliente.candidatosVisibles.length > 1 ? (
              <Button type="button" size="sm" onClick={onVerClientes}>
                Ver clientes
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                onClick={() => onConfirmarCon(cliente.candidatosVisibles[0])}
              >
                Es el mismo
              </Button>
            )}
            <Button type="button" size="sm" variant="outline" onClick={() => onDecidir({ cual: "otra" })}>
              Es otra persona
            </Button>
          </AvisoDeDuplicado>
        </div>
      ) : null}

      {/* LO DECIDIDO, Y CÓMO DESDECIRSE.
          Antes solo estaba la frase, sin vuelta atrás: una vez pulsado "es otra
          persona" o "es el mismo" los botones desaparecían para siempre y la
          única salida era tirar la revisión entera con "Volver". Y toda la
          maquinaria de reconciliar contra la lista COMPLETA de clientes existe
          precisamente para que la tarjeta siga ahí y se pueda cambiar de idea —
          sin este botón esa maquinaria no servía de nada. */}
      {cliente.candidatosVisibles.length > 0 && decision ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
          <p className="text-sm text-muted-foreground">
            {decision.cual === "otra"
              ? "Se registrará como un cliente nuevo, con su propio documento."
              : `Se sumará al “${
                  cliente.candidatosVisibles.find((c) => c.id === decision.clientId)?.name ??
                  "cliente que ya tienes"
                }”.`}
          </p>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() =>
              decision.cual === "otra"
                ? cliente.candidatosVisibles.length > 1
                  ? onVerClientes()
                  : onConfirmarCon(cliente.candidatosVisibles[0])
                : onDecidir({ cual: "otra" })
            }
          >
            {decision.cual === "otra"
              ? cliente.candidatosVisibles.length > 1
                ? "Ver clientes"
                : "Es el mismo"
              : "Es otra persona"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

// Una entrada de la lista: o un cliente vivo, o uno que el dueno quito y sigue
// ahi en rojo, en su sitio, para poder recuperarlo. Mismo patron que el
// historial del detalle.
export type EntradaDeLaRevision =
  | { tipo: "cliente"; cliente: ClienteConEstado }
  | { tipo: "eliminado"; nameKey: string; nombre: string };

export function RevisarClientes({
  entradas,
  decisiones,
  onDecidir,
  onVerClientes,
  onConfirmarCon,
  onAbrir,
  onRestaurarCliente,
  onSubirCliente,
  subiendo,
}: {
  entradas: EntradaDeLaRevision[];
  decisiones: Record<string, DecisionDuplicado>;
  onDecidir: (nameKey: string, d: DecisionDuplicado) => void;
  onVerClientes: (nameKey: string) => void;
  onConfirmarCon: (nameKey: string, c: CandidatoDuplicado) => void;
  onAbrir: (nameKey: string) => void;
  onRestaurarCliente: (nameKey: string) => void;
  onSubirCliente: (nameKey: string) => void;
  subiendo: boolean;
}) {
  return (
    <div className="flex flex-col gap-3">
      {entradas.map((e) =>
        e.tipo === "cliente" ? (
          <TarjetaCliente
            key={e.cliente.nameKey}
            cliente={e.cliente}
            decision={decisiones[e.cliente.nameKey]}
            onDecidir={(d) => onDecidir(e.cliente.nameKey, d)}
            onVerClientes={() => onVerClientes(e.cliente.nameKey)}
            onConfirmarCon={(c) => onConfirmarCon(e.cliente.nameKey, c)}
            onAbrir={() => onAbrir(e.cliente.nameKey)}
            onSubir={() => onSubirCliente(e.cliente.nameKey)}
            subiendo={subiendo}
          />
        ) : (
          // EL CLIENTE QUITADO SE QUEDA A LA VISTA, en su sitio, hasta que se
          // suba la libreta. Quitar a una persona se lleva por delante todos
          // sus renglones de golpe, asi que la vuelta atras tiene que estar
          // donde estaba ella — y no en un aviso que se va solo.
          <div
            key={e.nameKey}
            className="flex items-center gap-2 rounded-lg border border-destructive/40 p-3 text-destructive"
          >
            <span className="shrink-0 font-medium">Cliente eliminado</span>
            {/* El nombre, aunque el mapa de pantallas no lo pinte: con tres
                clientes quitados, tres filas identicas no dicen cual es cual. */}
            <span className="min-w-0 flex-1 truncate text-right text-xs opacity-80">
              {e.nombre}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-destructive hover:text-destructive"
              aria-label={`Recuperar a ${e.nombre}`}
              onClick={() => onRestaurarCliente(e.nameKey)}
            >
              <RotateCcw className="size-4" />
            </Button>
          </div>
        ),
      )}
    </div>
  );
}
