"use client";

import { Button } from "@/components/ui/button";
import { FilterChip } from "@/components/dashboard/client-filters";

// THE HISTORY'S TYPE FILTER, asked for by the owner on 2026-10-16: "Todos",
// "Fiado" and "Abono", to the right of the history's title.
//
// IT LIVES IN ITS OWN FILE because BOTH histories mount it -- the shopkeeper's
// and the client's at `/s/[token]`. Until 2026-10-16 it was copied byte for
// byte into each list, and the copies were still identical only because nobody
// had touched one yet. The first edit that reached one and not the other would
// have given the same product two filters that behave differently, and the
// client's is the half nobody on this side looks at.
// «DE CONTADO» ENTRA EL 2026-10-18, a petición del dueño: las ventas pagadas
// enteras no salían en el historial, porque no escriben nada en `movements`
// (ver `lib/ventas-de-contado.ts`). Ahora el historial las mezcla, así que el
// filtro tiene que poder dejarlas solas.
//
// `cash` Y NO `sale`: lo que distingue a esa fila no es que venga de una venta
// —un fiado también— sino que se pagó entera en el momento.
const TIPOS = [
  { value: "todos", label: "Todas" },
  { value: "charge", label: "Fiado" },
  { value: "payment", label: "Abono" },
  { value: "cash", label: "De contado" },
] as const;

export type TipoFiltro = (typeof TIPOS)[number]["value"];

export function MovementTypeFilter({
  tipo,
  setTipo,
  conAbono,
  conContado = false,
}: {
  tipo: TipoFiltro;
  setTipo: (v: TipoFiltro) => void;
  // Si esta lista enseña abonos. La del tendero no desde el 2026-10-20 --viven
  // dentro del fiado que pagaron-- y la del cliente sí. Ver `opciones`.
  conAbono: boolean;
  // UNA OPCION QUE NO FILTRA NADA ES PEOR QUE NO TENERLA. La pantalla del
  // cliente todavía no recibe las ventas de contado --su RPC no las devuelve,
  // ver `lib/ventas-de-contado.ts`-- así que allí el chip llevaría a una lista
  // vacía y a la frase «no tiene ... registrados», que sería falsa.
  conContado?: boolean;
}) {
  // ── QUÉ OPCIONES SE OFRECEN ──────────────────────────────────────────
  //
  // `conAbono` es del 2026-10-20 y ES OBLIGATORIO en los dos sitios que
  // montan este filtro, a propósito: la primera versión quitó «Abono» de esta
  // lista sin más, y como ESTE COMPONENTE ES COMPARTIDO por las dos pantallas
  // --la del tendero y la del CLIENTE, que lo importa desde aquí-- se lo quitó
  // también al cliente, que sigue viendo sus abonos. Un filtro que falta donde
  // sí hay filas que filtrar.
  //
  // Nada avisó: `tsc` pasó, el lint pasó y las suites pasaron, porque quitar
  // una opción de un array es legal en todas partes. Solo se ve abriendo la
  // otra pantalla.
  //
  // Sin valor por defecto por la misma razón: un `= true` habría dejado al
  // tendero con su «Abono» de vuelta en silencio el día que alguien olvide
  // pasarlo, que es el mismo fallo con la otra cara.
  const opciones = TIPOS.filter(
    (t) => (t.value !== "cash" || conContado) && (t.value !== "payment" || conAbono),
  );
  // THE CHIP NAMES ITS VALUE, NEVER ITS FIELD. It used to read "Tipo" while
  // unfiltered, which answers "what does this control?" -- a question the
  // owner stopped asking the moment he saw it, and that the new "Filtrar por"
  // label now answers anyway. "Todos" answers the one that is actually live:
  // what am I looking at right now. Owner's decision, 2026-10-16.
  const etiqueta = TIPOS.find((t) => t.value === tipo)?.label ?? "Todas";

  return (
    // EL RÓTULO «Filtrar por» YA NO ESTÁ AQUÍ. Vivía dentro de este
    // componente cuando era el único filtro; desde que hay dos (2026-10-23)
    // lo pone `FiltrosDelHistorial`, una vez, para los dos chips. Dejarlo
    // aquí lo habría escrito dos veces en la misma fila.
    //
    // Sigue siendo HERMANO del chip y no parte de él: el chip se rellena
    // cuando el filtro está puesto, y un «Filtrar por» resaltado se leería
    // como parte del valor elegido.
    <>
      <FilterChip label={etiqueta} active={tipo !== "todos"}>
        {(close) => (
          <div className="flex flex-col gap-1">
            {opciones.map((opt) => (
              <Button
                key={opt.value}
                type="button"
                variant={tipo === opt.value ? "secondary" : "ghost"}
                size="sm"
                className="justify-start"
                onClick={() => {
                  setTipo(opt.value);
                  close();
                }}
              >
                {opt.label}
              </Button>
            ))}
          </div>
        )}
      </FilterChip>
    </>
  );
}

// ===========================================================================
// EL FILTRO POR ESTADO, al lado del de tipo
//
// Encargo del dueño el 2026-10-23: *«el filtro "Filtrar por" agreguemos un
// filtro por estado, también en la vista del cliente»*. Llega el mismo día
// que el chip de estado vuelve a la fila, y es su consecuencia: una vez que
// cada fiado dice en qué va, lo siguiente que se quiere es ver solo los que
// van mal.
//
// LOS CINCO QUE EXISTEN, decisión suya preguntado con las dos salidas
// delante. La alternativa era dejar fuera «A favor» —no es un estado de un
// fiado, es del saldo del cliente— y eligió que **todo chip que se ve en una
// fila se pueda filtrar**, sin excepciones que haya que explicar.
//
// VIVE EN ESTE ARCHIVO Y NO EN UNO NUEVO por lo que la cabecera de arriba
// cuenta: las dos pantallas montan los dos filtros, y dos copias que hoy son
// iguales se separan en la primera edición que llegue a una sola.
const ESTADOS = [
  { value: "todos", label: "Todas" },
  { value: "dentro", label: "Dentro del plazo" },
  { value: "vencido", label: "Plazo vencido" },
  { value: "sin_plazo", label: "Sin plazo" },
  { value: "pagado", label: "Pagado" },
  { value: "a_favor", label: "A favor" },
] as const;

export type EstadoFiltro = (typeof ESTADOS)[number]["value"];

export function MovementStatusFilter({
  estado,
  setEstado,
  // LOS ESTADOS QUE DE VERDAD HAY EN ESTA LISTA. Misma razón que `conAbono`
  // en el filtro de al lado: ofrecer «Pagado» a un cliente que no tiene
  // ninguno saldado da una lista vacía por un filtro que no podía dar otra
  // cosa. Entra como argumento obligatorio para que nadie se lo deje puesto
  // por defecto y la opción reaparezca en silencio.
  disponibles,
}: {
  estado: EstadoFiltro;
  setEstado: (v: EstadoFiltro) => void;
  disponibles: ReadonlySet<string>;
}) {
  const opciones = ESTADOS.filter((e) => e.value === "todos" || disponibles.has(e.value));

  // SIN FILTRO DICE «Estado», Y ESO CONTRADICE AL CHIP DE AL LADO a propósito.
  //
  // La regla del 2026-10-16 es que el chip nombra su VALOR y no su campo:
  // «Todas» contesta «qué estoy mirando» en vez de «para qué sirve esto».
  // Vale con un chip. Con dos, los dos dirían «Todas» y no habría forma de
  // saber cuál es cuál — que es lo que se vio en pantalla al montarlos.
  //
  // Así que el de tipo se queda como está —es el que llevaba ahí desde
  // octubre— y este nombra su campo mientras no filtre nada. **En cuanto se
  // elige algo vuelve a nombrar su valor**: «Plazo vencido», no «Estado:
  // Plazo vencido». La regla sigue valiendo donde importa, que es cuando hay
  // un filtro puesto y hay que poder leerlo de un vistazo.
  const etiqueta = estado === "todos" ? "Estado" : (ESTADOS.find((e) => e.value === estado)?.label ?? "Estado");

  return (
    <FilterChip label={etiqueta} active={estado !== "todos"}>
      {(close) => (
        <div className="flex flex-col gap-1">
          {opciones.map((opt) => (
            <Button
              key={opt.value}
              type="button"
              variant={estado === opt.value ? "secondary" : "ghost"}
              size="sm"
              className="justify-start"
              onClick={() => {
                setEstado(opt.value);
                close();
              }}
            >
              {opt.label}
            </Button>
          ))}
        </div>
      )}
    </FilterChip>
  );
}

// ===========================================================================
// LOS DOS FILTROS, EN UNA FILA Y DEBAJO DEL TÍTULO
//
// *«Bajemos los filtros para abajo del título de la sección "Historial de
// transacciones"»* — dueño, 2026-10-23. Hasta ese día el filtro de tipo iba a
// la DERECHA del título, en la misma línea. Con dos chips ahí ya no caben a
// 375px sin partir el título, así que bajan los dos juntos.
//
// Y BAJAN COMO UN SOLO COMPONENTE, no como dos sueltos en cada lista: es el
// único sitio donde consta que «Filtrar por» se escribe una vez y que el
// orden es tipo y luego estado. Las dos pantallas que lo montan no pueden
// ordenarlos distinto ni duplicar el rótulo.
export function FiltrosDelHistorial({
  tipo,
  setTipo,
  conAbono,
  conContado = false,
  estado,
  setEstado,
  estadosDisponibles,
}: {
  tipo: TipoFiltro;
  setTipo: (v: TipoFiltro) => void;
  conAbono: boolean;
  conContado?: boolean;
  estado: EstadoFiltro;
  setEstado: (v: EstadoFiltro) => void;
  estadosDisponibles: ReadonlySet<string>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted-foreground">Filtrar por</span>
      <MovementTypeFilter
        tipo={tipo}
        setTipo={setTipo}
        conAbono={conAbono}
        conContado={conContado}
      />
      <MovementStatusFilter
        estado={estado}
        setEstado={setEstado}
        disponibles={estadosDisponibles}
      />
    </div>
  );
}
