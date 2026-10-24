"use client";

import { useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Search, Trash2 } from "lucide-react";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { StickyActions } from "@/components/dashboard/sticky-actions";
import { TarjetaDeFiado, type FiadoAbierto } from "@/components/dashboard/tarjeta-de-fiado";
import { WhatsappConsentField } from "@/components/dashboard/whatsapp-consent-field";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { registrarAbonoRepartido } from "@/app/(app)/abonos/actions";
import {
  guardarBorrador,
  leerBorrador,
  borrarBorrador,
  type BorradorDeReparto,
} from "@/lib/abonos/borrador";
import {
  repartir,
  deudaDelLibro,
  repartirEnBolivares,
  deudaEnBolivares,
  type FiadoParaRepartirMulti,
} from "@/lib/abonos/reparto";
import { formatBs } from "@/lib/exchange-rate/format";
import {
  formatAmountWhileTyping,
  formatPriceAmount,
  parseAmount,
  priceIn,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";
import type { LedgerCurrency } from "@/lib/types";

// PASO 1/2 DEL ABONO REPARTIDO — frame `1526:11182`.
//
// El tendero escribe cuánto le pagaron y la pantalla enseña cómo cae ese
// dinero entre los fiados abiertos, antes de guardar nada. Sustituye al paso
// 1/3, que obligaba a elegir UN fiado y repetir la operación por cada uno.
//
// ===========================================================================
// EL REPARTO SE CALCULA DOS VECES A PROPÓSITO
//
// Aquí, para enseñarlo; y en el servidor, para guardarlo. Es la MISMA función
// —`repartir()`— con las mismas entradas, así que no pueden discrepar. Lo que
// NO se hace es mandar las líneas ya repartidas desde el navegador: entonces
// cualquiera podría guardar un reparto que no sigue la gravedad o que le mete
// a un fiado más de lo que debe, y esta pantalla no tendría forma de notarlo.
//
// ===========================================================================
// DOS TARJETAS DISTINTAS, COMO EL FRAME, Y ESO CAMBIÓ EL 2026-10-23
//
// El frame `1564:11211` dibuja DOS: la que ya tiene importe asignado lleva
// título, FECHA y su renglón «Abona» debajo (`1564:11242`); la que no lleva
// título, la cifra en rojo debajo y un botón «Pagar» al lado, SIN fecha
// (`1564:11286`).
//
// HASTA HOY LAS DOS ERAN `TarjetaDeFiado` con cosas distintas debajo, y la
// razón escrita era buena: tres copias de la misma tarjeta en tres archivos
// es cómo dejan de ser la misma. Lo que esa razón no cubría es que no son la
// misma tarjeta — tienen distinto contenido y distinta disposición, y
// forzarlas a una sola forma es lo que puso DOS cifras del mismo fiado en la
// misma caja: «Debe €15.95» abajo a la izquierda y «−€25.00» en grande a la
// derecha. El dueño lo reportó al tocar la segunda y encontrarse la primera:
// *«Estoy seleccionando un abono de 25 euros pero al seleccionarlo me dice
// que es de 15.95»*.
//
// ASÍ QUE LA DE «Pagar» SE ESCRIBE AQUÍ, y la que recibe sigue siendo
// `TarjetaDeFiado` —la misma de `/abonos/nuevo` y del detalle de un abono—
// con `cifra="pendiente"` y sin su línea «Debe».
//
// Y ESTO NO DESHACE LA RESPUESTA DEL 2026-10-22. Aquel día se le preguntó si
// mantener «Debe $X», que el frame no dibuja, y dijo *«Sí mantén la
// tarjeta»*: lo que quería era ver cuánto falta en cada fiado, porque
// repartir sin eso es repartir a ciegas. Esa cifra no se va — pasa a ser LA
// cifra, la roja, en lugar de ser la segunda y la pequeña.
//
// Fuera del componente para que su referencia no cambie en cada render:
// `useSyncExternalStore` vuelve a suscribirse cuando `subscribe` es otra
// función, y `SIN_AJUSTES` tiene que ser el MISMO objeto vacío siempre.
const sinSuscripcion = () => () => {};
const SIN_AJUSTES: Record<string, number> = {};

export function AbonoReparto({
  clienteId,
  clienteNombre,
  clienteTieneWhatsapp,
  yaAceptaAvisos,
  fiados,
  libros,
  rates,
  paisVE,
  desde,
}: {
  clienteId: string;
  clienteNombre: string;
  clienteTieneWhatsapp: boolean;
  yaAceptaAvisos: boolean;
  fiados: FiadoAbierto[];
  // Los libros en los que este cliente debe algo. Casi siempre uno.
  libros: (LedgerCurrency | null)[];
  rates: BolivarRates | null;
  // Solo un negocio venezolano puede teclear en bolívares.
  paisVE: boolean;
  // ── DE DÓNDE SE VINO ───────────────────────────────────────────────
  //
  // A esta pantalla se llega por DOS puertas y la flecha tiene que deshacer
  // la que se usó. Encargo del dueño el 2026-10-23: *«si usuario entró desde
  // perfil del cliente debe regresarlo al perfil del cliente, si entró desde
  // buscar cliente lo debe regresar a buscar cliente»*.
  //
  // VA EN LA URL Y NO EN EL HISTORIAL DEL NAVEGADOR, y esa es la decisión que
  // importa: `router.back()` habría sido una línea, pero esta pantalla se
  // abandona y se vuelve a ella —cada «Pagar» de un fiado va a la pantalla
  // del monto y regresa— así que el paso anterior deja de ser la puerta de
  // entrada en cuanto el tendero reparte una vez. Un parámetro sobrevive a
  // eso, y a recargar.
  //
  // Por eso `abono-monto.tsx` lo arrastra en sus dos vueltas: si se perdiera
  // ahí, la flecha funcionaría hasta el primer reparto y luego no.
  desde: "cliente" | "buscar";
}) {
  const router = useRouter();
  const [guardando, empezar] = useTransition();

  // ===========================================================================
  // SE ARRANCA DEL BORRADOR, Y SE LEE CON `useSyncExternalStore`
  //
  // `sessionStorage` no existe en el servidor, así que leerlo en el
  // inicializador de `useState` --como estaba hasta el 2026-10-22-- hacía que
  // el servidor pintara la pantalla vacía y el navegador la llena sobre el
  // mismo HTML. React lo detecta como hidratación fallida y REHACE EL ÁRBOL
  // ENTERO. Funcionaba, y por eso duró: lo único que se veía era un error en
  // una consola que nadie mira. Pero es la pantalla donde se teclea dinero.
  //
  // Lo que arregla esto es el TERCER argumento: la instantánea del servidor.
  // React la usa al hidratar y cambia a la del navegador justo después, así
  // que los dos primeros pintados coinciden por construcción.
  //
  // La instantánea se cachea en un `ref` porque tiene que ser la MISMA
  // referencia en cada render --si no, React vuelve a pintar sin parar-- y
  // porque el borrador solo se lee al entrar: a partir de ahí manda el estado
  // de esta pantalla, que es quien lo escribe.
  const cacheBorrador = useRef<BorradorDeReparto | null | undefined>(undefined);
  const borrador = useSyncExternalStore(
    sinSuscripcion,
    () => {
      if (cacheBorrador.current === undefined) cacheBorrador.current = leerBorrador(clienteId);
      return cacheBorrador.current;
    },
    () => null,
  );

  // EL ESTADO, CON EL BORRADOR DE RESPALDO. `null` es «el tendero no ha tocado
  // esto todavía», que no es lo mismo que «vale la cadena vacía»: sin esa
  // distinción, borrar el monto a mano volvería a sacar el del borrador.
  const [libroEditado, setLibro] = useState<LedgerCurrency | null | undefined>(undefined);
  const [montoEditado, setMonto] = useState<string | null>(null);
  const [enBolivaresEditado, setEnBolivares] = useState<boolean | null>(null);
  const [aManoEditado, setAMano] = useState<Record<string, number> | null>(null);

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


  const libro =
    libroEditado !== undefined
      ? libroEditado
      : ((borrador?.libro as LedgerCurrency | null | undefined) ?? libros[0] ?? null);
  const monto = montoEditado ?? borrador?.monto ?? "";
  const enBolivares = enBolivaresEditado ?? borrador?.enBolivares ?? false;
  // `SIN_AJUSTES` y no `{}`: un objeto nuevo en cada render haría que el
  // `useMemo` del reparto y el efecto que guarda el borrador se dispararan
  // siempre, o sea escribir en `sessionStorage` en cada pintado.
  const aMano = aManoEditado ?? borrador?.aMano ?? SIN_AJUSTES;
  // LOS BOLÍVARES QUE TECLEÓ EN CADA FIADO, cuando los tecleó así. Se usan
  // para el total y viajan al servidor; sin ellos, la suma y lo guardado
  // serían reconversiones y no la cifra del tendero. Ver `aManoBs` en
  // `lib/abonos/borrador.ts` y lo que costó el 2026-10-24.
  //
  // SE IGNORA CUANDO HAY EDICIÓN EN CURSO (`aManoEditado`): esa viene de
  // tocar la pantalla, no del borrador, y mezclar las dos daría bolívares de
  // una cifra que ya cambió.
  const aManoBs = aManoEditado ? SIN_AJUSTES : (borrador?.aManoBs ?? SIN_AJUSTES);

  // Ver `soloDeFiadosVivos` en el guardado del borrador, más abajo.
  const pendientePorId = useMemo(
    () => new Map(fiados.map((f) => [f.movementId, f.pending])),
    [fiados],
  );
  const soloDeFiadosVivos = useCallback(
    (m: Record<string, number>, enBolivares = false) => {
      const limpio: Record<string, number> = {};
      for (const [id, v] of Object.entries(m)) {
        const pendiente = pendientePorId.get(id);
        // 1. FIADO QUE YA NO ESTÁ: fuera. Ver el porqué en el guardado.
        if (pendiente == null) continue;
        // 2. FIADO QUE AHORA DEBE MENOS: se recorta a lo que debe HOY.
        //
        // Es el otro medio fallo, y el que de verdad muerde: el id sigue vivo,
        // así que limpiar por id no lo ve. El tendero fija $1,02 a un fiado,
        // ese fiado se cobra por otro camino y pasa a deber $0,58, y la cifra
        // vieja se queda en el borrador — restándose del tope como si todavía
        // valiera. Un abono de $1,13 acaba diciendo «del abono quedan $0.11».
        //
        // LOS BOLÍVARES NO SE RECORTAN, y por eso el segundo parámetro: su
        // tope es otro —la deuda convertida— y recortarlos contra la cifra del
        // libro los dejaría en una cantidad que nadie tecleó, que es justo lo
        // que la regla de los montos tecleados prohíbe. Se quedan o se van con
        // su línea.
        limpio[id] = enBolivares ? v : Math.min(v, pendiente);
      }
      return limpio;
    },
    [pendientePorId],
  );

  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repartiendo, setRepartiendo] = useState(false);
  const [buscaFiado, setBuscaFiado] = useState("");

  // UN INSTANTE PARA TODA LA PANTALLA. El orden del reparto y los rótulos que
  // se pintan al lado tienen que salir del mismo, o la lista puede ordenarse
  // de una forma y rotularse de otra sin que nada falle.
  const [ahora] = useState(() => new Date());

  // ═══════════════════════════════════════════════════════════════════════
  // ¿ESTE ABONO CRUZA LIBROS?
  //
  // Encargo del dueño el 2026-10-23: con «Bolívares» elegido y un cliente que
  // debe en euros Y en dólares, el billete cae sobre los fiados más críticos
  // «sin importar moneda».
  //
  // CON UN SOLO LIBRO NO CAMBIA NADA, y por eso la condición lleva
  // `libros.length > 1`: un cliente que solo debe dólares, pagando en
  // bolívares, sigue por el camino de siempre. No es una optimización — es que
  // «cruzar» un solo libro no significa nada, y meterlo por la rama nueva
  // cambiaría su aritmética (la ida y vuelta de la conversión) sin que nadie
  // lo haya pedido.
  //
  // ═══════════════════════════════════════════════════════════════════════
  // QUÉ FIADOS SALEN EN LA LISTA: LO DECIDE LA MONEDA ELEGIDA ARRIBA
  //
  // Confirmado por el dueño el 2026-10-23, preguntado en claro y con la
  // alternativa encima de la mesa:
  //
  //   * «Bolívares» → TODOS sus fiados, de los dos libros. Unos bolívares se
  //     convierten a cualquiera de las dos monedas.
  //   * «Euros» → solo los de euros. Con euros no se paga una deuda en
  //     dólares sin una tasa euro/dólar que nadie acordó — que es la parte de
  //     la decisión del 2026-10-22 que la del 2026-10-23 NO cambió.
  //
  // LA ALTERNATIVA ERA «SIEMPRE TODOS», y se descartó por lo que arrastra: en
  // cuanto el tendero le pusiera cifra a un fiado en euros Y a uno en
  // dólares, el total de abajo dejaría de poder decirse en cualquiera de las
  // dos —serían peras y manzanas— y pasaría a decirse en bolívares aunque él
  // nunca hubiera tocado los bolívares.
  //
  // «Te pagó en euros, te enseño lo que puedes pagar con euros» es una regla
  // que el tendero deduce sin que nadie se la explique. Esa es la razón, y es
  // también la razón de que esté escrita aquí: desde fuera la lista filtrada
  // se lee como fiados que faltan.
  const cruzaLibros = enBolivares && libros.length > 1;

  // ═══════════════════════════════════════════════════════════════════════
  // EL SEGUNDO ESTADO DE ESTA PANTALLA — frame `1564:11211`
  //
  // La 1/2 nace con un campo: el tendero escribe el billete y el reparto cae
  // por gravedad. En cuanto paga UN fiado a mano, cambia: el campo se
  // sustituye por un buscador y el total pasa a ser la suma de lo que él vaya
  // fijando, fiado por fiado.
  //
  // Encargo del dueño el 2026-10-22 y confirmado al preguntárselo el
  // 2026-10-23: *«Es el SEGUNDO estado, tras pagar el primero»*. No sustituye
  // a la 1/2 — convive con ella.
  //
  // SE DEDUCE, NO SE GUARDA: hay líneas fijadas y no hay monto escrito. Ese
  // par solo lo produce `fijarEnBorrador`, que limpia el campo al volver de
  // pagar un fiado. Una bandera aparte en el borrador diría lo mismo y podría
  // desincronizarse de los dos datos que la producen.
  const modoSeleccion = monto.trim() === "" && Object.keys(aMano).length > 0;

  // LAS DOS CONVERSIONES, CON LAS TASAS DE HOY. El servidor volverá a hacerlas
  // con la tasa que él mismo sella, que es la que se guarda; estas son para
  // ENSEÑAR. Es la misma asimetría que ya tenía la pantalla del monto, escrita
  // allí: una informa, la otra decide, y la que decide nunca viaja en la
  // petición.
  const aBolivares = useMemo(
    () => (monto: number, moneda: LedgerCurrency | null) =>
      rates && moneda ? (priceIn("VES", { amount: monto, currency: moneda }, rates).amount ?? null) : null,
    [rates],
  );
  const desdeBolivares = useMemo(
    () => (bs: number, moneda: LedgerCurrency | null) =>
      rates && moneda ? (priceIn(moneda, { amount: bs, currency: "VES" }, rates).amount ?? null) : null,
    [rates],
  );

  // LOS FIADOS QUE ENTRAN EN EL REPARTO: los del libro elegido, o TODOS si se
  // cruza. Una sola lista, para que el tope, el reparto y lo que se dibuja
  // salgan siempre de la misma — que es la trampa que `deudaEnBolivares`
  // documenta en `reparto.ts`.
  const delLibro = useMemo(
    () => (cruzaLibros ? fiados : fiados.filter((f) => (f.currency ?? null) === libro)),
    [fiados, libro, cruzaLibros],
  );

  // LLEVA `currency` SIEMPRE, aunque el camino de un solo libro no la mire:
  // `FiadoParaRepartirMulti` extiende a `FiadoParaRepartir`, así que una sola
  // lista sirve para las dos funciones. Dos listas que se construyen igual y
  // se llenan en sitios distintos es como acaban diciendo cosas distintas.
  const paraRepartir: FiadoParaRepartirMulti[] = useMemo(
    () =>
      delLibro.map((f) => ({
        movementId: f.movementId,
        createdAt: f.fecha,
        plazoDias: f.plazoDias,
        cuotas: f.cuotas,
        amount: f.amount,
        pendiente: f.pending,
        currency: (f.currency ?? null) as LedgerCurrency | null,
      })),
    [delLibro],
  );

  // LA DEUDA, EN LA UNIDAD EN QUE SE ESTÁ REPARTIENDO: bolívares si se cruza,
  // la moneda del libro si no.
  const deuda = cruzaLibros
    ? deudaEnBolivares(paraRepartir, aBolivares)
    : deudaDelLibro(paraRepartir);
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
  //
  // Y EL `replace(",", ".")` QUE HABÍA ERA PEOR QUE NADA: cambia LA PRIMERA
  // coma, así que con miles agrupados `12.345,6789` se volvía
  // `12.345.6789` --dos puntos-- y `Number` devolvía `NaN`. Cero otra vez,
  // y con el reparto entero desaparecido de la pantalla.
  const montoNum = parseAmount(monto) ?? 0;

  // LO QUE SE TECLEA PUEDE SER BOLÍVARES Y EL LIBRO SER DÓLARES, así que el
  // reparto se hace SIEMPRE sobre la cifra del libro. Sin tasa no se puede
  // convertir y la pantalla lo dice en vez de inventar una.
  const enElLibro = useMemo(() => {
    // EN MODO SELECCIÓN NO HAY CAMPO: el total es lo que suman las líneas que
    // el tendero ha ido fijando, cada una topada a lo que debe su fiado.
    //
    // Se suma en la UNIDAD DEL REPARTO —bolívares si cruza libros, la moneda
    // del libro si no— por lo mismo que todo lo demás de esta pantalla: una
    // sola unidad para el tope, el reparto y el rótulo del botón.
    if (modoSeleccion) {
      return delLibro.reduce((suma, f) => {
        const puesto = aMano[f.movementId];
        if (puesto == null) return suma;
        const topado = Math.max(0, Math.min(puesto, f.pending));
        if (!cruzaLibros) return suma + topado;
        // SU CIFRA PRIMERO Y LA CONVERSIÓN DESPUÉS. Sumando conversiones, dos
        // líneas de Bs. 100.000 daban un botón de Bs. 200.005,87 — ver
        // `aManoBs`. La conversión solo entra cuando ese fiado se fijó en la
        // moneda del libro, donde no hay bolívar tecleado que respetar.
        const suyos = aManoBs[f.movementId];
        if (suyos != null && Math.abs(puesto - f.pending) > 0.005) return suma + suyos;
        if (suyos != null && puesto <= f.pending) return suma + suyos;
        return suma + (aBolivares(topado, (f.currency ?? null) as LedgerCurrency | null) ?? 0);
      }, 0);
    }
    if (cruzaLibros) return montoNum;
    if (!enBolivares) return montoNum;
    if (!libro || !rates) return 0;
    // `amount` es `number | null`: null cuando falta la tasa. Cae a 0, que
    // deja el botón apagado — mejor que convertir con una tasa inventada.
    return priceIn(libro, { amount: montoNum, currency: "VES" }, rates).amount ?? 0;
  }, [modoSeleccion, delLibro, aMano, aManoBs, aBolivares, cruzaLibros, enBolivares, montoNum, libro, rates]);

  const excede = enElLibro - deuda > 0.005;

  // ═══════════════════════════════════════════════════════════════════════
  // EL REPARTO, EN UNA FORMA SOLA PARA LAS DOS ARITMÉTICAS
  //
  // Las dos funciones devuelven cosas distintas —una en la moneda del libro,
  // la otra en bolívares y con la moneda de cada línea— y todo lo que hay
  // debajo necesita lo mismo: cuánto le toca a cada fiado EN SU MONEDA, y
  // cuánto suma el billete. Se normaliza aquí, una vez, para que ninguna
  // condición de abajo tenga que preguntar por qué camino se vino.
  const reparto = useMemo(() => {
    if (cruzaLibros) {
      const r = repartirEnBolivares({
        montoBs: excede ? 0 : enElLibro,
        fiados: paraRepartir,
        aMano,
        ahora,
        aBolivares,
        desdeBolivares,
      });
      return {
        lineas: r.lineas as { movementId: string; asignado: number }[],
        // EN BOLÍVARES, que es la unidad de este camino. El rótulo del botón
        // lo formatea con `formatBs`; ver allí.
        repartido: r.repartidoBs,
        sinAsignar: r.sinAsignarBs,
      };
    }
    return repartir({ monto: excede ? 0 : enElLibro, fiados: paraRepartir, aMano, ahora });
  }, [cruzaLibros, excede, enElLibro, paraRepartir, aMano, ahora, aBolivares, desdeBolivares]);

  // EL BORRADOR SE GUARDA EN CUANTO CAMBIA ALGO, no al salir: salir puede ser
  // un gesto de «atrás» del sistema, y entonces no hay dónde enganchar el
  // guardado. Es barato —una cadena corta en memoria del navegador— y lo que
  // compra es que volver de fijar un fiado encuentre la pantalla como estaba.
  useEffect(() => {
    // NO SE GUARDA ANTES DE HABER LEÍDO. En el primer pintado --el de la
    // hidratación-- `borrador` todavía vale `null` a propósito, así que lo
    // que hay en pantalla es la pantalla vacía. Guardar ahí machacaría con
    // nada el borrador que se está a punto de restaurar: el tendero volvería
    // de fijar un fiado y se encontraría su reparto en blanco.
    if (cacheBorrador.current === undefined) return;
    guardarBorrador({
      clienteId,
      libro,
      monto,
      enBolivares,
      // SIN MONTO TECLEADO NO HAY BILLETE, y eso es `null`, no `0`.
      //
      // El tope que viaja aquí existe para que las líneas fijadas a mano no
      // sumen más que lo que el cliente puso en el mostrador. Sin monto no hay
      // nada que exceder, así que no hay tope — cada fiado queda topado solo
      // por lo que debe.
      //
      // CON `0` LA PANTALLA DEL MONTO SE BLOQUEABA: desde que «Seleccionar
      // fiados» se dibuja siempre (2026-10-23), el tendero puede entrar sin
      // teclear nada, y allí se encontraba «Ya repartiste todo el abono» con
      // el campo vacío y ningún abono repartido. Medido en dev el 2026-10-23.
      totalEnLibro: monto.trim() === "" ? null : enElLibro,
      // ── SOLO LO FIJADO A FIADOS QUE SIGUEN ABIERTOS ──────────────────
      //
      // El borrador vive en el navegador y sobrevive a lo que pase en la
      // base: un fiado que se saldó por otro camino —o que se borró— deja su
      // cifra aquí dentro para siempre. Y esa cifra se RESTA del tope que la
      // pantalla del monto enseña, así que un fiado fantasma de $1,02 hace
      // que un abono de $1,13 diga «del abono quedan $0.11» con un fiado de
      // $320 delante.
      //
      // ESTA PANTALLA ES LA ÚNICA QUE PUEDE LIMPIARLO: es la que recibe la
      // lista de fiados abiertos. La del monto solo ve el borrador, así que
      // desde allí un id fantasma es indistinguible de uno bueno.
      //
      // Se limpia al guardar y no al leer, a propósito: así la corrección
      // queda escrita y no hay que repetirla en cada pantalla que lo lea.
      aMano: soloDeFiadosVivos(aMano),
      // ── Y LOS BOLÍVARES TECLEADOS, QUE ESTA PANTALLA NO TOCA ─────────
      //
      // SE REESCRIBEN TAL CUAL, y omitirlos no era neutral: este efecto
      // guarda el borrador ENTERO en cada render, así que al volver de la
      // pantalla del monto borraba el `aManoBs` que ella acababa de escribir.
      // El síntoma era que la tarjeta seguía enseñando la reconversión —Bs.
      // 100.001,87 en vez de los 100.000 tecleados— y costó media hora de
      // mirar el sitio equivocado el 2026-10-24: la cifra se guardaba bien y
      // se borraba un instante después.
      //
      // La lección, para la próxima: cuando dos pantallas escriben el mismo
      // borrador, la que no es dueña de un campo tiene que arrastrarlo.
      aManoBs: soloDeFiadosVivos(aManoBs, true),
    });
  }, [clienteId, libro, monto, enBolivares, enElLibro, aMano, aManoBs, soloDeFiadosVivos]);

  // ── LO QUE APAGA «REPARTIR MANUALMENTE» ────────────────────────────
  //
  // `delLibro.length <= 1`, abajo, en el botón. Un solo fiado en el libro no
  // se reparte entre nada.
  //
  // Y AHORA ESO ES TAMBIÉN «una sola tarjeta», que es lo que de verdad se
  // quiere decir: desde que la lista enseña TODOS los fiados del libro,
  // reciban o no, las dos cuentas son la misma. No lo fueron durante unas
  // horas del 2026-10-23 y costó un fallo en producción por cada lado —
  // está contado entero en el comentario del botón.
  //
  // `deuda` ya está en la unidad del reparto —bolívares si cruza libros— así
  // que `cubreTodo` compara dos cifras de la misma moneda. Comparar `montoNum`
  // con `deuda` sería comparar bolívares con dólares en cuanto se tecleara en
  // bolívares, que es la trampa que esta pantalla ya documenta dos veces.
  const cubreTodo = enElLibro > 0.005 && deuda - enElLibro <= 0.005;

  // Ver `desde` arriba. Se calcula aquí y no en la fila para que el destino y
  // la etiqueta no puedan separarse.
  const desdeLaFicha = desde === "cliente";

  const asignado = new Map(reparto.lineas.map((l) => [l.movementId, l.asignado]));

  // LOS BOLÍVARES DE CADA LÍNEA, TAL COMO LOS REPARTIÓ EL REPARTO.
  //
  // Cruzando libros NO se reconvierten desde `asignado`: esa cifra ya está
  // redondeada al céntimo de su moneda, y volverla a bolívares da un número
  // ligeramente distinto del que se gastó del billete. Medido en dev el
  // 2026-10-23 con 110.000 Bs sobre dos fiados: las dos tarjetas sumaban
  // 110.000,25 mientras el botón decía 110.000,00.
  //
  // No es dinero perdido —lo que se guarda es `asignado`, en la moneda del
  // fiado— pero son dos cifras distintas del MISMO billete en la misma
  // pantalla, que es exactamente lo que `reparto.ts` documenta al devolver
  // `asignadoBs` ya calculado en vez de dejar que lo recalcule quien llame.
  const asignadoBs = new Map(
    reparto.lineas.map((l) => [
      l.movementId,
      (l as { asignadoBs?: number }).asignadoBs ?? null,
    ]),
  );
  // ── EL TROZO DEL BILLETE QUE LE TOCA A CADA LÍNEA ──────────────────
  //
  // Solo cuando el tendero tecleó bolívares y no fijó esta línea a mano. Es
  // la misma cuenta que hace el servidor al guardar —proporcional a lo que
  // cada línea consume, y la última absorbe el resto— para que la tarjeta y
  // la fila guardada digan lo mismo.
  //
  // `null` cuando no aplica: sin bolívares tecleados no hay billete que
  // trocear, y entonces manda la conversión de siempre.
  const trozoDelBillete = (movementId: string): number | null => {
    if (!enBolivares || montoNum <= 0) return null;
    const conImporte = reparto.lineas.filter((l) => l.asignado > 0.005);
    const i = conImporte.findIndex((l) => l.movementId === movementId);
    if (i < 0) return null;
    // EL PESO DE CADA LÍNEA. Cruzando libros son sus bolívares, que es lo
    // único comparable entre monedas distintas. En un solo libro no hay
    // `asignadoBs` —ese reparto trabaja en la moneda del libro— y el peso es
    // el propio importe, que con una sola tasa da exactamente lo mismo.
    const pesoDe = (id: string) =>
      asignadoBs.get(id) ?? conImporte.find((l) => l.movementId === id)?.asignado ?? 0;
    const peso = conImporte.reduce((acc, l) => acc + pesoDe(l.movementId), 0);
    if (!(peso > 0)) return null;
    let repartido = 0;
    for (let j = 0; j < conImporte.length; j += 1) {
      if (j === conImporte.length - 1) {
        return Math.round((montoNum - repartido) * 100) / 100;
      }
      const v = Math.round(montoNum * (pesoDe(conImporte[j].movementId) / peso) * 100) / 100;
      if (j === i) return v;
      repartido = Math.round((repartido + v) * 100) / 100;
    }
    return null;
  };

  // En el orden del reparto, no en el de la consulta: es el que explica por
  // qué al primero le tocó todo.
  const enOrden = reparto.lineas
    .map((l) => delLibro.find((f) => f.movementId === l.movementId))
    .filter((f): f is FiadoAbierto => f != null);

  // LO QUE LA HOJA ENSEÑA: los mismos fiados del reparto, filtrados por lo
  // que el tendero escriba. Se busca por lo que la tarjeta DICE --el nombre de
  // los productos o la descripción-- y no por el id: es lo único que el
  // tendero ve y lo único que su cliente le va a nombrar.
  const fiadosFiltrados = useMemo(() => {
    const q = buscaFiado.trim().toLowerCase();
    if (!q) return enOrden;
    return enOrden.filter((f) =>
      [...f.productos, f.descripcion ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [enOrden, buscaFiado]);

  // ═══════════════════════════════════════════════════════════════════════
  // LO QUE LA PANTALLA ENSEÑA: TODOS LOS FIADOS DEL LIBRO, reciban o no
  //
  // `reparto.lineas` ya trae una línea por CADA fiado, con `asignado: 0` para
  // los que el billete no alcanza (ver `lib/abonos/reparto.ts`), así que
  // `enOrden` es la lista entera en orden de gravedad. No hay que ir a
  // buscarla a otro sitio.
  //
  // HASTA EL 2026-10-23 AQUÍ SE FILTRABA por `asignado > 0.005`, y las dos
  // mitades de ese día están contadas en el comentario de la lista, más
  // abajo. En una línea: enseñar solo a quien recibe esconde a los demás
  // justo cuando el abono es pequeño, que es casi siempre.
  //
  // EN SELECCIÓN SE FILTRA POR EL BUSCADOR y no por el reparto: la hoja es el
  // catálogo del que el tendero escoge, así que ahí mandan las palabras que
  // teclea.
  const enPantalla = modoSeleccion ? fiadosFiltrados : enOrden;

  const equivalencia = (n: number, moneda: PriceCurrency | null) => {
    if (!rates || !moneda || n <= 0) return null;
    return priceIn("VES", { amount: n, currency: moneda }, rates)?.amount ?? null;
  };

  const bsDelTotal = enBolivares ? montoNum : equivalencia(enElLibro, libro);

  // ═══════════════════════════════════════════════════════════════════════
  // LAS OPCIONES DEL ÚNICO SELECTOR DE MONEDA
  //
  // Una entrada por cada libro en el que este cliente debe algo, más una de
  // bolívares POR LIBRO si el negocio es venezolano. El porqué de que los
  // bolívares se dupliquen está junto al desplegable: con dos deudas abiertas,
  // «Bolívares» a secas no dice a cuál van.
  //
  // `libros` sale de los fiados abiertos, así que un cliente que ya pagó sus
  // euros deja de ver esa opción sola: no hay deuda que abonar ahí.
  const opcionesDeMoneda = useMemo(() => {
    const lista: { libro: LedgerCurrency | null; enBolivares: boolean; etiqueta: string }[] = [];
    for (const l of libros) {
      lista.push({
        libro: l,
        enBolivares: false,
        etiqueta: l === "EUR" ? "Euros" : l === "USD" ? "Dólares" : "Pesos",
      });
    }
    // UNA SOLA ENTRADA DE BOLÍVARES, Y ESO ES UN CAMBIO DE MODELO
    //
    // Hasta el 2026-10-23 había una POR LIBRO —«Bolívares · a su deuda en
    // euros», «Bolívares · a su deuda en dólares»— porque un reparto no podía
    // mezclar monedas y había que elegir a cuál iban. El dueño lo reportó con
    // una captura: *«está mostrando dos monedas en bolívares, está mal, debe
    // mostrar solo Bolívares»*.
    //
    // Ahora no hay nada que elegir: los bolívares caen sobre los fiados más
    // críticos, sean del libro que sean. La migración `141` lo acepta al
    // escribir y `repartirEnBolivares` decide cuánto le toca a cada uno.
    //
    // `libro` SIGUE VIAJANDO en la opción y no sobra: con un solo libro este
    // camino es el de siempre —se teclea en bolívares y se reparte en ESE
    // libro— así que la opción tiene que decir cuál es.
    if (paisVE) {
      lista.push({ libro: libros[0] ?? null, enBolivares: true, etiqueta: "Bolívares" });
    }
    return lista;
  }, [libros, paisVE]);

  // Lo que dice el botón cerrado. Con un libro basta el nombre; con dos hay
  // que repetir a cuál van los bolívares, o el botón miente por omisión.
  // Lo que dice el botón cerrado. «Bolívares» a secas desde el 2026-10-23: ya
  // no hay dos entradas de bolívares entre las que distinguir, así que la
  // coletilla «· dólares» describiría una elección que ya no se hace.
  const nombreDeMoneda = (enBs: boolean, l: LedgerCurrency | null) => {
    if (enBs) return "Bolívares";
    return l === "EUR" ? "Euros" : l === "USD" ? "Dólares" : "Pesos";
  };

  // ───────────────────────────────────────────────────────────────────────
  // LO QUE DEBE, EN LA MONEDA EN QUE SE ESTÁ TECLEANDO
  //
  // Reportado por el dueño el 2026-10-22 con una captura: *«El input ¿Cuánto
  // abona? solo hace el cálculo en dólares, debe hacer el cálculo en la moneda
  // seleccionada»*.
  //
  // QUÉ SE VEÍA. Con «Bolívares» puesto y 102,50 escritos, la línea decía «Te
  // debe $102.50 en esta moneda» — y los 102,50 que él acababa de teclear eran
  // BOLÍVARES, que son doce céntimos. Dos cifras idénticas, una al lado de la
  // otra, en dos monedas distintas y con la palabra «moneda» en medio. Es la
  // trampa que `topeEnBolivares` ya documenta para el tope de un fiado,
  // entrando por otra puerta: aquí no rechaza nada, solo lo cuenta mal.
  //
  // «en esta moneda» NO ES UN ADORNO: distingue la deuda en dólares de la
  // deuda en euros del mismo cliente. Lo que faltaba es que «esta moneda»
  // fuera de verdad la que el tendero tiene elegida.
  const deudaLegible = cruzaLibros
    ? // CRUZANDO LIBROS, `deuda` YA ES LA SUMA EN BOLÍVARES de los dos libros
      // —la calcula `deudaEnBolivares`— así que aquí no hay nada que
      // convertir. Pasarla por `equivalencia` la multiplicaría por la tasa
      // una segunda vez, y eso no se ve: el resultado sigue siendo un número
      // grande y plausible en bolívares.
      formatBs(deuda)
    : enBolivares && libro
      ? (() => {
          const bs = equivalencia(deuda, libro);
          // Sin tasa no se puede convertir, y entonces se dice en el libro:
          // una cifra en la moneda equivocada es peor que una en otra moneda
          // nombrada con claridad.
          return bs == null ? formatPriceAmount(deuda, libro) : formatBs(bs);
        })()
      : formatPriceAmount(deuda, (libro ?? "COP") as PriceCurrency);

  const guardar = () => {
    setError(null);
    empezar(async () => {
      const r = await registrarAbonoRepartido({
        clienteId,
        libro,
        // LA BANDERA QUE ABRE EL CAMINO NUEVO EN EL SERVIDOR. Solo con
        // bolívares y más de un libro; la acción lo vuelve a exigir por su
        // cuenta, porque esto viaja desde el navegador.
        cruzaLibros,
        // EN MODO SELECCIÓN NO HAY CAMPO, así que lo tecleado es la SUMA de lo
        // que el tendero fue fijando fiado por fiado — que es exactamente lo
        // que `enElLibro` calcula y lo que el botón de abajo enseña.
        //
        // MANDAR `montoNum` AQUÍ ERA MANDAR CERO: el campo está vacío, y el
        // servidor contestaba «Escribe cuánto te pagó» con dos fiados ya
        // puestos en pantalla y el botón diciendo $20.00. Medido en dev el
        // 2026-10-23, al guardar por primera vez desde este estado.
        //
        // El servidor NO se fía de esta cifra: vuelve a repartir con las
        // mismas entradas y topa cada línea contra lo que su fiado debe. Esto
        // le dice cuánto es el billete, no cómo se reparte.
        montoTecleado: modoSeleccion ? enElLibro : montoNum,
        monedaTecleada:
          enBolivares || (modoSeleccion && cruzaLibros)
            ? "VES"
            : ((libro ?? "COP") as PriceCurrency),
        aMano,
        // Lo tecleado en bolívares por fiado, para que el servidor guarde SU
        // cifra y no una reconversión.
        aManoBs,
        permisoMostrado: clienteTieneWhatsapp && !yaAceptaAvisos,
        avisarPorWhatsapp: consent,
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      // El borrador ya no describe nada: su reparto está escrito. Dejarlo
      // haría que volver a «Registrar abono» abriera la pantalla con el pago
      // que se acaba de hacer, como si estuviera pendiente.
      borrarBorrador(clienteId);
      // AL RESUMEN, no a la ficha. Es la pantalla de éxito del frame
      // `1524:10289`, y lee el grupo entero: enseña el total del billete y no
      // la línea por la que se entra. Sin movimiento devuelto —no debería
      // pasar— la ficha sigue siendo una salida honesta.
      router.push(r.movementId ? `/abonos/${r.movementId}` : `/clients/${clienteId}`);
    });
  };

  const puedeGuardar = enElLibro > 0.005 && !excede && reparto.repartido > 0.005 && !guardando;

  // ═══════════════════════════════════════════════════════════════════════
  // LA FILA DE LA HOJA «REPARTIR ABONO»: ELEGIR, NO MIRAR EL REPARTO
  //
  // Frame `1527:12129`. Encargo del dueño el 2026-10-22, y lo dijo así:
  // *«Este punto ya te lo he comentado varias veces y no me has hecho caso:
  // al seleccionar "Repartir distinto" las cards deben mostrarse con el botón
  // pagar y sin saldo a abonar»*. Tenía razón las tres veces.
  //
  // POR QUÉ ESTABA MAL: la hoja reusaba `filaDeFiado`, que es la fila de la
  // lista de abajo. Esa fila existe para ENSEÑAR el reparto —«Abona $0.12», o
  // «No le toca nada»— y aquí eso sobra y además estorba: un fiado que ya
  // tiene asignado un importe salía sin botón, así que la hoja que existe
  // para elegir CUALQUIERA de ellos dejaba fuera justo los que el reparto
  // automático ya había tocado.
  //
  // AQUÍ SIEMPRE HAY BOTÓN, en todos. Esa es la diferencia que importa: la
  // hoja es «elige a cuál le pongo yo la cifra», y a cualquiera se le puede
  // poner, tenga o no algo asignado ahora mismo.
  //
  // EL RECORRIDO QUE ABRE, y es el que el dueño describe entero: «Pagar» va
  // al detalle del fiado (`1536:11006`), de ahí «Continuar» a la pantalla del
  // monto (`1524:10358`), y al pagar se vuelve aquí con la cifra puesta en su
  // card (`1527:11671`).
  const filaParaElegir = (f: FiadoAbierto) => {
    const detalle = f.productos.length > 0 ? f.productos.join(", ") : (f.descripcion ?? "");
    const titulo = detalle ? `Fiado · ${detalle}` : "Fiado";
    const enBs =
      rates && f.currency
        ? priceIn("VES", { amount: f.pending, currency: f.currency }, rates)?.amount
        : null;

    return (
      // `shrink-0` NO ES DECORACIÓN. Esta misma fila se monta dentro de la
      // hoja «Repartir abono», cuya lista es un contenedor flex en columna con
      // altura acotada (`max-h-[90dvh]` + `overflow-y-auto`). Un hijo de un
      // flex encoge por defecto, así que con el teclado arriba —que es cuando
      // esa hoja se abre, con el buscador enfocado— las tarjetas se aplastaban
      // unas contra otras y el renglón de la cifra quedaba cortado. Lo reportó
      // el dueño el 2026-10-23 con la captura.
      //
      // Va en la FILA y no en la hoja porque es la fila la que no debe ceder
      // su altura: la hoja ya tiene su scroll, que es quien sobra.
      <li key={f.movementId} className="shrink-0 overflow-hidden rounded-[10px] border">
        <div className="flex items-center justify-between gap-3 pr-4">
          {/* LA TARJETA ENTERA ABRE EL DETALLE, y el botón de al lado hace
              otra cosa. Encargo del dueño el 2026-10-23: *«todo el card es
              clickeable, lleva al detalle de la transacción, eliminar icono
              "›" en la card»*.

              SON DOS DESTINOS EN UNA FILA, a propósito: tocar la tarjeta es
              «déjame ver qué fue esto» y lleva a `/transacciones/…`; tocar
              «Pagar» es «a este le pongo yo la cifra». Por eso la flecha
              sobra: con dos cosas tocables al lado, una flecha solo dice cuál
              de las dos no es. */}
          <Link
            href={`/transacciones/${f.movementId}`}
            className="flex min-w-0 flex-1 flex-col gap-1.5 px-4 py-2 text-left transition-colors active:bg-muted/60"
          >
            <span className="truncate text-sm font-medium">{titulo}</span>
            {/* UNA SOLA CIFRA, Y ES LO QUE ESTE FIADO TODAVÍA DEBE.
                Frame `1564:11286`: título, importe en rojo debajo y su
                equivalencia. SIN FECHA y SIN «Debe €X» — el frame no los
                dibuja aquí, y la tarjeta de arriba (`1564:11242`), que sí
                lleva fecha, es otra: esa explica un reparto hecho y esta
                ofrece hacer uno.

                POR QUÉ IMPORTA QUE SEA LO PENDIENTE: pulsar «Pagar» abre el
                monto con el pendiente como tope. Enseñar aquí el importe
                original hacía que la pantalla siguiente contradijera a la
                tarjeta desde la que se llegó, y así lo reportó el dueño el
                2026-10-23: *«Estoy seleccionando un abono de 25 euros pero al
                seleccionarlo me dice que es de 15.95»*.

                EL SIGNO ES «−» Y EL FRAME DIBUJA «+», a sabiendas: manda la
                regla del dueño del 2026-10-22 —*«abonos y de contados con
                "+", fiados con "-"»*—, que es la misma razón por la que
                `tarjeta-de-fiado.tsx` desplaza a su propio frame. */}
            <span className="flex items-center gap-1 text-base font-semibold tabular-nums text-destructive">
              {f.currency ? (
                <CurrencyFlagIcon currency={f.currency} className="size-4 shrink-0" />
              ) : null}
              -{formatPriceAmount(f.pending, f.currency ?? "COP")}
            </span>
            {enBs != null ? (
              <span className="text-xs text-muted-foreground tabular-nums">{formatBs(enBs)} hoy</span>
            ) : null}
          </Link>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 shrink-0"
            onClick={() => {
              // SE CIERRA ANTES DE NAVEGAR: `Sheet` es un Radix Dialog y no se
              // desmonta solo al cambiar de ruta.
              setRepartiendo(false);
              // DIRECTO AL MONTO, SIN EL PASO INTERMEDIO. Encargo del dueño
              // el 2026-10-23: *«elimina el paso "Detalle de transacción 2/2
              // confirma transacción a abonar"»*.
              //
              // Esa pantalla enseñaba el fiado y pedía «Continuar» — y lo que
              // enseñaba ya está en la tarjeta desde la que se pulsa «Pagar»:
              // el producto y lo que debe. Era un toque para confirmar lo que
              // el tendero acababa de elegir.
              router.push(
                `/abonos/nuevo/${f.movementId}/monto?reparto=1${desdeLaFicha ? "&desde=cliente" : ""}`,
              );
            }}
          >
            Pagar
          </Button>
        </div>
      </li>
    );
  };

  // UNA SOLA FILA, USADA EN DOS SITIOS: la lista de «Así se reparte el pago» y
  // la hoja de «Repartir distinto». Es una función y no un componente aparte
  // porque cierra sobre medio estado de esta pantalla —lo asignado, lo fijado
  // a mano, las tasas— y sacarlo fuera significaría pasarle siete props para
  // ganar nada. Lo que sí evita es lo de siempre: dos filas que empiezan
  // iguales y acaban distintas.
  const filaDeFiado = (f: FiadoAbierto) => {
    const toca = asignado.get(f.movementId) ?? 0;
    // Del reparto cuando lo trae —cruzando libros— y reconvertida si no. Ver
    // el comentario de `asignadoBs`.
    // ── LOS BOLÍVARES DE ESTA TARJETA ────────────────────────────────
    //
    // SU CIFRA PRIMERO. Si el tendero fijó este fiado tecleando bolívares, la
    // tarjeta repite ESA cifra. Lo demás son conversiones, y la vuelta no da
    // lo mismo: Bs. 100.000 son $112,8381, al céntimo $112,84, que valen
    // Bs. 100.001,87. Eso es lo que la tarjeta decía, y el dueño lo reportó
    // el 2026-10-24: *«tecleo = 100.000, tu conversión = 100.001,87»*.
    //
    // SOLO SI LA LÍNEA SIGUE VALIENDO LO QUE ÉL PUSO: en cuanto el reparto la
    // recorta —porque el billete no llega— su cifra deja de describir lo que
    // esta tarjeta abona, y entonces manda la conversión de lo que de verdad
    // le toca.
    const suyos = aManoBs[f.movementId];
    const sigueEntero = suyos != null && Math.abs((aMano[f.movementId] ?? 0) - toca) <= 0.005;
    // ── Y SI NO LA FIJÓ A MANO, SU TROZO DEL BILLETE ──────────────────
    //
    // Tecleando Bs. 1.000 sobre un fiado que debe de sobra, la tarjeta decía
    // «Bs. 1.001,44»: `asignadoBs` es la reconversión del importe del libro
    // —$1,13 × 886,2271— y no el billete. Reportado por el dueño el
    // 2026-10-24, y es el mismo fallo que ya se arregló para las líneas
    // fijadas a mano, en el rincón que faltaba.
    //
    // SE REPARTE COMO LO REPARTE EL SERVIDOR, proporcionalmente a lo que cada
    // línea consume del billete; con una sola línea, el billete entero. Que
    // las dos cuentas sean la misma no es elegancia: la tarjeta tiene que
    // decir lo que se va a guardar.
    const delBillete = trozoDelBillete(f.movementId);
    const bs = sigueEntero
      ? suyos
      : (delBillete ?? asignadoBs.get(f.movementId) ?? equivalencia(toca, f.currency));
    // `shrink-0`: ver la otra fila, unas líneas más arriba.
    return (
      <li key={f.movementId} className="shrink-0 rounded-[10px] border">
        {/* La tarjeta sin su propio borde: ya lo pone el `li`,
                        que es quien agrupa el fiado con lo que se le abona.
                        Dos bordes anidados se leen como dos tarjetas. */}
        <div className="[&>*]:rounded-b-none [&>*]:border-0">
          {/* SIN FLECHA: esta tarjeta no abre nada. La dibujaba igual hasta el
              2026-10-23, prometiendo una pantalla que no existe desde aquí. */}
          {/* SIN «Debe €X» Y CON LO PENDIENTE EN ROJO. El frame
              `1564:11242` dibuja título, fecha y UNA cifra; la línea «Debe»
              no está ahí, y con ella la tarjeta enseñaba dos números del
              mismo fiado que no coincidían. Encargo del dueño el 2026-10-23:
              *«en esta pantalla los fiados no deberían tener el saldo total
              por cobrar, solo el saldo del fiado de cada card»*. */}
          <TarjetaDeFiado
            fiado={f}
            rates={rates}
            mostrarPendiente={false}
            conChevron={false}
            cifra="pendiente"
          />
        </div>
        {/* SIEMPRE «Abona» Y SIEMPRE CON CIFRA, y aquí no hay botón.
            Hasta el 2026-10-23 esta fila tenía una segunda cara —«No le toca
            nada» más un «Pagar»— para los fiados que el reparto no alcanzaba.
            Sigue sin poder alcanzarse, pero por otro motivo que conviene
            saber: la lista de arriba SÍ monta a los que reciben cero, solo que
            esos los dibuja `filaParaElegir`, que es la tarjeta con su «Pagar».
            O sea que el reparto a cero y el botón viven en la otra fila, y
            aquí `toca` siempre pasa de cero.

            La diferencia es a propósito: una fila con cifra explica un reparto
            que ya ocurrió; una con botón ofrece hacer uno. Mezclarlas es lo
            que el dueño mandó quitar el 2026-10-22. */}
        <div className="flex items-center justify-between gap-3 border-t px-4 py-2">
          <span className="text-sm text-muted-foreground">Abona</span>
          {
            <div className="flex items-center gap-2">
              <div className="flex flex-col items-end">
                <span className="flex items-center gap-1 text-base font-semibold tabular-nums">
                  {f.currency ? (
                    <CurrencyFlagIcon currency={f.currency} className="size-3.5 shrink-0" />
                  ) : null}
                  {formatPriceAmount(toca, (f.currency ?? "COP") as PriceCurrency)}
                </span>
                {bs != null ? (
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {formatBs(bs)} hoy
                  </span>
                ) : null}
              </div>
              {/* FIJADO A MANO SE PUEDE DESHACER, y tiene que
                              poder: si no, el tendero que se equivoca al
                              fijar un fiado no tiene forma de volver al
                              reparto automático salvo recargando.

                              ERA UN BOTÓN DE TEXTO «Deshacer» hasta el
                              2026-10-23. Ahora es el MISMO botón de papelera
                              del carrito del catálogo —`destructive`, `size-10
                              rounded-xl`, icono de 4— por encargo del dueño.

                              POR QUÉ IMPORTA QUE SEA EL MISMO Y NO UNO
                              PARECIDO: en el carrito ese botón significa
                              «quita esta línea», y aquí significa lo mismo.
                              Dos iconos distintos para el mismo gesto es cómo
                              el tendero deja de saber cuál quita y cuál
                              resta. */}
              {aMano[f.movementId] != null ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="size-10 rounded-xl"
                  aria-label="Quitar lo asignado a este fiado"
                  onClick={() =>
                    // Del valor VISIBLE, no del estado: mientras el tendero no
                    // haya tocado nada, lo visible sale del borrador y el
                    // estado todavía es `null`.
                    setAMano(() => {
                      const n = { ...aMano };
                      delete n[f.movementId];
                      return n;
                    })
                  }
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </Button>
              ) : null}
            </div>
          }
        </div>
      </li>
    );
  };

  return (
    // ── SIN `p-4` PROPIO: EL PADDING LO PONE `AppMain`, Y SOLO ÉL ──────
    //
    // Reportado por el dueño el 2026-10-22, por tercera vez sobre lo mismo:
    // *«Aún sigo viendo diferencias en los paddings laterales del flujo
    // completo de abono, debe ser de 16px»*.
    //
    // MEDIDO: el `h1` empezaba a 32px del borde. `AppMain` ya trae `p-4` y
    // esta pantalla añadía otro, así que sumaban. Las otras del flujo no lo
    // añaden, y de ahí la diferencia que él veía al pasar de una a otra.
    //
    // Y ARREGLA UNA SEGUNDA COSA DE PASO: `StickyActions` usa `-mx-4` para
    // cancelar el padding de `AppMain` y quedar de borde a borde. Con el
    // padding duplicado solo cancelaba el de aquí, así que la banda de abajo
    // salía metida 16px por cada lado en vez de a ras. Medido antes: la barra
    // empezaba en 16 y no en 0.
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col gap-4">
      {/* `soloEnTelefono={false}`: `/abonos` está en la lista de
          `app-header.tsx` que suprime la cabecera a TODAS las anchuras, así
          que sin esto, a partir de `sm` la pantalla se queda sin forma de
          volver. */}
      {/* ── LA FLECHA VUELVE AL BUSCADOR, NO A LA FICHA ───────────────────
          Encargo del dueño el 2026-10-23: *«al seleccionar "atrás" debe
          llevar a sheet para buscar cliente, no al perfil del cliente»*.

          POR QUÉ TIENE SENTIDO: a esta pantalla se llega eligiendo un cliente
          en esa hoja. «Atrás» es deshacer esa elección —me equivoqué de
          cliente— y la ficha del cliente no es el paso anterior de nada: es
          otro sitio, desde el que además habría que volver a empezar.

          `?nuevo=abono` ES LA MISMA HOJA, no una copia: la monta `/dashboard`
          y abre directa en el buscador con el propósito «abono», que es lo
          que hace que al elegir cliente vuelva aquí. */}
      <ScreenBackRow
        href={desdeLaFicha ? `/clients/${clienteId}` : "/dashboard?nuevo=abono"}
        label={desdeLaFicha ? `Volver a ${clienteNombre}` : "Buscar otro cliente"}
        soloEnTelefono={false}
      />

      {/* ── EL RITMO VERTICAL DE LA CABECERA, MEDIDO CONTRA EL FRAME ──────
          Nodos `1526:11184` (contenedor del título) y `1526:11187` (el del
          subtítulo), del sitemap `1524:10288`.

          Reportado por el dueño el 2026-10-22: *«Paddings del flujo de abono
          son distintos, creo que no recorriste los frames y solo lo
          dedujiste»*. Tenía razón: esto llevaba un `gap-2` y un `gap-4`
          heredados de la pantalla de al lado, no las medidas del frame.

          QUÉ DICE EL FRAME, y de ahí salen los tres números de abajo:

            · contenedor del título    `px-16 py-8`   → 8 abajo
            · contenedor del subtítulo `px-16 pt-8 pb-16`, gap 8
            · el contenido empieza con su propio `p-16`

          O sea 8 + 8 = 16 entre el título y el subtítulo, 8 entre el
          subtítulo y la barra, y 16 + 16 = 32 entre la barra y lo que sigue.
          Llevaba 8, 8 y 16: la cabecera entera salía comprimida.

          EL GAP DEL CONTENEDOR SE ANULA AQUÍ (`-mt-*` no; `gap-0` y márgenes
          explícitos sí) porque el `gap-4` de la pantalla se suma a todo lo que
          se ponga dentro, y entonces cada número de arriba habría que
          escribirlo menos 16 — que es como se pierde la relación con el
          frame. */}
      <div className="flex flex-col gap-0 pb-4">
        <ScreenTitle>Registrar abono</ScreenTitle>
        {/* `brand-muted` ES EL `--subtle` DEL FRAME, #9a9a9a. Llevaba
            `muted-foreground`, que es #737373: más oscuro, y por tanto con más
            peso del que el frame le da a un rótulo de paso. */}
        {/* MARGEN Y NO RELLENO: un `pt-4` queda DENTRO de la caja del
            párrafo, así que separa igual pero no se puede medir desde fuera —
            y esto se comprobó midiendo. Un margen lo dice la geometría. */}
        <p className="mt-4 text-sm text-brand-muted">1/2 fiados</p>
        {/* `aria-hidden` porque la línea de arriba ya lo dice con palabras. */}
        <div aria-hidden="true" className="mt-2 h-1 w-full overflow-hidden rounded-full bg-muted">
          {/* 50 % Y NO EL 80 % QUE DIBUJA EL FRAME, y se dice en voz alta: el
              frame usa el componente `Progress` con su variante por defecto
              (`step="80"`, 4 de 5 segmentos) sobre una pantalla que se llama
              «1/2». Cuatro quintos en el paso uno de dos no cuadra con nada, y
              la captura que el dueño mandó ese mismo día enseña la barra a la
              mitad. Preguntado en el reporte del 2026-10-22. */}
          <div className="h-full w-1/2 rounded-full bg-foreground transition-all" />
        </div>
      </div>

      {/* SIN FIADOS NO HAY NADA QUE REPARTIR, y la salida es registrar la
          venta. Decisión del dueño del 2026-10-19, heredada del paso 1/3: el
          tendero que llegó aquí quería anotar que alguien le pagó; si no hay
          deuda, lo que de verdad pasó es que todavía no ha anotado lo que se
          llevó. */}
      {fiados.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-[10px] border px-6 py-12 text-center">
          <p className="text-sm leading-relaxed text-muted-foreground">
            {clienteNombre} no tiene fiados abiertos, así que no hay nada a lo que abonar.
          </p>
          <Button asChild className="h-10 w-full">
            <Link href={`/ventas/nueva?cliente=${clienteId}`}>Registrar venta</Link>
          </Button>
        </div>
      ) : (
        <>
          {/* AQUÍ ESTUVO «¿En qué moneda te pagó?», un segundo selector con una
              pastilla por libro. Lo quitó el dueño el 2026-10-22: *«¿por qué la
              agregaste? Elimínalo, para eso está el dropdown al lado del
              monto»*. Tenía razón: dos controles para una sola pregunta.

              SU TRABAJO NO DESAPARECE, SE MUDA AL DESPLEGABLE, que ahora lista
              TODOS los libros en los que ese cliente debe. Ver allí el caso
              que esto obligaba a resolver. */}
          {/* ── EL CAMPO, O EL BUSCADOR ───────────────────────────────
              En modo selección el campo se sustituye por «Buscar fiado» —
              frame `1564:11211`—, porque ya no hay un billete que repartir:
              el tendero va eligiendo fiados y poniéndoles cifra uno a uno, y
              lo que necesita es encontrarlos. Ver `modoSeleccion`.

              LA LUPA VA A LA DERECHA, como en el frame, y no a la izquierda
              como en la hoja de «Seleccionar fiados». Son dos buscadores de
              dos sitios distintos y cada uno sigue el suyo. */}
          {modoSeleccion ? (
            <div className="relative">
              <Input
                value={buscaFiado}
                onChange={(e) => setBuscaFiado(e.target.value)}
                placeholder="Buscar fiado"
                aria-label="Buscar fiado"
                className="h-10 pr-10"
              />
              <Search
                className="pointer-events-none absolute top-1/2 right-3 size-5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
            </div>
          ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="monto">¿Cuánto abona?</Label>
            <div className="flex items-start gap-2">
              <Input
                id="monto"
                inputMode="decimal"
                value={monto}
                ref={campoMonto}
                onChange={(e) => {
                  // El filtro de caracteres que había aquí lo hace ya
                  // `formatAmountWhileTyping`, que además agrupa y acota los
                  // decimales a cuatro.
                  const { texto, cursor } = formatAmountWhileTyping(
                    e.target.value,
                    monto,
                    e.target.selectionStart ?? e.target.value.length,
                  );
                  cursorPendiente.current = cursor;
                  setMonto(texto);
                }}
                placeholder="00"
                className="h-10 flex-1 text-lg"
              />
              {/* ═══════════════════════════════════════════════════════
                  EL ÚNICO SELECTOR DE MONEDA DE LA PANTALLA

                  Frame `1524:10439`, nodo `1525:11083`: bandera, nombre y
                  `keyboard_arrow_down`. El dueño quitó el 2026-10-22 el
                  segundo selector que vivía arriba --*«para eso está el
                  dropdown al lado del monto»*-- así que este carga con las dos
                  preguntas: en qué LIBRO se abona y en qué moneda se TECLEA.

                  ── EL BORDE QUE ESTO OBLIGA A RESOLVER ─────────────────

                  Un cliente venezolano puede deber en dólares Y en euros --es
                  el de la captura del reporte--. Con el selector de arriba
                  fuera, una lista de «Dólares / Bolívares» dejaría los euros
                  sin ninguna puerta: el tendero no podría abonar esa deuda.

                  Y «Bolívares» a secas no dice a CUÁL de las dos van. Elegir
                  por él --el último libro, el más grande, el primero-- es
                  inventar una respuesta sobre dinero, que es justo lo que
                  `CLAUDE.md` prohíbe.

                  LA SALIDA ES NOMBRARLO EN LA PROPIA OPCIÓN: con dos libros la
                  lista dice «Bolívares · a su deuda en dólares» y «Bolívares ·
                  a su deuda en euros». Con uno solo sobra la coletilla y dice
                  «Bolívares». Nadie tiene que deducir nada y no hace falta un
                  segundo control.

                  UN NEGOCIO COLOMBIANO NO VE BOLÍVARES --no hay tasa-- y con un
                  solo libro tampoco ve un selector de una opción, que sería
                  una pregunta sin respuesta posible. */}
              {opcionesDeMoneda.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="h-10 shrink-0 gap-2">
                      <CurrencyFlagIcon
                        currency={enBolivares ? "VES" : (libro ?? "USD")}
                        className="size-4 shrink-0"
                      />
                      <span className="text-xs">{nombreDeMoneda(enBolivares, libro)}</span>
                      <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {opcionesDeMoneda.map((o) => (
                      <DropdownMenuItem
                        key={`${o.enBolivares ? "ves" : "libro"}-${o.libro ?? "cop"}`}
                        onSelect={() => {
                          setLibro(o.libro);
                          setEnBolivares(o.enBolivares);
                        }}
                      >
                        <CurrencyFlagIcon
                          currency={o.enBolivares ? "VES" : (o.libro ?? "USD")}
                          className="size-4 shrink-0"
                        />
                        {o.etiqueta}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>

            {/* LA EQUIVALENCIA, Y SOLO CUANDO SE PUEDE CALCULAR. Sin tasa no
                se dibuja: inventar una conversión es peor que no darla. */}
            {/* CRUZANDO LIBROS NO SE DIBUJA, y eso no es un hueco: esta línea
                dice «lo que has tecleado, en la otra moneda», y cuando el
                billete se reparte entre dos libros no hay UNA otra moneda.

                QUÉ SE VEÍA MIENTRAS ESTUVO: tecleando 110.000 bolívares
                ponía «€110,000.00 hoy» —la misma cifra, etiquetada como
                euros— porque la unidad del reparto ya eran bolívares y el
                rótulo seguía asumiendo que no. Medido en dev el 2026-10-23.

                Lo que esa línea daba lo da mejor la lista de abajo: cada
                tarjeta enseña lo suyo en su moneda Y en bolívares. */}
            {!cruzaLibros && bsDelTotal != null && montoNum > 0 ? (
              // LA BANDERA A LA IZQUIERDA DEL RÓTULO — encargo del dueño el
              // 2026-10-23. Es la misma que ya acompaña a cada cifra en las
              // tarjetas y en el historial, y por el mismo motivo que allí:
              // esta línea y la de abajo —«Te debe …»— son dos números
              // parecidos en DOS monedas distintas, uno encima del otro. El
              // símbolo de un carácter al principio es lo único que los
              // separaba.
              //
              // LA BANDERA ES LA DE LA CIFRA QUE SE ENSEÑA, no la del campo:
              // tecleando en bolívares esta línea dice lo que son en el libro,
              // así que lleva la del libro; tecleando en el libro dice los
              // bolívares y lleva la de Venezuela. Al revés estaría etiquetando
              // cada número con la moneda del otro.
              // SIN BANDERA CUANDO LA CIFRA ES EN BOLÍVARES — encargo del
              // dueño el 2026-10-23: *«en la equivalencia en Bolívares no
              // agregues la bandera, solo en el monto principal en dólares o
              // euros»*.
              //
              // DESPLAZA SU PROPIA PETICIÓN DEL 2026-10-23 por la mañana, que
              // era justo añadirla. La razón de aquella sigue escrita abajo y
              // sigue siendo cierta —dos números parecidos en dos monedas, uno
              // encima del otro— pero la bandera de Venezuela aparecía tantas
              // veces por pantalla que dejaba de distinguir nada.
              //
              // CONFIRMADO POR ÉL EL 2026-10-23 al señalarle que el frame
              // `1564:11586` SÍ la dibuja: *«omitamos la bandera en la
              // equivalencia»*. O sea que esto desplaza también al frame, y
              // por eso la regla entera está en `DESIGN-SYSTEM.md` —«La
              // bandera va en el MONTO, no en su equivalencia»—: sin ella, el
              // siguiente que abra ese frame la vuelve a poner con toda la
              // razón y sin forma de saber que ya se decidió.
              //
              // TECLEANDO BOLÍVARES SÍ LA LLEVA, y no es una excepción: ahí la
              // cifra de esta línea está en la moneda del LIBRO, que es
              // «el monto principal en dólares o euros» del encargo.
              <p className="flex items-center gap-1 text-sm text-muted-foreground tabular-nums">
                {enBolivares ? (
                  <CurrencyFlagIcon
                    currency={(libro ?? "USD") as PriceCurrency}
                    className="size-3.5 shrink-0"
                  />
                ) : null}
                {enBolivares
                  ? `${formatPriceAmount(enElLibro, (libro ?? "COP") as PriceCurrency)} hoy`
                  : `${formatBs(bsDelTotal)} hoy`}
              </p>
            ) : null}

            {excede ? (
              <p className="text-sm leading-5 text-destructive">
                Te debe {deudaLegible} en esta moneda. Escribe esa cantidad o menos.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">Te debe {deudaLegible} en esta moneda.</p>
            )}
          </div>
          )}

          {/* EN SELECCIÓN LA LISTA SALE SIEMPRE, aunque todavía no haya nada
              fijado: es la lista de fiados entre los que elegir, y esconderla
              dejaría la pantalla con un buscador y nada que buscar. */}
          {modoSeleccion || (enElLibro > 0.005 && !excede) ? (
            <div className="flex flex-col gap-3">
              {/* «FIADOS» EN SELECCIÓN Y «ASÍ SE REPARTE EL PAGO» CUANDO HAY
                  BILLETE — frame `1564:11211`. No son dos nombres para lo
                  mismo: con billete la lista EXPLICA un reparto que se hizo
                  solo; en selección es el catálogo del que el tendero escoge. */}
              <h2 className="text-base font-medium">
                {modoSeleccion ? "Fiados" : "Así se reparte el pago"}
              </h2>

              {/* ── TODOS LOS FIADOS DEL LIBRO, RECIBAN O NO ──────────────
                  Y LAS DOS MITADES DEL 2026-10-23, porque la regla cambió de
                  lado ese mismo día y sin las dos no se entiende ninguna.

                  POR LA MAÑANA el dueño pidió lo contrario: *«cuando el monto
                  a abonar es menor al de cualquier fiado está mostrando fiado
                  con abono y resto de fiados con botón "Pagar", cambiemos eso
                  por solo mostrar el abono al fiado más crítico (solo un
                  abono), no muestres más fiados»*. Se filtró por «los que
                  reciben algo» y quedó justo eso.

                  POR LA TARDE reportó el efecto de ese filtro como fallo:
                  *«Fiados se empiezan a esconder y se muestra solo uno por
                  moneda, monto a abonar en bolívares solo muestra fiados en
                  dólares»*.

                  NO SON DOS OPINIONES, ES UNA CAUSA. El reparto es cascada:
                  paga primero al fiado más grave y solo desborda al siguiente
                  cuando ese queda saldado. Así que €7 contra un fiado que debe
                  €15,95 asignan a UNO, y filtrar por «los que reciben» esconde
                  los otros tres — casi siempre, porque un abono casi nunca
                  cubre el libro entero. En bolívares es peor y por eso se ve
                  antes: el billete alcanza para el peor, que puede estar en
                  dólares, y entonces el libro de euros desaparece de una
                  pantalla que dice estar repartiendo entre los dos.

                  LO QUE RECONCILIA LAS DOS: lo que estorbaba por la mañana no
                  era la tarjeta de más, era que traía *otra acción* —«dos
                  tarjetas para un pago, y la segunda ofreciendo otra cosa en
                  la pantalla donde se confirma la primera»—. Puesto así, el
                  dueño eligió la tarde CON el botón, el 2026-10-23: *«vamos
                  con esa pero retomemos las tarjetas con el botón "Pagar"»*.

                  Y EL «Pagar» DE UN FIADO A CERO NO ES UN CALLEJÓN, que era
                  la duda razonable al devolverlo: MEDIDO el 2026-10-23 con
                  $0,50 sobre fiados de $1 y $6,50 —todo el billete asignado al
                  primero— la pantalla del monto abre diciendo *«Máximo $0.50 —
                  lo que queda del abono»*. Lo repartido en automático no está
                  comprometido: se puede mover entero al fiado que el tendero
                  elija. */}
              <ul className="flex flex-col gap-3">
                {enPantalla
                  .map((f) =>
                    // CONVIVEN LAS DOS FILAS, y ya no solo en selección: la
                    // del fiado que tiene su cifra —con su renglón «Abona»— y
                    // la del que no, con su botón «Pagar». Es lo que dibuja el
                    // frame `1564:11211`, y es lo que hace que la pantalla
                    // sirva para lo que el dueño quiere: ir pagando de uno en
                    // uno sin perder de vista lo que ya lleva puesto.
                    (asignado.get(f.movementId) ?? 0) <= 0.005
                      ? filaParaElegir(f)
                      : filaDeFiado(f),
                  )}
              </ul>
            </div>
          ) : null}
        </>
      )}

      {error ? (
        <p className="text-sm leading-5 text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {/* ── «REPARTIR DISTINTO» Y SU HOJA — frame `1527:11851` ──────────
          QUÉ AÑADE, AHORA QUE CADA TARJETA YA TIENE SU «Pagar»: buscar. La
          lista de arriba enseña TODOS los fiados abiertos del cliente, y en
          una bodega con alguien que lleva veinte, encontrar el que el cliente
          acaba de nombrar es desplazarse hasta verlo. Aquí se escribe y se
          filtra.

          Es la MISMA fila de arriba, no una segunda: lo único que cambia es
          que se puede filtrar y que la hoja se cierra al elegir. */}
      <Sheet open={repartiendo} onOpenChange={setRepartiendo}>
        {/* `dvh` y no `vh`: en un teléfono con la barra del navegador a la
            vista, `vh` mide el viewport grande. Es la misma trampa que la hoja
            de «Registrar» ya documenta. */}
        <SheetContent side="bottom" className="flex max-h-[90dvh] flex-col rounded-t-xl">
          <SheetHeader>
            <SheetTitle className="text-xl font-medium">Repartir abono</SheetTitle>
          </SheetHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-6">
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                value={buscaFiado}
                onChange={(e) => setBuscaFiado(e.target.value)}
                placeholder="Buscar fiado"
                aria-label="Buscar fiado"
                className="h-10 pl-9"
              />
            </div>

            <h3 className="text-base font-medium">Historial</h3>

            <ul className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
              {fiadosFiltrados.length === 0 ? (
                <li className="py-6 text-center text-sm text-muted-foreground">
                  Ningún fiado coincide con «{buscaFiado.trim()}».
                </li>
              ) : (
                fiadosFiltrados.map(filaParaElegir)
              )}
            </ul>
          </div>
        </SheetContent>
      </Sheet>

      {fiados.length > 0 ? (
        <StickyActions>
          {/* LA CASILLA DEL PERMISO VA AQUÍ, no en la pantalla del monto.
              Decisión del dueño del 2026-10-22, y la razón es que aquí es
              donde de verdad sale el mensaje: pedir permiso para mandar en una
              pantalla que no manda nada es confuso, y preguntarlo una vez por
              fiado lo es más. */}
          {clienteTieneWhatsapp ? (
            <WhatsappConsentField
              clientName={clienteNombre}
              hasWhatsapp={clienteTieneWhatsapp}
              yaTienePermiso={yaAceptaAvisos}
              checked={consent}
              onCheckedChange={setConsent}
              disabled={guardando}
            />
          ) : null}

          {/* «SELECCIONAR FIADOS», Y SIEMPRE — encargo del dueño el
              2026-10-23: *«cambiar cta por "Seleccionar fiados" siempre en esa
              pantalla, eso permitirá al dueño cambiar el fiado a abonar»*.

              ESTABA CONDICIONADO a haber escrito un monto, con el argumento de
              que sin cifra no hay reparto que cambiar. Ese argumento valía
              cuando la hoja solo servía para repartir; desde que la lista de
              arriba enseña únicamente los fiados que reciben algo, la hoja es
              el único sitio donde están los demás. Esconderla hasta teclear
              deja al tendero sin forma de llegar al fiado que su cliente
              acaba de nombrar.

              EL RÓTULO HA CAMBIADO DOS VECES y las dos quedan escritas.
              «Repartir distinto» describía lo que hace con un monto puesto;
              «Seleccionar fiados» lo que hace siempre; y «Repartir
              manualmente» —encargo del dueño el 2026-10-23— dice además QUIÉN
              decide, que es lo que de verdad distingue a esta puerta de la
              lista automática de arriba. */}
          {/* ── CUÁNDO NO SE DIBUJA ───────────────────────────────────
              Tres casos, y en los tres el botón abriría una hoja donde no hay
              nada que decidir:

              1. EN MODO SELECCIÓN: su trabajo —encontrar un fiado y ponerle
                 cifra— ya lo hace el buscador de arriba con la lista entera
                 debajo. Dos puertas a lo mismo en la misma pantalla, y una de
                 ellas abriendo una hoja encima de la otra.

              2. CON UN SOLO FIADO: no hay entre qué repartir. Encargo del
                 dueño el 2026-10-23.

              3. CUANDO EL MONTO CUBRE TODA LA DEUDA: cada fiado recibe lo
                 suyo entero, así que no queda nada que mover de uno a otro —
                 cada línea ya está topada a lo que ese fiado debe. Mismo
                 encargo.

              EL TERCERO INCLUYE EL CASO EN QUE SE PASA (`excede`), y es a
              propósito: si tecleó más de lo que el cliente debe, tampoco hay
              reparto que ajustar — lo que hay es una cifra que corregir, y
              eso lo dice la línea roja de arriba.

              EL SEGUNDO SE CUENTA SOBRE LOS FIADOS DEL LIBRO, no sobre las
              tarjetas que se dibujan — y esto ya se equivocó una vez, así que
              va escrito entero.

              El 2026-10-23 por la mañana el dueño pidió esconderlo «cuando en
              la lista de fiados hay solo un fiado (…) porque solo hay un fiado
              a pagar», y se contó sobre las tarjetas pintadas. Esa tarde, con
              producción delante, reportó lo contrario: su clienta tenía CUATRO
              fiados vencidos y la pantalla le enseñaba uno solo, sin forma de
              llegar a los otros tres.

              Las dos peticiones son la misma confusión vista por sus dos
              caras: la lista solo dibuja a quien RECIBE algo, así que con un
              monto menor de lo que debe el peor fiado sale una tarjeta — y de
              ahí se concluye «solo hay un fiado». Contándolo sobre las
              tarjetas, el botón desaparece **justo cuando es la única puerta a
              los demás**, que es lo que esta hoja existe para ser.

              MEDIDO con los cuatro fiados de un cliente de dev el mismo día:
              €10 sobre un libro que debe €55,95 reparte una sola tarjeta;
              €20 reparte dos; Bs. 20.000 cruza libros y reparte tres. El
              reparto nunca estuvo mal — lo que estaba mal era esconder la
              puerta.

              LO QUE CUESTA, y es el precio de elegir esta cara: con dos fiados
              y un monto que solo alcanza al primero, el botón se ve aunque la
              lista enseñe una tarjeta. Es exactamente lo que él pidió quitar
              por la mañana. Se elige así porque la alternativa es que un
              fiado abierto no tenga ninguna puerta. */}
          {modoSeleccion || cubreTodo || delLibro.length <= 1 ? null : (
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full"
              onClick={() => {
                setBuscaFiado("");
                setRepartiendo(true);
              }}
            >
              Repartir manualmente
            </Button>
          )}

          <Button type="button" className="h-10 w-full" disabled={!puedeGuardar} onClick={guardar}>
            {guardando
              ? "Guardando…"
              : enElLibro > 0.005 && !excede
                ? // CRUZANDO LIBROS EL TOTAL ESTÁ EN BOLÍVARES y no en ningún
                  // libro: es la única moneda en la que ese billete existe
                  // entero. Enseñarlo en dólares exigiría sumar dólares y
                  // euros, que es justo lo que no se puede hacer.
                  `Pagar y finalizar ${
                    cruzaLibros
                      ? formatBs(reparto.repartido)
                      : formatPriceAmount(reparto.repartido, (libro ?? "COP") as PriceCurrency)
                  }`
                : "Pagar y finalizar"}
          </Button>
        </StickyActions>
      ) : null}
    </div>
  );
}
