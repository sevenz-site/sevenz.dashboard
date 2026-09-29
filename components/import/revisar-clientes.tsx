"use client";

import { ChevronRight, CircleAlert, TriangleAlert, UserRoundSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { cn } from "@/lib/utils";
import type { CandidatoDuplicado, ClienteRevisado, LibroDelCliente } from "@/lib/reconcile";

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
export type DecisionDuplicado = "mismo" | "otra";

// La revisión, por CLIENTE y no por movimiento.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ DEJA DE SER UNA TABLA
//
// La pantalla anterior era una fila por MOVIMIENTO: una libreta de seis páginas
// se convertía en cuarenta filas con ocho columnas, en un teléfono de 375px. El
// dueño no piensa en movimientos sueltos, piensa en personas: "¿está bien lo de
// Petronila?". Y lo que hay que revisar —la suma, la moneda, la cédula, si ese
// "Juanito" es el suyo— son preguntas POR PERSONA, no por línea.
//
// Así que arriba se resume por cliente y el detalle se abre aparte. Una tarjeta
// se lee de un vistazo y dice su estado con color, con chip y con una frase; la
// tabla decía lo mismo repartido en cuarenta filas y ninguna se leía.
//
// ─────────────────────────────────────────────────────────────────────────
// EL ORDEN DE LOS ESTADOS NO ES ESTÉTICO
//
// Una tarjeta tiene UN estado, el más accionable, porque un cliente puede tener
// tres problemas a la vez y pintarlos todos deja al dueño sin saber por dónde
// empezar. La prioridad es: lo que IMPIDE importar primero, lo que hay que
// decidir después, lo que conviene mirar al final.
//
//   faltan_datos   falta la cédula de un cliente nuevo, o la moneda. Bloquea.
//   duplicado      hay un cliente con ese nombre y nadie ha dicho si es el
//                  mismo. Bloquea, porque las dos respuestas se equivocan en
//                  direcciones opuestas — ver la nota de `DecisionDuplicado`.
//   revisar_suma   los totales escritos no cuadran con los montos. No bloquea:
//                  la libreta puede tener un error de suma de verdad y el dueño
//                  es quien decide.
//   sin_verificar  no había totales con los que comparar. NO es un fallo — en
//                  un cuaderno a mano es lo normal.
//   cuadra         todo bien.
//
// EL WHATSAPP NUNCA BLOQUEA y va en ámbar, no en rojo. El mapa original lo
// pintaba rojo junto a la cédula; la decisión del 2026-09-28 fue la contraria y
// manda la decisión, no el mockup. `lib/types.ts` lo dice desde el 2026-09-21:
// es opcional en todas partes.
export type EstadoTarjeta =
  | "faltan_datos"
  | "duplicado"
  | "revisar_suma"
  | "sin_verificar"
  | "cuadra";

export type ClienteConEstado = ClienteRevisado & {
  estado: EstadoTarjeta;
  // El cliente existente que se parece a este, para poder preguntar. Viene
  // APARTE de `candidato` y de una reconciliación contra la lista COMPLETA de
  // clientes, porque `candidato` desaparece en cuanto el dueño responde "es otra
  // persona" —y tiene que desaparecer, o el saldo previo de esa otra persona se
  // colaría en los totales—, pero los dos botones tienen que seguir ahí para
  // poder cambiar de idea.
  candidatoVisible: CandidatoDuplicado | null;
  // Lo que falta, ya redactado. Puede haber más de una cosa: "Falta cédula" y
  // "Falta WhatsApp" son dos avisos distintos y se enseñan los dos, separados,
  // porque uno impide importar y el otro no.
  bloqueos: string[];
  avisos: string[];
};

// Traduce la vista por cliente en lo que se pinta. Vive aquí y no en
// `lib/reconcile.ts` porque es una decisión de PANTALLA —qué se enseña primero
// cuando hay tres problemas a la vez—, no de datos.
export function conEstado(
  clientes: ClienteRevisado[],
  filas: { client_name: string; document_id: string | null; needs_document_id: boolean }[],
  decisiones: Record<string, DecisionDuplicado>,
  candidatos: Map<string, CandidatoDuplicado>,
): ClienteConEstado[] {
  return clientes.map((c) => {
    const candidatoVisible = candidatos.get(c.nameKey) ?? null;
    const suyas = filas.filter((f) => f.client_name.trim().toLowerCase() === c.nameKey);

    const bloqueos: string[] = [];
    // EL MISMO CRITERIO, FILA A FILA, que el bloqueo del pie de la pantalla
    // (`missingDocumentId`). Antes esto preguntaba si ALGUNA fila traía cédula
    // y el pie si le FALTABA a alguna: con una sola fila sin ella —la línea de
    // ajuste recién creada, por ejemplo— la tarjeta decía "Todo cuadra"
    // mientras el botón de subir estaba apagado. Dos medidas distintas de la
    // misma cosa siempre acaban contradiciéndose; esta es la que manda.
    if (suyas.some((f) => f.needs_document_id && !f.document_id?.trim())) {
      bloqueos.push("Falta la cédula. Sin ella no se puede importar.");
    }
    // LA MONEDA NO SE REPITE EN CADA TARJETA. Es un bloqueo de la TANDA —tiene
    // su propio selector arriba y su propio mensaje en el pie—, así que
    // ponerlo también aquí pintaba las seis tarjetas de rojo con el mismo
    // texto y tapaba lo único que las distingue: que una no cuadra, que otra
    // no tiene totales, que otra está repetida. Se vio al pintarlo.

    const avisos: string[] = [];
    if (c.libros.some((l) => l.estado === "sin_verificar")) {
      avisos.push(
        "Esta libreta no traía totales con los que comparar. Revisa los montos para estar seguro.",
      );
    }
    // El WhatsApp NO bloquea, y la frase no promete lo que todavía no hacemos:
    // hoy Sevenz no envía ningún mensaje a un cliente (`MS-3`, bloqueada por
    // `NG-1`). Dice que llegará y por qué conviene apuntarlo ahora, que es
    // cierto el día que se publica y sigue siéndolo el día que se active.
    if (c.faltaWhatsapp) {
      // Corto en la tarjeta. La explicación entera —que todavía no mandamos
      // avisos a clientes pero lo haremos— vive UNA vez, junto al campo donde
      // se escribe, y no seis veces en una lista que así no se lee.
      avisos.push("Falta el WhatsApp. Es opcional, pero conviene apuntarlo ahora.");
    }

    const estado: EstadoTarjeta = bloqueos.length
      ? "faltan_datos"
      : candidatoVisible && !decisiones[c.nameKey]
        ? "duplicado"
        : c.libros.some((l) => l.estado === "no_cuadra")
          ? "revisar_suma"
          : c.libros.some((l) => l.estado === "sin_verificar")
            ? "sin_verificar"
            : "cuadra";

    return { ...c, estado, bloqueos, avisos, candidatoVisible };
  });
}

const CHIP: Record<EstadoTarjeta, { texto: string; clase: string }> = {
  faltan_datos: { texto: "Faltan datos", clase: "border-destructive/40 text-destructive" },
  duplicado: { texto: "¿Es el mismo?", clase: "border-amber-400/60 text-amber-700 dark:text-amber-400" },
  revisar_suma: { texto: "Revisar suma", clase: "border-destructive/40 text-destructive" },
  sin_verificar: { texto: "Sin verificar", clase: "border-amber-400/60 text-amber-700 dark:text-amber-400" },
  cuadra: { texto: "Todo cuadra", clase: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400" },
};

const FONDO: Record<EstadoTarjeta, string> = {
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
  cliente,
  decision,
  onDecidir,
  onAbrir,
}: {
  cliente: ClienteConEstado;
  decision: DecisionDuplicado | undefined;
  onDecidir: (d: DecisionDuplicado) => void;
  onAbrir: () => void;
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

      {/* Lo que conviene mirar pero no impide nada, en ámbar. */}
      {cliente.avisos.map((a) => (
        <p key={a} className="flex items-start gap-1.5 text-sm text-amber-700 dark:text-amber-400">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          {a}
        </p>
      ))}

      {/* El duplicado, con sus datos y sus dos botones. Sin opción marcada por
          defecto: ver la nota de `DecisionDuplicado`. */}
      {cliente.candidatoVisible && !decision ? (
        <div className="flex flex-col gap-2 border-t border-amber-300/60 pt-2 dark:border-amber-500/20">
          <p className="flex items-start gap-1.5 text-sm">
            <UserRoundSearch className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" />
            <span>
              Ya tienes un &ldquo;{cliente.candidatoVisible.name}&rdquo; en tus clientes.
              {cliente.candidatoVisible.document_id ? ` Documento: ${cliente.candidatoVisible.document_id}.` : " Sin documento."}
              {cliente.candidatoVisible.balance_usd ? ` Debe ${formatDisplayCurrency(cliente.candidatoVisible.balance_usd, "USD")}.` : ""}
              {cliente.candidatoVisible.balance_eur ? ` Debe ${formatDisplayCurrency(cliente.candidatoVisible.balance_eur, "EUR")}.` : ""}
              {!cliente.candidatoVisible.balance_usd && !cliente.candidatoVisible.balance_eur && cliente.candidatoVisible.balance
                ? ` Debe ${formatCurrency(cliente.candidatoVisible.balance)}.`
                : ""}
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" onClick={() => onDecidir("mismo")}>
              Es el mismo
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onDecidir("otra")}>
              Es otra persona
            </Button>
          </div>
        </div>
      ) : null}

      {/* LO DECIDIDO, Y CÓMO DESDECIRSE.
          Antes solo estaba la frase, sin vuelta atrás: una vez pulsado "es otra
          persona" o "es el mismo" los botones desaparecían para siempre y la
          única salida era tirar la revisión entera con "Volver". Y toda la
          maquinaria de reconciliar contra la lista COMPLETA de clientes existe
          precisamente para que la tarjeta siga ahí y se pueda cambiar de idea —
          sin este botón esa maquinaria no servía de nada. */}
      {cliente.candidatoVisible && decision ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2">
          <p className="text-sm text-muted-foreground">
            {decision === "otra"
              ? "Se registrará como un cliente nuevo, con su propio documento."
              : `Se sumará al “${cliente.candidatoVisible.name}” que ya tienes.`}
          </p>
          <Button type="button" size="sm" variant="ghost" onClick={() => onDecidir(decision === "otra" ? "mismo" : "otra")}>
            {decision === "otra" ? "Es el mismo" : "Es otra persona"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function RevisarClientes({
  clientes,
  decisiones,
  onDecidir,
  onAbrir,
}: {
  clientes: ClienteConEstado[];
  decisiones: Record<string, DecisionDuplicado>;
  onDecidir: (nameKey: string, d: DecisionDuplicado) => void;
  onAbrir: (nameKey: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {clientes.map((c) => (
        <TarjetaCliente
          key={c.nameKey}
          cliente={c}
          decision={decisiones[c.nameKey]}
          onDecidir={(d) => onDecidir(c.nameKey, d)}
          onAbrir={() => onAbrir(c.nameKey)}
        />
      ))}
    </div>
  );
}
