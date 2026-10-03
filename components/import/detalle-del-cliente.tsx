"use client";

import { useState } from "react";
import {
  CircleAlert,
  Eye,
  Pencil,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useLongPress } from "@/hooks/use-long-press";
import {
  alternar,
  podarSeleccion,
  textoDeEliminar,
  textoDeMoneda,
  textoDeSeleccion,
} from "@/lib/seleccion-de-movimientos";
import { Label } from "@/components/ui/label";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { DocumentIdInput } from "@/components/dashboard/document-id-input";
import { WhatsappInput } from "@/components/whatsapp-input";
import { EditarMovimiento } from "@/components/import/editar-movimiento";
import { fechaDeLaLibreta } from "@/lib/fecha-de-libreta";
import {
  CHIP,
  type DecisionDuplicado,
  type EstadoTarjeta,
} from "@/components/import/revisar-clientes";
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
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { cn } from "@/lib/utils";
import type { ExtractedMovement, LedgerCurrency, OwnerCountry } from "@/lib/types";
import {
  AvisoDeDocumentoRepetido,
  AvisoDeDuplicado,
  FichaDeCliente,
  loQueDebe,
} from "@/components/import/emparejar-cliente";
import { BotonDeshacer } from "@/components/import/boton-deshacer";
import type {
  CandidatoDuplicado,
  ClienteRevisado,
  LibroDelCliente,
  ReviewRow,
} from "@/lib/reconcile";

// ─────────────────────────────────────────────────────────────────────────
// "REGISTRAR MOVIMIENTOS": el detalle de UN cliente
//
// Los datos de la persona se piden UNA vez arriba; abajo, el historial, que es
// una lista de renglones que se leen de un vistazo. Lo que se edita de un
// movimiento —tipo, monto, moneda, descripción— vive en su propia hoja
// (`EditarMovimiento`), porque una libreta de seis páginas son cuarenta
// renglones y con cuatro campos abiertos en cada uno la pantalla mide metros.
function importeDe(n: number, currency: LedgerCurrency | null): string {
  return currency ? formatDisplayCurrency(n, currency) : formatCurrency(n);
}

export type EleccionDeTotal = "libreta" | "suma";

// Lo que hay que recordar de una decisión ya tomada.
//
// Las dos cifras se guardan al decidir, no se vuelven a leer del libro: en
// cuanto se elige "mi libreta" y entra la línea de ajuste, las cuentas cuadran
// y `escrito`/`calculado` pasan a null — el libro ya no tiene desajuste que
// contar. Sin guardarlas, el bloque decía "tu libreta dice $140 y estos montos
// suman $140" y ofrecía "un ajuste de $0,00". Visto en dev.
export type DecisionDeTotal = {
  cual: EleccionDeTotal;
  escrito: number;
  calculado: number;
  // El importe al que el ajuste se rehizo solo, cuando el dueno toco un monto
  // DESPUES de haber elegido. Null mientras nadie lo haya movido.
  rehechoA?: number | null;
};

// Una entrada del historial: o una fila viva, o una que el dueño quitó y sigue
// ahí en rojo para poder recuperarla. Se intercalan en el orden de la libreta,
// que es el mismo en el que se leyeron.
export type EntradaDelHistorial =
  | { tipo: "fila"; fila: ReviewRow }
  | { tipo: "eliminado"; mov: ExtractedMovement };

// ── El desajuste, y cuál de los dos números manda ──────────────────────
//
// LOS DOS CHECKS SE QUEDAN SIEMPRE, también después de elegir. Si desaparecieran
// al responder, la decisión quedaría tomada sin forma de verla ni de cambiarla,
// y la línea de ajuste aparecería en el historial sin que nada en pantalla
// explicara de dónde salió.
function DecisionDelTotal({
  escrito,
  calculado,
  currency,
  decidido,
  onElegir,
}: {
  escrito: number;
  calculado: number;
  currency: LedgerCurrency | null;
  decidido: DecisionDeTotal | undefined;
  onElegir: (cual: EleccionDeTotal) => void;
}) {
  // Las dos cifras llegan YA RESUELTAS: cuando hay decision, `import-flow` las
  // saca del libro sombra —el que se calcula sin las lineas de ajuste— en vez
  // de las que se guardaron al decidir. Congelarlas dejaba el panel diciendo
  // "la suma de Sevenz: $70" despues de que el dueno corrigiera un monto.
  const esc = decidido ? decidido.escrito : escrito;
  const cal = decidido ? decidido.calculado : calculado;
  const diferencia = esc - cal;

  const opciones = [
    {
      cual: "libreta" as const,
      titulo: "Mi libreta subida",
      importe: esc,
      // Se dice ANTES de marcarlo lo que va a pasar, porque lo que pasa es que
      // aparece un movimiento nuevo en la cuenta de una persona.
      pie: `Agregaremos un movimiento por valor de ${importeDe(Math.abs(diferencia), currency)} para que cuadren las cuentas`,
    },
    {
      cual: "suma" as const,
      titulo: "La suma de Sevenz",
      importe: cal,
      pie: null,
    },
  ];

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <p className="flex items-start gap-1.5 text-sm text-destructive">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          Tu libreta subida dice <strong>{importeDe(esc, currency)}</strong> para un total de{" "}
          <strong>{importeDe(cal, currency)}</strong>. ¿Cuál es el correcto?
        </span>
      </p>

      {opciones.map((o) => (
        <label
          key={o.cual}
          className="flex cursor-pointer items-start gap-2.5 border-t pt-2 first-of-type:border-t-0 first-of-type:pt-0"
        >
          <Checkbox
            checked={decidido?.cual === o.cual}
            onCheckedChange={(v) => v === true && onElegir(o.cual)}
            className="mt-0.5"
          />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="text-sm font-medium">{o.titulo}</span>
            {o.pie ? <span className="text-xs text-muted-foreground">{o.pie}</span> : null}
          </span>
          <span className="shrink-0 font-semibold tabular-nums">
            {importeDe(o.importe, currency)}
          </span>
        </label>
      ))}
    </div>
  );
}

// Los totales, UNO POR MONEDA y nunca sumados entre sí. Un $50 y un €20 son dos
// deudas independientes; sumarlos daría "70" de nada, y el número saldría
// plausible, que es lo que lo hace peligroso.
function Totales({
  libros,
  decisiones,
  subido = false,
}: {
  libros: LibroDelCliente[];
  decisiones: Record<string, React.ComponentProps<typeof DecisionDelTotal> | undefined>;
  // Ya entro en la base: la pregunta de que total manda ya se respondio y no se
  // puede cambiar. Dejar las dos casillas ahi seria un control que se deja
  // pulsar y no hace nada.
  subido?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2">
      {libros.map((l) => {
        const decision = decisiones[l.currency ?? "COP"];
        return (
          <div key={l.currency ?? "COP"} className="flex flex-col gap-2">
            {decision && !subido ? <DecisionDelTotal {...decision} /> : null}

            <div className="flex flex-col gap-1 rounded-lg border p-3">
              {libros.length > 1 && l.currency ? (
                <p className="flex items-center gap-1.5 text-sm font-medium">
                  <CurrencyFlagIcon currency={l.currency} className="size-4" />
                  {l.currency === "USD" ? "Dólares" : "Euros"}
                </p>
              ) : null}

              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Debía en Sevenz</span>
                <span className="tabular-nums">{importeDe(l.saldoPrevio, l.currency)}</span>
              </div>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>Subido desde libreta</span>
                <span className="tabular-nums">
                  {l.totalPagina >= 0 ? "+" : "-"}
                  {importeDe(Math.abs(l.totalPagina), l.currency)}
                </span>
              </div>
              {/* El nombre del total depende del signo: "Queda debiendo -€30,00"
                  no es una deuda negativa, es que el cliente pagó de más. El
                  resto de la app ya lo dice como "A favor". */}
              <div className="flex items-center justify-between border-t pt-1 font-semibold">
                <span>
                  {l.saldoFinal > 0
                    ? "Queda debiendo"
                    : l.saldoFinal < 0
                      ? "Queda a favor"
                      : "Queda sin deuda"}
                </span>
                <span className="tabular-nums">
                  {l.saldoFinal === 0 ? "" : importeDe(Math.abs(l.saldoFinal), l.currency)}
                </span>
              </div>

              {l.estado === "sin_verificar" ? (
                <p className="flex items-start gap-1.5 pt-1 text-sm text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                  Esta libreta no traía totales con los que comparar, así que esta cuenta no se
                  pudo verificar.
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Un renglón del historial. Se lee, no se edita: el lápiz abre la hoja donde sí.
function FilaMovimiento({
  fila,
  esAjuste,
  soloLectura = false,
  onEditar,
  onEliminar,
  seleccionable = false,
  enSeleccion = false,
  seleccionada = false,
  onEmpezarSeleccion,
  onAlternar,
}: {
  fila: ReviewRow;
  // La línea de ajuste la calculó Sevenz, no la leyó de la libreta.
  esAjuste: boolean;
  // El cliente ya se subio: el renglon se lee y nada mas. Editarlo aqui no
  // tocaria la fila que ya esta en la base.
  soloLectura?: boolean;
  onEditar: () => void;
  onEliminar: () => void;
  // ── CT-21 ──
  // Un renglón ya subido no se puede quitar ni cambiar de moneda, así que
  // dejarlo marcar sería ofrecer acciones que luego no se pueden ejecutar.
  seleccionable?: boolean;
  enSeleccion?: boolean;
  seleccionada?: boolean;
  onEmpezarSeleccion?: () => void;
  onAlternar?: () => void;
}) {
  const fecha = fechaDeLaLibreta(fila.date);
  const esCargo = fila.type === "charge";
  // La pulsación larga solo arma el modo; una vez dentro, un toque normal marca
  // y desmarca, que es como se comporta cualquier lista de fotos del teléfono.
  const pulsacion = useLongPress(() => onEmpezarSeleccion?.(), seleccionable && !enSeleccion);
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg border p-3",
        fila.review_reason === "no_cuadra"
          ? "border-destructive/30 bg-destructive/5"
          : fila.needs_review
            ? "border-amber-300 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10"
            : undefined,
        // SIN ARO NI FONDO PROPIO en la fila marcada: la casilla es la marca,
        // como en el diseño entregado el 2026-10-02. La primera versión le puso
        // un `ring` y a 375px competía con los fondos que la fila YA usa para
        // decir otra cosa —rojo "no cuadra", ámbar "revisar"—, que es
        // información que no se puede tapar por señalar una selección.
      )}
      {...(enSeleccion ? {} : pulsacion.props)}
      onClick={enSeleccion ? onAlternar : undefined}
    >
      {/* EN MODO SELECCIÓN LA CASILLA SUSTITUYE A LOS BOTONES de la derecha, no
          se suma a ellos. Con ambos, el renglón tendría tres objetivos táctiles
          en 375px y el de en medio sería el de borrar. */}
      {enSeleccion ? (
        <Checkbox
          checked={seleccionada}
          // El contenedor ya alterna con su `onClick`: aquí solo hay que evitar
          // que el toque cuente dos veces y se quede como estaba.
          onClick={(e) => e.stopPropagation()}
          onCheckedChange={() => onAlternar?.()}
          aria-label={`Seleccionar ${esCargo ? "fiado" : "abono"}${fila.description ? ` ${fila.description}` : ""}`}
          className="shrink-0"
        />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <p className="truncate text-sm font-medium">
          {esCargo ? "Fiado" : "Abono"}
          {fila.description ? ` · ${fila.description}` : ""}
        </p>
        {fecha ? <p className="text-xs text-muted-foreground">{fecha}</p> : null}
      </div>

      <span
        className={cn(
          "flex shrink-0 items-center gap-1 text-sm font-medium tabular-nums",
          esCargo ? "text-destructive" : "text-money-in",
        )}
      >
        {esCargo ? "+" : "-"}
        {importeDe(fila.amount, fila.currency)}
        {fila.currency ? <CurrencyFlagIcon currency={fila.currency} className="size-4" /> : null}
      </span>

      {/* En modo selección no hay acciones por fila: la acción vive en el pie y
          se aplica a lo marcado. */}
      {enSeleccion ? null : (
      <>
      {/* EL LÁPIZ SIEMPRE, LA PAPELERA NO PARA EL AJUSTE.
          No es un renglón de la libreta, es la cuenta que hizo Sevenz para
          llegar al total que el dueño dijo que era el bueno. Editarla rompe
          justo eso: en dev se vio una de $15 cambiada a $150, y la pantalla
          quedó diciendo a la vez "agregaremos un movimiento de $15" y "con
          estos montos da $275". Dos cifras contradictorias sobre la deuda de
          una persona, sin nada que avisara.
          Y no es un callejón sin salida: para quitarla se cambia la decisión a
          "La suma de Sevenz" ahí abajo, que es de donde salió. */}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        aria-label={esAjuste || soloLectura ? "Ver este movimiento" : "Editar este movimiento"}
        onClick={onEditar}
      >
        {/* EL ICONO DICE LO QUE EL BOTÓN HACE. Cuando la fila es de solo lectura
            —el cliente ya se subió, o es la línea de ajuste— el lápiz promete
            una edición que no existe: se abre la hoja y no deja cambiar nada. El
            `aria-label` ya decía "Ver"; el icono no. Reportado el 2026-10-02. */}
        {esAjuste || soloLectura ? <Eye className="size-4" /> : <Pencil className="size-4" />}
      </Button>
      {esAjuste || soloLectura ? null : (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0"
          aria-label="Quitar este movimiento"
          onClick={onEliminar}
        >
          <Trash2 className="size-4" />
        </Button>
      )}
      </>
      )}
    </div>
  );
}

export function DetalleDelCliente({
  cliente,
  estado,
  candidatos,
  onVerClientes,
  onConfirmarCon,
  cuentaSeparada,
  onCuentaSeparada,
  duplicadosPorDocumento,
  decision,
  onDecidir,
  entradas,
  country,
  showCurrency,
  clienteCompartido,
  isLinked,
  onToggleLinked,
  onUpdate,
  onRemove,
  onRestaurar,
  esAjuste,
  onEliminarCliente,
  onRenombrar,
  bloqueos,
  pasosParaDeshacer,
  onDeshacer,
  onAplicarMoneda,
  onEliminarVarios,
  seleccion: seleccionCruda,
  setSeleccion,
  decisionesDeTotal,
  onElegirTotal,
  accionSubir,
  subido = false,
}: {
  cliente: ClienteRevisado;
  estado: EstadoTarjeta;
  // El cliente existente que se le parece, y qué dijo el dueño. Vienen APARTE
  // de `cliente.candidato`: ese desaparece en cuanto se responde "es otra
  // persona" —y tiene que desaparecer, o el saldo previo de la otra persona se
  // colaría en los totales—, pero la pregunta sigue en pantalla para poder
  // cambiar de idea.
  candidatos: CandidatoDuplicado[];
  onVerClientes: () => void;
  onConfirmarCon: (c: CandidatoDuplicado) => void;
  // CT-29b. Si ya dijo que si a una cuenta aparte con la misma cedula, y como
  // se dice que si.
  cuentaSeparada: boolean;
  onCuentaSeparada: () => void;
  // Llega como prop y no dentro de `cliente` porque la hoja recibe un
  // `ClienteRevisado` pelado —sin el estado de la tarjeta—, y ese calculo vive
  // en `conEstado`, que solo corre para la lista.
  duplicadosPorDocumento: CandidatoDuplicado[];
  decision: DecisionDuplicado | undefined;
  onDecidir: (d: DecisionDuplicado) => void;
  // El historial en el orden de la libreta, con los quitados intercalados.
  entradas: EntradaDelHistorial[];
  country: OwnerCountry;
  showCurrency: boolean;
  clienteCompartido: boolean;
  isLinked: (rowId: string) => boolean;
  onToggleLinked: (rowId: string) => void;
  // Por `rowId`, nunca por posición: este componente recibe un subconjunto, y
  // con índices la edición aterrizaba en otro cliente. Pasó el 2026-09-28.
  onUpdate: (rowId: string, patch: Partial<ExtractedMovement>) => void;
  onRemove: (rowId: string) => void;
  onRestaurar: (rowId: string) => void;
  // Qué renglones los puso Sevenz para cuadrar, y por tanto no se editan.
  esAjuste: (rowId: string) => boolean;
  onEliminarCliente: () => void;
  onRenombrar: (nombre: string) => void;
  // Lo que impide subir a ESTE cliente. Se enseña el primero: el detalle
  // resuelve de uno en uno y cuatro avisos a la vez no dicen por dónde empezar.
  bloqueos: string[];
  pasosParaDeshacer: number;
  onDeshacer: () => void;
  // CT-21: recibe sobre QUE filas actua. Con seleccion son las marcadas; sin
  // ella, todas las del cliente. El mismo control hace dos cosas, y por eso el
  // que decide cuales es quien sabe si hay seleccion, no quien aplica.
  onAplicarMoneda: (rowIds: string[], moneda: LedgerCurrency) => void;
  // CT-21. Una sola llamada con todos los ids, no una por fila: asi eliminar
  // doce es UN paso de deshacer. Doce pasos obligarian a pulsar doce veces para
  // volver atras de una sola decision.
  onEliminarVarios: (rowIds: string[]) => void;
  // CT-21. Sube al padre para que el «atras» del telefono se resuelva en el
  // guardia que ya existe, sin una segunda entrada en el historial.
  seleccion: Set<string>;
  setSeleccion: (next: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  decisionesDeTotal: Record<string, DecisionDeTotal | undefined>;
  onElegirTotal: (libro: LibroDelCliente, cual: EleccionDeTotal) => void;
  accionSubir: React.ReactNode;
  // Ya entro en la base. La hoja se queda abrible —para ver QUE se subio— pero
  // sin nada que tocar: editar aqui no cambiaria la fila ya guardada, y ofrecer
  // "Eliminar" sobre algo que ya existe es prometer un deshacer que no hay.
  subido?: boolean;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  // ── CT-21: la seleccion VIVE EN EL PADRE, y no fue la primera idea ──────
  //
  // Empezo aqui, local, porque cerrar la hoja la borraba sola. El fallo salio
  // probandolo: el boton «atras» del telefono tiene que deshacer la seleccion, y
  // para interceptarlo hace falta meter una entrada en el historial... que es
  // exactamente lo que `use-trampa-de-atras.ts` ya hace para la revision entera.
  //
  // Dos manipulaciones del historial a la vez se pisan: al gastar la mia con
  // `history.back()`, el `popstate` despertaba al guardia de la revision y
  // saltaba «¿Salir sin subir la libreta?» al deseleccionar. La cabecera de ese
  // archivo lo avisa con todas las letras — "dos copias de una manipulacion del
  // historial con este nivel de sutileza es exactamente como aparece el proximo
  // fallo" — y aqui apareció.
  //
  // Asi que no hay segunda trampa: la seleccion sube a `import-flow`, que
  // envuelve el guardia que YA existe. Ver `guardConSeleccion` alli.

  const filas = entradas.flatMap((e) => (e.tipo === "fila" ? [e.fila] : []));
  const documentoEscrito = filas.find((f) => f.document_id?.trim())?.document_id ?? "";
  // La cédula que YA está guardada en la ficha. No viene en las filas: la
  // extracción nunca lee un documento de la foto. Sin esto el campo salía vacío
  // para un cliente que la tiene, con un pie hablando de "cambiarlo".
  // SIN RESPUESTA NO HAY CAMPOS. Mientras no se diga si es la misma persona, no
  // se sabe de quién son la cédula y el teléfono que se verían: los del cliente
  // que ya existe, o los de alguien nuevo que todavía no tiene ninguno.
  // Enseñar unos cualesquiera es invitar a escribir sobre la ficha equivocada.
  const sinDecidir = candidatos.length > 0 && !decision;
  // "Es el mismo": se enseña lo que ya está guardado y no se toca. La 073 solo
  // rellena documentos y teléfonos que estén en null, así que un campo editable
  // sobre un valor YA GUARDADO aceptaría el cambio y lo tiraría en silencio.
  //
  // PERO SOLO CUANDO HAY ALGO GUARDADO. Bloquearlo por el mero hecho de ser el
  // mismo cliente dejaba un callejón sin salida, medido en dev el 2026-10-01:
  // un cliente que ya existe y NO tiene cédula pedía la cédula para poder
  // importar —"Confirmar y subir" deshabilitado— con el único campo donde
  // escribirla bloqueado. La migración sí la habría guardado: los dos updates de
  // la 076 llevan `where ... is null`. Las únicas salidas eran quitar al cliente
  // de la tanda o decir "es otra persona" y duplicarlo.
  // Con cual se emparejo, si se emparejo. De el salen la cedula y el WhatsApp
  // que se enseñan bloqueados: son los de ESA ficha, no los de "alguna".
  const emparejadoCon =
    decision?.cual === "mismo"
      ? (candidatos.find((c) => c.id === decision.clientId) ?? null)
      : null;
  const esElMismo = emparejadoCon !== null;
  const documentoGuardado = esElMismo ? (emparejadoCon?.document_id ?? null) : null;
  const whatsappGuardado = esElMismo ? (emparejadoCon?.whatsapp?.trim() || null) : null;
  const exigeDocumento = cliente.necesitaDocumento && !documentoEscrito.trim();

  const monedas = new Set(filas.map((f) => f.currency));
  const monedaDelCliente = monedas.size === 1 ? [...monedas][0] : null;

  // ── CT-21, la parte que evita los fantasmas ────────────────────────────
  //
  // La seleccion se filtra contra lo que hay VIVO en cada render en vez de
  // limpiarse a mano. Sin esto, eliminar lo marcado dejaria el contador
  // diciendo "4 seleccionados" sobre una lista donde no queda ninguno, y el
  // boton actuaria sobre ids que ya no existen. Ver `lib/seleccion-de-movimientos.ts`.
  // Un cliente ya subido no tiene nada que seleccionar: sus filas ya estan en
  // la base y ni se quitan ni cambian de moneda desde aqui.
  const seleccionables = subido ? [] : filas.map((f) => f.rowId);
  const seleccion = podarSeleccion(seleccionCruda, seleccionables);
  const enSeleccion = seleccion.size > 0;
  const idsSeleccionados = [...seleccion];
  // Las que recibiran la moneda: las marcadas, o todas las del cliente.
  const alcanceDeMoneda = enSeleccion ? idsSeleccionados : filas.map((f) => f.rowId);


  const chip = CHIP[estado];
  const filaEditandose = filas.find((f) => f.rowId === editando) ?? null;

  return (
    // `px-4`: `SheetContent` no trae ningún margen lateral propio — solo
    // `SheetHeader` lo pone, y por eso el título respiraba y las tarjetas de
    // abajo tocaban el borde de la pantalla.
    <div className="flex flex-col gap-4 px-4 pb-2">
      {/* ── Quién ──────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {/* EL NOMBRE SE EDITA SIEMPRE, pedido el 2026-10-02. Era un `h2` fijo,
              así que un nombre mal leído por la IA —o una grafía que hay que
              igualar a la de una ficha existente— solo se podía corregir
              quitando al cliente y volviendo a empezar.
              `onBlur` y no `onChange`: el nombre ES la clave de agrupación, y
              reagrupar en cada tecla partiría la tarjeta en "K", "Ka", "Kar"
              mientras se escribe. Se aplica al salir del campo o con Enter. */}
          {subido ? (
            <h2 className="truncate text-xl font-semibold">{cliente.name}</h2>
          ) : (
            <input
              aria-label="Nombre del cliente"
              defaultValue={cliente.name}
              key={cliente.name}
              onBlur={(e) => onRenombrar(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              className="w-full min-w-0 truncate rounded-md border border-transparent bg-transparent px-1 py-0.5 text-xl font-semibold hover:border-border focus:border-border focus:outline-none"
            />
          )}
          <p className="text-sm text-muted-foreground">
            {filas.length} {filas.length === 1 ? "movimiento" : "movimientos"}
            {filas.length === 1 ? " registrado" : " registrados"}
          </p>
          <span
            className={cn(
              "w-fit rounded-full border px-2 py-0.5 text-xs font-medium",
              chip.clase,
            )}
          >
            {chip.texto}
          </span>
        </div>

        {/* Quitar a esta persona entera de la subida. Con confirmación y no con
            deshacer, al revés que un movimiento suelto: aquí se van de golpe
            todos sus renglones, y una tanda revisada durante media hora no
            debería poder perder un cliente completo de un roce.

            No sale si ya se subio: sus movimientos estan en la base y quitar la
            tarjeta no los sacaria de ahi. Seria un boton que promete deshacer
            algo que no deshace. */}
        {subido ? null : (
        <div className="flex shrink-0 items-center gap-2">
        {/* El deshacer, a la IZQUIERDA de "Eliminar" (CT-31). Se queda a la
            vista y apagado cuando no hay nada que deshacer: si apareciera y
            desapareciera movería el botón de eliminar, y eso es un toque en el
            sitio equivocado sobre una acción que borra. */}
        <BotonDeshacer
          pasos={pasosParaDeshacer}
          onDeshacer={onDeshacer}
          className="size-9 shrink-0 rounded-full"
        />
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="shrink-0">
              Eliminar
              <Trash2 className="size-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Quitar a {cliente.name} de esta subida?</AlertDialogTitle>
              <AlertDialogDescription>
                Se quitan sus {filas.length}{" "}
                {filas.length === 1 ? "movimiento" : "movimientos"} y no se guardará nada suyo. El
                resto de la libreta se sube igual. La foto no se borra: puedes volver a empezar la
                revisión si te equivocas.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={onEliminarCliente}>Quitar</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        </div>
        )}
      </div>

      {/* ── ¿Es el mismo, o es otra persona? ───────────────────────────
          Ámbar y no rojo: no es un dato que falte, es una pregunta que solo el
          dueño puede responder. Sin marcar por defecto — las dos respuestas se
          equivocan en silencio y en direcciones opuestas: una funde a dos
          personas en una ficha, la otra parte el historial de una. */}
      {/* Nada de esto sale si el cliente ya entro: la pregunta del duplicado se
          respondio antes de subir, y volver a mostrarla invita a cambiar algo
          que ya no se puede cambiar. */}
      {candidatos.length > 0 && !subido ? (
        <div className="flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
          <p className="font-semibold">¿Es el mismo?</p>
          {/* RADIOS, NO BOTONES. Esto fueron dos `Button` durante unas horas,
              por un razonamiento mio que resulto equivocado: que, como elegir
              abre una confirmacion, era una accion. Lo que queda guardado es un
              VALOR, y la regla del design system ya lo decia. El sintoma: tras
              pulsar "Es otra persona" los dos botones seguian ahi, iguales, sin
              marca de lo elegido. Reportado el 2026-10-02. */}
          <AvisoDeDuplicado
            nombreEnLaLibreta={cliente.name}
            candidatos={candidatos}
            elegido={decision?.cual}
            onElegirMismo={() =>
              candidatos.length > 1 ? onVerClientes() : onConfirmarCon(candidatos[0])
            }
            onElegirOtra={() => onDecidir({ cual: "otra" })}
            // La misma ficha que la tarjeta de la lista, y por lo mismo: la
            // cedula y el saldo son lo que deja comprobar que es la persona
            // correcta cuando el nombre se repite. Aqui SIN boton de subir —
            // ese ya esta en el pie de la hoja, y dos botones que hacen lo
            // mismo a dos dedos de distancia es un toque en el equivocado.
            fichaEmparejada={
              emparejadoCon ? (
                <div className="flex flex-col gap-1.5">
                  <p className="text-xs text-muted-foreground">
                    {/* CT-33. Se repite aqui lo que dijo el dialogo de
                        confirmacion: ese se cierra y la tarjeta se queda, y sin
                        esta linea la unica pista de que se va a recuperar a
                        alguien seria una etiqueta gris en la ficha. */}
                    {emparejadoCon.hidden
                      ? "Se recuperará y se emparejará con:"
                      : "Emparejado con:"}
                  </p>
                  <FichaDeCliente
                    nombre={emparejadoCon.name}
                    documento={emparejadoCon.document_id}
                    whatsapp={emparejadoCon.whatsapp}
                    debe={loQueDebe(emparejadoCon)}
                    oculto={emparejadoCon.hidden ?? null}
                  />
                </div>
              ) : null
            }
          />
        </div>
      ) : null}

      {/* ── Sus datos, una sola vez ──────────────────────────────────────
          No salen hasta que la pregunta de arriba esté respondida. */}
      {sinDecidir || subido ? null : clienteCompartido ? (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          La cédula y el WhatsApp de este cliente se escriben arriba, en la lista, porque marcaste
          que todos los movimientos son de la misma persona.
        </p>
      ) : (
        <div className="flex flex-col gap-3 rounded-lg border p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="detalle-documento" className="text-xs">
              Documento
            </Label>
            {/* La de un cliente que ya existe SE ENSEÑA, no se edita: la 073
                solo rellena documentos que estén en null, así que un campo
                editable aceptaría el cambio y lo tiraría en silencio. */}
            <DocumentIdInput
              id="detalle-documento"
              country={country}
              disabled={Boolean(documentoGuardado)}
              value={documentoGuardado ?? documentoEscrito}
              onChange={(next) => {
                for (const f of filas) onUpdate(f.rowId, { document_id: next || null });
              }}
              invalid={exigeDocumento}
            />
            {documentoGuardado ? (
              <p className="text-xs text-muted-foreground">
                Para cambiarlo, entra al cliente desde Clientes cuando termines de subir la libreta.
              </p>
            ) : exigeDocumento ? (
              <p className="text-xs text-destructive">
                {/* A un cliente que YA existe no se le llama nuevo: la pantalla
                    acababa de decir "ya tienes un X en tus clientes" y dos líneas
                    después lo contradecía. */}
                {esElMismo
                  ? "Este cliente todavía no tiene cédula guardada. Escríbela para poder importar."
                  : "Es un cliente nuevo. Sin cédula no se puede importar."}
              </p>
            ) : null}

            {/* CT-29b: PEGADO AL CAMPO QUE LO DISPARA, y no arriba con la
                pregunta del nombre. Esta la provoca lo que ella acaba de
                teclear, asi que la respuesta tiene que leerse donde esta la
                causa: subirla al bloque ambar de arriba la separaria del campo
                y pareceria otra vez la misma pregunta. */}
            {duplicadosPorDocumento.length > 0 ? (
              <div className="mt-1 flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/20 dark:bg-amber-500/10">
                <AvisoDeDocumentoRepetido
                  documento={documentoGuardado ?? documentoEscrito}
                  candidatos={duplicadosPorDocumento}
                  elegido={cuentaSeparada ? "separada" : undefined}
                  onElegirCliente={onConfirmarCon}
                  onElegirSeparada={onCuentaSeparada}
                />
                {cuentaSeparada ? (
                  <p className="text-sm text-muted-foreground">
                    Se creará una cuenta aparte con la misma cédula. Las dos quedarán en tu lista
                    de clientes.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="detalle-whatsapp" className="text-xs">
              WhatsApp (opcional)
            </Label>
            <WhatsappInput
              // `key`: `defaultValue` solo se lee al montar, asi que al cambiar
              // de "es el mismo" a "es otra persona" el campo se quedaria con el
              // numero del otro cliente. Cambiar la key lo vuelve a montar.
              key={esElMismo ? "guardado" : "nuevo"}
              id="detalle-whatsapp"
              name="detalle-whatsapp"
              disabled={Boolean(whatsappGuardado)}
              preferredDialCode={OWNER_COUNTRY_DIAL_CODE[country]}
              defaultValue={
                whatsappGuardado ?? filas.find((f) => f.whatsapp?.trim())?.whatsapp ?? null
              }
              onValueChange={(v) => {
                for (const f of filas) onUpdate(f.rowId, { whatsapp: v.trim() || null });
              }}
            />
            {cliente.faltaWhatsapp ? (
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                Todavía no enviamos avisos de cobro a tus clientes, pero lo haremos pronto. Si
                registras su WhatsApp ahora, no tendrás que volver a pasar por aquí.
              </p>
            ) : null}
          </div>
        </div>
      )}

      {/* ── Movimientos ────────────────────────────────────────────────── */}
      {/* Era "Historial" hasta el 2026-10-02. El nombre viejo describía una
          lista que solo se lee; desde CT-21 es la lista sobre la que se actúa,
          y el título tiene que decir eso antes de que nadie toque nada. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">Movimientos</p>
          {/* EL CONTADOR Y SU SALIDA, EN LA MISMA FILA. Un modo en el que se ha
              entrado por un gesto que no se ve tiene que decir dos cosas a la
              vez: en qué modo estás, y cómo sales. Separarlos deja al dueño
              dentro de algo que no sabe desactivar. */}
          {enSeleccion ? (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                {textoDeSeleccion(seleccion.size)}
              </p>
              <Button
                type="button"
                variant="link"
                className="h-auto p-0 text-sm"
                onClick={() => setSeleccion(new Set())}
              >
                Deseleccionar
              </Button>
            </div>
          ) : null}
        </div>

        {/* La moneda, debajo del título — CT-21, punto 2. Estaba en su propio
            recuadro más arriba; aquí está pegada a lo que cambia.

            RADIOS Y NO BOTONES: lo que queda guardado es un VALOR —en qué
            moneda está esto—, y `DESIGN-SYSTEM.md` ya lo dice. Era la misma
            confusión que costó una vuelta en el aviso de duplicado. */}
        {showCurrency && !subido ? (
          <>
            <RadioGroup
              // Sin selección refleja la moneda del cliente; con selección no
              // marca nada, porque lo marcado puede mezclar monedas y enseñar
              // una de las dos sería mentir sobre las otras.
              value={enSeleccion ? "" : (monedaDelCliente ?? "")}
              onValueChange={(v) => onAplicarMoneda(alcanceDeMoneda, v as LedgerCurrency)}
              className="flex flex-row flex-wrap gap-2"
            >
              {(
                [
                  { moneda: "USD", nombre: "Dólares" },
                  { moneda: "EUR", nombre: "Euros" },
                ] as const
              ).map(({ moneda, nombre }) => (
                <label
                  key={moneda}
                  className="flex h-10 cursor-pointer items-center gap-2 rounded-full border border-border bg-background px-3.5 text-sm"
                >
                  <RadioGroupItem value={moneda} />
                  {/* LA ETIQUETA CAMBIA CON EL ALCANCE. El mismo control hace
                      dos cosas —los marcados, o todos— y sin decirlo el dueño
                      no sabe a qué acaba de darle. */}
                  <span className="whitespace-nowrap">{textoDeMoneda(nombre, seleccion.size)}</span>
                  <CurrencyFlagIcon currency={moneda} />
                </label>
              ))}
            </RadioGroup>
            {!enSeleccion && monedaDelCliente === null && monedas.size > 1 ? (
              <p className="text-xs text-muted-foreground">
                Esta libreta mezcla monedas. Cada movimiento lleva la suya.
              </p>
            ) : null}
          </>
        ) : null}

        {entradas.map((e) =>
          e.tipo === "fila" ? (
            <div key={e.fila.rowId} className="flex flex-col gap-1">
              <FilaMovimiento
                fila={e.fila}
                esAjuste={esAjuste(e.fila.rowId)}
                soloLectura={subido}
                onEditar={() => setEditando(e.fila.rowId)}
                onEliminar={() => onRemove(e.fila.rowId)}
                seleccionable={!subido}
                enSeleccion={enSeleccion}
                seleccionada={seleccion.has(e.fila.rowId)}
                onEmpezarSeleccion={() => setSeleccion(new Set([e.fila.rowId]))}
                onAlternar={() => setSeleccion((prev) => alternar(prev, e.fila.rowId))}
              />
              {/* Se dice de dónde salió y cómo quitarla. Un renglón que aparece
                  solo y no se puede tocar, sin explicación, se lee como un fallo. */}
              {esAjuste(e.fila.rowId) ? (
                <p className="px-1 text-xs text-muted-foreground">
                  Lo agregó Sevenz para cuadrar con tu libreta.
                  {/* SE DICE CUANDO CAMBIA SOLO. El dueño aceptó un importe
                      concreto y el cliente va a ver esta línea; que se recalcule
                      en silencio al corregir un monto sería cambiarle un número
                      a su espalda. Solo sale si de verdad se movió. */}
                  {decisionesDeTotal[e.fila.currency ?? "COP"]?.rehechoA != null ? (
                    <>
                      {" "}
                      Se actualizó a{" "}
                      {importeDe(
                        decisionesDeTotal[e.fila.currency ?? "COP"]!.rehechoA!,
                        e.fila.currency,
                      )}{" "}
                      al cambiar un monto.
                    </>
                  ) : null}
                </p>
              ) : null}
              {/* El porqué de una fila marcada, debajo de ella. Solo "no cuadra"
                  va en rojo: las otras dos son avisos, y en un cuaderno a mano
                  casi ninguna línea trae su total escrito.

                  EN MODO SELECCIÓN SE CALLA, junto con la casilla del cliente
                  compartido de más abajo: mientras se marca, lo único que hay
                  que poder ver de un vistazo es qué está marcado, y dos párrafos
                  entre fila y fila lo hacen imposible en 375px. */}
              {enSeleccion ? null : e.fila.review_reason === "no_cuadra" ? (
                <p className="flex items-start gap-1.5 px-1 text-xs text-destructive">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" />
                  No cuadra: tu libreta dice{" "}
                  {importeDe(e.fila.read_balance!, e.fila.currency)} y con estos montos da{" "}
                  {importeDe(e.fila.page_balance, e.fila.currency)}.
                </p>
              ) : e.fila.review_reason === "lectura_dudosa" ? (
                <p className="flex items-start gap-1.5 px-1 text-xs text-amber-700 dark:text-amber-400">
                  <TriangleAlert className="mt-px size-3.5 shrink-0" />
                  La IA no leyó esta línea con seguridad — revisa el monto.
                </p>
              ) : null}

              {/* El escape del cliente compartido, por línea. Sin esto, marcar
                  "todos el mismo cliente" en una página que sí mezcla no tendría
                  más salida que desmarcarlo y perder lo ya escrito. */}
              {clienteCompartido && !enSeleccion ? (
                <label className="flex cursor-pointer items-center gap-2 px-1 text-xs text-muted-foreground">
                  <Checkbox
                    checked={isLinked(e.fila.rowId)}
                    onCheckedChange={() => onToggleLinked(e.fila.rowId)}
                  />
                  Es de {cliente.name || "este cliente"}
                </label>
              ) : null}
            </div>
          ) : (
            // LA FILA QUITADA SE QUEDA A LA VISTA, en su sitio, hasta que se
            // suba la libreta. Un toast que se va en cinco segundos obliga a
            // reaccionar a tiempo; aquí el dueño puede quitar un renglón,
            // seguir revisando veinte clientes y recuperarlo al final.
            <div
              key={e.mov.uid}
              className="flex items-center gap-2 rounded-lg border border-destructive/40 p-3 text-destructive"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                Movimiento eliminado
              </span>
              <span className="shrink-0 text-xs opacity-80">
                {e.mov.type === "charge" ? "Fiado" : "Abono"}
                {e.mov.description ? ` · ${e.mov.description}` : ""}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-8 shrink-0 text-destructive hover:text-destructive"
                aria-label="Recuperar este movimiento"
                onClick={() => e.mov.uid && onRestaurar(e.mov.uid)}
              >
                <RotateCcw className="size-4" />
              </Button>
            </div>
          ),
        )}
      </div>

      {/* ── Cómo queda ─────────────────────────────────────────────────── */}
      <Totales
        subido={subido}
        libros={cliente.libros}
        decisiones={Object.fromEntries(
          cliente.libros.map((l) => {
            const clave = l.currency ?? "COP";
            const decidido = decisionesDeTotal[clave];
            const hayQuePreguntar =
              l.estado === "no_cuadra" && l.escrito !== null && l.calculado !== null;
            if (!hayQuePreguntar && !decidido) return [clave, undefined];
            return [
              clave,
              {
                escrito: l.escrito ?? l.saldoFinal,
                calculado: l.calculado ?? l.totalPagina,
                currency: l.currency,
                decidido,
                onElegir: (cual: EleccionDeTotal) => onElegirTotal(l, cual),
              },
            ];
          }),
        )}
      />

      {/* LO QUE IMPIDE SUBIR, justo encima del boton que impide. Hasta el
          2026-10-02 esto solo salia en la tarjeta de la lista: desde el detalle
          el boton aparecia apagado sin ninguna explicacion al lado, y con el
          nombre borrado ni siquiera habia pista de que faltaba. Misma forma que
          el pie de la revision. */}
      {!subido && bloqueos.length > 0 ? (
        <p className="flex items-start gap-1.5 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" />
          {bloqueos[0]}
        </p>
      ) : null}

      {/* ── EL PIE, FIJO ABAJO — CT-21, punto 6 ────────────────────────────
          Antes iba al final del contenido y se iba con el scroll: en una
          libreta de veinte movimientos había que recorrerla entera para llegar
          al botón, y después volver arriba para seguir revisando.

          `sticky bottom-0` y NO `fixed`: la hoja ya es un contenedor con su
          propio scroll, y un `fixed` se posicionaría contra la ventana —
          quedando fuera de sitio en cuanto el teclado del teléfono la encoge.
          `DESIGN-SYSTEM.md`: un panel fijo se acota al espacio que tiene.

          Los márgenes negativos cancelan el padding de la hoja para que la
          banda llegue de borde a borde, y el `pb` suma el área segura del
          iPhone: sin ella, el botón queda debajo de la barra de inicio. */}
      {subido ? null : (
        <div className="sticky bottom-0 -mx-4 -mb-4 mt-2 border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {/* UNA ACCIÓN A LA VEZ, decidido con el usuario el 2026-10-02.
              Mientras hay selección el pie es eliminar; al deseleccionar vuelve
              subir. Los dos a la vez serían dos botones grandes fijos comiendo
              media pantalla, con el destructivo justo encima del que más se
              pulsa. */}
          {enSeleccion ? (
            <Button
              type="button"
              variant="destructive"
              className="w-full"
              onClick={() => {
                onEliminarVarios(idsSeleccionados);
                setSeleccion(new Set());
              }}
            >
              <Trash2 className="size-4" />
              {textoDeEliminar(seleccion.size)}
            </Button>
          ) : (
            accionSubir
          )}
        </div>
      )}

      {/* Montado solo mientras se edita, y con `key` en la fila: su borrador nace
          de los valores de ESE movimiento al montarse, sin un efecto que los
          copie. Con el componente siempre montado, abrir la hoja de otro
          renglon heredaria el borrador del anterior. */}
      {filaEditandose ? (
        <EditarMovimiento
          key={filaEditandose.rowId}
          fila={filaEditandose}
          esAjuste={esAjuste(filaEditandose.rowId)}
          onCerrar={() => setEditando(null)}
          showCurrency={showCurrency}
          onUpdate={onUpdate}
          onEliminar={onRemove}
        />
      ) : null}
    </div>
  );
}
