"use client";

import { useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { Link2, Loader2, Minus, Plus, Trash2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { avisarCuentaPausada } from "@/lib/cuenta-pausada";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { SupplierField } from "@/components/dashboard/supplier-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  formatAmountForInput,
  formatPercent,
  formatPriceAmount,
  isSaleCurrencyLocked,
  marginFromPrice,
  parseAmount,
  parseTypedAmount,
  priceFromCost,
  priceIn,
  type BolivarRates,
  type CostCurrency,
  type PriceCurrency,
  type PriceTier,
  withoutLockedSaleCurrencies,
} from "@/lib/products/price";
import { useGroupedAmount } from "@/hooks/use-grouped-amount";
import { MARGIN_PRESETS } from "@/lib/products/options";
import { ProductPhotoInput } from "@/components/dashboard/product-photo-input";
import { Checkbox } from "@/components/ui/checkbox";
import { TarjetaDePublicacion } from "@/components/dashboard/product-detail-rows";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import {
  createProduct,
  updateProduct,
  trashProduct,
  type ProductInput,
} from "@/app/(app)/productos/actions";
import type { ProductRow } from "@/lib/products/catalog";
import { ScreenBackRow } from "@/components/dashboard/screen-back-row";
import { ScreenTitle } from "@/components/dashboard/screen-chrome";
import { StickyActions } from "@/components/dashboard/sticky-actions";

const DEFAULT_MARGIN: Record<PriceTier, string> = { retail: "30", wholesale: "15" };

// Las monedas en las que un producto puede llevar precio. VES no está: es la
// moneda en la que el cliente PAGA, y desde el frame 1192:4185 se enseña como
// una línea «Hoy: Bs. …» DEBAJO de cada una, no como una fila propia.
const SELLABLE: PriceCurrency[] = ["USD", "EUR", "USDT"];

// LOS CUATRO PASOS, con los rótulos del frame `1465:18582` tal cual: «1/4
// Información del producto», «2/4 Precio», «3/4 Detalles», «4/4 Verifica».
const ETIQUETA_DEL_PASO = [
  "Información del producto",
  "Precio",
  "Detalles",
  "Verifica",
] as const;

const CURRENCY_LABEL: Record<string, string> = {
  USD: "Dólar",
  EUR: "Euro",
  USDT: "USDT",
  COP: "Peso",
  VES: "Bolívar",
};

// Los del menú del frame, en plural, que es como se nombra una moneda cuando
// se habla de cuánto costó algo.
const COST_LABEL: Record<string, string> = {
  USD: "Dólares",
  EUR: "Euros",
  USDT: "USDT",
  COP: "Pesos",
  OTHER: "Otro",
};

// LA FICHA DE PRODUCTO, segun el frame 1192:4185.
//
// ─────────────────────────────────────────────────────────────────────────
// AL DETAL VA PRIMERO
//
// El frame lo invierte respecto a la versión anterior, y tiene sentido: el
// precio al detal es el que el tendero usa cien veces al día; el de mayor es
// el caso particular. La sección de mayor es además la más larga, porque lleva
// debajo «a partir de cantidad».
//
// ─────────────────────────────────────────────────────────────────────────
// O HAY MARGEN, O HAY PRECIOS FIJOS POR MONEDA
//
// El desplegable del margen se inhabilita en cuanto alguna moneda que no sea
// la base lleva un importe a mano, y se recupera volviendo a enlazarlas.
//
// Y SIN COSTO, elegir un margen no calcula nada. En vez de dejarlo pasar en
// silencio, la ficha pinta el campo del costo en rojo y lo dice — es lo que
// pidió el dueño el 2026-10-10, y es mejor que inhabilitar el desplegable,
// porque un control apagado no explica qué falta.
// EL FLUJO DE CUATRO PASOS PARA CREAR O EDITAR UN PRODUCTO.
//
// Encargo del dueño el 2026-10-20: *«actualmente es un popup y es muy
// extenso, lo que afecta la experiencia del usuario»*, con el frame
// `1465:18582`. Y, preguntado, que **editar también** pase a pantallas.
//
// NO HAY CAMPOS NI PATRONES NUEVOS, que fue su condición: el formulario es el
// mismo, repartido. Lo único que no existía es el 4/4, que relee lo tecleado.
export function ProductoFlujo({
  product,
  rates,
  defaultCurrency,
  overrides,
  initialCurrencies,
  supplierSuggestions,
  lastCostCurrency,
  ownerId,
}: {
  product: ProductRow | null;
  // null para un negocio colombiano: no hay equivalencias que enseñar.
  rates: BolivarRates | null;
  defaultCurrency: PriceCurrency;
  overrides: Record<PriceTier, Partial<Record<PriceCurrency, number>>>;
  // UNA LISTA POR ESCALÓN desde la migración 114, cada una con SU base
  // primera. Antes era una sola para los dos, y por eso quitar una moneda en
  // un bloque la quitaba del otro — lo reportó el dueño el 2026-10-15.
  initialCurrencies: Record<PriceTier, PriceCurrency[]>;
  // Los proveedores que este negocio ya escribió, para el autocompletado.
  // Salen de los productos que la página ya cargó, no de una consulta nueva.
  supplierSuggestions: string[];
  // La moneda del costo del ULTIMO producto creado por este negocio, o
  // null si todavia no tiene ninguno. Solo la usa el dialogo de alta: al
  // editar manda la del producto que se esta abriendo.
  lastCostCurrency?: CostCurrency | null;
  ownerId: string;
}) {
  const router = useRouter();
  const [saving, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // ── EL PASO, Y POR QUÉ NO ES UNA RUTA ────────────────────────────────
  //
  // Los cuatro pasos comparten UN formulario: lo que se teclea en el 1 tiene
  // que seguir ahí al volver desde el 4. Con una ruta por paso ese estado
  // habría que levantarlo a un contexto o escribirlo en la dirección, y el
  // asistente de venta --que tiene el mismo problema-- ya resolvió esto con
  // estado interno. Es el patrón de la casa, no una economía.
  const [paso, setPaso] = useState<1 | 2 | 3 | 4>(1);

  // ADÓNDE SE VA AL SALIR. Al catálogo, que es de donde se entra por las dos
  // puertas --el botón flotante y el del estado vacío--.
  const salir = () => router.push("/productos");

  // ── «CONTINUAR» VALIDATES ITS OWN SCREEN ─────────────────────────────
  //
  // Owner's instruction on 2026-10-20: *«la validación del nombre debe
  // ocurrir al seleccionar "Continuar" en esa misma pantalla»*, and the same
  // for prices.
  //
  // I HAD LEFT IT TO THE SAVE, reasoning that the server already holds the
  // rules and repeating them here duplicated them. That was bad reasoning and
  // the screenshot shows why: «Escribe el nombre del producto» surfaced on
  // step 2/4, at the foot, below the wholesale price — two screens away from
  // the empty field and saying nothing about where it was. An error has to
  // appear where it can be fixed; otherwise it is just a refusal.
  //
  // ===========================================================================
  // THE PRICE RULE IS STRICTER THAN THE SERVER'S, ON PURPOSE
  //
  // The server asks for ONE price across the whole product (`Pon al menos un
  // precio, al detal o al mayor`). The owner asked for one per ENABLED tier,
  // and the extra strictness earns its keep: a product with «Venta al mayor»
  // on and no wholesale price passes the server's rule on the strength of the
  // retail one, and reaches the catalogue offering a wholesale tier with no
  // figure behind it. An enabled switch is a promise.
  //
  // A TIER «HAS A PRICE» if its base has one OR any of its loose currencies
  // does: breaking the dollar's link and typing only the euro is a valid way
  // to price it, and looking at the base alone would read that as empty.
  function tienePrecio(tier: PriceTier): boolean {
    const base = tier === "retail" ? priceRetail : priceWholesale;
    if (base.trim() !== "") return true;
    return Object.values(fixed[tier]).some((v) => (v ?? "").trim() !== "");
  }

  function continuar() {
    if (paso === 1 && name.trim() === "") {
      setError("Escribe el nombre del producto.");
      return;
    }
    if (paso === 2) {
      if (ventaRetail && !tienePrecio("retail")) {
        setError("Debes fijar al menos un precio al detal");
        return;
      }
      if (ventaWholesale && !tienePrecio("wholesale")) {
        setError("Debes fijar al menos un precio al mayor");
        return;
      }
    }
    // THE NOTICE CLEARS ON THE WAY FORWARD. Without this, one screen's notice
    // hangs at the foot of the next one — half of what the owner reported.
    setError(null);
    setPaso((p) => Math.min(4, p + 1) as 1 | 2 | 3 | 4);
  }

  const editing = product != null;

  const [name, setName] = useState(product?.name ?? "");

  // UN PRODUCTO NUEVO ARRANCA CON 1 EN EL INVENTARIO. Frame 1192:4185,
  // 2026-10-14. Hasta hoy arrancaba vacío.
  //
  // El valor sirve porque el caso corriente del alta rápida es «acabo de
  // recibir uno de estos»; y el que recibió veinte cambia un dígito, que es
  // menos trabajo que escribirlo desde cero. Lo que NO puede hacer es tocar
  // una ficha que ya existe: un producto guardado sin cantidad la dejó vacía a
  // propósito, y abrirlo para corregir el precio no puede inventarle un 1.
  // Por eso se mira `product` y no `stock`.
  const [stock, setStock] = useState(
    product != null ? formatAmountForInput(product.stock_opening) : "1",
  );
  // SE PASO DEL TOPE AL TECLEAR. No es lo mismo que «el valor es demasiado
  // grande»: con el tope puesto, el valor NUNCA llega a serlo, porque la tecla
  // no entra. Sin este aviso, el campo ignoraría al dedo sin decir nada, que
  // es la peor forma de rechazar algo.
  const [stockTopado, setStockTopado] = useState(false);

  // SE APAGA CON LA SIGUIENTE PULSACION QUE SI ENTRA -- y eso incluye borrar,
  // que es como se corrige un campo en un telefono. Se hace aqui y no en un
  // `useEffect` que vigile `stock`: llamar a setState dentro de un efecto
  // encadena renders y la regla `react-hooks/set-state-in-effect` lo rechaza.
  const cambiarStock: Dispatch<SetStateAction<string>> = (valor) => {
    setStockTopado(false);
    setStock(valor);
  };

  const [cost, setCost] = useState(formatAmountForInput(product?.cost, { miles: true }));

  // DÓNDE LO COMPRÓ. Migración 103, frame 1192:4185.
  const [supplier, setSupplier] = useState(product?.supplier ?? "");

  // LA MONEDA DEL COSTO DEL ÚLTIMO PRODUCTO QUE CREÓ ESTE NEGOCIO.
  //
  // Decisión del dueño el 2026-10-14, y la TERCERA de ese día sobre este mismo
  // campo. Las tres se dejan escritas porque cada una desplaza a la anterior y
  // ninguna era mala — lo que cambió es qué caso se considera el corriente:
  //
  //   1. «La última moneda usada» (2026-10-10). Un tendero compra casi siempre
  //      en la misma moneda, así que preguntárselo cada vez es una decisión que
  //      ya tomó.
  //   2. «Siempre dólares» (2026-10-14, por la mañana), y pesos en Colombia. El
  //      dólar es la moneda en que se piensa el precio en Venezuela, y arrancar
  //      en otra porque UNA vez se compró en euros convierte un caso raro en el
  //      valor por defecto de todos los productos siguientes.
  //   3. **La del último producto CREADO** (2026-10-14, por la tarde), que es
  //      lo que hay hoy. Lo que desplaza al 2: un tendero que compra en USDT lo
  //      hace SIEMPRE, no una vez, y para él el caso raro es el dólar.
  //
  // Vuelve a salir de su propio historial y NO del navegador: iOS Safari borra
  // `localStorage` y la ficha «olvidaría» lo que lleva meses haciendo.
  //
  // SIN PRODUCTOS TODAVÍA, `lastCostCurrency` llega null y cae en la moneda del
  // negocio — que es la decisión 2, intacta para el primer producto de una
  // cuenta nueva. No hay historial del que tirar, y el país es lo único que se
  // sabe de ese negocio.
  const [costCurrency, setCostCurrency] = useState<CostCurrency>(
    (product?.cost_currency as CostCurrency | null) ?? lastCostCurrency ?? defaultCurrency,
  );
  // «OTRO» SE QUEDA EN «OTRO», Y NO SE PREGUNTA CUAL. Decisión del dueño el
  // 2026-10-10. Lo que se escribía ahí no servía para nada — no tenemos tasa
  // de esa moneda la llame como la llame— y en dev acabó guardando un «Gjrj».
  // La migración 089 relaja el check que la 087 había puesto para exigirlo.
  // Se enciende al intentar elegir un margen sin costo. Ver `pedirCosto`.
  const [costoFaltante, setCostoFaltante] = useState(false);
  // HERMANO DEL ANTERIOR, PARA EL OTRO MOTIVO. Se enciende al intentar elegir
  // un margen cuando SÍ hay costo pero su moneda es «Otro», de la que no
  // tenemos tasa. Decisión del dueño el 2026-10-14: con «Otro» se guarda sin
  // problema, pero si intenta calcular el margen hay que decírselo en vez de
  // no hacer nada.
  //
  // Son dos estados y no uno con dos valores porque señalan sitios distintos:
  // «falta el costo» pinta el importe en rojo, y esto pinta el SELECTOR DE
  // MONEDA, que es lo que hay que cambiar. Pintar el importe aquí sería el
  // fallo que el dueño reportó el 2026-10-10 — «Primero pon el costo» con un
  // 35 escrito encima.
  const [monedaSinTasa, setMonedaSinTasa] = useState(false);

  // LAS MONEDAS BLOQUEADAS SE CAEN AL CARGAR, no solo al anadir (CT-79). Un
  // producto que ya tenga USDT -- en dev hay dos -- se abre sin ella, y al
  // guardar deja de tenerla. Es lo que "bloqueada" tiene que significar: si
  // siguiera editable, el tendero podria mantener vivo un precio que el
  // catalogo publicaria y que ninguna orden podria registrarse.
  //
  // Su base nunca se cae, por `withoutLockedSaleCurrencies`: eso repreciaria
  // el producto en silencio en vez de ocultarle una moneda.
  const [currencies, setCurrencies] = useState<Record<PriceTier, PriceCurrency[]>>({
    retail: withoutLockedSaleCurrencies(initialCurrencies.retail),
    wholesale: withoutLockedSaleCurrencies(initialCurrencies.wholesale),
  });

  // LA BASE DE CADA ESCALÓN ES LA PRIMERA DE SU LISTA, y ese contrato lo
  // comparte con `currenciesOf` y con `TierSection`. Dos listas, dos bases:
  // un producto puede escribir su detal en dólares y su mayor en euros.
  const baseDe = (tier: PriceTier) => currencies[tier][0] ?? defaultCurrency;

  const [priceRetail, setPriceRetail] = useState(
    formatAmountForInput(product?.price_retail, { miles: true }),
  );
  const [priceWholesale, setPriceWholesale] = useState(
    formatAmountForInput(product?.price_wholesale, { miles: true }),
  );
  // EL MARGEN GUARDADO MANDA SOBRE EL VALOR POR DEFECTO al abrir una ficha que
  // ya existe. Si no, corregir el costo de un producto con 20 % de margen se
  // lo subiría a 30 % sin que nadie lo pidiera — ver `handleCost`.
  const [marginRetail, setMarginRetail] = useState(
    product?.margin_retail_pct != null ? String(product.margin_retail_pct) : DEFAULT_MARGIN.retail,
  );
  const [marginWholesale, setMarginWholesale] = useState(
    product?.margin_wholesale_pct != null
      ? String(product.margin_wholesale_pct)
      : DEFAULT_MARGIN.wholesale,
  );
  // 6 POR DEFECTO EN UN PRODUCTO NUEVO. Frame 1192:4185, 2026-10-14.
  //
  // Misma regla que el inventario de arriba y por la misma razón: se mira
  // `product`, no el valor. Una ficha guardada sin mínimo lo dejó así porque
  // su precio de mayor no depende de la cantidad, y abrirla no puede
  // inventarle un umbral que cambiaría lo que el cliente paga.
  const [minQty, setMinQty] = useState(
    product != null ? formatAmountForInput(product.wholesale_min_quantity) : "6",
  );

  // QUE SE VENDE: AL DETAL, AL MAYOR, O LAS DOS COSAS.
  //
  // Decisión del dueño el 2026-10-10. Un producto nuevo nace con las dos
  // encendidas; uno que ya existe las deduce de si tiene ese precio.
  //
  // NO HAY COLUMNA NUEVA, y es deliberado: «no lo vendo al mayor» y «no tiene
  // precio al mayor» son la misma cosa dicha dos veces, y un booleano aparte
  // podría acabar contradiciendo al precio — un producto marcado «sí se vende
  // al mayor» con la columna en null, o al revés. Apagar el interruptor manda
  // `null` en ese precio; encenderlo deja escribirlo.
  const [ventaRetail, setVentaRetail] = useState(
    product == null ? true : product.price_retail != null,
  );
  const [ventaWholesale, setVentaWholesale] = useState(
    product == null ? true : product.price_wholesale != null,
  );

  const [confirmarBorrado, setConfirmarBorrado] = useState(false);

  const [fixed, setFixed] = useState<Record<PriceTier, Partial<Record<PriceCurrency, string>>>>({
    retail: Object.fromEntries(
      Object.entries(overrides.retail).map(([c, v]) => [c, formatAmountForInput(v, { miles: true })]),
    ),
    wholesale: Object.fromEntries(
      Object.entries(overrides.wholesale).map(([c, v]) => [c, formatAmountForInput(v, { miles: true })]),
    ),
  });

  // UN PRODUCTO NUEVO NACE PUBLICADO EN LOS DOS ESCALONES. Decisión del dueño
  // el 2026-10-10, y va de la mano con que la tarjeta del cliente enseñe el
  // precio más bajo: el caso corriente es querer que se vea.
  //
  // El DEFAULT DE LA BASE sigue siendo `false` (migración 084) y eso no es una
  // incoherencia: ahí protege contra una fila creada por cualquier otra vía
  // —un import, un script— que acabaría publicada sin que nadie lo decidiera.
  // Aquí lo decide el formulario, que es donde hay alguien decidiendo.
  const [pubRetail, setPubRetail] = useState(product?.published_retail ?? true);
  const [pubWholesale, setPubWholesale] = useState(product?.published_wholesale ?? true);
  const publishOn = pubRetail || pubWholesale;

  const [photoPath, setPhotoPath] = useState<string | null>(product?.photo_path ?? null);
  const [description, setDescription] = useState(product?.description ?? "");

  // `parseTypedAmount` Y NO `parseAmount` en todo lo que lee un campo de
  // DINERO de esta pantalla, desde el 2026-10-24, que es cuando el costo y los
  // precios pasaron a agruparse mientras se teclean.
  //
  // `parseAmount` tiene que adivinar porque lee texto libre, y su regla es «un
  // separador solo con tres dígitos detrás son miles». En un campo agrupado la
  // convención ya está decidida —los puntos son nuestros, la coma es el
  // decimal— y esa adivinanza lee «1,234» como MIL DOSCIENTOS TREINTA Y
  // CUATRO. Un precio con tres decimales es raro; un precio mil veces mayor
  // puesto en el catálogo sin que nada chille, no se descubre mirando.
  const toNum = (v: string) => {
    const n = parseTypedAmount(v);
    return n != null && n > 0 ? n : null;
  };
  const costNumber = toNum(cost);
  const costUsable = costNumber != null && costCurrency !== "OTHER";

  // EL MARGEN SE MIDE DENTRO DE UNA MONEDA, y por eso hay que decirle cuál.
  // Cada escalón tiene su propia base desde la `114`, así que el precio que
  // se le pasa está en la moneda de SU escalón y no en una común.
  const marginOf = (price: string, tier: PriceTier): number | null => {
    const p = toNum(price);
    if (p == null) return null;
    return marginFromPrice(costNumber, costCurrency, p, baseDe(tier), rates);
  };

  // ELEGIR UN MARGEN SIN COSTO NO SE IGNORA: SE EXPLICA.
  //
  // Decisión del dueño el 2026-10-10. Lo alternativo era dejar el desplegable
  // apagado, y es peor: un control apagado no dice qué falta ni dónde está lo
  // que falta. Pintar el costo en rojo señala el sitio exacto.
  // Lo que pasa cuando el costo está pero su moneda no convierte.
  function pedirMonedaConTasa() {
    setMonedaSinTasa(true);
  }

  function pedirCosto() {
    setCostoFaltante(true);
    // SIN `focus()`, y se probó: Radix devuelve el foco a su propio
    // desplegable cuando se cierra, DESPUES de que este manejador corra, así
    // que la llamada no hacía nada. Una línea que aparenta funcionar y no
    // funciona es peor que no tenerla.
    //
    // No hace falta: el campo está justo encima, se pinta en rojo y el
    // mensaje dice qué poner. Robarle el foco a un control que el tendero
    // acaba de tocar tampoco sería mejor.
  }

  // LOS MILES, MIENTRAS SE TECLEA — pedido por el dueño el 2026-10-24 para
  // toda la app. Va sobre `handleCost` y no sobre `setCost` porque teclear el
  // costo recalcula los dos precios: el formateo tiene que ocurrir ANTES de
  // que `recalcularDesdeCosto` lea el texto, o leería lo que el navegador puso
  // y no lo que queda en pantalla.
  const { ref: refCosto, onChange: alTeclearCosto } = useGroupedAmount(cost, handleCost);

  function handleCost(next: string) {
    setCost(next);
    if (next.trim() !== "") setCostoFaltante(false);
    recalcularDesdeCosto(next, costCurrency);
  }

  function recalcularDesdeCosto(texto: string, moneda: CostCurrency) {
    const c = parseTypedAmount(texto);
    if (c == null || c <= 0 || moneda === "OTHER" || !rates) return;

    // RECALCULA SIEMPRE, no solo los precios vacíos. Lo pidió el dueño el
    // 2026-10-10 tras ver la pantalla: con el costo en 50 y un 6,5 viejo en el
    // precio, el margen salía como «Otro» y la cifra se quedaba ahí sin que
    // nada la explicara.
    //
    // Antes esto solo rellenaba los huecos, para no reescribir un precio
    // puesto a mano. La contrapartida de cambiarlo, y conviene saberla:
    // corregir el costo de un producto que ya existe le recalcula los dos
    // precios. Se recalculan CON SU MARGEN GUARDADO, no con el 30/15 por
    // defecto, así que un producto al 20 % se queda al 20 % — eso es lo que
    // hace que esto sea aceptable y no una sorpresa.
    //
    // Un escalón con precios fijados a mano por moneda se queda fuera: ahí el
    // margen no manda, y su desplegable está apagado por lo mismo.
    //
    // CADA ESCALÓN RECALCULA CON SU PROPIA BASE (114). Con una base compartida
    // esto funcionaba por casualidad; con dos, calcular el precio del mayor
    // partiendo de la moneda del detal le pondría al tendero un número en la
    // moneda equivocada sin decírselo.
    const recalcular = (
      tier: PriceTier,
      margen: string,
      fijos: Partial<Record<PriceCurrency, string>>,
      set: (v: string) => void,
    ) => {
      const suBase = baseDe(tier);
      const hayFijos = currencies[tier].some(
        (x) => x !== suBase && estaDesvinculada(fijos, x),
      );
      if (hayFijos) return;
      const p = priceFromCost(c, moneda, Number(margen), suBase, rates);
      if (p != null) set(formatAmountForInput(p, { miles: true }));
    };
    recalcular("retail", marginRetail, fixed.retail, setPriceRetail);
    recalcular("wholesale", marginWholesale, fixed.wholesale, setPriceWholesale);
  }

  // APAGAR LAS DOS DEJARIA UN PRODUCTO SIN NINGUN PRECIO, y la tabla exige
  // uno (`products_at_least_one_price`). Se impide aquí, con una frase, en vez
  // de dejar que el guardado falle: cuando falla, los dos campos que harían
  // falta para arreglarlo están escondidos detrás de los interruptores que el
  // tendero acaba de apagar.
  function pedirVenta(tier: PriceTier, activa: boolean) {
    if (!activa) {
      const otra = tier === "retail" ? ventaWholesale : ventaRetail;
      if (!otra) {
        toast.error("Un producto tiene que venderse de alguna forma: al detal, al mayor o las dos.");
        return;
      }
    }
    if (tier === "retail") setVentaRetail(activa);
    else setVentaWholesale(activa);
  }

  // AGREGAR Y QUITAR SON DE UN ESCALÓN, NO DEL PRODUCTO (114).
  //
  // Hasta el 2026-10-15 había una sola lista y las dos secciones compartían
  // estas dos funciones, así que las papeleras estaban conectadas: quitar el
  // euro al mayor lo quitaba del detal. El dueño lo reportó dos veces, y la
  // segunda dejó claro lo que quería — «un producto puede tener los tres
  // precios al detal pero solo uno al mayor».
  function agregarMoneda(tier: PriceTier, c: PriceCurrency) {
    setCurrencies((prev) =>
      prev[tier].includes(c) ? prev : { ...prev, [tier]: [...prev[tier], c] },
    );
  }

  // QUITAR LA BASE NO PUEDE DEJAR EL NUMERO QUIETO, y esto es dinero.
  //
  // `price_retail` guarda «el precio en la moneda base de SU escalón». Si se
  // quita el dólar y pasa a mandar el euro, un 65 guardado dejaría de
  // significar $65 y pasaría a significar 65 € sin que nadie lo tocara — el
  // producto se encarecería un 12 % en silencio.
  //
  // Y DESDE LA 114 SOLO SE MUEVE EL PRECIO DE SU ESCALÓN, que es lo que esto
  // tenía de retorcido antes: con una base compartida había que mover LOS DOS
  // precios a la vez, porque los dos estaban escritos en la misma moneda.
  // Separar las bases no complicó esta función, la simplificó.
  function quitarMoneda(tier: PriceTier, c: PriceCurrency) {
    const lista = currencies[tier];
    if (lista.length <= 1) return;
    const siguientes = lista.filter((x) => x !== c);
    const nuevaBase = siguientes[0];
    const baseActual = baseDe(tier);

    if (c === baseActual) {
      const precio = tier === "retail" ? priceRetail : priceWholesale;
      const fijado = (fixed[tier][nuevaBase] ?? "").trim();
      let trasladado = fijado;
      if (trasladado === "") {
        const n = parseTypedAmount(precio);
        const conv =
          n == null || !rates
            ? null
            : priceIn(nuevaBase, { amount: n, currency: baseActual }, rates).amount;
        trasladado = conv == null ? "" : formatAmountForInput(conv, { miles: true });
      }
      if (tier === "retail") setPriceRetail(trasladado);
      else setPriceWholesale(trasladado);
    }

    setFixed((f) => {
      const next = { ...f[tier] };
      delete next[c];
      if (c === baseActual) delete next[nuevaBase];
      return { ...f, [tier]: next };
    });
    setCurrencies((prev) => ({ ...prev, [tier]: siguientes }));
  }

  const input: ProductInput = {
    name,
    // El campo «Unidad» salió del formulario el 2026-10-10. La columna se
    // queda: los productos que ya la tienen la conservan y el catálogo público
    // la sigue enseñando, pero no se vuelve a pedir.
    unit: product?.unit ?? null,
    // LAS DOS LISTAS. `rowFrom` saca de cada una su base, que es la primera.
    activeCurrenciesRetail: currencies.retail,
    activeCurrenciesWholesale: currencies.wholesale,
    // Un escalón apagado no manda precio, ni precios por moneda, ni queda
    // publicado. Si no, un producto que «ya no se vende al mayor» seguiría
    // saliendo en el catálogo de mayorista con su precio de siempre.
    priceRetail: ventaRetail ? priceRetail || null : null,
    priceWholesale: ventaWholesale ? priceWholesale || null : null,
    fixedRetail: ventaRetail ? fixed.retail : {},
    fixedWholesale: ventaWholesale ? fixed.wholesale : {},
    cost: cost || null,
    costCurrency: cost.trim() === "" ? null : costCurrency,
    // Nada lo escribe desde el 2026-10-10. Ver la migración 089.
    costCurrencyOther: null,
    // ESTOS DOS SE GUARDAN EN LA BASE, así que el fallo de monedas cruzadas
    // del 2026-10-22 no solo se veía: se escribía. Un producto con el costo en
    // dólares y el precio al detal en euros quedaba con un `margin_retail_pct`
    // que no era su margen, y de ahí sale el informe de ganancia.
    marginRetailPct: ventaRetail ? (marginOf(priceRetail, "retail")?.toString() ?? null) : null,
    marginWholesalePct: ventaWholesale
      ? (marginOf(priceWholesale, "wholesale")?.toString() ?? null)
      : null,
    stockOpening: stock || null,
    supplier: supplier || null,
    wholesaleMinQuantity: minQty || null,
    publishedRetail: ventaRetail && pubRetail,
    publishedWholesale: ventaWholesale && pubWholesale,
    photoPath,
    description: description || null,
  };

  function save() {
    setError(null);
    startTransition(async () => {
      const result = editing
        ? await updateProduct(product!.id, input)
        : await createProduct(input);

      if (result.error) {
        if (avisarCuentaPausada(result.error)) return;
        setError(result.error);
        return;
      }

      // GUARDADO: se sale al catálogo. Era `onOpenChange(false)` más un
      // `onSaved?.()` para que quien montaba el diálogo supiera distinguir
      // «guardó» de «se arrepintió» y limpiara el formulario solo en el
      // primer caso. Con una pantalla propia ese problema desaparece: salir
      // la desmonta, y volver a entrar la monta vacía.
      salir();
      router.refresh();
      toast.success(editing ? "Producto actualizado." : "Producto creado.");
    });
  }

  const tierProps = {
    cost: costNumber,
    costCurrency,
    costUsable,
    onNeedCost: pedirCosto,
    onNeedRateCurrency: pedirMonedaConTasa,
    // `currencies`, `onAddCurrency` y `onRemoveCurrency` YA NO VIVEN AQUÍ: son
    // lo único que las dos secciones no pueden compartir, y compartirlas era
    // exactamente el fallo. Cada `TierSection` recibe las suyas abajo.
    rates,
    disabled: saving,
  };

  // ESTE ARCHIVO ERA UN DIÁLOGO HASTA EL 2026-10-20. El historial guarda esa
  // versión, con su comentario sobre la columna `auto` de un grid a 375px que
  // costó medir. Lo que cambió es el envoltorio: el estado, las validaciones,
  // el vínculo entre monedas, la foto y el borrado son los mismos.
  return (
    <div className="flex flex-1 flex-col gap-4">
      {/* ── LA CABECERA DEL FLUJO ──────────────────────────────────────
          Misma forma que el asistente de venta (`nueva-venta.tsx`): rótulo,
          «N/4» con el nombre del paso, y una barra que se llena. No se copia
          por parecido — es lo que el frame `1465:18582` dibuja en los cuatro,
          y lo que el tendero ya aprendió registrando una venta. */}
      <ScreenBackRow
        onClick={() => (paso === 1 ? salir() : setPaso((p) => (p - 1) as 1 | 2 | 3))}
        label={paso === 1 ? "Volver al catálogo" : "Volver al paso anterior"}
        soloEnTelefono={false}
      />

      <div className="flex flex-col gap-2">
        <ScreenTitle>{editing ? "Editar producto" : "Crear producto"}</ScreenTitle>
        <p className="text-sm text-muted-foreground">
          {paso}/4 {ETIQUETA_DEL_PASO[paso - 1]}
        </p>
        <div aria-hidden="true" className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-foreground transition-all"
            style={{ width: `${(paso / 4) * 100}%` }}
          />
        </div>
      </div>

      {/* ── 24px ENTRE CAMPOS, EN LOS TRES PASOS DE FORMULARIO ───────────
          Decidido por el dueño el 2026-10-20 — *«incrementa el gap entonces a
          24px»*— después de medirlo: ya eran los 16 que había pedido y los
          seguía viendo apretados.

          POR QUÉ 16 SE VEÍA CORTO AQUÍ Y NO EN OTRAS PANTALLAS: un campo de
          esta app mide 32px de alto y su rótulo va pegado a 8. Así que cada
          bloque rótulo+campo ocupa 60px y los separan 16 — una proporción que
          en una lista de cuatro campos seguidos deja menos aire ENTRE dos
          campos que DENTRO de uno más su rótulo. Con 24 la separación entre
          bloques vuelve a ser mayor que la de dentro, que es lo que hace que
          se lean como cuatro cosas y no como una parrilla.

          EL 4/4 NO ENTRA: no es un formulario, son filas de lectura con el
          ritmo de 8px que dibuja el frame `1465:19856`. */}
      {paso === 1 ? (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <Label htmlFor="producto_nombre">Nombre del producto</Label>
              <Input
                id="producto_nombre"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Escribe nombre"
                autoFocus={!editing}
              />
            </div>

            {/* «Disponible en inventario», no «Cantidad»: el frame lo renombró el
                2026-10-10 y la palabra nueva dice de qué cantidad habla. Sin
                sufijo de unidad, porque el campo «Unidad» ya no existe. */}
            <Stepper
              id="producto_cantidad"
              label="Disponible en inventario"
              value={stock}
              onChange={cambiarStock}
              /* EL TECHO SE DICE ANTES DE CHOCAR CON ÉL. Pedido por el dueño el
                 2026-10-14, después de que su 1000000000000000 solo produjera un
                 error al pulsar guardar — con quince campos rellenos y una foto
                 ya subida detrás.

                 El aviso sale SOLO cuando el número ya se pasó, no siempre: un
                 «máximo 11 dígitos» permanente bajo un campo que el 99 % de las
                 veces lleva un 1 o un 12 es ruido que se deja de leer, y
                 entonces tampoco se lee el día que importa. */
              /* ONCE DÍGITOS, Y LA TECLA DOCE NO ENTRA. Pedido por el dueño
                 el 2026-10-15. La versión anterior dejaba teclear
                 1000000000000000 entero y avisaba debajo en gris: el aviso
                 llegaba tarde y parecía una nota, no un rechazo.

                 El tope son once ENTEROS y no once caracteres, porque el límite
                 real es `numeric(14,3)` en la base. */
              maxDigitos={11}
              onTope={() => setStockTopado(true)}
              hintError={stockTopado || excedeTecho(stock, 1e11)}
              /* ONLY THE CEILING WARNING LEFT HERE. The standing note —«Por
                 ahora esta cantidad no baja sola: cuando fíes o vendas,
                 tendrás que ajustarla tú»— was removed at the owner's request
                 on 2026-10-20, reviewing step 1/4 with the three hints
                 circled in red.

                 It is the same reasoning the ceiling warning's own comment
                 states right above: a permanent grey line under a field that
                 almost always holds a 1 or a 12 is noise, and noise is read
                 once and then never again. The ceiling warning stays because
                 it only appears once the number is already past the limit. */
              hint={
                stockTopado || excedeTecho(stock, 1e11)
                  ? "Esa cantidad es demasiado grande: como mucho 11 dígitos (99.999.999.999)."
                  : null
              }
              disabled={saving}
            />

            {/* EL PROVEEDOR CIERRA EL PASO 1, y ya no va detrás del costo:
                el costo se mudó al 2/4 el 2026-10-20 (ver su comentario allí).
                Lo que queda aquí es qué es el producto y cuánto hay. */}
            <SupplierField
              value={supplier}
              onChange={setSupplier}
              suggestions={supplierSuggestions}
              disabled={saving}
            />
        </div>
      ) : null}

      {paso === 2 ? (
        <div className="flex flex-col gap-6">
            {/* ── EL COSTO ABRE ESTA PANTALLA ──────────────────────────────
                Instrucción del dueño el 2026-10-20: *«cambiar el campo de
                "Costo unitario" a la pantalla de "Precio", ponlo de primero,
                ya que el margen depende de que ese campo está seteado,
                entonces para no hacer regresar al usuario a pantallas
                anteriores»*.

                Vivía en el 1/4, junto al nombre y el inventario, porque las
                dos preguntas de la compra —cuánto te costó y dónde lo
                compraste— iban juntas. Esa agrupación es defendible y pierde
                contra lo que el flujo hace de verdad: el margen NO SE PUEDE
                ELEGIR sin costo, y el desplegable del margen está aquí. Un
                tendero que llega al 2/4 y toca «Margen al detal» se topaba con
                «Primero pon el costo» y un campo que está dos pantallas atrás
                — un error que no se puede arreglar donde sale, que es lo mismo
                que ya costó mover la validación del nombre ese mismo día.

                DE PRIMERO Y NO AL FINAL, porque es de lo que dependen los dos
                bloques siguientes: se lee en el orden en que se usa. */}
                        <div className="flex flex-col gap-2">
              {/* «Costo unitario» y no «Costo», a petición del dueño el
                  2026-10-10: el campo de arriba pregunta cuántas unidades hay,
                  así que «Costo» a secas se lee como el costo de todas ellas.
                  Lo que Sevenz necesita para calcular un precio es el de UNA. */}
              {/* «(opcional)» desde el 2026-10-14, a petición del dueño, y
                  describe lo que el formulario ya hacía: sin costo se puede
                  guardar perfectamente, escribiendo el precio a mano. Lo único
                  que el costo desbloquea es calcularlo desde el margen.

                  «Costo unitario» y no «Costo» a secas se queda: lo pidió el
                  dueño el 2026-10-10 porque el campo de arriba pregunta cuántas
                  unidades hay, así que «Costo» se lee como el de todas ellas. El
                  frame 1192:4185 dice «Costo (opcional)» y de las dos mitades se
                  toma la que añade —lo opcional— sin perder la que ya se había
                  razonado. */}
              <Label htmlFor="producto_costo">Costo unitario (opcional)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="producto_costo"
                  inputMode="decimal"
                  value={cost}
                  ref={refCosto}
                  onChange={alTeclearCosto}
                  placeholder="00"
                  aria-invalid={costoFaltante}
                  className={costoFaltante ? "border-destructive" : undefined}
                />
                <CostCurrencySelect
                  value={costCurrency}
                  onChange={(v) => {
                    setCostCurrency(v);
                    setCostoFaltante(false);
                    // El error se apaga en cuanto se toca la moneda, sea cual
                    // sea la elegida: lo que se pedía era volver a mirar este
                    // control, y eso ya lo hizo. Si vuelve a elegir «Otro» y a
                    // intentar un margen, vuelve a salir.
                    setMonedaSinTasa(false);
                    // Cambiar a una moneda que SI convierte recalcula los
                    // precios: el costo es el mismo número pero ya no significa
                    // lo mismo, así que dejar los precios quietos los dejaría
                    // describiendo una conversión que nadie hizo.
                    recalcularDesdeCosto(cost, v);
                  }}
                  hasRates={Boolean(rates)}
                  businessCurrency={defaultCurrency}
                  disabled={saving}
                />
              </div>

              {costoFaltante ? (
                <p className="text-xs leading-relaxed text-destructive">
                  Primero pon el costo: sin él no podemos calcular el precio desde el margen.
                </p>
              ) : monedaSinTasa ? (
                /* EN ROJO Y SOLO DESPUÉS DE INTENTARLO. La misma frase vive dos
                   líneas más abajo en gris, como aviso; esto es lo que se enseña
                   cuando el tendero YA intentó elegir un margen. La diferencia no
                   es de tono: un aviso describe el estado y un error contesta a
                   algo que acabas de hacer, y el dueño pidió lo segundo el
                   2026-10-14 porque el desplegable aceptaba la elección y luego
                   no cambiaba nada. */
                <p className="text-xs leading-relaxed text-destructive">
                  Para calcular el margen, elige Dólares, Euros o USDT: de «Otro» no tenemos la
                  tasa. Puedes dejarla en «Otro» y escribir tú los precios abajo — el producto se
                  guarda igual.
                </p>
              ) : costCurrency === "OTHER" ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  De esa moneda no tenemos la tasa, así que no podemos calcular los precios desde
                  el margen. Escríbelos tú abajo.
                </p>
              ) : (
                /* FOUR WORDS, down from a sentence and a half. The owner cut
                   «Con esto calculamos los precios desde el margen y te
                   decimos tu ganancia» on 2026-10-20: the margin selector sits
                   right below and explains itself, so the line was describing
                   the next control rather than this field.

                   The other two branches keep their full text, and that is the
                   distinction: they fire only when the chosen currency has no
                   rate, where the line is not a description but the reason a
                   calculation the owner expected is not going to happen. */
                <p className="text-xs leading-relaxed text-muted-foreground">Lo que te costó a ti.</p>
              )}
            </div>


            {/* AL DETAL PRIMERO, que es el orden del frame y el del día a día. */}
            <TierSection
              {...tierProps}
              tier="retail"
              currencies={currencies.retail}
              onAddCurrency={(c) => agregarMoneda("retail", c)}
              onRemoveCurrency={(c) => quitarMoneda("retail", c)}
              label="Margen al detal"
              ventaLabel="Venta al detal"
              activa={ventaRetail}
              onActivaChange={(v) => pedirVenta("retail", v)}
              price={priceRetail}
              onPriceChange={setPriceRetail}
              margin={marginRetail}
              onMarginChange={setMarginRetail}
              fixed={fixed.retail}
              onFixedChange={(next) => setFixed((f) => ({ ...f, retail: next }))}
            />

            <TierSection
              {...tierProps}
              tier="wholesale"
              currencies={currencies.wholesale}
              onAddCurrency={(c) => agregarMoneda("wholesale", c)}
              onRemoveCurrency={(c) => quitarMoneda("wholesale", c)}
              label="Margen al mayor"
              ventaLabel="Venta al mayor"
              activa={ventaWholesale}
              onActivaChange={(v) => pedirVenta("wholesale", v)}
              price={priceWholesale}
              onPriceChange={setPriceWholesale}
              margin={marginWholesale}
              onMarginChange={setMarginWholesale}
              fixed={fixed.wholesale}
              onFixedChange={(next) => setFixed((f) => ({ ...f, wholesale: next }))}
              extra={
                <Stepper
                  id="producto_min_mayor"
                  label="Precio al mayor a partir de cantidad"
                  value={minQty}
                  onChange={setMinQty}
                  // El botón «−» no baja de 1. Pedido por el dueño el
                  // 2026-10-14, y coincide con el `check` de la 088, que ya
                  // rechaza cualquier valor que no sea mayor que cero.
                  min={1}
                  hint={
                    // Solo cuando de verdad hay un cero escrito. Un aviso
                    // permanente bajo un campo que siempre lleva un 6 es ruido,
                    // y el ruido se deja de leer antes del día que importa.
                    minQty.trim() !== "" && (parseAmount(minQty) ?? 1) < 1
                      ? "Tiene que ser 1 o más: por debajo de eso, el precio al mayor aplicaría siempre."
                      : null
                  }
                  disabled={saving}
                />
              }
            />
        </div>
      ) : null}

      {paso === 3 ? (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3 rounded-lg border p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <Label htmlFor="producto_publicar">Publicar producto en catálogo</Label>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Lo ve cualquiera que abra el enlace de tu catálogo, con su foto y su precio.
                  </p>
                </div>
                <Switch
                  id="producto_publicar"
                  checked={publishOn}
                  disabled={saving}
                  onCheckedChange={(next) => {
                    setPubRetail(next);
                    setPubWholesale(next);
                  }}
                />
              </div>

              {publishOn ? (
                <div className="flex flex-col gap-3 border-t pt-3">
                  <PublishCheck
                    id="pub_mayor"
                    label="Mostrar precio al mayor"
                    checked={pubWholesale}
                    disabled={saving}
                    onChange={setPubWholesale}
                  />
                  <PublishCheck
                    id="pub_detal"
                    label="Mostrar precio al detal"
                    checked={pubRetail}
                    disabled={saving}
                    onChange={setPubRetail}
                  />
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Foto</Label>
              <ProductPhotoInput
                ownerId={ownerId}
                value={photoPath}
                onChange={setPhotoPath}
                disabled={saving}
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="producto_descripcion">Descripción (opcional)</Label>
              <Textarea
                id="producto_descripcion"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Escribe descripción del producto"
                rows={3}
              />
            </div>
        </div>
      ) : null}

      {paso === 4 ? (
        <Verifica
          nombre={name}
          stock={stock}
          cost={cost}
          costCurrency={costCurrency}
          supplier={supplier}
          description={description}
          photoPath={photoPath}
          pubRetail={pubRetail}
          pubWholesale={pubWholesale}
          ventaRetail={ventaRetail}
          ventaWholesale={ventaWholesale}
          currencies={currencies}
          fixed={fixed}
          priceRetail={priceRetail}
          priceWholesale={priceWholesale}
          // THE MARGIN COMES DOWN COMPUTED, not as the select's own value.
          // They are not the same thing: the dropdown can say «Otro» while the
          // typed price still implies a real margin against the cost, and it
          // is that one the review has to show — it is what the owner will be
          // earning, not what he picked from a list.
          margenRetail={ventaRetail ? marginOf(priceRetail, "retail") : null}
          margenWholesale={ventaWholesale ? marginOf(priceWholesale, "wholesale") : null}
          minQty={minQty}
          rates={rates}
        />
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      {/* ── LOS BOTONES ──────────────────────────────────────────────────
          `StickyActions` y no un pie suelto: es la barra del flujo de
          registrar, y lo que trae de más sobre un `sticky` es esconderse con
          el teclado — que en un formulario de cuatro pantallas es lo único
          que importa.

          EN EL 4/4 SON DOS, del frame `1465:19879`: «Crear producto» relleno
          y «Editar» con borde. El segundo vuelve al paso 1, que es lo que una
          pantalla de revisión tiene que ofrecer: corregir lo que acabas de
          leer. Al editar un producto que ya existe, el relleno dice «Guardar»
          — es la misma acción y el verbo tiene que decir cuál de las dos es. */}
      <StickyActions>
        {paso < 4 ? (
          <Button type="button" className="h-10 w-full text-base font-semibold" onClick={continuar}>
            Continuar
          </Button>
        ) : (
          <>
            <Button
              type="button"
              className="h-10 w-full text-base font-semibold"
              disabled={saving}
              onClick={save}
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Guardando...
                </>
              ) : editing ? (
                "Guardar"
              ) : (
                "Crear producto"
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full text-base font-semibold"
              disabled={saving}
              onClick={() => setPaso(1)}
            >
              Editar
            </Button>
            {/* «Eliminar producto» SOLO AL EDITAR, y aquí abajo: el frame no
                lo dibuja porque el suyo es el flujo de alta, donde no hay nada
                que eliminar. Se conserva el control que el diálogo ya tenía
                en vez de dejar sin borrado a quien edita. */}
            {editing ? (
              <Button
                type="button"
                variant="destructiveText"
                disabled={saving}
                onClick={() => setConfirmarBorrado(true)}
              >
                Eliminar producto
              </Button>
            ) : null}
          </>
        )}
      </StickyActions>

      {/* BORRAR PREGUNTA ANTES, a petición del dueño el 2026-10-10. El botón
          vivía junto a «Guardar» y borraba al primer toque, que en un teléfono
          es un dedo mal puesto de distancia.

          El texto NO dice «esta acción no se puede deshacer», porque sí se
          puede: el producto va a la papelera y la notificación trae su botón
          de restaurar (migración 090). Decirlo aquí es lo que convierte la
          confirmación en información y no solo en un freno. */}
      <AlertDialog open={confirmarBorrado} onOpenChange={setConfirmarBorrado}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {product?.name ?? "el producto"}?</AlertDialogTitle>
            <AlertDialogDescription>
              Sale de tu catálogo y deja de verse en los enlaces que hayas compartido. Si te
              arrepientes, puedes restaurarlo desde tus notificaciones.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                startTransition(async () => {
                  const r = await trashProduct(product!.id);
                  if (avisarCuentaPausada(r.error)) return;
                  if (r.error) return setError(r.error);
                  // SALE DE LA PANTALLA, que antes era cerrar el diálogo.
                  salir();
                  toast.success("Producto eliminado.");
                })
              }
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// EL DESPLEGABLE DE LA MONEDA DEL COSTO, con su bandera.
//
// Solo las monedas de las que SABEMOS la tasa, más «Otro». Un elemento de una
// moneda que no podemos convertir sería una promesa que la pantalla no puede
// cumplir — y «Otro» ya cubre ese caso diciendo lo que pasa.
//
// Sin bolívar, que es lo que dibuja el menú del frame: un costo en bolívares
// envejece con la tasa igual que un precio, y el margen que saliera de él
// cambiaría solo de un día para otro.
function CostCurrencySelect({
  value,
  onChange,
  hasRates,
  businessCurrency,
  disabled,
}: {
  value: CostCurrency;
  onChange: (v: CostCurrency) => void;
  hasRates: boolean;
  businessCurrency: PriceCurrency;
  disabled: boolean;
}) {
  // ═══════════════════════════════════════════════════════════════════════
  // «OTRO» SALIÓ DE LA LISTA EL 2026-10-14. DECISIÓN DEL DUEÑO.
  //
  // Existió entre el 2026-10-10 (migración 087) y hoy. Se retira porque tenía
  // un fallo real, y se deja escrito entero porque la idea volverá — un
  // tendero que compra en pesos colombianos para vender en Venezuela es un
  // caso corriente, y el día que se retome conviene saber con qué se chocó.
  //
  // EL FALLO, medido el 2026-10-14 reproduciéndolo: elegir «Otro» y guardar
  // SIN COSTO perdía la moneda en silencio. Al reabrir el producto decía
  // «Dólares».
  //
  // La causa no está en el selector sino en cómo se guarda el par, en
  // `rowFrom()` del server action:
  //
  //     cost_currency: cost == null ? null : (input.costCurrency ?? null)
  //
  // Es decir: SIN COSTO NO HAY MONEDA. Y eso es correcto para las otras tres
  // —una moneda sin importe no significa nada y la 087 exige el par con un
  // `check`— pero con «Otro» el tendero cree estar diciendo algo más: «mi
  // costo está en una moneda rara». Si además deja el importe vacío, lo único
  // que había dicho se tira.
  //
  // LO QUE HACE EL CASO ESPECIALMENTE MALO es que el costo es OPCIONAL. Así
  // que la combinación que lo rompe —moneda «Otro» + costo vacío— no es un
  // error del tendero: es exactamente lo que la pantalla le invita a hacer.
  //
  // QUÉ HARÍA FALTA PARA DEVOLVERLA, y por qué no se hizo hoy:
  //
  //   1. Decidir qué significa «Otro» sin importe. Hoy la 087 y la 089 dicen
  //      que la moneda acompaña al costo; si «Otro» puede existir sola, eso
  //      es otro dato —«en qué moneda compro»— y probablemente va en `owners`
  //      y no en cada producto.
  //   2. Resolver qué enseña el selector al reabrir cuando el par está a
  //      medias, en vez de caer al valor por defecto sin avisar.
  //   3. Lo de siempre: de «Otro» no tenemos tasa, así que el margen no puede
  //      calcular nada y el precio hay que escribirlo a mano. Eso no es un
  //      fallo, es el precio de la función, y ya estaba dicho en pantalla.
  //
  // Mientras tanto, un tendero que compra en otra moneda apunta el costo en
  // dólares, que es lo que hacía antes del 2026-10-10.
  // ═══════════════════════════════════════════════════════════════════════
  const base: CostCurrency[] = hasRates ? ["USD", "EUR", "USDT"] : [businessCurrency];
  // UNA FICHA QUE YA TENÍA «Otro» SIGUE ENSEÑÁNDOLO, aunque ya no se pueda
  // elegir. Sin esto, abrir uno de esos productos dejaría el selector en
  // blanco: Radix no pinta un valor que no está entre sus opciones, y el
  // tendero vería un hueco donde antes había una palabra.
  //
  // Se puede salir de ahí —eligiendo cualquiera de las otras— pero no volver,
  // que es justo lo que se busca mientras la opción esté retirada.
  const opciones: CostCurrency[] = base.includes(value) ? base : [...base, value];

  return (
    <Select value={value} disabled={disabled} onValueChange={(v) => onChange(v as CostCurrency)}>
      <SelectTrigger className="h-10 w-36 shrink-0" aria-label="Moneda del costo">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {opciones.map((c) => (
          <SelectItem key={c} value={c}>
            <span className="flex items-center gap-1.5">
              {c === "OTHER" || c === "COP" ? null : (
                <CurrencyFlagIcon currency={c} />
              )}
              {COST_LABEL[c] ?? c}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function PublishCheck({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(v === true)}
      />
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
    </div>
  );
}

// UN CONTADOR CON SUS DOS BOTONES. Lo usan «Disponible en inventario» y
// «Precio al mayor a partir de cantidad», que son el mismo control.
// SI EL TENDERO ROMPIO LA CADENA DE ESTA MONEDA.
//
// Lo dice que la CLAVE exista en `fixed`, no que tenga texto dentro. Son dos
// cosas distintas y atarlas fue el fallo que el dueno reporto el 2026-10-14:
// con la regla vieja, borrar el campo para escribir otro numero contaba como
// volver a vincularlo, asi que el valor saltaba a la equivalencia calculada y
// el campo se quedaba en solo lectura. Vaciar es el primer gesto de escribir.
//
// Una funcion y no tres copias de la condicion: estaba escrita tres veces
// --la fila, el recalculo desde el costo y el desplegable del margen-- y tres
// copias de un predicado acaban discrepando. Aqui la discrepancia seria que la
// fila se cree desvinculada mientras el margen le pisa el precio.
function estaDesvinculada(
  fijos: Partial<Record<PriceCurrency, string>>,
  currency: PriceCurrency,
): boolean {
  return fijos[currency] !== undefined;
}

// SI UN NUMERO SE PASA DEL TECHO DE SU COLUMNA.
//
// Vive junto al formulario y no en `lib/`: aqui solo decide si enseñar un
// aviso. Quien de verdad rechaza es `validate()` en el server action, con los
// mismos números y por la razón de siempre -- la restricción de la base es la
// garantía, y esto y aquello son la cortesía.
function excedeTecho(valor: string, techo: number): boolean {
  const n = parseAmount(valor);
  return n != null && n >= techo;
}

function Stepper({
  id,
  label,
  value,
  onChange,
  hint,
  hintError = false,
  maxDigitos,
  onTope,
  min = 0,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  // El `Dispatch` del `useState` del padre, no una función cualquiera: hace
  // falta para el `step` de abajo.
  onChange: Dispatch<SetStateAction<string>>;
  hint: string | null;
  // EL SUELO DEL BOTÓN «−», configurable desde el 2026-10-14.
  //
  // Estaba fijo en 0, que es correcto para el inventario —un producto puede
  // tener cero unidades— y no lo es para la cantidad mínima del precio al
  // mayor: un umbral de 0 significa «el precio de mayor aplica siempre», que
  // es justo lo que ese campo existe para no decir. El dueño lo pidió con el
  // mínimo en 1.
  //
  // Solo frena al BOTÓN. Teclear sigue permitido, y si se escribe un 0 lo
  // dice el `hint` — bloquear el teclado impediría borrar el contenido para
  // escribir otro número, que es como se corrige un campo en un teléfono.
  min?: number;
  // EL AVISO EN ROJO. Un `hint` normal es gris y se lee como una nota al pie;
  // esto es el campo diciendo que no acepta lo que se le esta dando, y tiene
  // que distinguirse de un consejo.
  hintError?: boolean;
  // CUANTOS DIGITOS ENTEROS CABEN. Cuando se pasa, la pulsacion NO ENTRA --
  // pedido por el dueno el 2026-10-15, despues de ver que teclear un numero
  // imposible te dejaba seguir escribiendo y solo te avisaba debajo.
  //
  // Se cuentan los digitos del lado entero y no los caracteres del campo: con
  // `1234567890,5` son once digitos y doce caracteres, y el limite de verdad
  // --`numeric(14,3)` en la base-- es de once ENTEROS. Contar caracteres
  // rechazaria un numero valido por llevar coma.
  maxDigitos?: number;
  // Se llama cuando una pulsacion se rechaza, para que el padre pueda
  // explicar por que no pasa nada. Sin esto, el campo simplemente ignoraria
  // al dedo, que es la peor forma de decir que no.
  onTope?: () => void;
  disabled: boolean;
}) {
  // ACTUALIZACION FUNCIONAL, Y NO ES PREFERENCIA DE ESTILO. Antes esto leía
  // `value` de la prop, y tres toques seguidos al «+» dejaban la cantidad en
  // 1: React agrupa el lote y los tres manejadores leían el mismo render
  // viejo. Encontrado probando la ficha el 2026-10-10.
  const step = (delta: number) =>
    onChange((prev) => {
      const n = Number(String(prev).replace(",", ".")) || 0;
      return String(Math.max(min, n + delta));
    });

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {/* 32px AND NOT 40, so the row is exactly as tall as its own field.
          The owner reported on 2026-10-20 that the fields of step 1/4 looked
          «muy cercanos unos de otros». Measured: the column's gap is already
          the 16px he asked for, and the two rows that read as tighter were
          this one — its buttons were `size-10`, 8px taller than the 32px
          `Input` between them, so the row grew 4px above and 4px below and
          ate the air on both sides. Label-to-field came out 12 instead of 8,
          and field-to-next-label 20 instead of 16.

          This is the rule `DESIGN-SYSTEM.md` already settled after the same
          mismatch on `CountryCodeSelect`: the 40px rule is about LABELLED
          buttons, which line up with each other; a control that is half of a
          field lines up with its field. A `−`/`+` beside a number is half of
          a field. And the fix goes on the control, never on the `Input` —
          raising the base input would move signup, client creation and
          movements all at once, which is its own pass with its own tests. */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          aria-label={`Restar uno en ${label}`}
          disabled={disabled}
          onClick={() => step(-1)}
        >
          <Minus className="size-4" />
        </Button>
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(e) => {
            const nuevo = e.target.value;
            // SE DEJA BORRAR SIEMPRE. Un tope que tambien bloquea la tecla de
            // retroceso deja el campo atascado en un numero que no se puede
            // corregir -- y en un telefono, corregir es borrar y reescribir.
            if (maxDigitos != null && nuevo.length > value.length) {
              const parteEntera = nuevo.split(/[.,]/)[0].replace(/[^0-9]/g, "");
              if (parteEntera.length > maxDigitos) {
                onTope?.();
                return;
              }
            }
            onChange(nuevo);
          }}
          placeholder="0"
          aria-invalid={hintError}
          disabled={disabled}
          className={`text-center tabular-nums ${hintError ? "border-destructive" : ""}`}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-8 shrink-0"
          aria-label={`Sumar uno en ${label}`}
          disabled={disabled}
          onClick={() => step(1)}
        >
          <Plus className="size-4" />
        </Button>
      </div>
      {hint ? (
        <p
          className={`text-xs leading-relaxed ${hintError ? "text-destructive" : "text-muted-foreground"}`}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function TierSection({
  tier,
  label,
  ventaLabel,
  activa,
  onActivaChange,
  price,
  onPriceChange,
  margin,
  onMarginChange,
  cost,
  costCurrency,
  costUsable,
  onNeedCost,
  onNeedRateCurrency,
  currencies,
  onAddCurrency,
  onRemoveCurrency,
  rates,
  fixed,
  onFixedChange,
  disabled,
  extra,
}: {
  tier: PriceTier;
  label: string;
  ventaLabel: string;
  activa: boolean;
  onActivaChange: (v: boolean) => void;
  price: string;
  onPriceChange: (next: string) => void;
  margin: string;
  onMarginChange: (next: string) => void;
  cost: number | null;
  costCurrency: CostCurrency;
  costUsable: boolean;
  onNeedCost: () => void;
  onNeedRateCurrency: () => void;
  currencies: PriceCurrency[];
  onAddCurrency: (c: PriceCurrency) => void;
  onRemoveCurrency: (c: PriceCurrency) => void;
  rates: BolivarRates | null;
  fixed: Partial<Record<PriceCurrency, string>>;
  onFixedChange: (next: Partial<Record<PriceCurrency, string>>) => void;
  disabled: boolean;
  extra?: React.ReactNode;
}) {
  const base = currencies[0];
  const priceNumber = (() => {
    const n = parseTypedAmount(price);
    return n != null && n > 0 ? n : null;
  })();

  // EL COSTO SE CONVIERTE A LA BASE DE ESTE ESCALÓN ANTES DE DIVIDIR.
  //
  // Es el fallo que reportó el dueño el 2026-10-22: con el costo en dólares y
  // la base del escalón en euros, esto restaba euros menos dólares. El
  // porcentaje que salía no coincidía con ningún preajuste, así que el
  // desplegable se quedaba donde estaba mientras el precio SÍ cambiaba --que
  // es justo lo que él vio--. La conversión vive dentro de `marginFromPrice`,
  // que desde entonces exige las monedas en su firma.
  const derived =
    priceNumber != null ? marginFromPrice(cost, costCurrency, priceNumber, base, rates) : null;

  // O HAY MARGEN, O HAY PRECIOS FIJOS POR MONEDA. Basta con que UNA moneda que
  // no sea la base lleve importe a mano para que el margen deje de mandar. La
  // salida es volver a enlazarla, que es un gesto visible y no un callejón.
  const hayFijos = currencies.some((c) => c !== base && estaDesvinculada(fixed, c));

  // EL DESPLEGABLE NO ENSEÑA UN PORCENTAJE SI DE AHI NO SALE NINGUN NUMERO.
  //
  // Reportado por el dueño el 2026-10-10: con la moneda del costo en «Otro»
  // —de la que no tenemos tasa— la ficha seguía diciendo «30 %». Ese 30 % no
  // calculaba nada, pero se leía como si el precio de abajo saliera de él.
  //
  // Sin costo pasa lo mismo, así que las dos situaciones comparten respuesta:
  // «Otro (escribe el precio)», que es exactamente lo que está ocurriendo.
  //
  // El desplegable sigue sin apagarse por falta de costo: el dueño pidió que
  // al intentar elegir se señale el costo en rojo, y un control apagado no
  // dice qué falta.
  // ── QUÉ PREAJUSTE SE ENSEÑA: EL QUE REPRODUCE ESTE PRECIO ───────────
  //
  // Se preguntaba al revés --calcular el margen del precio y buscarlo en la
  // lista-- y eso no sobrevive al redondeo. El precio se guarda a dos
  // decimales, así que un 30 % sobre un costo convertido vuelve como 30,03 y
  // `includes(30.03)` es falso: el desplegable decía «Otro» sobre un precio
  // que ÉL mismo acababa de calcular.
  //
  // SE VIO AL ESCRIBIR LA PRUEBA del fallo de monedas cruzadas el 2026-10-22,
  // no en la pantalla: con un costo de $10 al 30 % en euros, la ida da 11,56
  // y la vuelta 30,03. Arreglar solo la conversión habría dejado el
  // desplegable igual de quieto por otro motivo.
  //
  // PREGUNTANDO AL REVÉS NO HAY TOLERANCIA QUE INVENTAR: se compara el precio
  // con el que cada preajuste ESCRIBIRÍA, con la misma función y el mismo
  // redondeo, así que o cuadra al céntimo o no es ese.
  const presetQueCuadra =
    priceNumber != null && costUsable && cost != null && rates != null
      ? (MARGIN_PRESETS as readonly number[]).find((m) => {
          const p = priceFromCost(cost, costCurrency, m, base, rates);
          return p != null && Math.abs(p - priceNumber) < 0.005;
        })
      : undefined;

  const selectValue = !costUsable
    ? "otro"
    : presetQueCuadra != null
      ? String(presetQueCuadra)
      : derived != null
        ? "otro"
        : margin;

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      {/* EL INTERRUPTOR VA ARRIBA Y MANDA SOBRE TODA LA TARJETA. Apagado, la
          sección se pliega hasta esta fila — es la tarjeta cerrada del
          mockup— y lo que hay debajo deja de existir para el guardado. */}
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor={`venta_${tier}`} className="text-base">
          {ventaLabel}
        </Label>
        <Switch
          id={`venta_${tier}`}
          checked={activa}
          disabled={disabled}
          onCheckedChange={onActivaChange}
        />
      </div>

      {!activa ? null : (
      <>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`margen_${tier}`}>{label}</Label>
        <Select
          value={selectValue}
          disabled={disabled || hayFijos}
          onValueChange={(v) => {
            if (v === "otro") {
              document.getElementById(`precio_${tier}`)?.focus();
              return;
            }
            onMarginChange(v);
            if (cost == null) {
              // FALTA EL COSTO. El campo se pinta en rojo y lo dice.
              onNeedCost();
              return;
            }
            // HAY COSTO PERO SU MONEDA NO CONVIERTE («Otro»). Aquí NO se pinta
            // el costo en rojo, y esa distinción es el fallo que reportó el
            // dueño el 2026-10-10: la pantalla decía «Primero pon el costo»
            // con un 5 escrito justo encima. El costo está; lo que falta es
            // una moneda de la que sepamos la tasa.
            //
            // Hasta el 2026-10-14 esto se limitaba a NO HACER NADA y confiar en
            // el texto informativo de debajo del costo. El dueño pidió que se
            // diga: un desplegable que acepta tu elección y luego no cambia
            // nada se lee como que la pantalla está rota.
            if (!costUsable) {
              onNeedRateCurrency();
              return;
            }
            if (!rates) return;
            const siguiente = priceFromCost(cost, costCurrency, Number(v), base, rates);
            if (siguiente != null) onPriceChange(formatAmountForInput(siguiente, { miles: true }));
          }}
        >
          <SelectTrigger id={`margen_${tier}`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MARGIN_PRESETS.map((m) => (
              <SelectItem key={m} value={String(m)}>
                {formatPercent(m)}
              </SelectItem>
            ))}
            <SelectItem value="otro">Otro (escribe el precio)</SelectItem>
          </SelectContent>
        </Select>
        {hayFijos ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Tienes precios puestos a mano, así que el margen no manda. Vuelve a enlazarlos con su
            cadena para que lo calculemos nosotros.
          </p>
        ) : null}
      </div>

      <PriceRows
        tier={tier}
        price={price}
        onPriceChange={onPriceChange}
        basePrice={priceNumber}
        currencies={currencies}
        onAddCurrency={onAddCurrency}
        onRemoveCurrency={onRemoveCurrency}
        rates={rates}
        fixed={fixed}
        onFixedChange={onFixedChange}
        disabled={disabled}
      />

      {extra}

      {!costUsable ? null : derived != null && derived < 0 ? (
        /* UNA PERDIDA SE LLAMA PERDIDA. «Tu ganancia es del -10 %» es una
           contradicción, y en una pantalla de dinero se lee como un fallo de
           cuentas en vez de como un aviso. No se bloquea: liquidar o mover
           mercancía por vencer son casos reales. */
        <p className="text-xs leading-relaxed text-destructive">
          A ese precio vendes <strong>por debajo de lo que te costó</strong>: pierdes{" "}
          {formatPercent(Math.abs(derived))}.
        </p>
      ) : derived != null ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          A ese precio tu ganancia es del{" "}
          <strong className="text-foreground">{formatPercent(derived)}</strong>.
        </p>
      ) : null}
      </>
      )}
    </div>
  );
}

// ── WHAT A CURRENCY IS WORTH, IN ONE PLACE ─────────────────────────────────
//
// Two screens need this answer and they must not disagree: the price rows of
// step 2/4, where it is typed, and the review of 4/4, where it is read back. A
// review that computes the figure its own way is worse than no review — it
// confirms a number the save will not write.
//
// `calculadoDe` is the LINKED value: the base is itself, everything else
// follows the rate. `mostradoDe` adds the override on top, because a currency
// whose chain is broken is worth what the owner typed and nothing else.
function calculadoDe(
  currency: PriceCurrency,
  base: PriceCurrency,
  precioBase: number | null,
  rates: BolivarRates | null,
): number | null {
  if (currency === base) return precioBase;
  if (precioBase == null || !rates) return null;
  return priceIn(currency, { amount: precioBase, currency: base }, rates).amount;
}

function mostradoDe(
  currency: PriceCurrency,
  base: PriceCurrency,
  precioBase: number | null,
  fijos: Partial<Record<PriceCurrency, string>>,
  rates: BolivarRates | null,
): number | null {
  return estaDesvinculada(fijos, currency)
    ? parseTypedAmount(fijos[currency] ?? "")
    : calculadoDe(currency, base, precioBase, rates);
}

function PriceRows({
  tier,
  price,
  onPriceChange,
  basePrice,
  currencies,
  onAddCurrency,
  onRemoveCurrency,
  rates,
  fixed,
  onFixedChange,
  disabled,
}: {
  tier: PriceTier;
  price: string;
  onPriceChange: (next: string) => void;
  basePrice: number | null;
  currencies: PriceCurrency[];
  onAddCurrency: (c: PriceCurrency) => void;
  onRemoveCurrency: (c: PriceCurrency) => void;
  rates: BolivarRates | null;
  fixed: Partial<Record<PriceCurrency, string>>;
  onFixedChange: (next: Partial<Record<PriceCurrency, string>>) => void;
  disabled: boolean;
}) {
  const base = currencies[0];

  // COLOMBIA: UNA SOLA FILA, y eso no es un hueco. Un negocio colombiano cobra
  // en pesos y no tiene tasa de ninguna clase.
  if (!rates) {
    return (
      <PriceRow
        currency={base}
        label={`Precio en ${CURRENCY_LABEL[base]?.toLowerCase() ?? base}`}
        value={price}
        onChange={onPriceChange}
        disabled={disabled}
        inputId={`precio_${tier}`}
      />
    );
  }

  // Lo que todavia se puede anadir. Las bloqueadas no estan (CT-79).
  const inactivas = SELLABLE.filter((c) => !currencies.includes(c) && !isSaleCurrencyLocked(c));
  const enBolivares = (amount: number | null, currency: PriceCurrency) =>
    amount == null ? null : priceIn("VES", { amount, currency }, rates).amount;

  return (
    <div className="flex flex-col gap-3">
      {currencies.map((currency) => {
        const esBase = currency === base;
        // DESVINCULADO LO DICE LA CLAVE, NO EL TEXTO. Reportado por el dueño
        // el 2026-10-14: al romper la cadena y borrar el campo para escribir
        // otro número, el valor volvía solo a la equivalencia calculada y el
        // campo se quedaba en solo lectura.
        //
        // La causa era esta línea, que decía `(fixed[currency] ?? "").trim()
        // !== ""`: el estado «este precio lo pongo yo» y el contenido del
        // campo eran el MISMO dato, así que vaciar el campo equivalía a volver
        // a vincularlo. Y vaciarlo es el primer gesto de escribir otro número.
        //
        // Ahora el estado vive en si la clave EXISTE en `fixed`. Romper la
        // cadena la crea, volver a vincular la borra, y lo que haya escrito
        // dentro —incluido nada— es asunto del tendero mientras escribe.
        //
        // El servidor ya lo soportaba: al construir los `product_price_overrides`
        // descarta los importes nulos o no positivos, así que una clave con el
        // texto vacío no guarda ninguna fila. No hacía falta tocarlo.
        const manual = estaDesvinculada(fixed, currency);
        const calculado = calculadoDe(currency, base, basePrice, rates);
        const mostrado = manual ? parseTypedAmount(fixed[currency] ?? "") : calculado;
        const bs = enBolivares(mostrado, currency);

        return (
          <PriceRow
            key={currency}
            currency={currency}
            label={
              esBase
                ? `Precio ${CURRENCY_LABEL[currency] ?? currency}`
                : manual
                  ? `Precio fijado en ${CURRENCY_LABEL[currency] ?? currency}`
                  : `Precio ${CURRENCY_LABEL[currency] ?? currency}`
            }
            // LA FILA CALCULADA SE ESCRIBE COMO LA QUE SE TECLEA.
            //
            // Reportado por el dueño el 2026-10-24: la fila del euro decía
            // «€2,230,987.52» mientras la de al lado, editable, decía
            // «2.500.000». Dos formas de escribir dinero en dos campos
            // pegados, dentro del mismo control.
            //
            // Y lo que lo delataba estaba aquí mismo: romper el vínculo de esa
            // fila la pasa a `formatAmountForInput(calculado, { miles: true })`
            // —ver el `onToggle` de más abajo—, o sea que pulsar el candado
            // cambiaba el formato del MISMO número. Usar el mismo escritor en
            // los dos estados quita la diferencia de raíz.
            //
            // La moneda no se pierde al quitar el símbolo: la fila la nombra
            // en su rótulo («Precio Euro») y la repite su bandera.
            value={
              esBase
                ? price
                : manual
                  ? (fixed[currency] ?? "")
                  : calculado == null
                    ? "—"
                    : formatAmountForInput(calculado, { miles: true })
            }
            readOnly={!esBase && !manual}
            disabled={disabled}
            inputId={esBase ? `precio_${tier}` : `precio_${tier}_${currency}`}
            onChange={(next) =>
              esBase ? onPriceChange(next) : onFixedChange({ ...fixed, [currency]: next })
            }
            // LA EQUIVALENCIA VA DEBAJO DE CADA MONEDA, del frame 1192:4185.
            // Antes era una fila suelta al final, que decía lo que vale el
            // precio base y nada de las demás. Así cada línea dice lo que de
            // verdad le van a pagar por ESA.
            bolivares={bs == null ? null : `Hoy: ${formatPriceAmount(bs, "VES")}`}
            // LA FILA DE LA MONEDA BASE NO LLEVA VINCULO: es el precio, no una
            // equivalencia de nada, y su vínculo con el costo es el margen.
            // THE CHAIN OPENS EVEN WITH NOTHING TO COPY. Reported by the owner
            // on 2026-10-20: *«cuando hay dos precios y ninguno tiene valor, no
            // puedo desvincular el segundo para customizarlo, debería»*.
            //
            // It read `disabled: disabled || (!manual && calculado == null)`,
            // and with no base price `calculado` is null for every non-base
            // currency — so the one state where breaking the link is the
            // ONLY way forward was the state that forbade it. Someone who
            // wants to price the euro by hand and leave the dollar alone had
            // to first type a dollar price they did not want, break the chain,
            // and then go back and erase it.
            //
            // The unlinked state lives in whether the KEY exists in `fixed`,
            // not in what it holds — that is the 2026-10-14 fix explained
            // above. So an empty string is a perfectly good unlinked price:
            // the field opens blank and waits. The server already drops
            // non-positive amounts when it builds `product_price_overrides`,
            // so nothing is written until a number is typed.
            link={
              esBase
                ? null
                : {
                    linked: !manual,
                    disabled,
                    onToggle: () => {
                      if (manual) {
                        const next = { ...fixed };
                        delete next[currency];
                        onFixedChange(next);
                      } else {
                        onFixedChange({
                          ...fixed,
                          [currency]:
                            calculado == null ? "" : formatAmountForInput(calculado, { miles: true }),
                        });
                      }
                    },
                  }
            }
            onRemove={currencies.length <= 1 ? null : () => onRemoveCurrency(currency)}
          />
        );
      })}

      {inactivas.map((currency) => (
        <div key={currency} className="flex items-center justify-between gap-2">
          <Label className="flex min-w-0 shrink items-center gap-1.5 text-xs font-normal text-muted-foreground">
            <CurrencyFlagIcon currency={currency} />
            <span className="truncate">Precio {CURRENCY_LABEL[currency] ?? currency}</span>
          </Label>
          {/* EL MISMO ENVOLTORIO QUE UNA FILA ACTIVA, y esto no es cosmética:
              la fila activa agrupa su campo y el hueco de la papelera con
              `gap-1`, y esta los tenía sueltos dentro del `gap-2` de la fila.
              Cuatro píxeles de diferencia, suficientes para que el botón
              «Agregar» no cuadrara con el campo de arriba. Reportado por el
              dueño el 2026-10-10 como «alineados a la derecha». */}
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10 w-32 shrink-0"
              disabled={disabled}
              onClick={() => onAddCurrency(currency)}
            >
              <Plus className="size-4" /> Agregar
            </Button>
            <span className="inline-block size-6" aria-hidden="true" />
          </div>
        </div>
      ))}

      {/* WHERE THE RATE COMES FROM, AND HOW TO OPT OUT OF IT.
          Text written by the owner on 2026-10-20, replacing «"Hoy" es lo que
          vale ese precio en bolívares con la tasa de hoy, y se mueve con ella.
          Puedes romper la cadena de una moneda para escribir tú su precio».

          The old line explained the mechanism — what «Hoy» means and that it
          moves. The new one answers the question a shopkeeper actually brings
          to a rate he did not type: where does this number come from. The
          mechanism was never the doubt; the provenance was.

          THE ICON IS DRAWN, NOT NAMED, because the owner wrote it as an icon
          in the sentence. `Link2` and not `Unlink`: it is what the button
          shows while the price IS linked, which is the only state in which
          someone would go looking for this instruction. Showing the other one
          would send them hunting for a control that is not on screen yet. */}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Las tasas de Sevenz provienen de fuentes públicas. Selecciona{" "}
        <Link2 className="inline-block size-3.5 align-text-bottom" aria-hidden="true" /> para
        desvincular el precio de la tasa oficial.
      </p>
    </div>
  );
}

function PriceRow({
  currency,
  label,
  value,
  onChange,
  readOnly,
  disabled,
  inputId,
  link,
  onRemove,
  bolivares,
}: {
  currency: PriceCurrency;
  label: string;
  value: string;
  onChange?: (next: string) => void;
  readOnly?: boolean;
  disabled: boolean;
  inputId: string;
  link?: {
    linked: boolean;
    disabled: boolean;
    onToggle: () => void;
  } | null;
  onRemove?: (() => void) | null;
  bolivares?: string | null;
}) {
  // LOS MILES, MIENTRAS SE TECLEA. Una fila, un componente, un hook: este
  // componente se pinta dentro de un `.map` sobre las monedas del escalón, y
  // un hook no puede vivir dentro de ese `.map` —React exige el mismo orden de
  // hooks en cada pintado y quitar una moneda lo rompería—. Por eso la fila ya
  // era un componente y aquí solo se le añade el hook.
  //
  // En una fila CALCULADA (`readOnly`) el `onChange` no se dispara nunca, así
  // que el hook no hace nada: lo que la deja agrupada es que quien calcula su
  // valor ya lo escribe con `formatAmountForInput(..., { miles: true })`.
  const { ref: refPrecio, onChange: alTeclearPrecio } = useGroupedAmount(value, (t) => onChange?.(t));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <Label
          htmlFor={inputId}
          className="flex min-w-0 shrink items-center gap-1.5 text-xs font-normal text-muted-foreground"
        >
          {currency === "COP" ? null : (
            <CurrencyFlagIcon currency={currency} />
          )}
          <span className="truncate">{label}</span>
        </Label>

        <div className="flex shrink-0 items-center gap-1">
          <div className="relative">
            <Input
              id={inputId}
              inputMode="decimal"
              value={value}
              readOnly={readOnly}
              disabled={disabled}
              ref={refPrecio}
              onChange={alTeclearPrecio}
              placeholder="00.00"
              className={`h-10 w-32 text-right tabular-nums ${link ? "pr-9" : ""} ${
                readOnly ? "bg-muted/50" : ""
              }`}
            />
            {link ? (
              <button
                type="button"
                disabled={link.disabled}
                onClick={link.onToggle}
                aria-label={
                  link.linked
                    ? `Desvincular el precio en ${currency} y escribirlo a mano`
                    : `Volver a calcular el precio en ${currency}`
                }
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
              >
                {/* CADENA ROTA, NO CADENA TACHADA. Pedido por el dueño el
                    2026-10-14 con el icono delante: `Unlink` dibuja los dos
                    eslabones separándose con sus destellos, y `Link2Off` —lo
                    que había— es la misma cadena entera con una barra encima.

                    La diferencia importa porque la barra es el signo de
                    «prohibido» o «desactivado» en el resto de la interfaz, y
                    aquí no hay nada prohibido: el precio está desvinculado y
                    se puede escribir, que es justo lo contrario. */}
                {link.linked ? <Link2 className="size-4" /> : <Unlink className="size-4" />}
              </button>
            ) : null}
          </div>

          {onRemove ? (
            <button
              type="button"
              disabled={disabled}
              onClick={onRemove}
              aria-label={`Quitar ${currency} de este producto`}
              className="rounded p-1 text-destructive outline-none transition-colors hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            >
              <Trash2 className="size-4" />
            </button>
          ) : (
            // Hueco del mismo ancho: sin él la columna de importes queda
            // torcida entre una fila con papelera y otra sin ella.
            <span className="inline-block size-6" aria-hidden="true" />
          )}
        </div>
      </div>

      {bolivares ? (
        <span className="pl-[21px] text-xs text-muted-foreground tabular-nums">{bolivares}</span>
      ) : null}
    </div>
  );
}

// ============================================================================
// THE PIECES OF THE REVIEW SCREEN — frame `1465:19856`
//
// The frame draws two shapes and only two, so there are two row components
// here and no third one invented to tidy something up.

// ── ONE FIELD, READ BACK ───────────────────────────────────────────────────
//
// Label on the left in 12px muted, value on the right in 14px primary, 8px of
// air above and below. The optional flag sits OUTSIDE the value, which is how
// the frame nests it (`1465:19912`): the currency belongs to the row, not to
// the number, so it stays put while the figure grows.
//
// NO SEPARATOR LINE. The earlier version drew a `border-b` under every row;
// the frame has none, and with rows this short the rules were doing the work
// the 8px of padding already does, turning a list of six facts into six boxes.
function FilaDeRepaso({
  nombre,
  valor,
  moneda,
}: {
  nombre: string;
  valor: React.ReactNode;
  moneda?: PriceCurrency | string | null;
}) {
  return (
    <div className="flex items-center gap-1 py-2">
      <span className="min-w-0 flex-1 text-xs leading-4 text-muted-foreground">{nombre}</span>
      <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5 text-right text-sm leading-5 tabular-nums">
        {valor}
      </span>
      {moneda ? (
        <CurrencyFlagIcon currency={moneda as PriceCurrency} className="size-4 shrink-0" />
      ) : null}
    </div>
  );
}

// ── A FIELD WHOSE VALUE NEEDS THE WHOLE WIDTH ──────────────────────────────
//
// The frame gives Description its own shape (`1465:19916`): label on its own
// line, text underneath at full width, still inside the same 8px rhythm. A
// paragraph squeezed into the right-hand half of a two-column row wraps after
// four words, which is why this is drawn differently rather than reusing the
// row above.
function FilaAncha({ nombre, children }: { nombre: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-center gap-1 py-2">
      <span className="text-xs leading-4 text-muted-foreground">{nombre}</span>
      <div className="flex items-center text-sm leading-5">{children}</div>
    </div>
  );
}

// WHAT A FIELD LEFT EMPTY SAYS. The frame spells this out once, on Proveedor:
// «No registrado». It is the only empty state the design draws, so it is the
// one every optional field uses here instead of a dash invented on the spot.
//
// AND EVERY ROW IS DRAWN, filled or not — which reverses what this screen did
// until 2026-10-20. Hiding the empty ones seemed kinder («what matters is what
// you DID fill in») and it is wrong for the job this screen has: the owner is
// checking a product before creating it, and the most expensive mistake is the
// field he believes he filled and did not. A row that is simply absent cannot
// be noticed; one that says «No registrado» can.
const SIN_DATO = "No registrado";

// UN BLOQUE POR FORMA DE VENTA, as the frame draws them: «Venta al detal» and
// «Venta al mayor», each with its margin and its prices. Only the tier that is
// switched on appears — a block titled «Venta al mayor» with nothing under it
// would claim the product sells wholesale without a price, the opposite of
// what is true.
function BloqueDeVenta({
  titulo,
  etiquetaDelMargen,
  margen,
  monedas,
  base,
  precioBase,
  fijos,
  rates,
  minimo,
}: {
  titulo: string;
  etiquetaDelMargen: string;
  margen: number | null;
  monedas: PriceCurrency[];
  base: PriceCurrency;
  precioBase: number | null;
  fijos: Partial<Record<PriceCurrency, string>>;
  rates: BolivarRates | null;
  minimo?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm leading-5">{titulo}</p>
      <div className="flex flex-col">
        {/* THE MARGIN IS THE ONE ROW THAT DISAPPEARS WHEN EMPTY, and it is not
            an exception to the rule above — it is outside it. Every other row
            here holds something the owner TYPED, so an absent one could be a
            field he believes he filled, and «No registrado» is what lets him
            catch that. The margin is not typed: it is derived from the cost.
            With no cost there is no margin to report, and «Margen: No
            registrado» would accuse him of skipping a field that does not
            exist. Cost itself is already on this screen saying so. */}
        {margen == null ? null : (
          <FilaDeRepaso nombre={etiquetaDelMargen} valor={formatPercent(margen)} />
        )}
        {/* EVERY CURRENCY THE TIER CARRIES, with the price actually in force —
            which is the bug the owner reported on 2026-10-20: *«el frame para
            verificar el producto antes de crearlo no está mostrando los
            precios seteados»*.

            It was reading `fixed`, the hand-pinned overrides, and nothing
            else. Those are the EXCEPTION: the ordinary way to price a product
            is to type the base and let the rest follow the rate, and that
            leaves `fixed` empty. So the screen said «Sin precio todavía» to
            someone who had typed a price two screens earlier — and said it
            directly above the button that creates the product. */}
        {monedas.map((c) => {
          const importe = mostradoDe(c, base, precioBase, fijos, rates);
          return (
            <FilaDeRepaso
              key={c}
              nombre={`Precio ${CURRENCY_LABEL[c] ?? c}`}
              valor={importe == null ? SIN_DATO : formatPriceAmount(importe, c)}
              moneda={c}
            />
          );
        })}
        {minimo ? <FilaDeRepaso nombre="A partir de" valor={`${minimo} unidades`} /> : null}
      </div>
    </div>
  );
}

// A CHECKED BOX, READ-ONLY. `PublishCheck` is the editable one from step 3/4
// and takes an `onChange`; this is the same shape with nothing behind it.
// ============================================================================
// 4/4 VERIFICA — frame `1465:19856`
//
// Everything typed, read back, before saving. The step did not exist in the
// old dialog and adds no field: it shows the same ones as the three before it.
//
// WHY A WHOLE SCREEN TO RE-READ. In the dialog the owner reached «Crear
// producto» with the form in front of him and could check it at a glance.
// Split into four, the save button lands on a screen showing three fields out
// of nine, so the last thing he saw before deciding was a third of what he was
// deciding about. This screen gives that glance back.
function valorDelCosto(cost: string, costCurrency: string): string {
  const n = parseTypedAmount(cost);
  if (n == null) return SIN_DATO;
  return costCurrency === "OTHER"
    ? cost.trim()
    : formatPriceAmount(n, costCurrency as PriceCurrency);
}

function Verifica({
  nombre,
  stock,
  cost,
  costCurrency,
  supplier,
  description,
  photoPath,
  pubRetail,
  pubWholesale,
  ventaRetail,
  ventaWholesale,
  currencies,
  fixed,
  priceRetail,
  priceWholesale,
  margenRetail,
  margenWholesale,
  minQty,
  rates,
}: {
  nombre: string;
  stock: string;
  cost: string;
  costCurrency: string;
  supplier: string;
  description: string;
  photoPath: string | null;
  pubRetail: boolean;
  pubWholesale: boolean;
  ventaRetail: boolean;
  ventaWholesale: boolean;
  currencies: Record<PriceTier, PriceCurrency[]>;
  fixed: Record<PriceTier, Partial<Record<PriceCurrency, string>>>;
  priceRetail: string;
  priceWholesale: string;
  margenRetail: number | null;
  margenWholesale: number | null;
  minQty: string;
  rates: BolivarRates | null;
}) {
  const publicando = pubRetail || pubWholesale;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col">
        <FilaDeRepaso nombre="Nombre del producto" valor={nombre.trim() || SIN_DATO} />
        <FilaDeRepaso nombre="Disponible en inventario" valor={stock.trim() || SIN_DATO} />
        <FilaDeRepaso
          nombre="Costo"
          // FORMATTED AS MONEY, as the frame writes it (`$000.00`) and as
          // every other amount on this screen already is. Echoing the raw
          // «1.20» back puts the one figure the owner is checking in a
          // different shape from the prices right below it.
          //
          // «Otro» has no format to apply — that is the point of that option
          // — so its text is shown exactly as typed.
          valor={valorDelCosto(cost, costCurrency)}
          // THE FLAG ONLY WHERE THERE IS A FIGURE TO QUALIFY. A currency icon
          // beside «No registrado» states the currency of an amount that does
          // not exist.
          moneda={cost.trim() ? costCurrency : null}
        />
        <FilaDeRepaso nombre="Proveedor" valor={supplier.trim() || SIN_DATO} />
        <FilaAncha nombre="Descripción">
          <p className="min-w-0 flex-1 break-words">{description.trim() || SIN_DATO}</p>
        </FilaAncha>

        {/* FOTO: the frame draws the label and then the image across the full
            width underneath (`1465:20094`), not a 64px thumbnail inside the
            row. This screen is for looking at what is about to be published,
            and the photo is the one field whose mistake — the wrong shot, a
            blurry one — is invisible at thumbnail size. */}
        {photoPath ? (
          <div className="flex flex-col pb-4">
            <FilaDeRepaso nombre="Foto" valor="" />
            {/* `unoptimized` for the same reason as in `ProductPhotoInput`:
                the source is a Supabase public URL and the photo was already
                resized on the device. */}
            <Image
              src={getPublicProductPhotoUrl(photoPath)}
              alt="Foto del producto"
              width={640}
              height={480}
              unoptimized
              className="h-[120px] w-full rounded-[10px] border object-cover"
            />
          </div>
        ) : (
          <FilaDeRepaso nombre="Foto" valor={SIN_DATO} />
        )}
      </div>

      {/* ── THE PUBLISHING CARD ────────────────────────────────────────────
          The only bordered box the frame draws on this screen (`1465:20077`),
          and it earns the border: it is the one block whose state is not a
          number but a decision, and the only one with consequences outside the
          shop — what a stranger opening the catalogue link will see.

          READ-ONLY, not interactive. Editing it here would make this a fifth
          editing screen instead of the re-read it exists to be; «Editar» goes
          back to the step that owns it.

          EL COMPONENTE VIVE FUERA desde el 2026-10-26, porque la ficha del
          producto (frame `1730:14329`) dibuja esta misma tarjeta con el mismo
          razonamiento. Lo que había aquí era su original; se movió en vez de
          copiarse, que es la regla que `StickyActions` dejó escrita. */}
      <TarjetaDePublicacion
        publicando={publicando}
        alMayor={pubWholesale}
        alDetal={pubRetail}
      />

      {ventaRetail ? (
        <BloqueDeVenta
          titulo="Venta al detal"
          etiquetaDelMargen="Margen al detal"
          margen={margenRetail}
          monedas={currencies.retail}
          base={currencies.retail[0]}
          precioBase={parseTypedAmount(priceRetail)}
          fijos={fixed.retail}
          rates={rates}
        />
      ) : null}
      {ventaWholesale ? (
        <BloqueDeVenta
          titulo="Venta al mayor"
          // THE FRAME SAYS «Margen al detal» HERE TOO, and that is a slip in
          // the design, not a decision: this is the wholesale block. Copying it
          // literally would put a label in front of the owner naming the wrong
          // tier, on the screen he opens to catch exactly that kind of mistake.
          // Flagged to the owner on delivery.
          etiquetaDelMargen="Margen al mayor"
          margen={margenWholesale}
          monedas={currencies.wholesale}
          base={currencies.wholesale[0]}
          precioBase={parseTypedAmount(priceWholesale)}
          fijos={fixed.wholesale}
          rates={rates}
          minimo={minQty.trim() || undefined}
        />
      ) : null}
    </div>
  );
}
