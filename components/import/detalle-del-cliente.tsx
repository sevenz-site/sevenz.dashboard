"use client";

import { CircleAlert, Trash2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { TipoButtons } from "@/components/dashboard/movement-currency-field";
import { DocumentIdInput } from "@/components/dashboard/document-id-input";
import { WhatsappInput } from "@/components/whatsapp-input";
import { OWNER_COUNTRY_DIAL_CODE } from "@/lib/countries";
import { formatCurrency } from "@/lib/format";
import { formatDisplayCurrency } from "@/lib/exchange-rate/format";
import { cn } from "@/lib/utils";
import type { ExtractedMovement, LedgerCurrency, OwnerCountry } from "@/lib/types";
import type { ClienteRevisado, LibroDelCliente, ReviewRow } from "@/lib/reconcile";

// ─────────────────────────────────────────────────────────────────────────
// "REGISTRAR MOVIMIENTOS": el detalle de UN cliente
//
// Sustituye a `ImportReviewTable` dentro del panel. La tabla se reutilizó
// mientras la lista por cliente se construía, y por eso funcionaba: sabe editar
// monto, tipo, moneda, documento y WhatsApp. Lo que no sabe es ser el detalle de
// una persona — enseña una columna "Cliente" repetida ocho veces con el mismo
// nombre, una columna "Documento" con el mismo documento en cada fila, y se
// desplaza de lado en un teléfono para llegar al monto.
//
// Aquí los datos del cliente se piden UNA vez arriba, y abajo va solo lo que de
// verdad cambia de un renglón a otro: tipo, monto, detalle y —si la libreta
// mezcla— la moneda de esa línea.
//
// POR QUÉ NO HAY BOTÓN "IMPORTAR" AQUÍ, aunque el mapa de pantallas lo dibuje.
// Importar guarda la tanda COMPLETA, no este cliente: `confirmImport` recibe
// todas las filas de todos los clientes y la migración 073 las mete en una sola
// transacción. Un botón que diga "Importar" dentro de la ficha de Petronila y
// guarde además los otros veintinueve clientes miente sobre su alcance, y el
// error caro no es el de quien lee mal la etiqueta: es el de quien la lee bien.
// Así que aquí el botón cierra, y el de importar es el de la lista — que además
// está tapado mientras este panel está abierto, porque el panel es modal.
function importeDe(n: number, currency: LedgerCurrency | null): string {
  return currency ? formatDisplayCurrency(n, currency) : formatCurrency(n);
}

// El aviso de una línea concreta. Mismo reparto de colores que la lista: rojo
// solo cuando la cuenta está mal de verdad; lo demás es ámbar, porque una
// libreta a mano casi nunca trae el total escrito en cada renglón y pintar eso
// de rojo deja la pantalla entera en rojo.
function avisoDeLaFila(row: ReviewRow): { texto: string; rojo: boolean } | null {
  if (row.review_reason === "no_cuadra") {
    return {
      rojo: true,
      texto: `No cuadra: tu libreta dice ${importeDe(row.read_balance!, row.currency)} y con estos montos da ${importeDe(row.page_balance, row.currency)}.`,
    };
  }
  if (row.review_reason === "lectura_dudosa") {
    return { rojo: false, texto: "La IA no leyó esta línea con seguridad — revisa el monto." };
  }
  if (row.review_reason === "sin_saldo") {
    return { rojo: false, texto: "Esta línea no traía un saldo escrito con el que comparar." };
  }
  return null;
}

// Las dos píldoras de moneda, con su NOMBRE y no solo la bandera.
//
// La primera versión ponía la bandera sola en las líneas, para que cupiera al
// lado del monto. Rompía el patrón de toda la app —en el alta de movimiento, en
// la cabecera de la cartera y en la modal, la moneda siempre se dice con la
// palabra— y encima obligaba a saber que la bandera azul de doce estrellas es el
// euro. Así que la palabra vuelve y lo que cede es el sitio: las píldoras bajan
// a su propia fila, debajo del monto, donde tienen los 375px enteros.
export function MonedaPildoras({
  value,
  onChange,
  etiqueta = "Moneda",
}: {
  value: LedgerCurrency | null;
  onChange: (v: LedgerCurrency) => void;
  etiqueta?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label>{etiqueta}</Label>
      <div className="flex flex-row flex-wrap gap-2">
        {(
          [
            { moneda: "USD", nombre: "Dólares" },
            { moneda: "EUR", nombre: "Euros" },
          ] as const
        ).map(({ moneda, nombre }) => (
          <Button
            key={moneda}
            type="button"
            variant={value === moneda ? "default" : "outline"}
            size="sm"
            className="rounded-full px-3.5"
            aria-pressed={value === moneda}
            onClick={() => onChange(moneda)}
          >
            <CurrencyFlagIcon currency={moneda} />
            {nombre}
          </Button>
        ))}
      </div>
    </div>
  );
}

// Los totales, UNO POR MONEDA y nunca sumados entre sí.
//
// Un $50 y un €20 son dos deudas independientes, no una deuda vista de dos
// formas — la regla que sigue toda la app. Sumarlos daría "70" de nada, y el
// número saldría plausible, que es lo que lo hace peligroso: nadie lo
// cuestiona. Es el mismo motivo por el que `porCobrar()` manda "$50,00 y
// €20,00" en vez de un número.
export type EleccionDeTotal = "libreta" | "suma";

// Lo que hay que recordar de una decisión ya tomada.
//
// Las dos cifras se guardan al decidir, no se vuelven a leer del libro: en
// cuanto se elige "mi libreta" y entra la línea de ajuste, las cuentas cuadran
// y `escrito`/`calculado` pasan a null — el libro ya no tiene desajuste que
// contar. Sin guardarlas, el resumen decía "tu libreta dice $140 y estos montos
// suman $140" y ofrecía "una línea de ajuste de $0,00". Visto en dev.
export type DecisionDeTotal = {
  cual: EleccionDeTotal;
  escrito: number;
  calculado: number;
};

// El bloque que pregunta cuál de los dos números manda — o, si ya se respondió,
// el que dice qué se decidió y deja cambiarlo.
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
  // Con una decisión tomada mandan SUS cifras, no las del libro de ahora.
  const esc = decidido ? decidido.escrito : escrito;
  const cal = decidido ? decidido.calculado : calculado;
  const diferencia = esc - cal;

  if (decidido) {
    return (
      <div className="mt-1 flex flex-col gap-2 border-t pt-2">
        <p className="text-sm">
          {decidido.cual === "libreta" ? (
            <>
              Te quedaste con el total de tu libreta:{" "}
              <strong>{importeDe(esc, currency)}</strong>. Agregamos la línea de ajuste de{" "}
              {importeDe(Math.abs(diferencia), currency)} que ves arriba.
            </>
          ) : (
            <>
              Te quedaste con la suma de los montos:{" "}
              <strong>{importeDe(cal, currency)}</strong>. Tu libreta decía{" "}
              {importeDe(esc, currency)} y lo dejamos anotado.
            </>
          )}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => onElegir(decidido.cual === "libreta" ? "suma" : "libreta")}
        >
          {decidido.cual === "libreta"
            ? `Cambiar a ${importeDe(cal, currency)}`
            : `Cambiar a ${importeDe(esc, currency)}`}
        </Button>
      </div>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-2 border-t pt-2">
      <p className="flex items-start gap-1.5 text-sm text-destructive">
        <CircleAlert className="mt-0.5 size-4 shrink-0" />
        <span>
          Tu libreta dice <strong>{importeDe(esc, currency)}</strong> y estos montos suman{" "}
          <strong>{importeDe(cal, currency)}</strong>. ¿Cuál es el bueno?
        </span>
      </p>

      {(
        [
          {
            cual: "libreta" as const,
            titulo: `Mi libreta: ${importeDe(esc, currency)}`,
            // Se dice ANTES de pulsarlo lo que va a pasar, porque lo que pasa es
            // que aparece un movimiento nuevo en la cuenta de una persona. Un
            // dato de dinero que sale de la nada, sin aviso, es exactamente lo
            // que nadie quiere encontrarse tres meses después.
            pie: `Agregamos una línea de ajuste de ${importeDe(Math.abs(diferencia), currency)} para que cuadre.`,
          },
          {
            cual: "suma" as const,
            titulo: `La suma de estos montos: ${importeDe(cal, currency)}`,
            pie: "La libreta traía un error de cuentas. Lo dejamos anotado.",
          },
        ]
      ).map((o) => (
        <label
          key={o.cual}
          className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-2.5"
        >
          <Checkbox
            checked={false}
            onCheckedChange={(v) => v === true && onElegir(o.cual)}
            className="mt-0.5"
          />
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">{o.titulo}</span>
            <span className="text-xs text-muted-foreground">{o.pie}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

function Totales({
  libros,
  decisiones,
}: {
  libros: LibroDelCliente[];
  // Por moneda, porque el desajuste es de un libro: la página puede cuadrar en
  // dólares y no en euros, y son dos preguntas distintas.
  decisiones: Record<string, React.ComponentProps<typeof DecisionDelTotal> | undefined>;
}) {
  return (
    <div className="flex flex-col gap-2">
      {libros.map((l) => {
        const decision = decisiones[l.currency ?? "COP"];
        return (
        <div key={l.currency ?? "COP"} className="flex flex-col gap-1 rounded-lg border p-3">
          {/* La cabecera de la moneda solo aparece cuando hay más de un libro:
              con uno solo, repetir "Dólares" encima de tres cifras que ya
              llevan el símbolo es ruido. */}
          {libros.length > 1 && l.currency ? (
            <p className="flex items-center gap-1.5 text-sm font-medium">
              <CurrencyFlagIcon currency={l.currency} className="size-4" />
              {l.currency === "USD" ? "Dólares" : "Euros"}
            </p>
          ) : null}

          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Ya debía</span>
            <span className="tabular-nums">{importeDe(l.saldoPrevio, l.currency)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>Esta libreta</span>
            {/* Signo explícito y el importe en absoluto. Un `-` de los que mete
                el formateador y un `+` puesto a mano quedaban con guiones
                distintos en la misma tarjeta; y aquí el signo significa algo —
                si esta página sube o baja la deuda—, así que se dice aparte. */}
            <span className="tabular-nums">
              {l.totalPagina >= 0 ? "+" : "-"}
              {importeDe(Math.abs(l.totalPagina), l.currency)}
            </span>
          </div>
          {/* EL NOMBRE DEL TOTAL DEPENDE DEL SIGNO, y no es un detalle de estilo.
              "Queda debiendo -€30,00" es lo que salía, y un negativo ahí no
              significa una deuda negativa: significa que el cliente pagó de más
              y tiene saldo A FAVOR. El resto de la app ya lo dice así —"Debe",
              "A favor", "Sin deuda"— y una pantalla que se inventa su propia
              forma de decirlo obliga a traducir un signo mentalmente, justo
              donde se está decidiendo sobre dinero. */}
          <div className="flex items-center justify-between border-t pt-1 font-semibold">
            <span>
              {l.saldoFinal > 0 ? "Queda debiendo" : l.saldoFinal < 0 ? "Queda a favor" : "Queda sin deuda"}
            </span>
            <span className="tabular-nums">
              {l.saldoFinal === 0 ? "" : importeDe(Math.abs(l.saldoFinal), l.currency)}
            </span>
          </div>

          {/* ── EL DESAJUSTE, Y CUÁL DE LOS DOS NÚMEROS MANDA ────────────
              Antes esto era una frase y nada más: decía las dos cifras y
              dejaba al dueño con el problema. Ahora se elige, porque solo él
              sabe cuál es cierta — su libreta puede tener un error de suma, o
              puede faltar un renglón que no salió en la foto.

              El bloque sigue visible DESPUÉS de elegir "mi libreta", aunque
              entonces las cuentas ya cuadren y el estado sea `cuadra`: si
              desapareciera, la decisión quedaría tomada sin forma de verla ni
              de cambiarla, y la línea de ajuste aparecería en el historial sin
              que nada en pantalla explicara de dónde salió. */}
          {decision ? <DecisionDelTotal {...decision} /> : null}
          {l.estado === "sin_verificar" ? (
            <p className="flex items-start gap-1.5 pt-1 text-sm text-amber-700 dark:text-amber-400">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              Esta libreta no traía totales con los que comparar, así que esta cuenta no se pudo
              verificar.
            </p>
          ) : null}
        </div>
        );
      })}
    </div>
  );
}

export function DetalleDelCliente({
  cliente,
  filas,
  country,
  showCurrency,
  clienteCompartido,
  isLinked,
  onToggleLinked,
  onUpdate,
  onRemove,
  onAplicarMoneda,
  decisionesDeTotal,
  onElegirTotal,
  onListo,
}: {
  cliente: ClienteRevisado;
  // Solo las filas de ESTE cliente.
  filas: ReviewRow[];
  country: OwnerCountry;
  showCurrency: boolean;
  // True mientras "todas las filas son del mismo cliente" está marcada. Entonces
  // el nombre, la cédula y el WhatsApp se escriben UNA vez arriba de la lista y
  // aquí no se pueden tocar: lo que se teclease aquí lo pisaría el valor
  // compartido en el siguiente render, o sea que el campo aceptaría texto y no
  // haría nada.
  clienteCompartido: boolean;
  // Si esa línea sigue tomando el cliente compartido. Una página suele ser de
  // una persona pero puede mezclar, así que el valor compartido es un valor por
  // defecto que cualquier línea puede rechazar — y entonces vuelve al nombre que
  // se leyó en la foto, y aparece como su propia tarjeta en la lista.
  isLinked: (rowId: string) => boolean;
  onToggleLinked: (rowId: string) => void;
  // Por `rowId`, nunca por posición: este componente recibe un subconjunto, y
  // con índices la edición aterrizaba en otro cliente. Pasó el 2026-09-28.
  onUpdate: (rowId: string, patch: Partial<ExtractedMovement>) => void;
  onRemove: (rowId: string) => void;
  // La moneda de este cliente, de un toque. Pisa las de sus líneas a propósito:
  // aquí el dueño está mirando a una persona y decide por ella, que es distinto
  // del "Todo Dólares" de la lista — ese solo toca lo que sigue sin asignar.
  onAplicarMoneda: (moneda: LedgerCurrency) => void;
  // Qué hacer con un total escrito que no cuadra: quedarse con el de la
  // libreta —que añade una línea de ajuste— o con la suma de los montos.
  // Vive en el flujo y no aquí porque cambia `reviewMovements`, que es de allí.
  decisionesDeTotal: Record<string, DecisionDeTotal | undefined>;
  onElegirTotal: (libro: LibroDelCliente, cual: EleccionDeTotal) => void;
  onListo: () => void;
}) {
  const documentoEscrito = filas.find((f) => f.document_id?.trim())?.document_id ?? "";
  // LA CÉDULA QUE YA ESTÁ GUARDADA en la ficha del cliente. No viene en las
  // filas: la extracción nunca lee un documento de la foto, así que
  // `f.document_id` es null para un cliente que existe y ya tiene la suya.
  //
  // Sin esto el campo salía VACÍO para QA Petronila, que tiene V-9001101
  // guardada — visto en dev el 2026-09-28 —, y justo debajo el texto de apoyo
  // decía "para cambiarlo, entra al cliente desde Clientes". Un campo en blanco
  // con un pie que habla de cambiar algo: el dueño no puede saber si Sevenz
  // tiene su cédula o la perdió.
  const documentoGuardado = cliente.candidato?.document_id ?? null;
  const whatsappGuardado = cliente.candidato?.whatsapp?.trim() || null;
  // Decisión 3 del mapa: la de un cliente que ya existe SE ENSEÑA, no se exige
  // ni se edita aquí. Y no se edita por una razón concreta: la migración 073
  // solo rellena documentos que estén en null (`and document_id is null`), así
  // que un campo editable aceptaría el texto y lo tiraría en silencio.
  const exigeDocumento = cliente.necesitaDocumento && !documentoEscrito.trim();

  // Cuál de las dos monedas está marcada para este cliente. Sale de sus filas,
  // no de un estado aparte: si todas coinciden, esa; si mezcla, ninguna.
  const monedas = new Set(filas.map((f) => f.currency));
  const monedaDelCliente = monedas.size === 1 ? [...monedas][0] : null;

  return (
    // `px-4`: `SheetContent` no trae ningún margen lateral propio — solo
    // `SheetHeader` lo pone, y por eso el título respiraba y las tarjetas de
    // abajo tocaban el borde de la pantalla. Va aquí y no en el componente
    // compartido: el resto de los paneles de la app ya cuadran.
    <div className="flex flex-col gap-4 px-4 pb-2">
      {/* ── Los datos de la persona, una sola vez ─────────────────────────
          Con el cliente compartido marcado, la cédula y el WhatsApp ya se
          escriben una vez arriba de la lista, así que aquí se dice dónde en vez
          de ofrecer un campo que no guardaría nada. */}
      {clienteCompartido ? (
        <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
          La cédula y el WhatsApp de este cliente se escriben arriba, en la lista, porque marcaste
          que todos los movimientos son de la misma persona.
        </p>
      ) : (
      <div className="flex flex-col gap-3 rounded-lg border p-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="detalle-documento" className="text-xs">
            Cédula/documento
          </Label>
          {documentoGuardado ? (
            <p id="detalle-documento" className="text-sm tabular-nums">
              {documentoGuardado}
            </p>
          ) : (
            <DocumentIdInput
              id="detalle-documento"
              country={country}
              value={documentoEscrito}
              // Se escribe en TODAS las filas de este cliente. El documento es de
              // la persona, no del renglón: guardarlo en una sola fila dejaría a
              // `confirmImport` viendo un cliente con cédula y otro sin ella
              // según qué fila mirase primero.
              onChange={(next) => {
                for (const f of filas) onUpdate(f.rowId, { document_id: next || null });
              }}
              invalid={exigeDocumento}
            />
          )}
          {documentoGuardado ? (
            <p className="text-xs text-muted-foreground">
              Para cambiarlo, entra al cliente desde Clientes cuando termines de subir la libreta.
            </p>
          ) : exigeDocumento ? (
            <p className="text-xs text-destructive">
              Es un cliente nuevo. Sin cédula no se puede importar.
            </p>
          ) : null}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="detalle-whatsapp" className="text-xs">
            WhatsApp (opcional)
          </Label>
          {/* Mismo criterio que la cédula, y por el mismo motivo mecánico: la
              073 solo escribe el WhatsApp cuando el cliente no tiene ninguno
              (`and whatsapp is null`), así que un campo editable sobre un
              número ya guardado aceptaría el texto y lo tiraría en silencio. Y
              el número viejo gana a propósito: el de la libreta puede ser más
              antiguo que el que el dueño corrigió a mano en la ficha. */}
          {whatsappGuardado ? (
            <p id="detalle-whatsapp" className="text-sm tabular-nums">
              {whatsappGuardado}
            </p>
          ) : (
            <WhatsappInput
              id="detalle-whatsapp"
              name="detalle-whatsapp"
              preferredDialCode={OWNER_COUNTRY_DIAL_CODE[country]}
              defaultValue={filas.find((f) => f.whatsapp?.trim())?.whatsapp ?? null}
              onValueChange={(v) => {
                for (const f of filas) onUpdate(f.rowId, { whatsapp: v.trim() || null });
              }}
            />
          )}
          {/* La explicación entera vive AQUÍ, una vez, junto al campo donde se
              escribe — y no seis veces en la lista, donde así no se lee.
              Y no promete lo que todavía no hacemos: hoy Sevenz no manda ningún
              aviso a un cliente (`MS-3`, bloqueada por `NG-1`). La frase es
              cierta el día que se publica y sigue siéndolo el día que se active,
              sin tocar nada. */}
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

      {/* La moneda de este cliente. Fuera del recuadro de datos y siempre
          presente: la moneda es de los movimientos, no de la persona, así que
          sigue haciendo falta cuando el cliente compartido está marcado — que es
          justo el caso de una libreta de una sola persona. Un negocio colombiano
          no tiene esta pregunta: su libro no lleva moneda. */}
        {showCurrency ? (
          <div className="flex flex-col gap-1.5 rounded-lg border p-3">
            <MonedaPildoras
              value={monedaDelCliente}
              onChange={onAplicarMoneda}
              etiqueta="Moneda de este cliente"
            />
            {monedaDelCliente === null && monedas.size > 1 ? (
              <p className="text-xs text-muted-foreground">
                Esta libreta mezcla monedas. Cada línea lleva la suya abajo.
              </p>
            ) : null}
          </div>
        ) : null}

      {/* ── El historial, un renglón por movimiento ─────────────────────── */}
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">
          {filas.length} {filas.length === 1 ? "movimiento" : "movimientos"}
        </p>

        {filas.map((f) => {
          const aviso = avisoDeLaFila(f);
          return (
            <div
              key={f.rowId}
              className={cn(
                "flex flex-col gap-2 rounded-lg border p-3",
                f.review_reason === "no_cuadra"
                  ? "border-destructive/30 bg-destructive/5"
                  : f.needs_review
                    ? "border-amber-300 bg-amber-50 dark:border-amber-500/20 dark:bg-amber-500/10"
                    : undefined,
              )}
            >
              {/* La papelera FUERA DEL FLUJO, anclada arriba a la derecha.
                  Estaba en un flex al lado del tipo y le robaba 36px de ancho:
                  con eso, "Cargo (fía)" y "Abono (paga)" ya no cabían en una
                  línea y se apilaban, así que cada movimiento crecía dos filas.
                  Visto en la captura a 375px. */}
              <div className="relative">
                {/* EL MISMO COMPONENTE que el formulario de "Agregar
                    movimiento", no una copia parecida. Antes eran dos botones
                    propios, más cortos: se veían bien y rompían el patrón, que
                    es peor que verse mal — el dueño aprende una forma de decir
                    "cargo o abono" y aquí se encontraba otra.
                    `canPay` va en true porque aquí no se está pagando contra un
                    saldo vivo: se está transcribiendo lo que ya pasó y quedó
                    escrito en la libreta. */}
                <TipoButtons
                  value={f.type}
                  onValueChange={(v) => onUpdate(f.rowId, { type: v })}
                  canPay
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute top-0 right-0 size-9"
                  aria-label="Quitar este movimiento"
                  onClick={() => onRemove(f.rowId)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`monto-${f.rowId}`} className="text-xs">
                  Monto
                </Label>
                <Input
                  id={`monto-${f.rowId}`}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={f.amount}
                  onChange={(e) => onUpdate(f.rowId, { amount: Number(e.target.value) || 0 })}
                />
              </div>

              {/* La moneda POR LÍNEA, siempre que el negocio tenga monedas.
                  Estaba condicionada a que el cliente YA mezclara, y eso era un
                  callejón sin salida: tras aplicar "Todo Dólares" el control
                  desaparecía, así que el dueño que entonces se daba cuenta de
                  que un renglón era en euros no tenía forma de decirlo. */}
              {showCurrency ? (
                <MonedaPildoras
                  value={f.currency}
                  onChange={(v) => onUpdate(f.rowId, { currency: v })}
                />
              ) : null}

              <Input
                placeholder="Detalle (opcional)"
                aria-label="Detalle"
                value={f.description ?? ""}
                onChange={(e) => onUpdate(f.rowId, { description: e.target.value || null })}
              />

              {/* El escape del cliente compartido, por línea. Sin esto, marcar
                  "todas son del mismo cliente" en una página que sí mezcla no
                  tendría más salida que desmarcarlo y perder el nombre, la
                  cédula y el teléfono ya escritos. Al desvincular, la línea
                  vuelve al nombre que se leyó en la foto y aparece como su
                  propia tarjeta en la lista. */}
              {clienteCompartido ? (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={isLinked(f.rowId)}
                    onCheckedChange={() => onToggleLinked(f.rowId)}
                  />
                  Es de {cliente.name || "este cliente"}
                </label>
              ) : null}

              {aviso ? (
                <p
                  className={cn(
                    "flex items-start gap-1.5 text-xs",
                    aviso.rojo ? "text-destructive" : "text-amber-700 dark:text-amber-400",
                  )}
                >
                  <TriangleAlert className="mt-px size-3.5 shrink-0" />
                  <span className="min-w-0">{aviso.texto}</span>
                </p>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* ── Cómo queda ─────────────────────────────────────────────────── */}
      <Totales
        libros={cliente.libros}
        decisiones={Object.fromEntries(
          cliente.libros.map((l) => {
            const clave = l.currency ?? "COP";
            const decidido = decisionesDeTotal[clave];
            // El bloque sale cuando el libro NO cuadra, y también cuando ya se
            // decidió — porque al elegir "mi libreta" las cuentas pasan a
            // cuadrar y, sin esto, la pregunta y su respuesta desaparecerían
            // juntas dejando una línea de ajuste sin explicación.
            const hayQuePreguntar = l.estado === "no_cuadra" && l.escrito !== null && l.calculado !== null;
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

      <Button type="button" className="w-full" onClick={onListo}>
        Listo
      </Button>
    </div>
  );
}
