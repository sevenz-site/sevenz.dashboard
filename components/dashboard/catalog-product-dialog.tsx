"use client";

import { useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { Link2, Link2Off, Loader2, Minus, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  lastCostCurrency,
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
  // La última que este negocio usó, para que un producto nuevo abra con ella.
  // Ver la página: sale de su propio historial, no del navegador.
  lastCostCurrency: CostCurrency | null;
  ownerId: string;
}) {
  const router = useRouter();
  const [saving, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editing = product != null;

  const [name, setName] = useState(product?.name ?? "");
  const [stock, setStock] = useState(formatAmountForInput(product?.stock_opening));
  const [cost, setCost] = useState(formatAmountForInput(product?.cost));

  // LA MONEDA DEL COSTO. Por defecto la última que este negocio usó, igual que
  // el formulario de movimientos recuerda la suya — y por el mismo motivo: un
  // tendero compra casi siempre en la misma moneda, así que preguntárselo cada
  // vez es una decisión que ya tomó.
  //
  // Sale del historial del propio negocio y NO del navegador: iOS Safari borra
  // `localStorage` tras un tiempo de inactividad, y entonces la pantalla
  // «olvidaría» lo que el tendero lleva meses haciendo. Es la regla de
  // CLAUDE.md sobre no apoyarse en el navegador para nada que importe.
  const [costCurrency, setCostCurrency] = useState<CostCurrency>(
    (product?.cost_currency as CostCurrency | null) ?? lastCostCurrency ?? defaultCurrency,
  );
  const [costOther, setCostOther] = useState(product?.cost_currency_other ?? "");
  // Se enciende al intentar elegir un margen sin costo. Ver `pedirCosto`.
  const [costoFaltante, setCostoFaltante] = useState(false);

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
  const [minQty, setMinQty] = useState(formatAmountForInput(product?.wholesale_min_quantity));

  const [fixed, setFixed] = useState<Record<PriceTier, Partial<Record<PriceCurrency, string>>>>({
    retail: Object.fromEntries(
      Object.entries(overrides.retail).map(([c, v]) => [c, formatAmountForInput(v)]),
    ),
    wholesale: Object.fromEntries(
      Object.entries(overrides.wholesale).map(([c, v]) => [c, formatAmountForInput(v)]),
    ),
  });

  const [pubRetail, setPubRetail] = useState(product?.published_retail ?? false);
  const [pubWholesale, setPubWholesale] = useState(product?.published_wholesale ?? false);
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
    const c = parseAmount(next);
    if (c == null || c <= 0 || costCurrency === "OTHER" || !rates) return;

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
      const hayFijos = currencies.some((x) => x !== base && (fijos[x] ?? "").trim() !== "");
      if (hayFijos) return;
      const p = priceFromCost(c, costCurrency, Number(margen), base, rates);
      if (p != null) set(formatAmountForInput(p));
    };
    recalcular(marginRetail, fixed.retail, setPriceRetail);
    recalcular(marginWholesale, fixed.wholesale, setPriceWholesale);
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
    priceRetail: priceRetail || null,
    priceWholesale: priceWholesale || null,
    fixedRetail: fixed.retail,
    fixedWholesale: fixed.wholesale,
    cost: cost || null,
    costCurrency: cost.trim() === "" ? null : costCurrency,
    costCurrencyOther: costCurrency === "OTHER" ? costOther : null,
    marginRetailPct: marginOf(priceRetail)?.toString() ?? null,
    marginWholesalePct: marginOf(priceWholesale)?.toString() ?? null,
    stockOpening: stock || null,
    wholesaleMinQuantity: minQty || null,
    publishedRetail: pubRetail,
    publishedWholesale: pubWholesale,
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
      router.refresh();
      toast.success(editing ? "Producto actualizado." : "Producto creado.");
    });
  }

  const tierProps = {
    cost: costNumber,
    costCurrency,
    costUsable,
    onNeedCost: pedirCosto,
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
            onChange={setStock}
            hint={
              stock.trim() === ""
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
            <Label htmlFor="producto_costo">Costo unitario</Label>
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
                }}
                hasRates={Boolean(rates)}
                businessCurrency={defaultCurrency}
                disabled={saving}
              />
            </div>

            {costCurrency === "OTHER" ? (
              <Input
                value={costOther}
                onChange={(e) => setCostOther(e.target.value)}
                placeholder="¿En qué moneda?"
                aria-label="Escribe la moneda del costo"
                disabled={saving}
              />
            ) : null}

            {costoFaltante ? (
              <p className="text-xs leading-relaxed text-destructive">
                Primero pon el costo: sin él no podemos calcular el precio desde el margen.
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

          {/* AL DETAL PRIMERO, que es el orden del frame y el del día a día. */}
          <TierSection
            {...tierProps}
            tier="retail"
            label="Margen al detal"
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
                hint={null}
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
  const opciones: CostCurrency[] = hasRates
    ? ["USD", "EUR", "USDT", "OTHER"]
    : [businessCurrency, "OTHER"];

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
function Stepper({
  id,
  label,
  value,
  onChange,
  hint,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  // El `Dispatch` del `useState` del padre, no una función cualquiera: hace
  // falta para el `step` de abajo.
  onChange: Dispatch<SetStateAction<string>>;
  hint: string | null;
  disabled: boolean;
}) {
  // ACTUALIZACION FUNCIONAL, Y NO ES PREFERENCIA DE ESTILO. Antes esto leía
  // `value` de la prop, y tres toques seguidos al «+» dejaban la cantidad en
  // 1: React agrupa el lote y los tres manejadores leían el mismo render
  // viejo. Encontrado probando la ficha el 2026-10-10.
  const step = (delta: number) =>
    onChange((prev) => {
      const n = Number(String(prev).replace(",", ".")) || 0;
      return String(Math.max(0, n + delta));
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
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          disabled={disabled}
          className="text-center tabular-nums"
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
      {hint ? <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function TierSection({
  tier,
  label,
  price,
  onPriceChange,
  margin,
  onMarginChange,
  cost,
  costCurrency,
  costUsable,
  onNeedCost,
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
  price: string;
  onPriceChange: (next: string) => void;
  margin: string;
  onMarginChange: (next: string) => void;
  cost: number | null;
  costCurrency: CostCurrency;
  costUsable: boolean;
  onNeedCost: () => void;
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
  const hayFijos = currencies.some((c) => c !== base && (fixed[c] ?? "").trim() !== "");

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
            if (!costUsable || cost == null || !rates) {
              onNeedCost();
              return;
            }
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
        const manual = (fixed[currency] ?? "").trim() !== "";
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
                {link.linked ? <Link2 className="size-4" /> : <Link2Off className="size-4" />}
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
