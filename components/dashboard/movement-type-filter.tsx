"use client";

import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { FilterChip } from "@/components/dashboard/client-filters";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import type { PriceCurrency } from "@/lib/products/price";

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
}: {
  tipo: TipoFiltro;
  setTipo: (v: TipoFiltro) => void;
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
  // LOS CUATRO, SIEMPRE. Ni «Abono» ni «De contado» se esconden ya cuando el
  // cliente no tiene ninguno: el aviso de la lista vacía lo explica mejor que
  // una opción que aparece y desaparece según a quién se abra.
  //
  // «De contado» ESTUVO CONDICIONADO por un comentario que había dejado de
  // ser cierto: decía que la pantalla del cliente no recibe esas ventas
  // —«su RPC no las devuelve»— y sí las recibe, por `ventas_de_contado`, que
  // `/s/[token]` lee y le pasa a la lista. Se comprobó el 2026-10-23 leyendo
  // las dos pantallas, y se quitó. Es el riesgo de una condición cuya razón
  // envejece sin que nada avise: la condición seguía funcionando y protegía
  // de algo que ya no pasaba.
  const opciones = TIPOS;
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
// LOS SEIS, SIEMPRE, aunque esta lista no tenga ninguno de ese estado.
// Instrucción del dueño el 2026-10-23: *«los filtros deben mostrar todos los
// estados así no hayan transacciones en ese estado; si se aplica el filtro y
// no hay transacciones se debe mostrar empty state»*.
//
// ESTO DESPLAZA LO QUE HABÍA, que escondía las opciones vacías para no
// ofrecer un filtro que no podía dar otra cosa que una lista vacía. La razón
// vieja era buena y falla por un sitio: una opción que aparece y desaparece
// según el cliente obliga a aprender el control de nuevo en cada ficha, y no
// deja distinguir «no tiene ninguno» de «este filtro no existe». El aviso de
// abajo contesta eso en palabras, que es más barato que una lista cambiante.
//
// «Crítico» ENTRA EL MISMO DÍA. Hasta entonces ninguna fila podía decirlo
// —era un estado de la cuenta, no del fiado— y el dueño lo pidió al no
// encontrar en el historial el fiado que ponía «Crítico» a su tarjeta.
const ESTADOS = [
  { value: "todos", label: "Todas" },
  { value: "dentro_del_plazo", label: "Dentro del plazo" },
  { value: "plazo_vencido", label: "Plazo vencido" },
  { value: "sin_plazo", label: "Sin plazo" },
  { value: "critico", label: "Crítico" },
  { value: "pagado", label: "Pagado" },
  { value: "a_favor", label: "A favor" },
] as const;

export type EstadoFiltro = (typeof ESTADOS)[number]["value"];

export function MovementStatusFilter({
  estado,
  setEstado,
}: {
  estado: EstadoFiltro;
  setEstado: (v: EstadoFiltro) => void;
}) {
  const opciones = ESTADOS;

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
  estado,
  setEstado,
  moneda,
  setMoneda,
  monedas,
  codigo,
  setCodigo,
}: {
  tipo: TipoFiltro;
  setTipo: (v: TipoFiltro) => void;
  estado: EstadoFiltro;
  setEstado: (v: EstadoFiltro) => void;
  moneda: MonedaFiltro;
  setMoneda: (v: MonedaFiltro) => void;
  // Los libros que lleva este negocio. Vacío en uno colombiano, que tiene uno
  // solo: ahí el filtro no se dibuja, y no por estar vacío —ver el comentario
  // de los estados— sino porque elegir entre una cosa no es elegir.
  monedas: readonly PriceCurrency[];
  // ── EL BUSCADOR POR CÓDIGO ──────────────────────────────────────────
  //
  // Encargo del dueño el 2026-10-23: *«en el historial de transacciones
  // agregarás un filtro tipo search para escribir el código y buscar las
  // transacciones con ese código»*.
  //
  // PARA QUÉ SIRVE DE VERDAD, que no es «encontrar una transacción»: un pago
  // repartido entre tres fiados deja TRES filas que no se parecen entre sí
  // —monedas distintas, importes distintos— y nada en la lista dice que
  // fueron el mismo billete. Escribir su código las deja a las tres en
  // pantalla y a nada más. Es la única herramienta que vuelve a juntarlas.
  codigo: string;
  setCodigo: (v: string) => void;
}) {
  return (
    // SIN EL RÓTULO «Filtrar por», que se fue el 2026-10-23 por instrucción
    // del dueño. Con un solo chip explicaba para qué servía; con tres, los
    // chips se explican entre ellos y el rótulo solo gastaba ancho en la
    // única fila que tiene que caber a 375px.
    <div className="flex flex-col gap-2">
      {/* EL BUSCADOR EN SU PROPIA LÍNEA, y no como un cuarto chip: a 375px
          la fila ya lleva tres y un campo de escribir necesita ancho para
          enseñar lo que se teclea. Arriba porque es el filtro más estrecho
          de todos —deja en pantalla una transacción— y leerlo primero evita
          combinarlo sin querer con un chip puesto antes. */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={codigo}
          onChange={(e) => setCodigo(e.target.value)}
          placeholder="Buscar por código, monto o producto"
          aria-label="Buscar por código de transacción, monto o producto"
          // SIN `uppercase` DESDE EL 2026-10-23, cuando esto dejó de buscar
          // solo códigos: con nombres de producto y montos en la misma caja,
          // poner en mayúsculas lo que se teclea haría que «Agua» se viera
          // «AGUA» mientras la fila dice «Agua». La comparación ya ignora
          // mayúsculas, así que no hacía falta ni para los códigos.
          className="h-10 pl-9"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <MovementTypeFilter tipo={tipo} setTipo={setTipo} />
        <MovementStatusFilter estado={estado} setEstado={setEstado} />
        {monedas.length > 1 ? (
          <MovementCurrencyFilter moneda={moneda} setMoneda={setMoneda} monedas={monedas} />
        ) : null}
      </div>
    </div>
  );
}

// ===========================================================================
// EL FILTRO POR MONEDA
//
// *«Agregar filtro "Moneda"»* — dueño, 2026-10-23, el mismo día que el
// historial pasa a enseñar el saldo de cada libro en el pie de cada fila. Es
// su consecuencia: con dos libros mezclados en una sola lista, poder quedarse
// con uno es lo que hace legible la serie de cifras que ese pie dibuja.
//
// SOLO CON DOS LIBROS O MÁS. Un negocio colombiano lleva uno, y un desplegable
// de una sola opción no decide nada — la misma regla que ya siguen los
// selectores de moneda del abono y de la venta.
const MONEDAS: Partial<Record<PriceCurrency, string>> = {
  USD: "Dólares",
  EUR: "Euros",
  COP: "Pesos",
};
const nombreDeMoneda = (c: PriceCurrency) => MONEDAS[c] ?? c;

export type MonedaFiltro = "todas" | PriceCurrency;

export function MovementCurrencyFilter({
  moneda,
  setMoneda,
  monedas,
}: {
  moneda: MonedaFiltro;
  setMoneda: (v: MonedaFiltro) => void;
  monedas: readonly PriceCurrency[];
}) {
  const etiqueta = moneda === "todas" ? "Moneda" : nombreDeMoneda(moneda);
  return (
    <FilterChip label={etiqueta} active={moneda !== "todas"}>
      {(close) => (
        <div className="flex flex-col gap-1">
          {(["todas", ...monedas] as const).map((opt) => (
            <Button
              key={opt}
              type="button"
              variant={moneda === opt ? "secondary" : "ghost"}
              size="sm"
              className="justify-start gap-2"
              onClick={() => {
                setMoneda(opt);
                close();
              }}
            >
              {opt === "todas" ? null : <CurrencyFlagIcon currency={opt} className="size-4" />}
              {opt === "todas" ? "Todas" : nombreDeMoneda(opt)}
            </Button>
          ))}
        </div>
      )}
    </FilterChip>
  );
}

// ===========================================================================
// QUÉ DICE LA LISTA CUANDO UN FILTRO NO DEJA NADA
//
// *«Si se aplica el filtro y no hay transacciones en ese filtro se debe
// mostrar empty state mencionando que no hay transacciones en ese estado
// seleccionado»* — dueño, 2026-10-23, al abrir todas las opciones.
//
// NOMBRA LOS FILTROS PUESTOS, uno a uno, y no dice «no coincide con los
// filtros»: con tres chips encima, esa frase obliga a mirarlos de vuelta para
// saber cuál quitar. Diciendo «No hay fiados en euros en "Plazo vencido"» se
// sabe qué soltar sin levantar la vista.
//
// LO QUE NO DICE, a propósito: que el cliente no tenga NINGUNA transacción.
// Esa frase es de otro sitio —la lista vacía de verdad, que además explica
// cómo registrar la primera— y sería falsa con la lista entera a un toque.
export function tituloDeListaVacia({
  tipo,
  estado,
  moneda,
  codigo = "",
}: {
  tipo: TipoFiltro;
  estado: EstadoFiltro;
  moneda: MonedaFiltro;
  // El código tecleado, si lo hay. Por defecto vacío para que una pantalla
  // que todavía no tenga buscador siga llamando a esto igual.
  codigo?: string;
}): string {
  const sustantivo =
    tipo === "charge"
      ? "fiados"
      : tipo === "payment"
        ? "abonos"
        : tipo === "cash"
          ? "ventas de contado"
          : "transacciones";

  const partes = [`No hay ${sustantivo}`];
  // LO BUSCADO VA PRIMERO, igual que en la cadena de filtros: es el filtro
  // más estrecho, y cuando está puesto suele ser el único culpable de que la
  // lista esté vacía. Tal cual se tecleó y entre comillas, para que se vea si
  // sobra una letra.
  //
  // «que digan» Y NO «con el código», desde que esto busca también montos y
  // productos: decirle «no hay transacciones con el código "agua"» a quien
  // buscó un producto es contarle un fallo que no cometió.
  if (codigo.trim() !== "") partes.push(`que digan «${codigo.trim()}»`);
  if (moneda !== "todas") partes.push(`en ${nombreDeMoneda(moneda).toLowerCase()}`);
  if (estado !== "todos") {
    const etiqueta = ESTADOS.find((e) => e.value === estado)?.label ?? estado;
    partes.push(`en «${etiqueta}»`);
  }
  return partes.join(" ");
}
