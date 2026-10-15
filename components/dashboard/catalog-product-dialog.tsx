"use client";

import { useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { Link2, Loader2, Minus, Plus, Sparkles, Trash2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  priceIn,
  formatPriceAmount,
  formatPercent,
  marginFromPrice,
  parseAmount,
  formatAmountForInput,
  priceFromCost,
  type BolivarRates,
  type CostCurrency,
  type PriceCurrency,
  type PriceTier,
} from "@/lib/products/price";
import { MARGIN_PRESETS } from "@/lib/products/options";
import { ProductPhotoInput } from "@/components/dashboard/product-photo-input";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import {
  createProduct,
  updateProduct,
  trashProduct,
  type ProductInput,
} from "@/app/(app)/productos/actions";
import type { ProductRow } from "@/lib/products/catalog";

const DEFAULT_MARGIN: Record<PriceTier, string> = { retail: "30", wholesale: "15" };

// Las monedas en las que un producto puede llevar precio. VES no está: es la
// moneda en la que el cliente PAGA, y desde el frame 1192:4185 se enseña como
// una línea «Hoy: Bs. …» DEBAJO de cada una, no como una fila propia.
const SELLABLE: PriceCurrency[] = ["USD", "EUR", "USDT"];

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
export function CatalogProductDialog({
  open,
  onOpenChange,
  product,
  rates,
  defaultCurrency,
  overrides,
  initialCurrencies,
  supplierSuggestions,
  lastCostCurrency,
  onSaved,
  ownerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ProductRow | null;
  // null para un negocio colombiano: no hay equivalencias que enseñar.
  rates: BolivarRates | null;
  defaultCurrency: PriceCurrency;
  overrides: Record<PriceTier, Partial<Record<PriceCurrency, number>>>;
  initialCurrencies: PriceCurrency[];
  // Los proveedores que este negocio ya escribió, para el autocompletado.
  // Salen de los productos que la página ya cargó, no de una consulta nueva.
  supplierSuggestions: string[];
  // La moneda del costo del ULTIMO producto creado por este negocio, o
  // null si todavia no tiene ninguno. Solo la usa el dialogo de alta: al
  // editar manda la del producto que se esta abriendo.
  lastCostCurrency?: CostCurrency | null;
  // Se llama SOLO cuando el guardado sale bien, nunca al cerrar sin guardar.
  onSaved?: () => void;
  ownerId: string;
}) {
  const router = useRouter();
  const [saving, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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

  const [cost, setCost] = useState(formatAmountForInput(product?.cost));

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

  const [currencies, setCurrencies] = useState<PriceCurrency[]>(initialCurrencies);
  const base = currencies[0] ?? defaultCurrency;

  const [priceRetail, setPriceRetail] = useState(formatAmountForInput(product?.price_retail));
  const [priceWholesale, setPriceWholesale] = useState(
    formatAmountForInput(product?.price_wholesale),
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
      Object.entries(overrides.retail).map(([c, v]) => [c, formatAmountForInput(v)]),
    ),
    wholesale: Object.fromEntries(
      Object.entries(overrides.wholesale).map(([c, v]) => [c, formatAmountForInput(v)]),
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

  const toNum = (v: string) => {
    const n = parseAmount(v);
    return n != null && n > 0 ? n : null;
  };
  const costNumber = toNum(cost);
  const costUsable = costNumber != null && costCurrency !== "OTHER";

  const marginOf = (price: string): number | null => {
    const p = toNum(price);
    if (p == null) return null;
    return marginFromPrice(costNumber, p);
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

  function handleCost(next: string) {
    setCost(next);
    if (next.trim() !== "") setCostoFaltante(false);
    recalcularDesdeCosto(next, costCurrency);
  }

  function recalcularDesdeCosto(texto: string, moneda: CostCurrency) {
    const c = parseAmount(texto);
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
    const recalcular = (
      margen: string,
      fijos: Partial<Record<PriceCurrency, string>>,
      set: (v: string) => void,
    ) => {
      const hayFijos = currencies.some((x) => x !== base && estaDesvinculada(fijos, x));
      if (hayFijos) return;
      const p = priceFromCost(c, moneda, Number(margen), base, rates);
      if (p != null) set(formatAmountForInput(p));
    };
    recalcular(marginRetail, fixed.retail, setPriceRetail);
    recalcular(marginWholesale, fixed.wholesale, setPriceWholesale);
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

  function agregarMoneda(c: PriceCurrency) {
    setCurrencies((prev) => (prev.includes(c) ? prev : [...prev, c]));
  }

  // QUITAR LA BASE NO PUEDE DEJAR EL NUMERO QUIETO, y esto es dinero.
  //
  // `price_retail` guarda «el precio en la moneda base». Si se quita el dólar
  // y pasa a mandar el euro, un 65 guardado dejaría de significar $65 y pasaría
  // a significar 65 € sin que nadie lo tocara — el producto se encarecería un
  // 12 % en silencio. Por eso vive aquí y no en una sección: hay que mover el
  // precio de LOS DOS escalones.
  function quitarMoneda(c: PriceCurrency) {
    if (currencies.length <= 1) return;
    const siguientes = currencies.filter((x) => x !== c);
    const nuevaBase = siguientes[0];

    if (c === base) {
      const trasladar = (precio: string, fijos: Partial<Record<PriceCurrency, string>>) => {
        const fijado = (fijos[nuevaBase] ?? "").trim();
        if (fijado !== "") return fijado;
        const n = parseAmount(precio);
        if (n == null || !rates) return "";
        const conv = priceIn(nuevaBase, { amount: n, currency: base }, rates).amount;
        return conv == null ? "" : formatAmountForInput(conv);
      };
      setPriceRetail(trasladar(priceRetail, fixed.retail));
      setPriceWholesale(trasladar(priceWholesale, fixed.wholesale));
    }

    const limpiar = (f: Partial<Record<PriceCurrency, string>>) => {
      const next = { ...f };
      delete next[c];
      if (c === base) delete next[nuevaBase];
      return next;
    };
    setFixed((f) => ({ retail: limpiar(f.retail), wholesale: limpiar(f.wholesale) }));
    setCurrencies(siguientes);
  }

  const input: ProductInput = {
    name,
    // El campo «Unidad» salió del formulario el 2026-10-10. La columna se
    // queda: los productos que ya la tienen la conservan y el catálogo público
    // la sigue enseñando, pero no se vuelve a pedir.
    unit: product?.unit ?? null,
    activeCurrencies: currencies,
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
    marginRetailPct: ventaRetail ? (marginOf(priceRetail)?.toString() ?? null) : null,
    marginWholesalePct: ventaWholesale ? (marginOf(priceWholesale)?.toString() ?? null) : null,
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
        setError(result.error);
        return;
      }

      onOpenChange(false);
      // AVISA DE QUE SE GUARDÓ, y no basta con `onOpenChange(false)` para eso:
      // cerrar ocurre igual cuando el tendero se arrepiente. Quien monta este
      // diálogo necesita distinguir las dos cosas para limpiar el formulario
      // solo en una. Ver `CatalogTable`.
      onSaved?.();
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
    currencies,
    onAddCurrency: agregarMoneda,
    onRemoveCurrency: quitarMoneda,
    rates,
    disabled: saving,
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      {/* `grid-cols-[minmax(0,1fr)]`: `DialogContent` es `display: grid` sin
          columnas declaradas, y una columna `auto` se dimensiona al
          MAX-CONTENT del hijo más ancho sin encoger nunca. Medido a 375px el
          2026-10-10: 343px de ancho útil contra una columna de 349,75 y 39px
          de scroll horizontal. Ver DESIGN-SYSTEM.md. */}
      <DialogContent className="grid-cols-[minmax(0,1fr)] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar producto" : "Crear producto"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Lo que cambies aquí se usa la próxima vez que lo vendas o lo fíes."
              : "Con el nombre y un precio basta. Lo demás lo puedes completar después."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {editing ? null : <AiPhotoCard />}

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
            hint={
              stockTopado || excedeTecho(stock, 1e11)
                ? "Esa cantidad es demasiado grande: como mucho 11 dígitos (99.999.999.999)."
                : stock.trim() === ""
                  ? null
                  : "Por ahora esta cantidad no baja sola: cuando fíes o vendas, tendrás que ajustarla tú."
            }
            disabled={saving}
          />

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
                onChange={(e) => handleCost(e.target.value)}
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
              <p className="text-xs leading-relaxed text-muted-foreground">
                Lo que te costó a ti. Con esto calculamos los precios desde el margen y te
                decimos tu ganancia.
              </p>
            )}
          </div>

          {/* EL PROVEEDOR VA DESPUÉS DEL COSTO, que es el orden del frame y
              también el de la cabeza: las dos preguntas son sobre la compra
              —cuánto te costó y dónde lo compraste— y van juntas, antes de
              pasar a las dos de la venta. */}
          <SupplierField
            value={supplier}
            onChange={setSupplier}
            suggestions={supplierSuggestions}
            disabled={saving}
          />

          {/* AL DETAL PRIMERO, que es el orden del frame y el del día a día. */}
          <TierSection
            {...tierProps}
            tier="retail"
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
                  label="Incluir precio al mayor"
                  checked={pubWholesale}
                  disabled={saving}
                  onChange={setPubWholesale}
                />
                <PublishCheck
                  id="pub_detal"
                  label="Incluir precio al detal"
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

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="sm:flex-col-reverse sm:justify-start">
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
          <Button type="button" disabled={saving} onClick={save}>
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Guardando...
              </>
            ) : editing ? (
              "Guardar"
            ) : (
              <>
                <Plus className="size-4" /> Crear producto
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>

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
                  if (r.error) return setError(r.error);
                  onOpenChange(false);
                  router.refresh();
                  toast.success("Producto eliminado.");
                })
              }
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
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
                <CurrencyFlagIcon currency={c as "USD" | "EUR" | "USDT"} />
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

function AiPhotoCard() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed bg-muted/40 p-4">
      <div className="flex items-start gap-3">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-sm font-medium">Sube foto del producto</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Sevenz extraerá los datos. Tú verificas lo que haga falta.
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => toast.info("Esto llega en una próxima actualización.")}
      >
        Subir recibo foto
      </Button>
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
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0"
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
          className="size-10 shrink-0"
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
    const n = parseAmount(price);
    return n != null && n > 0 ? n : null;
  })();

  const derived = priceNumber != null ? marginFromPrice(cost, priceNumber) : null;

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
  const selectValue = !costUsable
    ? "otro"
    : derived != null
      ? (MARGIN_PRESETS as readonly number[]).includes(derived)
        ? String(derived)
        : "otro"
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
            if (siguiente != null) onPriceChange(formatAmountForInput(siguiente));
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

  const inactivas = SELLABLE.filter((c) => !currencies.includes(c));
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
        const calculado = esBase
          ? basePrice
          : basePrice == null
            ? null
            : priceIn(currency, { amount: basePrice, currency: base }, rates).amount;
        const mostrado = manual ? parseAmount(fixed[currency] ?? "") : calculado;
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
            value={
              esBase
                ? price
                : manual
                  ? (fixed[currency] ?? "")
                  : calculado == null
                    ? "—"
                    : formatPriceAmount(calculado, currency)
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
            link={
              esBase
                ? null
                : {
                    linked: !manual,
                    disabled: disabled || (!manual && calculado == null),
                    onToggle: () => {
                      if (manual) {
                        const next = { ...fixed };
                        delete next[currency];
                        onFixedChange(next);
                      } else if (calculado != null) {
                        onFixedChange({
                          ...fixed,
                          [currency]: formatAmountForInput(calculado),
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
            <CurrencyFlagIcon currency={currency as "USD" | "EUR" | "USDT"} />
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

      <p className="text-xs leading-relaxed text-muted-foreground">
        «Hoy» es lo que vale ese precio en bolívares con la tasa de hoy, y se mueve con ella.
        Puedes romper la cadena de una moneda para escribir tú su precio.
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
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <Label
          htmlFor={inputId}
          className="flex min-w-0 shrink items-center gap-1.5 text-xs font-normal text-muted-foreground"
        >
          {currency === "COP" ? null : (
            <CurrencyFlagIcon currency={currency as "USD" | "EUR" | "VES" | "USDT"} />
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
              onChange={(e) => onChange?.(e.target.value)}
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
