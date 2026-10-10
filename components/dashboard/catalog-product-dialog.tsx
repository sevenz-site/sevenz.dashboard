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
  suggestedPrice,
  marginFromPrice,
  parseAmount,
  formatAmountForInput,
  priceFromCost,
  type BolivarRates,
  type CostCurrency,
  type PriceCurrency,
  type PriceTier,
} from "@/lib/products/price";
import { MARGIN_PRESETS, UNIT_OPTIONS, unitPlural } from "@/lib/products/options";
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

// Las monedas en las que un producto puede llevar precio, en el orden del
// frame. VES no está: es la moneda en la que el cliente PAGA, se enseña
// siempre calculada al final y no se agrega ni se quita (decisión del dueño,
// 2026-10-10, y la migración 087 la deja fuera de `product_currencies`).
const SELLABLE: PriceCurrency[] = ["USD", "EUR", "USDT"];

const CURRENCY_LABEL: Record<string, string> = {
  USD: "Dólar",
  EUR: "Euro",
  USDT: "USDT",
  COP: "Peso",
  VES: "Bolívar",
};

// LA FICHA DE PRODUCTO, segun el frame 1187:3728 y los ajustes del 2026-10-10.
//
// ─────────────────────────────────────────────────────────────────────────
// LAS MONEDAS SON UNA LISTA QUE EL TENDERO MONTA
//
// Cada moneda se agrega y se quita. USD viene activa por defecto y NO es
// obligatoria: un producto puede tener solo precio en euros. La PRIMERA de la
// lista es la base — la que va en `price_retail` / `price_wholesale` y la que
// lee todo lo de aguas abajo: la rejilla, el catálogo público, la tarjeta que
// ve el cliente.
//
// ─────────────────────────────────────────────────────────────────────────
// O HAY MARGEN, O HAY PRECIOS FIJOS POR MONEDA
//
// Son incompatibles y el dueño lo dijo con esas palabras. Aquí se traduce en
// una regla concreta: **el desplegable del margen se inhabilita en cuanto
// alguna moneda que no sea la base lleva un importe a mano**, y se recupera
// volviendo a enlazarlas con su cadena.
//
// Y sin costo el margen no puede calcular nada, así que enseña «Otro». El
// valor por defecto (30/15) solo aparece cuando hay un costo al que aplicarlo.
//
// ─────────────────────────────────────────────────────────────────────────
// TRES COSAS EN LAS QUE ESTA PANTALLA SE APARTA DEL FRAME, Y POR QUE
//
// 1. La fila de la moneda base no lleva vínculo. El frame dibuja uno en las
//    tres. Pero esa fila es el precio, no una equivalencia de nada, y su
//    vínculo con el costo es el margen de arriba.
// 2. Bolívares se enseña siempre, al final, calculada y sin controles.
// 3. Una moneda calculada se llama «Equivalencia», no «Precio». El frame dice
//    «Precio USDT»; el dueño decidió lo contrario el 2026-10-09 y el caso que
//    lo motivó sigue en pie: con el BCV a 160 y el USDT a 200, un producto de
//    $12 enseña 9,60 USDT — correcto, y se lee como un error.
export function CatalogProductDialog({
  open,
  onOpenChange,
  product,
  rates,
  defaultCurrency,
  overrides,
  initialCurrencies,
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
  ownerId: string;
}) {
  const router = useRouter();
  const [saving, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editing = product != null;

  const [name, setName] = useState(product?.name ?? "");

  const storedUnit = product?.unit ?? "";
  const unitIsPreset = (UNIT_OPTIONS as readonly string[]).includes(storedUnit);
  const [unitChoice, setUnitChoice] = useState<string>(
    storedUnit === "" ? (editing ? "" : "Unidad") : unitIsPreset ? storedUnit : "Otro",
  );
  const [unitOther, setUnitOther] = useState(unitIsPreset ? "" : storedUnit);
  const unit = unitChoice === "Otro" ? unitOther : unitChoice;

  const [stock, setStock] = useState(formatAmountForInput(product?.stock_opening));
  const [cost, setCost] = useState(formatAmountForInput(product?.cost));

  // LA MONEDA DEL COSTO. Decisión del dueño el 2026-10-10: hace falta desde
  // que el producto puede venderse solo en euros con el costo apuntado en
  // dólares. Por defecto la del negocio, que es lo que era implícitamente
  // antes de la migración 087.
  const [costCurrency, setCostCurrency] = useState<CostCurrency>(
    (product?.cost_currency as CostCurrency | null) ?? defaultCurrency,
  );
  const [costOther, setCostOther] = useState(product?.cost_currency_other ?? "");

  const [currencies, setCurrencies] = useState<PriceCurrency[]>(initialCurrencies);
  const base = currencies[0] ?? defaultCurrency;

  const [priceRetail, setPriceRetail] = useState(formatAmountForInput(product?.price_retail));
  const [priceWholesale, setPriceWholesale] = useState(
    formatAmountForInput(product?.price_wholesale),
  );
  const [marginRetail, setMarginRetail] = useState(DEFAULT_MARGIN.retail);
  const [marginWholesale, setMarginWholesale] = useState(DEFAULT_MARGIN.wholesale);

  // LOS PRECIOS FIJADOS A MANO, por escalón y por moneda. Todo vive aquí hasta
  // que se pulsa Guardar, y eso cambió el 2026-10-10: antes cada candado
  // escribía en la base al instante, de modo que abrir una ficha, tocar un
  // candado y cerrar sin guardar dejaba el cambio hecho.
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

  // Un costo en una moneda «Otra» no sirve para calcular: no tenemos su tasa.
  const costUsable = costNumber != null && costCurrency !== "OTHER";

  const marginOf = (price: string): number | null => {
    const p = toNum(price);
    if (p == null) return null;
    return marginFromPrice(costNumber, p);
  };

  // EL COSTO RELLENA LOS PRECIOS QUE ESTAN VACIOS, Y SOLO ESOS.
  //
  // Es lo que le da sentido al margen por defecto. Lo que NO hace es mover un
  // precio que ya tiene valor — corregir el costo de un producto viejo no
  // puede reescribirle por detrás un precio que alguien puso a mano.
  function handleCost(next: string) {
    setCost(next);
    const c = parseAmount(next);
    if (c == null || c <= 0 || costCurrency === "OTHER" || !rates) return;
    const enBase = priceIn(base, { amount: c, currency: costCurrency }, rates).amount;
    if (enBase == null) return;
    if (priceRetail.trim() === "") {
      const p = suggestedPrice(enBase, Number(marginRetail));
      if (p != null) setPriceRetail(formatAmountForInput(p));
    }
    if (priceWholesale.trim() === "") {
      const p = suggestedPrice(enBase, Number(marginWholesale));
      if (p != null) setPriceWholesale(formatAmountForInput(p));
    }
  }

  // AGREGAR Y QUITAR MONEDAS VIVEN AQUI, no dentro de un escalón, y no es
  // organización: quitar la moneda BASE tiene que mover el precio de LOS DOS
  // escalones a la que pase a ser base, y un escalón solo conoce el suyo.
  function agregarMoneda(c: PriceCurrency) {
    setCurrencies((prev) => (prev.includes(c) ? prev : [...prev, c]));
  }

  // QUITAR LA BASE NO PUEDE DEJAR EL NUMERO QUIETO, y esto es dinero.
  //
  // `price_retail` guarda «el precio en la moneda base». Si se quita el dólar
  // y pasa a mandar el euro, ese 65 dejaría de significar $65 y pasaría a
  // significar €65 sin que nadie lo tocara — el producto se encarecería un
  // 12 % en silencio.
  //
  // Así que al quitar la base se traslada el precio: si la moneda que hereda
  // ya tenía un importe fijado a mano, ese manda; si no, se convierte el que
  // había. Y la que hereda deja de tener «precio fijado», porque ahora ES el
  // precio.
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
    unit: unit || null,
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
        // `createProduct` puede devolver un aviso CON id: el producto se
        // guardó y lo que falló fueron las tablas satélite. En ese caso no se
        // cierra la ficha, para que el tendero pueda reintentar sobre lo que
        // ya escribió.
        setError(result.error);
        return;
      }

      onOpenChange(false);
      router.refresh();
      toast.success(editing ? "Producto actualizado." : "Producto creado.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      {/* `grid-cols-[minmax(0,1fr)]` NO es decoración, y esto costó
          encontrarlo. `DialogContent` es `display: grid` sin columnas
          declaradas, así que crea una columna `auto` — y una columna `auto` se
          dimensiona al MAX-CONTENT del hijo más ancho, sin encogerse nunca por
          debajo de él.

          Medido a 375px el 2026-10-10, con el dueño reportando «paddings
          rotos»: el diálogo tenía 343px de ancho útil y su columna medía
          349,75. Siete píxeles de más en CADA hijo, y 39 de scroll horizontal
          contando el padding. El síntoma no es que una fila se salga: es que
          TODAS se salen a la vez y el padding derecho parece haber
          desaparecido. */}
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

          <div className="flex flex-col gap-2">
            <Label htmlFor="producto_unidad">Unidad</Label>
            <Select value={unitChoice} onValueChange={setUnitChoice}>
              <SelectTrigger id="producto_unidad" className="w-full">
                <SelectValue placeholder="Elige una" />
              </SelectTrigger>
              <SelectContent>
                {UNIT_OPTIONS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
                <SelectItem value="Otro">Otro</SelectItem>
              </SelectContent>
            </Select>
            {unitChoice === "Otro" ? (
              <Input
                value={unitOther}
                onChange={(e) => setUnitOther(e.target.value)}
                placeholder="¿En qué lo cuentas?"
                aria-label="Escribe la unidad"
              />
            ) : null}
          </div>

          <QuantityStepper value={stock} onChange={setStock} unit={unit || null} />

          <div className="flex flex-col gap-2">
            <Label htmlFor="producto_costo">Costo (opcional)</Label>
            <Input
              id="producto_costo"
              inputMode="decimal"
              value={cost}
              onChange={(e) => handleCost(e.target.value)}
              placeholder="00"
            />
            {/* LOS CHIPS DE LA MONEDA DEL COSTO, pedidos por el dueño el
                2026-10-10. Solo salen con un costo escrito: unos chips encima
                de un campo vacío preguntan por la moneda de nada. */}
            {cost.trim() === "" ? null : (
              <CostCurrencyChips
                value={costCurrency}
                onChange={setCostCurrency}
                other={costOther}
                onOtherChange={setCostOther}
                hasRates={Boolean(rates)}
                businessCurrency={defaultCurrency}
                disabled={saving}
              />
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              Lo que te costó a ti. Con esto calculamos los precios desde el margen y te decimos
              tu ganancia.
            </p>
          </div>

          <TierSection
            tier="wholesale"
            label="Margen al mayor"
            price={priceWholesale}
            onPriceChange={setPriceWholesale}
            margin={marginWholesale}
            onMarginChange={setMarginWholesale}
            cost={costNumber}
            costCurrency={costCurrency}
            costUsable={costUsable}
            currencies={currencies}
            onAddCurrency={agregarMoneda}
            onRemoveCurrency={quitarMoneda}
            rates={rates}
            fixed={fixed.wholesale}
            onFixedChange={(next) => setFixed((f) => ({ ...f, wholesale: next }))}
            disabled={saving}
          />

          <TierSection
            tier="retail"
            label="Margen al detal"
            price={priceRetail}
            onPriceChange={setPriceRetail}
            margin={marginRetail}
            onMarginChange={setMarginRetail}
            cost={costNumber}
            costCurrency={costCurrency}
            costUsable={costUsable}
            currencies={currencies}
            onAddCurrency={agregarMoneda}
            onRemoveCurrency={quitarMoneda}
            rates={rates}
            fixed={fixed.retail}
            onFixedChange={(next) => setFixed((f) => ({ ...f, retail: next }))}
            disabled={saving}
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
                  // ENCENDER MARCA LAS DOS, decisión del dueño el 2026-10-10.
                  // Va de la mano con que la tarjeta del cliente enseñe el
                  // precio más bajo: si se publican los dos escalones, el
                  // cliente ve el mejor de los dos y el tendero no tiene que
                  // elegir nada para el caso corriente.
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

// LOS CHIPS DE LA MONEDA DEL COSTO.
//
// Solo se ofrecen las monedas de las que SABEMOS la tasa, más «Otra». Un chip
// de una moneda que no podemos convertir sería una promesa que la pantalla no
// puede cumplir — y «Otra» ya cubre ese caso diciendo lo que pasa.
function CostCurrencyChips({
  value,
  onChange,
  other,
  onOtherChange,
  hasRates,
  businessCurrency,
  disabled,
}: {
  value: CostCurrency;
  onChange: (v: CostCurrency) => void;
  other: string;
  onOtherChange: (v: string) => void;
  hasRates: boolean;
  businessCurrency: PriceCurrency;
  disabled: boolean;
}) {
  // Un negocio colombiano no tiene tasa de ninguna clase, así que sus únicas
  // opciones honestas son su peso y «Otra».
  const opciones: CostCurrency[] = hasRates
    ? ["VES", "USD", "EUR", "USDT", "OTHER"]
    : [businessCurrency, "OTHER"];

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {opciones.map((c) => (
          <Button
            key={c}
            type="button"
            size="sm"
            variant={value === c ? "default" : "outline"}
            disabled={disabled}
            onClick={() => onChange(c)}
          >
            {c === "OTHER" ? "Otra" : (CURRENCY_LABEL[c] ?? c)}
          </Button>
        ))}
      </div>

      {value === "OTHER" ? (
        <>
          <Input
            value={other}
            onChange={(e) => onOtherChange(e.target.value)}
            placeholder="¿En qué moneda?"
            aria-label="Escribe la moneda del costo"
            disabled={disabled}
          />
          {/* DICHO, NO DESCUBIERTO. De una moneda que no sea una de las cuatro
              no tenemos tasa, así que no hay forma de convertir: el margen no
              puede calcular ningún precio y los escribe el tendero. Callarlo
              dejaría cuatro filas en «—» sin ninguna explicación. */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            De esa moneda no tenemos la tasa, así que no podemos calcular los precios desde el
            margen. Escríbelos tú abajo; la ganancia tampoco se podrá calcular.
          </p>
        </>
      ) : null}
    </div>
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

// LA TARJETA DE LA FOTO CON IA, QUE TODAVIA NO HACE NADA.
//
// El frame la pide con una nota: «de momento mostrar mensaje que será una
// próxima actualización». Es el único control decorativo de esta pantalla, y
// conviene que siga siéndolo: dos cosas que no funcionan a la vez dejan de
// leerse como «viene pronto» y empiezan a leerse como «está roto».
//
// Lo que falta: CT-57 (reseña de OpenRouter) y PL-8 (la cuota gratis de Gemini
// son 20 fotos al día para TODOS los dueños juntos).
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

// LA CANTIDAD, CON SUS DOS BOTONES.
//
// Y DICE QUE TODAVIA NO SE MUEVE SOLO, porque si no, miente. Decisión del
// dueño el 2026-10-09: el campo entra ahora y la máquina de eventos después.
function QuantityStepper({
  value,
  onChange,
  unit,
}: {
  value: string;
  // El `Dispatch` del `useState` del padre, no una función cualquiera. Hace
  // falta para el `step` de abajo.
  onChange: Dispatch<SetStateAction<string>>;
  unit: string | null;
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
      <Label htmlFor="producto_cantidad">Cantidad</Label>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0"
          aria-label="Restar uno"
          onClick={() => step(-1)}
        >
          <Minus className="size-4" />
        </Button>
        <Input
          id="producto_cantidad"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="0"
          className="text-center tabular-nums"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0"
          aria-label="Sumar uno"
          onClick={() => step(1)}
        >
          <Plus className="size-4" />
        </Button>
        <span className="shrink-0 text-sm text-muted-foreground">({unitPlural(unit)})</span>
      </div>
      {value.trim() === "" ? null : (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Por ahora esta cantidad no baja sola: cuando fíes o vendas, tendrás que ajustarla tú.
        </p>
      )}
    </div>
  );
}

// UN ESCALON: SU MARGEN Y UNA FILA POR MONEDA.
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
  currencies,
  onAddCurrency,
  onRemoveCurrency,
  rates,
  fixed,
  onFixedChange,
  disabled,
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
  currencies: PriceCurrency[];
  onAddCurrency: (c: PriceCurrency) => void;
  onRemoveCurrency: (c: PriceCurrency) => void;
  rates: BolivarRates | null;
  fixed: Partial<Record<PriceCurrency, string>>;
  onFixedChange: (next: Partial<Record<PriceCurrency, string>>) => void;
  disabled: boolean;
}) {
  const base = currencies[0];
  const priceNumber = (() => {
    const n = parseAmount(price);
    return n != null && n > 0 ? n : null;
  })();

  const derived = priceNumber != null ? marginFromPrice(cost, priceNumber) : null;

  // O HAY MARGEN, O HAY PRECIOS FIJOS POR MONEDA. El dueño lo dijo así el
  // 2026-10-10, y aquí es una regla concreta: basta con que UNA moneda que no
  // sea la base lleve importe a mano para que el margen deje de mandar. La
  // salida es volver a enlazarlas, que es un gesto visible y no un callejón.
  const hayFijos = currencies.some((c) => c !== base && (fixed[c] ?? "").trim() !== "");
  const margenApagado = disabled || !costUsable || hayFijos;

  // SIN COSTO EL DESPLEGABLE DICE «OTRO», pedido del dueño el 2026-10-10. El
  // valor por defecto solo tiene sentido cuando hay un costo al que
  // aplicárselo; enseñar «30 %» junto a un precio que nadie calculó desde un
  // margen es afirmar algo falso.
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
          disabled={margenApagado}
          onValueChange={(v) => {
            if (v === "otro") {
              document.getElementById(`precio_${tier}`)?.focus();
              return;
            }
            onMarginChange(v);
            if (cost == null || !rates || costCurrency === "OTHER") return;
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
        {hayFijos && costUsable ? (
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

  // Agregar y quitar actúan sobre el PRODUCTO, no sobre este escalón: una
  // moneda es algo en lo que el producto se vende, no algo de su precio al
  // mayor. Por eso la lista se ve igual en las dos secciones, y por eso los
  // manejadores viven en el diálogo — ver `quitarMoneda`.

  // COLOMBIA: UNA SOLA FILA, y eso no es un hueco. Un negocio colombiano cobra
  // en pesos y no tiene tasa de ninguna clase — no existe Bs/COP porque no hay
  // bolívares de por medio.
  if (!rates) {
    return (
      <PriceField
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

  return (
    <div className="flex flex-col gap-3">
      {currencies.map((currency) => {
        const esBase = currency === base;
        const manual = (fixed[currency] ?? "").trim() !== "";
        const calculado =
          basePrice == null
            ? null
            : priceIn(currency, { amount: basePrice, currency: base }, rates).amount;

        return (
          <PriceField
            key={currency}
            currency={currency}
            label={
              esBase
                ? `Precio ${CURRENCY_LABEL[currency] ?? currency}`
                : manual
                  ? `Precio fijado en ${CURRENCY_LABEL[currency] ?? currency}`
                  : `Equivalencia en ${CURRENCY_LABEL[currency] ?? currency}`
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
                        // Se siembra con lo que se está viendo, para que el
                        // número no salte al romper la cadena.
                        onFixedChange({
                          ...fixed,
                          [currency]: formatAmountForInput(calculado),
                        });
                      }
                    },
                  }
            }
            // LA BASE TAMBIEN SE QUITA. El dueño lo pidió con esas palabras el
            // 2026-10-10: «por defecto la moneda activa será USD, pero no
            // obligatoria, el cliente la puede eliminar para agregar otra».
            // Lo único que no se puede es quedarse sin ninguna.
            onRemove={currencies.length <= 1 ? null : () => onRemoveCurrency(currency)}
          />
        );
      })}

      {inactivas.map((currency) => (
        <div key={currency} className="flex items-center justify-between gap-3">
          <Label className="flex min-w-0 shrink items-center gap-1.5 text-xs font-normal text-muted-foreground">
            <CurrencyFlagIcon currency={currency as "USD" | "EUR" | "VES" | "USDT"} />
            <span className="truncate">Precio {CURRENCY_LABEL[currency] ?? currency}</span>
          </Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10 w-36 shrink-0"
            disabled={disabled}
            onClick={() => onAddCurrency(currency)}
          >
            <Plus className="size-4" /> Agregar
          </Button>
        </div>
      ))}

      {/* BOLIVARES, SIEMPRE Y AL FINAL. Decisión del dueño el 2026-10-10: es la
          moneda en la que el cliente PAGA, no una en la que se fija precio, así
          que no se agrega, no se quita y no se puede fijar. La migración 085 lo
          impide también en el esquema. */}
      <PriceField
        currency="VES"
        // «en Bs.» y no «en bolívares»: la etiqueta completa se corta con
        // puntos suspensivos en la caja de 375px, y lo que se pierde al
        // cortarla es justo el nombre de la moneda. La palabra que carga el
        // significado —«Equivalencia», que la distingue de un precio— se
        // queda entera.
        label="Equivalencia en Bs."
        value={
          basePrice == null
            ? "—"
            : (() => {
                const bs = priceIn("VES", { amount: basePrice, currency: base }, rates).amount;
                return bs == null ? "—" : formatPriceAmount(bs, "VES");
              })()
        }
        readOnly
        disabled={disabled}
        inputId={`precio_${tier}_VES`}
      />

      <p className="text-xs leading-relaxed text-muted-foreground">
        Las equivalencias se calculan con la tasa del día. Puedes romper la cadena de una moneda
        para escribir tú su precio; la de bolívares no, porque la tasa se mueve y ese número
        dejaría de cuadrar con los demás al día siguiente.
      </p>
    </div>
  );
}

// UNA FILA: bandera, etiqueta, caja con el importe y, si toca, el control de
// vínculo dentro de la caja y la papelera fuera.
function PriceField({
  currency,
  label,
  value,
  onChange,
  readOnly,
  disabled,
  inputId,
  link,
  onRemove,
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
}) {
  return (
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
          // Hueco del mismo ancho: sin él, la caja de la fila base y la de las
          // demás no quedan alineadas y la columna de importes se ve torcida.
          <span className="inline-block size-6" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
