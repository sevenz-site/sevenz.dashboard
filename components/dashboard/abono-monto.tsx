"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { AttachmentUploader } from "@/components/dashboard/attachment-uploader";
import { WhatsappConsentField } from "@/components/dashboard/whatsapp-consent-field";
import {
  BsAmountPreview,
  MontoARegistrarRow,
  PrevistaCheckbox,
  ResumenMonto,
  montoConvertido,
} from "@/components/dashboard/movement-currency-field";
import { registrarAbonoDirigido } from "@/app/(app)/abonos/actions";
import { fijarEnBorrador, leerBorrador } from "@/lib/abonos/borrador";
import type { MovementRateContext } from "@/lib/exchange-rate/convert";
import { topeEnBolivares } from "@/lib/exchange-rate/monto-en-bolivares";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBs } from "@/lib/exchange-rate/format";
import { toBs } from "@/lib/exchange-rate/convert";
import {
  formatAmountWhileTyping,
  formatPriceAmount,
  parseAmount,
  type PriceCurrency,
} from "@/lib/products/price";
import type { LedgerCurrency, MonedaTecleada } from "@/lib/types";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { StickyActions } from "@/components/dashboard/sticky-actions";

// PASO 3/3 DEL ABONO DIRIGIDO — frame `1389:9381`.
//
// ===========================================================================
// ESTA PANTALLA NO TIENE CAMPOS PROPIOS DE DINERO, Y ESO ES EL PUNTO
//
// Las pastillas de moneda, la tarjeta del monto, la de «Monto a registrar», la
// casilla de la tasa prevista y el «Resumen» son LOS MISMOS componentes que
// pinta el formulario de «Agregar» — `movement-currency-field.tsx`. Se reusan
// a petición del dueño el 2026-10-19 (*«los componentes de chips para
// seleccionar la moneda a registrar ya existen en el formulario actual de
// Agregar, así como los inputs de Montos y Resumen»*), y la primera versión de
// esta pantalla los había vuelto a escribir a mano.
//
// Reusarlos no es solo ahorro de líneas: `montoConvertido` hace exactamente la
// misma cuenta que `convertirDesdeBolivares` hace en el servidor
// —`Math.round((bs / porUnidad) * 100) / 100`—, así que la cifra que el tendero
// lee y la que se guarda no pueden separarse. Dos conversiones escritas aparte
// se separan el día que una se corrija.
//
// LO ÚNICO QUE ESTA PANTALLA AÑADE es que aquí el libro de destino NO se elige:
// el abono va a UN fiado y ese fiado ya tiene su moneda. Por eso las pastillas
// llevan dos opciones y no tres, y `MontoARegistrarRow` va sin desplegable.

// LAS TRES RESPUESTAS POSIBLES A «¿CUÁNTO QUEDA DEL ABONO?», como números para
// que `useSyncExternalStore` pueda compararlas sin inventar un objeto nuevo en
// cada render. `DESCONOCIDO` es «todavía no se ha leído el borrador» y NO es
// lo mismo que `SIN_LIMITE`: con el primero el botón se queda apagado, con el
// segundo manda el tope del fiado.
const DESCONOCIDO = -1;
const SIN_LIMITE = Number.POSITIVE_INFINITY;

// Fuera del componente para que su referencia no cambie: `useSyncExternalStore`
// vuelve a suscribirse cada vez que esta función es otra.
const sinSuscripcion = () => () => {};

export function AbonoMonto({
  ownerId,
  fiadoId,
  clienteId,
  clienteNombre,
  clienteTieneWhatsapp,
  libro,
  pendiente,
  rateContext,
  yaAceptaAvisos,
  pasoUnico = false,
  enReparto = false,
  sufijoDelOrigen = "",
}: {
  ownerId: string;
  fiadoId: string;
  clienteId: string;
  clienteNombre: string;
  clienteTieneWhatsapp: boolean;
  // La moneda del fiado. `null` es un negocio colombiano: un solo libro, sin
  // monedas que elegir ni equivalencias que enseñar.
  libro: LedgerCurrency | null;
  pendiente: number;
  rateContext: MovementRateContext | null;
  yaAceptaAvisos: boolean;
  // SE LLEGÓ DESDE LA FICHA DEL FIADO, no desde el paso 2/2. Ver el porqué en
  // la página que lo decide; aquí solo cambia el rótulo y la flecha.
  pasoUnico?: boolean;
  // SE LLEGÓ DESDE UN REPARTO. Entonces esta pantalla NO guarda: fija lo que
  // le toca a este fiado y vuelve a «1/2 fiados». Ver `fijarYVolver`.
  enReparto?: boolean;
  // `&desde=cliente`, o cadena vacía. Se arrastra en las DOS vueltas al paso
  // 1/2 —la flecha y `fijarYVolver`— porque si se perdiera en una de ellas la
  // flecha de allí funcionaría hasta el primer reparto y después no. Ver
  // `desde` en `abono-reparto.tsx`.
  sufijoDelOrigen?: string;
}) {
  const router = useRouter();
  const [guardando, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const llevaDivisas = libro !== null;
  const moneda = (libro ?? "COP") as PriceCurrency;

  // SE PUEDE ESCRIBIR EN BOLÍVARES solo si hay con qué convertir. Sin tasa, la
  // única moneda posible es la del libro: ofrecer bolívares y rechazarlos al
  // guardar sería peor que no ofrecerlos.
  const puedeBolivares = llevaDivisas && rateContext != null;

  const [monedaTecleada, setMonedaTecleada] = useState<MonedaTecleada>(libro ?? "USD");
  const [monto, setMonto] = useState("");

  // ── EL MONTO SE AGRUPA MIENTRAS SE TECLEA ─────────────────────────────
  //
  // El mismo trato que el campo de la hoja de cobro, por petición del dueño el
  // 2026-10-23. Aquí no llega relleno con una cifra fea —nace vacío o con lo
  // que el tendero escribió antes— pero dejarlo sin agrupar era la otra mitad
  // de la incoherencia: la línea de debajo YA decía `Bs. 12.260.350,06` y el
  // campo de encima, `12345,6789012`.
  //
  // EL CURSOR HAY QUE DEVOLVERLO A MANO: el campo es controlado, así que React
  // repinta su valor en cada tecla y lo deja al final. Sin esto, cada millar
  // que aparece lo empuja y corregir un dígito del medio es imposible. Va en
  // un `useLayoutEffect` porque cuando el `onChange` corre, el valor nuevo
  // todavía no está en el DOM.
  const campoMonto = useRef<HTMLInputElement>(null);
  const cursorPendiente = useRef<number | null>(null);

  useLayoutEffect(() => {
    const destino = cursorPendiente.current;
    if (destino == null || campoMonto.current == null) return;
    cursorPendiente.current = null;
    campoMonto.current.setSelectionRange(destino, destino);
  });

  const [usarPrevista, setUsarPrevista] = useState(false);
  const [descripcion, setDescripcion] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [avisar, setAvisar] = useState(false);

  // `parseAmount` Y NO `Number(...)`, que es lo que había aquí.
  //
  // `Number("0,95")` es `NaN`, y con `|| 0` eso se convierte en CERO sin que
  // nada chille. El campo lleva `inputMode="decimal"` y el texto de al lado
  // escribe las cifras con coma, así que el tendero teclea comas: ESTE CAMPO
  // NUNCA SUPO LEERLAS. Es anterior al formateo de miles del 2026-10-23, pero
  // ese formateo lo dejó al descubierto —desde él, el campo solo produce
  // comas— así que lo que era «a veces» pasó a ser «siempre».
  //
  // `parseAmount` es el lector de dinero del repo y entiende las dos
  // convenciones, los miles y los decimales. Su comentario ya lo decía: dos
  // copias de un lector de dinero son dos oportunidades de arreglar solo una.
  const escrito = parseAmount(monto) ?? 0;

  // La misma tasa que el servidor va a sellar, no una copia: el objeto viene
  // del servidor y la casilla solo elige cuál de las dos usar.
  const tasaActiva =
    usarPrevista && rateContext?.prevista
      ? { usd: rateContext.prevista.usd, eur: rateContext.prevista.eur }
      : rateContext?.effectiveRate;

  // LO QUE VA A QUEDAR GUARDADO, en la moneda del fiado. Se calcula aquí solo
  // para ENSEÑARLO; la cifra que se guarda la vuelve a calcular el servidor con
  // la tasa que él mismo sella. Dos cálculos para dos propósitos distintos: uno
  // informa, el otro decide, y el que decide nunca viaja en la petición.
  const enElLibro =
    monedaTecleada === "VES" && libro && rateContext
      ? (montoConvertido(monto, libro, rateContext, usarPrevista) ?? 0)
      : escrito;

  // ===========================================================================
  // DENTRO DE UN REPARTO, EL TOPE TAMBIÉN ES LO QUE QUEDA DEL ABONO
  //
  // Decisión del dueño del 2026-10-22: manda lo tecleado. El campo «¿Cuánto
  // abona?» de la 1/2 es el billete que el cliente puso en el mostrador, y una
  // línea no puede llevarse más que el billete entero.
  //
  // Sin esto, tecleando $1 y fijando $7 aquí la pantalla 1/2 acababa diciendo
  // dos cifras que se contradicen —el campo «1», el botón «Pagar y finalizar
  // $7.00»— y el servidor guardaba 7. En Venezuela era peor: convierte LO
  // TECLEADO a bolívares y lo reparte entre líneas que suman otra cosa, así
  // que la equivalencia guardada no correspondía a lo cobrado.
  //
  // Lo que ya está fijado a mano en OTRAS líneas se descuenta; lo de esta no,
  // para que volver a entrar a corregirla no la deje atrapada en su propia
  // cifra. Esos importes ya vienen topados a su fiado —los escribió esta misma
  // pantalla—, así que no hace falta conocer los demás pendientes.
  // EL BORRADOR SE LEE DESPUÉS DE MONTAR, NO AL PINTAR.
  //
  // Vive en `sessionStorage`, que el servidor no tiene. Leerlo durante el
  // render hace que el servidor pinte «Máximo $50.00» y el navegador «Máximo
  // $20.00» sobre el mismo HTML: React lo detecta, tira el árbol entero y lo
  // vuelve a montar. En la pantalla donde se teclea dinero eso no es un aviso
  // de consola, es la pantalla rehaciéndose debajo del dedo.
  //
  // Mientras no se haya leído, el botón se queda apagado. Es un fotograma, no
  // se ve, y es la única forma de no enseñar un tope permisivo --el del fiado,
  // más alto-- antes de saber el verdadero.
  // `useSyncExternalStore` y no un `useState` con su efecto: es la herramienta
  // que existe para esto, y lo que la hace la correcta aquí es su TERCER
  // argumento --la instantánea del servidor--. React la usa al hidratar y
  // cambia a la del navegador después, así que el servidor y el primer pintado
  // del cliente coinciden sin que nadie tenga que acordarse de nada.
  //
  // Sin suscripción: el borrador no cambia mientras esta pantalla vive. Quien
  // lo cambia es la 1/2, y para volver a ella hay que salir de aquí.
  const leido = useSyncExternalStore(
    sinSuscripcion,
    () => {
      if (!enReparto) return SIN_LIMITE;
      const b = leerBorrador(clienteId);
      if (!b) return SIN_LIMITE;
      // SIN BILLETE NO HAY TOPE DEL ABONO: cada fiado queda topado solo por lo
      // que debe. Es el estado en el que entra la 1/2 cuando el tendero empieza
      // a pagar fiado por fiado; ver `totalEnLibro` en `borrador.ts`.
      if (b.totalEnLibro == null) return SIN_LIMITE;
      // Lo de ESTA línea no se descuenta: volver a entrar a corregirla la
      // dejaría atrapada en su propia cifra. Los importes del borrador ya
      // vienen topados a su fiado --los escribió esta misma pantalla--, así
      // que no hace falta conocer los demás pendientes.
      const otras = Object.entries(b.aMano).reduce(
        (s, [id, v]) => (id === fiadoId ? s : s + v),
        0,
      );
      return Math.max(0, Math.round((b.totalEnLibro - otras) * 100) / 100);
    },
    () => DESCONOCIDO,
  );

  const borradorLeido = leido !== DESCONOCIDO;
  const restanteDelAbono: number | null =
    leido === DESCONOCIDO || leido === SIN_LIMITE ? null : leido;

  // El tope de verdad es el menor de los dos, y cuál de ellos manda cambia el
  // mensaje: «lo que debe este fiado» y «lo que queda del abono» se corrigen
  // de formas distintas.
  const topeEnLibro = restanteDelAbono != null ? Math.min(pendiente, restanteDelAbono) : pendiente;
  const mandaElAbono = restanteDelAbono != null && restanteDelAbono < pendiente - 0.005;

  // EL TOPE, EN LA MONEDA EN QUE SE ESTÁ ESCRIBIENDO. Comparar bolívares
  // tecleados contra una deuda en dólares es un fallo que ya estuvo en
  // producción —ver `topeEnBolivares`—, y aquí reaparecería igual: con un fiado
  // de $55, «Bs. 100» son doce céntimos y se rechazarían por ser 100 > 55.
  const topeTecleado: number | null =
    monedaTecleada !== "VES"
      ? topeEnLibro
      : libro
        ? topeEnBolivares(topeEnLibro, libro, tasaActiva)
        : null;

  const topeLegible =
    monedaTecleada === "VES" ? formatBs(topeTecleado ?? 0) : formatPriceAmount(topeEnLibro, moneda);

  const deMas = enElLibro - topeEnLibro > 0.005;
  // Sin nada que repartir no hay cifra válida que escribir, y decirlo aquí
  // ahorra que el tendero pruebe números hasta rendirse: el abono entero ya
  // está puesto en otras líneas.
  const abonoAgotado = restanteDelAbono != null && restanteDelAbono <= 0.005;
  const listo = enElLibro > 0 && !deMas && borradorLeido;

  // ===========================================================================
  // DENTRO DE UN REPARTO, ESTA PANTALLA NO GUARDA
  //
  // Decisión del dueño del 2026-10-22: al pulsar aquí *«regresa a 1/2 fiados
  // para seleccionar otro abono a pagar»*. Lo que el tendero fija es cuánto le
  // toca a ESTE fiado; lo que escribe en la base es «Pagar y finalizar», una
  // sola vez y con todas las líneas juntas.
  //
  // Es la mitad de `CT-128` sin la cual el reparto no sería una transacción:
  // guardando aquí, tres fiados serían tres pagos y TRES WhatsApp al cliente
  // por un solo billete.
  //
  // El monto se queda en el borrador del navegador, no en la base: mientras el
  // tendero va y viene no hay NADA escrito, así que abandonar a mitad no deja
  // medio pago en ningún sitio.
  function fijarYVolver() {
    setError(null);
    fijarEnBorrador(clienteId, fiadoId, enElLibro, libro);
    router.push(`/abonos/nuevo?cliente=${clienteId}${sufijoDelOrigen}`);
  }

  function guardar() {
    setError(null);
    startTransition(async () => {
      const r = await registrarAbonoDirigido({
        fiadoId,
        monto: escrito,
        monedaTecleada: monedaTecleada as "VES" | PriceCurrency,
        usarPrevista,
        photoPath,
        descripcion,
        // Se mandan los DOS por separado: que la casilla estuviera en pantalla
        // y que la marcara. Mandar solo «aceptó» hace que un «no» no quede
        // anotado, y entonces la casilla vuelve a salir en el siguiente
        // movimiento como si nunca se hubiera preguntado.
        permisoMostrado: !yaAceptaAvisos,
        avisarPorWhatsapp: avisar,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.push(`/abonos/${r.movementId}`);
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* LA FLECHA VUELVE POR DONDE SE VINO.
          Llegando del paso 2/3, al paso 2/3. Llegando del botón «Pagar» de la
          ficha del fiado, a esa ficha -- que es lo que el dueño reportó el
          2026-10-20: *«si el usuario desea regresar al detalle seleccionando
          "Regresar" lo regresa a los dos pasos previos del flujo y eso está
          mal»*.

          `soloEnTelefono={false}` porque `app-header.tsx` esconde la barra de la
          app en todo `/abonos` a TODAS las anchuras: sin esto, desde `sm` la
          pantalla se quedaría sin ninguna salida. */}
      <ScreenBackRow
        // SIN EL DETALLE INTERMEDIO, la vuelta del reparto es la 1/2 — que
        // es de donde se vino desde que el dueño quitó ese paso el
        // 2026-10-23. Antes volvía a `/abonos/nuevo/<fiado>?reparto=1`, una
        // pantalla que ya no está en el camino.
        href={
          pasoUnico
            ? `/transacciones/${fiadoId}`
            : enReparto
              ? `/abonos/nuevo?cliente=${clienteId}${sufijoDelOrigen}`
              : `/abonos/nuevo/${fiadoId}`
        }
        label={pasoUnico ? "Volver al detalle" : clienteNombre}
        soloEnTelefono={false}
      />

      <div className="flex flex-col gap-2">
        <ScreenTitle>Registrar abono</ScreenTitle>
        {/* ── EL CONTADOR, DESPUÉS DE QUITAR EL PASO INTERMEDIO ──────
            El dueño lo reportó el 2026-10-23: *«los pasos y el progreso de la
            barra no coinciden»*. Tenía razón, y había DOS cosas mal.

            LA PRIMERA: «3/3» no existía en ningún camino real. El reparto era
            1/2 → 2/2 (detalle) → 2/2 (monto) —dos pantallas con el MISMO
            número— y desde la ficha de un fiado era 1/1. El «3/3» se quedó de
            una versión con tres pasos que ya no estaba.

            LA SEGUNDA: la barra iba siempre al 100 %, también en el paso
            intermedio. Una barra llena en mitad del camino dice «ya está» y
            la pantalla siguiente la desmiente.

            AHORA SON DOS CAMINOS Y SE CUENTAN SOLOS: por el reparto, 1/2
            fiados → 2/2 monto; por la ficha de un fiado, 1/1. La barra va al
            100 % porque en los dos casos ESTA es la última pantalla. */}
        <p className="text-sm text-muted-foreground">
          {pasoUnico || !enReparto ? "1/1" : "2/2"} Monto a abonar
        </p>
        <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-full rounded-full bg-foreground transition-all" />
        </div>
      </div>

      {/* «FIADO SELECCIONADO», ARRIBA DEL TODO. Es el tope y es la razón de
          estar aquí: sin verlo, el tendero escribe una cifra a ciegas y se
          entera del límite cuando la acción se la rechaza. */}
      <div className="flex items-center justify-between gap-4 rounded-[10px] border px-4 py-3">
        <span className="text-xs text-muted-foreground">Fiado seleccionado</span>
        <span className="flex flex-col items-end">
          <span className="flex items-center gap-1.5 text-base font-semibold tabular-nums">
            {llevaDivisas ? <CurrencyFlagIcon currency={libro} className="size-4 shrink-0" /> : null}
            {formatPriceAmount(pendiente, moneda)}
          </span>
          {/* LA EQUIVALENCIA, SIEMPRE Y DEBAJO — frame `1564:11409`, y encargo
              del dueño el 2026-10-23: *«en la card "Fiado seleccionado"
              agregar la equivalencia en bolívares siempre»*.

              SIEMPRE Y NO SOLO AL TECLEAR BOLÍVARES: esta cifra es el TOPE, y
              el tendero que va a escribir bolívares necesita saber contra qué
              se mide ANTES de escribir. Sin ella escribe a ciegas y se entera
              del límite cuando la pantalla se lo rechaza.

              CON LA TASA DE HOY (`effectiveRate`) y no con la prevista: esto
              no es lo que se va a guardar —eso es el «Resumen» de abajo, que
              sí sigue la casilla— es cuánto debe ese fiado si se mirara hoy.
              La palabra «hoy» es parte de la frase por eso.

              Un negocio colombiano no la ve: no hay bolívares que enseñar. */}
          {/* SIN BANDERA — encargo del dueño el 2026-10-23, con la captura de
              esta misma línea señalada: *«en la equivalencia en Bolívares no
              agregues la bandera, solo en el monto principal en dólares o
              euros»*. La llevaba desde esa misma mañana, cuando pidió añadir
              la equivalencia; las dos peticiones quedan escritas.

              CONFIRMADO al señalarle que el frame `1564:11586` sí la dibuja.
              La regla y su frontera —qué es «monto principal» y qué es
              «equivalencia»— están en `DESIGN-SYSTEM.md`. */}
          {llevaDivisas && rateContext ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatBs(toBs(pendiente, libro, rateContext.effectiveRate))} hoy
            </span>
          ) : null}
        </span>
      </div>

      {/* ═══════════════════════════════════════════════════════════════
          UN SOLO BLOQUE: «¿CUÁNTO ABONA?» + DESPLEGABLE — frame `1564:11567`

          Eran DOS secciones: «Moneda a registrar», con una pastilla por
          moneda, y «Monto», con su campo debajo. El dueño pasó el frame el
          2026-10-23: *«en la sección "Moneda a registrar" y "Monto" no es lo
          que te pasé en el frame, acá la sección precisa que unifica ambas»*.

          ES EL MISMO PATRÓN QUE LA 1/2, y eso es la mitad del encargo: las
          dos pantallas del mismo flujo preguntan lo mismo —cuánto y en qué
          moneda— y hasta hoy lo preguntaban de dos formas distintas. Un
          tendero que aprende una tiene que volver a aprender la otra.

          LAS OPCIONES SIGUEN SIENDO DOS, NO TRES: bolívares y la moneda de
          este fiado. La tercera sería abonar un fiado en dólares con euros,
          que es la conversión entre libros que este producto no hace nunca
          (ver `convert.ts`). Lo que cambió es la forma del control, no lo que
          ofrece. */}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="monto">¿Cuánto abona?</Label>
        <div className="flex items-start gap-2">
          <Input
            id="monto"
            name="monto"
            inputMode="decimal"
            value={monto}
            ref={campoMonto}
            onChange={(e) => {
              const { texto, cursor } = formatAmountWhileTyping(
                e.target.value,
                monto,
                e.target.selectionStart ?? e.target.value.length,
              );
              cursorPendiente.current = cursor;
              setMonto(texto);
            }}
            placeholder="00"
            aria-invalid={deMas || undefined}
            className="h-10 flex-1 text-lg"
          />
          {/* SIN DESPLEGABLE CUANDO NO HAY NADA QUE ELEGIR: un negocio
              colombiano, o uno venezolano sin tasa con la que convertir. Un
              selector de una sola opción es una pregunta sin respuesta
              posible. */}
          {puedeBolivares ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="h-10 shrink-0 gap-2">
                  <CurrencyFlagIcon
                    currency={monedaTecleada as PriceCurrency}
                    className="size-4 shrink-0"
                  />
                  <span className="text-xs">
                    {monedaTecleada === "VES"
                      ? "Bolívares"
                      : monedaTecleada === "EUR"
                        ? "Euros"
                        : "Dólares"}
                  </span>
                  <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(["VES", libro] as const).map((m) => (
                  <DropdownMenuItem key={m} onSelect={() => setMonedaTecleada(m as MonedaTecleada)}>
                    <CurrencyFlagIcon currency={m as PriceCurrency} className="size-4 shrink-0" />
                    {m === "VES" ? "Bolívares" : m === "EUR" ? "Euros" : "Dólares"}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        {/* LA EQUIVALENCIA, DEBAJO Y SIN BANDERA — frame `1564:11586` y el
            encargo del 2026-10-23 sobre las banderas. Enseña la OTRA moneda:
            tecleando bolívares dice lo que son en el libro, y al revés.

            SOLO CON UNA CIFRA ESCRITA: «Bs. 0,00» debajo de un campo vacío no
            informa de nada y empuja hacia abajo el aviso del tope. */}
        {rateContext && libro && (parseAmount(monto) ?? 0) > 0 ? (
          monedaTecleada === "VES" ? (
            <MontoARegistrarRow
              bolivares={monto}
              destino={libro}
              rateContext={rateContext}
              usarPrevista={usarPrevista}
              type="payment"
            />
          ) : (
            <BsAmountPreview
              amount={monto}
              currency={libro}
              rateContext={rateContext}
              usarPrevista={usarPrevista}
            />
          )
        ) : null}

        {/* UN SOLO RENGLÓN con el tope: en gris mientras va bien y el error
            rojo EN SU LUGAR cuando se pasa. Misma decisión que el formulario
            de «Agregar», donde los dos a la vez hacían que el dueño leyera el
            mismo aviso repetido.

            ESTO NO ESTÁ EN EL FRAME y se queda: es el tope del abono, y sin
            él el tendero escribe a ciegas y se entera del límite cuando la
            acción se lo rechaza. */}
        <p
          className={
            deMas || abonoAgotado
              ? "text-sm leading-5 text-destructive"
              : "text-sm text-muted-foreground"
          }
        >
          {abonoAgotado
            ? "Ya repartiste todo el abono. Vuelve atrás y deshaz otro fiado, o escribe un abono mayor."
            : deMas
              ? mandaElAbono
                ? `Del abono quedan ${formatPriceAmount(restanteDelAbono ?? 0, moneda)}. Escribe esa cantidad o menos.`
                : `Ese fiado solo debe ${formatPriceAmount(pendiente, moneda)}. Escribe esa cantidad o menos.`
              : `Máximo ${topeLegible} — ${mandaElAbono ? "lo que queda del abono" : "lo que debe este fiado"}.`}
        </p>

        {/* LA FRASE DEL FRAME, REESCRITA CON LO QUE DE VERDAD PASA.
            El frame dice «Abono quedará guardado en Bolívares a la tasa
            equivalente», y eso es FALSO en este producto: el abono se guarda
            en la moneda del FIADO, con la tasa sellada de hoy. Preguntado al
            dueño el 2026-10-23 entre quitarla y reescribirla, eligió
            reescribirla — dice lo que el frame quería decir (que hay una
            conversión de por medio) sin afirmar algo que no ocurre.

            SOLO TECLEANDO BOLÍVARES: es cuando hay conversión que explicar. */}
        {monedaTecleada === "VES" && libro ? (
          <p className="text-xs leading-4 text-muted-foreground">
            Se guarda en {libro === "EUR" ? "euros" : "dólares"} a la tasa de hoy; los bolívares
            son la equivalencia.
          </p>
        ) : null}

        {rateContext && libro ? (
          <>
            {/* LA CASILLA DE LA PREVISTA SE GOBIERNA SOLA. El frame la dibuja
                siempre porque su maqueta tiene uno de esos viernes; el
                componente aplica `tocaOfrecerPrevista`, la misma ventana que
                usan las dos calculadoras y el formulario de «Agregar». La
                versión anterior de esta pantalla la pintaba en cuanto hubiera
                una prevista guardada, que es una segunda regla para la misma
                casilla. */}
            <PrevistaCheckbox
              rateContext={rateContext}
              checked={usarPrevista}
              onCheckedChange={setUsarPrevista}
            />
          </>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="descripcion">Descripción (opcional)</Label>
        <Textarea
          id="descripcion"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          className="min-h-[120px]"
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label>Foto (opcional)</Label>
        <AttachmentUploader ownerId={ownerId} value={photoPath} onChange={setPhotoPath} />
      </div>

      {/* EL RESUMEN, JUSTO ANTES DEL BOTÓN. Repite la cifra que se va a anotar y
          no se toca. Tecleando la moneda del fiado repite lo escrito, que parece
          redundante y no lo es: con el monto arriba y la foto en medio, en un
          teléfono el número ya no se ve cuando el dedo llega al botón. */}
      <ResumenMonto
        type="payment"
        monto={enElLibro > 0 ? enElLibro : null}
        moneda={libro}
        rateContext={rateContext}
        usarPrevista={usarPrevista}
        bolivaresTecleados={monedaTecleada === "VES" ? monto : null}
      />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {/* ── `StickyActions`, NO LA MISMA BARRA COPIADA A MANO ──────────────
          Esta barra llevaba las clases de `StickyActions` escritas aquí una
          por una, y por eso NO heredaba lo único que ese componente añade
          sobre un `sticky`: desaparecer con el teclado abierto.

          Lo reportó el dueño el 2026-10-20 con una captura: tecleando el
          monto, «Pagar» y el aviso de WhatsApp se quedaban flotando encima
          del teclado numérico, tapando el campo que estaba rellenando. Es
          EXACTAMENTE el fallo que él mismo reportó el 2026-10-18 con
          «Registrar y finalizar» sobre el campo Documento, y que `StickyActions`
          existe para no repetir — pero esta pantalla no lo montaba.

          Las clases eran idénticas salvo `gap-3` contra el `gap-4` del
          componente y `pt-4` contra `pt-3`. O sea que la copia ya había
          empezado a separarse del original, que es cómo acaban las copias. */}
      <StickyActions>
        {/* EL PERMISO DE WHATSAPP, ENCIMA DEL BOTÓN — donde el frame lo pone.
            Es `WhatsappConsentField`, el mismo de las otras tres puertas, y no
            la frase del frame: lo que la casilla enseña es LITERALMENTE lo que
            se guarda como evidencia (`textoPermisoDeclarado`), y dos cadenas
            distintas —una para enseñar y otra para guardar— convierten la
            prueba ante Meta en una reconstrucción. Ver `lib/whatsapp-opt-in.ts`.

            EL RECIBO QUE SALE DE AQUÍ VIAJA CON `abono_confirmation_v3`,
            confirmada en producción el 2026-10-16. La `v2` fue la que se aprobó
            con el botón de URL estático y tumbó 12 de 12 envíos (`MS-39`); si
            alguien lee esa ficha y cree que el recibo no funciona, es esa. */}
        {/* EN UN REPARTO, LA CASILLA NO VA AQUÍ. Decisión del dueño del
            2026-10-22: sube a «1/2 fiados», junto a «Pagar y finalizar».
            Pedir permiso para mandar en una pantalla que no manda nada es
            confuso, y pedirlo una vez por fiado lo es más — un reparto de
            tres preguntaría tres veces por el mismo cliente. */}
        {enReparto ? null : (
          <WhatsappConsentField
            clientName={clienteNombre}
            hasWhatsapp={clienteTieneWhatsapp}
            yaTienePermiso={yaAceptaAvisos}
            checked={avisar}
            onCheckedChange={setAvisar}
            disabled={guardando}
          />
        )}
        <Button
          type="button"
          className="h-10 w-full"
          disabled={!listo || guardando}
          onClick={enReparto ? fijarYVolver : guardar}
        >
          {guardando
            ? "Guardando…"
            : enElLibro > 0
              ? `Pagar ${formatPriceAmount(enElLibro, moneda)}`
              : "Pagar"}
        </Button>
      </StickyActions>
    </div>
  );
}
