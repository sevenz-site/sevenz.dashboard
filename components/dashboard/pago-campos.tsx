"use client";

// THE PAYMENT FIELDS OF A SALE — «¿Cuánto paga?», the amount with its
// currency, the equivalence, the photo and the note.
//
// ===========================================================================
// WHY THIS LIVES IN ITS OWN FILE SINCE 2026-10-24
//
// It was a local `PagoSheet` inside `nueva-venta.tsx`, and the catalogue
// order's step 2/2 (frame `1564:11028`) is the same screen: the same two
// chips, the same amount in bolívares, the same BCV-forecast checkbox, the
// same equivalence. Copying it would have been six hundred lines of MONEY
// logic in two places -- the `StickyActions` failure this repo already paid
// for twice, with the rounding of a real shopkeeper's cash on the line.
//
// So the fields moved here and `PagoSheet` is now a Sheet around them. The
// only thing the two callers do not share is their frame: one is a bottom
// sheet, the other a full screen with its own «1/2 · 2/2» chrome.

import { useState } from "react";
import { Check, ChevronDown, Percent, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AttachmentUploader } from "@/components/dashboard/attachment-uploader";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { CuotasSelect } from "@/components/dashboard/cuotas-select";
import { PlazoPagoSelect } from "@/components/dashboard/plazo-pago-select";
import { useGroupedAmount } from "@/hooks/use-grouped-amount";
import { formatDate } from "@/lib/format";
import { DEFAULT_PLAZO_PAGO } from "@/lib/types";
import {
  formatAmountForInput,
  formatPriceAmount,
  parseAmount,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";

// CAPITALISED, UNLIKE `currencyName()` in `lib/products/price.ts`, which
// returns a lowercase word for use inside a sentence. Here it is a label on
// its own and the frames write it with a capital. Exported because
// `nueva-venta.tsx` labels its cards with the same map, and two copies would
// drift the day a currency is added.
export const NOMBRE: Partial<Record<PriceCurrency, string>> = {
  USD: "Dólares",
  EUR: "Euros",
  COP: "Pesos",
};

// ── «PAGAR» ────────────────────────────────────────────────────────────
//
// UN FORMULARIO CON DOS RAMAS — frames `1389:9222` (contado) y `1389:9296`
// (fiado o crédito). «Ambos es el mismo formulario, lo que cambia son los
// campos según si selecciona "de contado" o "fiado o crédito"» — el dueño,
// 2026-10-18.
//
// ===========================================================================
// POR QUÉ UNA MONEDA PUEDE LLEVAR LAS DOS COSAS
//
// La hoja se abre desde la tarjeta de una moneda y registra UNA de las dos, la
// que diga el chip. Pero la misma moneda admite las dos a la vez, y ese es el
// caso que el dueño describió con sus palabras el 2026-10-17: «una compra por
// 10 USD puede abonar 5 y quedar debiendo 5». Se abre la hoja dos veces —una
// de contado por 5, otra a crédito por 5— y la tarjeta enseña las dos.
//
// Por eso `PasoPago` guarda DOS huecos por moneda y no uno. Con un solo hueco,
// registrar el fiado borraría el abono que acaba de entrar en la caja.
//
// ===========================================================================
// «MONTO» Y «EQUIVALENCIA» SON LAS DOS CARAS DEL MISMO DINERO
//
// Lo que el cliente entrega y lo que entra en el libro. En un negocio
// venezolano suelen ser distintas —paga en bolívares, el libro es en dólares—
// y las dos se guardan: `entry_amount` con su moneda es lo que de verdad pasó
// de mano a mano, y es el registro más defendible en una disputa (migración
// `022`); `amount` es lo que descuenta de la venta.
//
// LA EQUIVALENCIA SE PUEDE CORREGIR A MANO, y no es un descuido del frame:
// el tendero puede aceptar unos bolívares de menos y dar la cuenta por
// cerrada. El servidor sella la tasa pero NO divide una cifra por la otra —
// hacerlo convertía una venta pagada completa en un fiado de un céntimo.
// LO QUE SE REGISTRA EN UNA MONEDA: UNA COSA, no dos.
//
// Lo tuve dos días como dos huecos —un cobro y un fiado por separado— y el
// dueño lo corrigió el 2026-10-18 con una regla que los une: «al seleccionar
// "De contado" en el input de monto se pone el monto total; si el monto se
// edita a un monto diferente al total, entonces debe seleccionarse el chip
// "Fiado o crédito"».
//
// O sea que EL CHIP NO ES UN CAMPO, ES UNA CONSECUENCIA: paga todo o no paga
// todo. `amount` es lo que entrega hoy y el resto —total menos eso— es la
// deuda, calculada, nunca tecleada aparte. Con dos huecos se podía registrar
// 5,84 de cobro y 2,03 de fiado sobre una venta de 5,84; con uno, eso es
// inexpresable.
export type Registro = {
  // Lo que entra HOY en el libro de esta moneda.
  amount: number;
  // Lo que de verdad entregaron, y en qué. `null` = en la moneda del libro.
  entryCurrency: "VES" | null;
  entryAmount: number | null;
  // Solo valen si `amount` no cubre el total. Si lo cubre, no hay fiado que
  // pactar y el servidor los ignora porque no escribe ningún cargo.
  plazo: string;
  cuotas: string;
  usarPrevista: boolean;
  // El comprobante. Va a `sale_payments.photo_path` si hubo cobro, y a
  // `movements.photo_path` del cargo si quedó deuda.
  photoPath: string | null;
  description: string;
};

// LAS CUOTAS, TAL COMO LAS CALCULA LA BASE. Migración `118`: «el vencimiento
// de la cuota i es created_at + plazo_dias * i / cuotas». Aquí se repite para
// ENSEÑARLAS antes de guardar, que es lo que el frame pide — no para decidir
// nada, porque quien decide es el `check` de la migración.
//
// Se reparte en partes iguales y el resto se le suma a la ÚLTIMA: tres cuotas
// de 10 son 3,33 · 3,33 · 3,34, no tres de 3,33 que suman 9,99. Ese céntimo
// perdido es el que hace que un cliente que pagó todo siga debiendo.
function calendarioDeCuotas(
  monto: number,
  plazoDias: number | null,
  cuotas: number,
): { numero: number; vence: string | null; monto: number }[] {
  const n = Math.max(1, cuotas);
  const base = Math.floor((monto / n) * 100) / 100;
  const hoy = Date.now();
  return Array.from({ length: n }, (_, i) => ({
    numero: i + 1,
    vence:
      plazoDias == null
        ? null
        : new Date(hoy + (plazoDias * (i + 1) * 86400000) / n).toISOString(),
    monto:
      i === n - 1 ? Math.round((monto - base * (n - 1)) * 100) / 100 : base,
  }));
}

export function PagoCampos({
  etiquetaBoton,
  // ── EL BOTÓN, PEGADO ABAJO A 40px ─────────────────────────────────
  //
  // Encargo del dueño el 2026-10-27: *«pega el botón Pagar abajo a 40px de
  // distancia del fondo de la pantalla»*. Los 40px no se escriben aquí: los
  // pone `StickyActions`, que es el componente que ya los tiene medidos.
  //
  // ES UNA PROP Y NO EL COMPORTAMIENTO POR DEFECTO porque este componente
  // tiene DOS usos y solo uno es una pantalla:
  //
  //   · El paso `2/x` del pedido --una pantalla completa-- lo pide. Su botón
  //     estaba al final de la columna, a 160px de desplazamiento a 375x812,
  //     que es lo que el dueño vio.
  //   · El «Registrar pago» del asistente de venta vive dentro de una HOJA
  //     que ya termina abajo. Una barra pegada dentro de otra cosa pegada no
  //     añade nada y le quitaría a la hoja su propio pie.
  //
  // Y NO SON SOLO 40px: `StickyActions` se esconde con el teclado arriba.
  // Esta pantalla tiene el campo del monto, así que sin eso el botón se
  // quedaría flotando encima del teclado justo mientras se teclea el dinero
  // --el fallo que el dueño ha reportado tres veces--.
  botonPegadoAbajo = false,
  mostrarTotal = true,
  moneda,
  ownerId,
  total,
  rates,
  prevista,
  inicial,
  onGuardar,
}: {
  moneda: PriceCurrency;
  // Para el subidor de la foto, que escribe en el bucket de este negocio.
  ownerId: string;
  // Lo que suma la venta en esta moneda, para la tarjeta de arriba.
  total: number;
  rates: BolivarRates | null;
  prevista: { fecha: string } | null;
  inicial: Registro | null;
  onGuardar: (r: Registro) => void;
  // THE TOTAL CARD AT THE TOP. The sheet needs it: it covers the whole phone,
  // so without it the figure being paid against is off-screen. The order's
  // step 2/2 does NOT, because its own frame (`1564:11028`) already opens with
  // the sealed line -- product, quantity and «Por pagar» -- and drawing both
  // would show the same amount twice, one of them with a heading the frame
  // never had.
  botonPegadoAbajo?: boolean;
  mostrarTotal?: boolean;
  // THE SUBMIT LABEL. The sheet in the sale wizard says «Pagar»; the full
  // screen of frame `1564:11028` says «Pagar $00.00», with the figure. One
  // prop instead of two copies of six hundred lines.
  etiquetaBoton?: string;
}) {
  const tasa = rates ? (moneda === "EUR" ? rates.eur : rates.usd) : null;

  // ── EN QUÉ MONEDA LE ENTREGAN ───────────────────────────────────────
  //
  // BOLÍVARES POR DEFECTO, por decisión del dueño el 2026-10-18: «la moneda
  // por defecto en el monto a pagar debe ser Bolívares».
  //
  // Y no es una preferencia de pantalla, es cómo se cobra de verdad en
  // Venezuela: el libro está en dólares o en euros, pero lo que pasa de mano a
  // mano son bolívares. Arrancar en la moneda del libro le pedía al tendero
  // cambiar el selector en casi todos los cobros.
  //
  // Sin tasa —un negocio colombiano— no hay bolívares que ofrecer: cae en la
  // moneda del libro y el selector no se pinta.
  const entregaInicial: "VES" | PriceCurrency = inicial
    ? inicial.entryCurrency === "VES"
      ? "VES"
      : moneda
    : tasa
      ? "VES"
      : moneda;

  // EL MONTO ARRANCA EXPRESADO EN LA MONEDA DE ENTREGA, y esto no sobra: con
  // bolívares por defecto, sembrarlo con lo que falta EN EL LIBRO abriría la
  // hoja enseñando «5,84» con la etiqueta «Bolívares» — una cifra mil veces
  // más pequeña de la que el tendero va a recibir, y perfectamente creíble.
  //
  // Y ARRANCA CON EL TOTAL, no con cero: «al seleccionar "De contado" en el
  // input de monto se pone el monto total de pago» (el dueño, 2026-10-18). Le
  // pagan todo en la mayoría de las ventas, así que el caso corriente es cero
  // teclas.
  // CÓMO SE ESCRIBE EN EL CAMPO: con separador de miles y 4 decimales como
  // mucho. Petición del dueño el 2026-10-23, al ver que la hoja se abría
  // enseñando `5760,4761499999` — el total de la venta multiplicado por la
  // tasa, con toda la cola que deja la multiplicación.
  //
  // NO ES SOLO FEO: una cifra de catorce dígitos en el campo donde el tendero
  // escribe lo que le acaban de poner en la mano no se lee como «el total», se
  // lee como que la app calculó algo raro. Y cobrar es el momento en que menos
  // margen hay para dudar.
  //
  // CUATRO DECIMALES ES LA PRECISIÓN DE LA BASE, no un recorte a ojo:
  // `unit_price` y los precios de producto son `numeric(14, 4)`. El quinto
  // dígito no se iba a guardar de ninguna forma. En bolívares, además, un
  // diezmilésimo no existe.
  const COMO_SE_ESCRIBE = { miles: true, maxDecimales: 4 } as const;

  const enEntrega = (enElLibro: number) =>
    formatAmountForInput(
      entregaInicial === "VES" && tasa ? enElLibro * tasa : enElLibro,
      COMO_SE_ESCRIBE,
    );

  const [monedaEntrega, setMonedaEntrega] = useState<"VES" | PriceCurrency>(
    entregaInicial,
  );
  const [monto, setMonto] = useState(() =>
    inicial?.entryAmount != null
      ? formatAmountForInput(inicial.entryAmount, COMO_SE_ESCRIBE)
      : enEntrega(inicial?.amount ?? total),
  );
  // ── EL CURSOR, QUE HAY QUE DEVOLVER A MANO ────────────────────────────
  //
  // El campo es controlado: React vuelve a pintar su `value` en cada tecla y
  // deja el cursor AL FINAL. Mientras el texto no cambiaba de forma eso no se
  // notaba; agrupando, cada millar que aparece lo empujaría y corregir un
  // dígito del medio sería imposible.
  //
  // Va en un `useLayoutEffect` y no en el propio `onChange` porque el valor
  // nuevo todavía no está en el DOM cuando el manejador corre: colocarlo allí
  // lo pone sobre el texto viejo y React lo pisa al repintar.
  // Todo eso lo hace `useGroupedAmount`, que nació el 2026-10-24 al llevar la
  // agrupación a los campos de dinero que faltaban: estas líneas estaban
  // copiadas en tres pantallas, idénticas, y un diff entre ellas no enseñaba
  // nada. Es la lección de `StickyActions` escrita en CLAUDE.md.
  const { ref: refMonto, onChange: alTeclearMonto } = useGroupedAmount(
    monto,
    setMonto,
    COMO_SE_ESCRIBE.maxDecimales,
  );

  const [usarPrevista, setUsarPrevista] = useState(
    inicial?.usarPrevista ?? false,
  );
  const [photoPath, setPhotoPath] = useState<string | null>(
    inicial?.photoPath ?? null,
  );
  const [plazo, setPlazo] = useState(inicial?.plazo ?? DEFAULT_PLAZO_PAGO);
  const [cuotas, setCuotas] = useState(inicial?.cuotas ?? "1");
  const [descripcion, setDescripcion] = useState(inicial?.description ?? "");

  // LAS DOS CIFRAS SON DOS HECHOS DISTINTOS, y la segunda se CALCULA:
  //
  //   «Monto»        lo que el cliente puso en la mano, en la moneda en que lo
  //                  puso. Va a `entry_amount` / `entry_currency`, que es el
  //                  registro más defendible en una disputa (migración `022`).
  //   «Equivalencia» lo que eso vale en el libro. Va a `amount`, y es lo que
  //                  descuenta de la venta.
  //
  // EN EL FRAME ES UNA CIFRA, NO UNA CASILLA — cambió así el 2026-10-18,
  // después de que yo la hubiera hecho editable. La versión editable permitía
  // expresar un descuento («recibo 10 y doy la cuenta por cerrada en 9,50»),
  // pero abría la puerta a que el libro y lo entregado contaran historias
  // distintas sin que nada chille. Se sigue el frame.
  const entregaEnOtraMoneda = monedaEntrega === "VES";
  const entregado = parseAmount(monto) ?? 0;

  // EL CÉNTIMO QUE CONVIERTE UNA VENTA PAGADA EN UN FIADO, y por qué hay un
  // ajuste aquí: 5.756,66 Bs a 985,73 son 5,8399… que redondea a 5,84 y
  // cuadra. Pero no siempre cae así — con otras cifras la división deja 19,99
  // sobre un total de 20, y la venta nace con un fiado de 0,01 que nadie
  // entiende y nadie cobra.
  //
  // Siendo la equivalencia una cifra calculada, el tendero ya no puede
  // corregirla a mano, así que el ajuste tiene que estar aquí: si lo convertido
  // queda a un céntimo de lo que falta, se usa lo que falta. Un céntimo de
  // holgura sobre una conversión no inventa dinero; un fiado fantasma sí
  // ensucia el saldo de alguien para siempre.
  const convertido = entregaEnOtraMoneda && tasa ? entregado / tasa : entregado;

  // EL CÉNTIMO QUE CONVIERTE UNA VENTA PAGADA EN UN FIADO. 5.756,66 Bs a
  // 985,73 dan 5,8399… que redondea bien, pero con otras cifras la división
  // deja 19,99 sobre un total de 20 y la venta nace con un fiado de 0,01 que
  // nadie entiende y nadie cobra. Siendo la equivalencia calculada, el tendero
  // no puede corregirla, así que el ajuste está aquí.
  const enElLibro =
    total > 0 && Math.abs(convertido - total) <= 0.01
      ? total
      : Math.round(convertido * 100) / 100;

  // ── EL CHIP NO SE ELIGE: SE DEDUCE DEL MONTO ──────────────────────
  //
  // Regla del dueño, 2026-10-18: «al seleccionar "De contado" en el input de
  // monto se pone el monto total de pago; si el monto se edita a un monto
  // diferente al total, entonces debe seleccionarse el chip "Fiado o
  // crédito"».
  //
  // Así que no hay un estado `tipo` que pueda discrepar de la cifra: paga todo
  // o no paga todo, y el chip lo dice. Es lo que hace imposible el caso que el
  // dueño vio en una captura —«Cobrado €5,84 · Fiado €2,03» sobre una venta de
  // 5,84— porque ya no hay dos cifras que puedan sumarse de más.
  const esContado = Math.abs(enElLibro - total) <= 0.005;
  const deMas = enElLibro - total > 0.005;

  // ── CERO ENTREGADO ES UNA VENTA VÁLIDA: ES UN FIADO ENTERO ──────────
  //
  // Era `enElLibro > 0 && entregado > 0 && !deMas` hasta el 2026-10-19, y con
  // eso UNA VENTA 100 % FIADA NO SE PODÍA REGISTRAR. `entregado` es lo que el
  // cliente paga en el acto, así que al pulsar «Fiado o crédito» —que vacía el
  // campo— valía 0 y el botón «Pagar» no se habilitaba nunca. Y el paso 3 no
  // deja avanzar sin decidir esa tarjeta, así que las dos puertas quedaban
  // cerradas a la vez y la venta no tenía salida: el tendero solo podía
  // inventarse un abono que el cliente no hizo, o abandonarla.
  //
  // FIAR ES EL PRODUCTO, así que esto bloqueaba el caso corriente —«llévatelo
  // y me pagas el viernes»— mientras el abono parcial, que es el menos
  // frecuente, sí funcionaba. Medido en dev el 2026-10-19: campo vacío,
  // deshabilitado; con un 0 escrito, deshabilitado; con 5 de 7,50, habilitado.
  //
  // Y EL SERVIDOR SIEMPRE LO ADMITIÓ. `registrarVenta` guarda una venta con
  // `pagos: []` sin protestar — `qa/venta-accion.mjs` lo prueba en varios
  // casos. Era solo la pantalla, que es la misma forma del fallo de las cuotas
  // del 2026-10-16: la acción lista y el formulario no.
  //
  // POR QUÉ NO HABÍA QUE PROTEGER UN ESTADO «SIN TOCAR», que es para lo que
  // parecía estar `entregado > 0`: el campo NACE con el total entero (ver
  // `useState` de `monto` más arriba), así que el diálogo abre ya en «De
  // contado». Llegar a cero exige un acto deliberado — pulsar el chip de
  // crédito, o vaciar con la X. No hay ambigüedad que defender.
  //
  // `>= 0` Y NO SOLO `!deMas`: `parseAmount` devuelve el número tal cual, así
  // que un «-5» escrito a mano pasaría como un pago negativo. Esa puerta se
  // queda cerrada.
  const listo = enElLibro >= 0 && !deMas;

  const plazoDias =
    plazo && plazo !== "sin_especificar" && Number.isFinite(Number(plazo))
      ? Number(plazo)
      : null;
  // LO QUE QUEDARÁ DEBIENDO, que es sobre lo que se reparten las cuotas.
  const debe = Math.round((total - enElLibro) * 100) / 100;
  const calendario = esContado
    ? []
    : calendarioDeCuotas(debe, plazoDias, Number(cuotas) || 1);

  // TOCAR UN CHIP ES ESCRIBIR EN EL MONTO, porque el chip es la consecuencia.
  //
  // «De contado» pone el total: es la regla del dueño, y el caso corriente.
  // «Fiado o crédito» VACÍA el campo para que escriba lo que de verdad le
  // dieron — dejarlo con el total sería un chip que dice «no paga todo» sobre
  // una cifra que es todo, y el propio chip saltaría de vuelta.
  function ponerTipo(siguiente: "contado" | "credito") {
    if (siguiente === "contado") {
      setMonto(enEntrega(total));
      return;
    }
    if (esContado) setMonto("");
  }

  return (
    <div className="flex flex-col gap-5">
      {/* LA TARJETA DEL TOTAL, la misma que la del paso 3. Sirve de
          recordatorio: la hoja tapa la pantalla entera en un teléfono. Ver
          `mostrarTotal`: el paso 2/2 del pedido la apaga porque su frame ya
          abre con la línea sellada. */}
      {mostrarTotal ? (
        <div className="flex flex-col justify-center gap-1 rounded-[10px] border px-4 py-2">
          <span className="text-sm">Total en {NOMBRE[moneda] ?? moneda}</span>
          <span className="flex items-center gap-1">
            <CurrencyFlagIcon currency={moneda} className="size-4" />
            <span className="text-base font-semibold tabular-nums">
              {formatPriceAmount(total, moneda)}
            </span>
          </span>
          {tasa ? (
            <span className="pl-5 text-xs text-muted-foreground tabular-nums">
              {formatPriceAmount(total * tasa, "VES")}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-4">
        <p className="text-base font-semibold">Detalles de pago</p>

        <div className="flex flex-col gap-2 rounded-[10px] border p-4">
          <div className="flex flex-col gap-2">
            <p className="text-sm">¿Cuánto paga?</p>
            <div className="flex flex-wrap gap-2">
              {[
                {
                  valor: "contado" as const,
                  texto: "De contado",
                  Icono: Check,
                },
                {
                  valor: "credito" as const,
                  texto: "Fiado o crédito",
                  Icono: Percent,
                },
              ].map(({ valor, texto, Icono }) => {
                const activo = (valor === "contado") === esContado;
                return (
                  <button
                    key={valor}
                    type="button"
                    onClick={() => ponerTipo(valor)}
                    aria-pressed={activo}
                    className="flex items-center gap-1 rounded-full border p-2 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
                        activo
                          ? "border-foreground"
                          : "border-muted-foreground/40"
                      }`}
                    >
                      {activo ? (
                        <span className="size-2 rounded-full bg-foreground" />
                      ) : null}
                    </span>
                    {texto}
                    {/* EL GLIFO DE CADA CHIP, del frame: un visto para el
                            contado y un porcentaje para el crédito. En rojo el
                            segundo porque es el que deja deuda — el mismo
                            criterio con el que el resto de la app pinta un
                            cargo. */}
                    <Icono
                      className={`size-4 shrink-0 ${valor === "credito" ? "text-destructive" : "text-money-in"}`}
                      aria-hidden="true"
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="pago-monto">Monto</Label>
            <div className="flex items-start gap-1">
              {/* LA «X» PARA VACIARLO DE UN TOQUE, a petición del dueño el
                      2026-10-18.

                      POR QUÉ HACE FALTA AQUÍ Y NO EN OTROS CAMPOS: este llega
                      RELLENO —con el total de la venta cuando se elige «De
                      contado»— y lo normal es querer otra cifra. Sin esto hay
                      que borrar dígito a dígito con el teclado numérico
                      abierto, que es donde «20000» tarda cinco toques en
                      desaparecer.

                      `onMouseDown` con `preventDefault` para no robarle el foco
                      al campo: sin eso el teclado del teléfono se cierra al
                      tocar la cruz y hay que volver a abrirlo para escribir. */}
              <div className="relative min-w-0 flex-1">
                <Input
                  id="pago-monto"
                  ref={refMonto}
                  className={monto ? "pr-9" : undefined}
                  inputMode="decimal"
                  value={monto}
                  // SE AGRUPA MIENTRAS SE TECLEA, a petición del dueño el
                  // 2026-10-23. El hook le pasa el valor ANTERIOR además
                  // del nuevo, y no es un capricho de la firma: tecleando
                  // `12345`, al llegar el `5` el texto crudo es `1.2345`,
                  // que leído solo no se distingue de «uno coma dos tres
                  // cuatro cinco».
                  onChange={alTeclearMonto}
                  placeholder="00"
                />
                {monto ? (
                  <button
                    type="button"
                    aria-label="Borrar el monto"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setMonto("")}
                    className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              {/* EL SELECTOR SOLO CON TASA. Sin ella no hay bolívares que
                      ofrecer, y un desplegable de una sola opción no decide
                      nada. */}
              {/* EN LAS DOS RAMAS. Lo tenía solo en el contado y los dos
                      frames lo dibujan igual: un fiado pactado en bolívares es
                      tan posible como un cobro en bolívares, y la deuda se
                      guarda convertida al libro exactamente igual. */}
              {/* EL DESPLEGABLE DEL DESIGN SYSTEM, NO EL NATIVO.
                      Instrucción del dueño el 2026-10-23 con la captura: un
                      `<select>` abre la rueda gris del sistema operativo —otra
                      tipografía, otros colores, otro radio— en medio de una
                      pantalla que es toda de la app.

                      ES EL MISMO MONTAJE QUE `abono-monto.tsx`, a propósito y
                      no por copiar: botón `outline` de 40px con la bandera, el
                      nombre y el chevron, y los ítems con su bandera. Los dos
                      campos preguntan lo mismo —«¿en qué moneda te lo
                      entregan?»— en dos flujos distintos, así que tienen que
                      verse iguales. Si a uno hay que cambiarle algo, al otro
                      también. */}
              {tasa ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-9 shrink-0 gap-2"
                      aria-label="Moneda que te entrega"
                    >
                      <CurrencyFlagIcon
                        currency={monedaEntrega === "VES" ? "VES" : moneda}
                        className="size-4 shrink-0"
                      />
                      <span className="text-xs">
                        {monedaEntrega === "VES"
                          ? "Bolívares"
                          : (NOMBRE[moneda] ?? moneda)}
                      </span>
                      <ChevronDown
                        className="size-4 shrink-0 opacity-60"
                        aria-hidden="true"
                      />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {([moneda, "VES"] as const).map((opcion) => (
                      <DropdownMenuItem
                        key={opcion}
                        onSelect={() => {
                          const siguiente = opcion as "VES" | PriceCurrency;
                          if (siguiente === monedaEntrega || !tasa) return;
                          // SE REEXPRESA LA CIFRA AL CAMBIAR. Dejar
                          // 5.756,66 rotulado «Dólares» no sería un fallo
                          // silencioso —el tope de la venta lo frena— pero
                          // sí un susto, y obliga a reteclear lo que la
                          // app ya sabe convertir.
                          // LA SEGUNDA PUERTA AL MISMO CAMPO, y la que más
                          // decimales suelta: dividir entre la tasa deja
                          // cola casi siempre. Si esta se quedara sin
                          // `COMO_SE_ESCRIBE`, el campo se vería bien al
                          // abrir y se ensuciaría al tocar el desplegable
                          // — que es peor que verse mal desde el principio.
                          const actual = parseAmount(monto) ?? 0;
                          setMonto(
                            formatAmountForInput(
                              siguiente === "VES"
                                ? actual * tasa
                                : actual / tasa,
                              COMO_SE_ESCRIBE,
                            ),
                          );
                          setMonedaEntrega(siguiente);
                        }}
                      >
                        <CurrencyFlagIcon
                          currency={opcion === "VES" ? "VES" : moneda}
                          className="size-4 shrink-0"
                        />
                        {opcion === "VES"
                          ? "Bolívares"
                          : (NOMBRE[moneda] ?? moneda)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </div>

          {entregaEnOtraMoneda ? (
            <p className="text-xs leading-4 text-muted-foreground">
              Un pago parcial queda guardado en {NOMBRE[moneda] ?? moneda} a la
              tasa equivalente.
            </p>
          ) : null}

          {/* LA PREVISTA SOLO SI EXISTE, y solo si hay algo que convertir.
                  Es una CASILLA y no una cifra: el navegador no manda ningún
                  número, solo pide que se use la tasa que el servidor ya tiene
                  guardada. */}
          {prevista && entregaEnOtraMoneda ? (
            <label className="flex cursor-pointer items-center gap-2 text-xs">
              <Checkbox
                checked={usarPrevista}
                onCheckedChange={(v) => setUsarPrevista(v === true)}
              />
              Aplicar tasa BCV prevista para el {formatDate(prevista.fecha)}
            </label>
          ) : null}

          {/* LA EQUIVALENCIA, SIEMPRE VISIBLE Y SIEMPRE CALCULADA. Es lo
                  que va a quedar escrito en el libro, así que se enseña grande
                  y en verde —`money-in`, el token con el que esta app pinta el
                  dinero que entra; el frame la fija en #176349—. No se puede
                  teclear: ver el comentario de `enElLibro`. */}
          <div className="flex items-center justify-between gap-2 py-2">
            <span className="flex flex-col justify-center gap-[3px]">
              <span className="text-xs font-medium">Equivalencia</span>
              <span className="text-xl font-semibold tabular-nums text-money-in">
                {formatPriceAmount(enElLibro, moneda)}
              </span>
            </span>
            <span className="flex shrink-0 items-center gap-1 text-xs">
              {NOMBRE[moneda] ?? moneda}
              <CurrencyFlagIcon currency={moneda} className="size-4" />
            </span>
          </div>

          {deMas ? (
            <p className="text-xs text-destructive">
              No puedes cobrar más de {formatPriceAmount(total, moneda)}.
            </p>
          ) : null}
        </div>
      </div>

      {/* ── LA RAMA DEL CRÉDITO ────────────────────────────────────── */}
      {!esContado ? (
        <>
          <PlazoPagoSelect
            value={plazo}
            onValueChange={(v) => {
              setPlazo(v);
              // Sin plazo no hay nada que repartir, así que las cuotas
              // vuelven a pago único — el `check` de la `118` lo exige, y
              // si no, el campo se esconde con un número dentro que nadie
              // acaba de decidir.
              if (v === "" || v === "sin_especificar") setCuotas("1");
            }}
          />
          <CuotasSelect
            value={cuotas}
            onValueChange={setCuotas}
            plazoDias={plazoDias}
          />

          {/* EL CALENDARIO, que es lo que convierte «3 cuotas en 30 días»
                  en algo que el tendero puede repetirle a su cliente. Se pinta
                  solo cuando hay plazo: sin fecha, una tabla de vencimientos
                  son tres rayas. */}
          {plazoDias != null && calendario.length > 1 ? (
            <div className="flex flex-col gap-2 rounded-[10px] border p-3">
              <div className="flex gap-2 text-sm">
                <span className="w-4">#</span>
                <span className="flex-1">Vence</span>
                <span className="flex-1 text-right">Monto</span>
              </div>
              {calendario.map((c) => (
                <div key={c.numero} className="flex items-center gap-2 text-xs">
                  <span className="w-4 tabular-nums">{c.numero}</span>
                  <span className="min-w-0 flex-1">
                    {c.vence ? formatDate(c.vence) : "—"}
                  </span>
                  <span className="flex-1 text-right tabular-nums">
                    {formatPriceAmount(c.monto, moneda)}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {/* FOTO (OPCIONAL) — está en los DOS frames y se me había quedado
              fuera entera; lo corrigió el dueño el 2026-10-18.

              `AttachmentUploader` es el mismo que usa el comprobante de un
              movimiento: ya resuelve subir desde la galería o abrir la cámara
              en un teléfono, y sube al bucket que la ficha del movimiento lee.
              Rehacerlo aquí habría sido copiar esa lógica para que un día una
              de las dos deje de abrir la cámara. */}
      <div className="flex flex-col gap-2">
        <Label>Foto (opcional)</Label>
        <AttachmentUploader
          ownerId={ownerId}
          value={photoPath}
          onChange={setPhotoPath}
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="pago-nota">Descripción (opcional)</Label>
        <Textarea
          id="pago-nota"
          className="h-[120px]"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          placeholder="Descripción"
        />
      </div>

      <Pie pegado={botonPegadoAbajo}>
      <Button
        type="button"
        className="h-10 w-full"
        disabled={!listo}
        onClick={() =>
          onGuardar({
            // LO QUE ENTRA HOY EN EL LIBRO. Lo que falte hasta el total es
            // la deuda, y la calcula el servidor: aquí no se teclea.
            amount: Math.round(enElLibro * 100) / 100,
            entryCurrency: entregaEnOtraMoneda ? "VES" : null,
            // LO ENTREGADO SE GUARDA SIEMPRE, no solo en bolívares. Con la
            // misma moneda coincide con `amount` salvo por el ajuste del
            // céntimo; en bolívares es la única constancia de cuántos
            // cambiaron de mano, que es para lo que existe `entry_amount`
            // desde la migración `022` — una tasa se revisa, un billete
            // contado no.
            entryAmount: entregado,
            // EL PLAZO Y LAS CUOTAS VIAJAN SIEMPRE y el servidor los ignora
            // cuando no hay deuda que pactar, porque entonces no escribe
            // ningún cargo. Limpiarlos aquí según el chip obligaría a
            // volver a elegirlos si el tendero baja el monto y lo sube.
            plazo,
            cuotas,
            usarPrevista,
            photoPath,
            description: descripcion.trim(),
          })
        }
      >
        {etiquetaBoton ?? "Pagar"}
      </Button>
      </Pie>
    </div>
  );
}

// ── EL PIE: `StickyActions` O NADA, Y NUNCA SUS CLASES COPIADAS ───────
//
// Un envoltorio de tres líneas en vez de un `botonPegadoAbajo ? <Sticky…>`
// repetido alrededor del botón: con el ternario habría que escribir el botón
// dos veces, y dos copias de un botón que escribe dinero es exactamente la
// clase de duplicado que este fichero nació para quitar.
//
// SIN PEGAR DEVUELVE A SUS HIJOS TAL CUAL, no un `<div>` vacío: dentro de la
// hoja del asistente de venta, un contenedor de más rompería el `gap` de la
// columna que lo envuelve.
function Pie({
  pegado,
  children,
}: {
  pegado: boolean;
  children: React.ReactNode;
}) {
  if (!pegado) return <>{children}</>;
  return <StickyActions>{children}</StickyActions>;
}
