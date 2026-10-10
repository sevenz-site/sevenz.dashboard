"use client";

import { useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Minus, Plus, Sparkles, Unlock } from "lucide-react";
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
  allPrices,
  formatPriceAmount,
  formatPercent,
  priceRowLabel,
  suggestedPrice,
  marginFromPrice,
  parseAmount,
  formatAmountForInput,
  type BolivarRates,
  type PriceCurrency,
  type PriceTier,
} from "@/lib/products/price";
import { MARGIN_PRESETS, UNIT_OPTIONS, unitPlural } from "@/lib/products/options";
import { ProductPhotoInput } from "@/components/dashboard/product-photo-input";
import {
  createProduct,
  updateProduct,
  pinPrice,
  unpinPrice,
  trashProduct,
  type ProductInput,
} from "@/app/(app)/productos/actions";
import type { ProductRow } from "@/lib/products/catalog";

// Lo que el frame 1187:3728 pone en cada desplegable al abrir la ficha.
const DEFAULT_MARGIN: Record<PriceTier, string> = { retail: "30", wholesale: "15" };

// LA FICHA DE PRODUCTO, segun el frame 1187:3728.
//
// ─────────────────────────────────────────────────────────────────────────
// NO HAY CAMPO «PRECIO AL MAYOR»: EL PRECIO SE TECLEA EN SU MONEDA
//
// Lo pidio el dueno el 2026-10-10 y tiene razon: ese campo y la fila «Precio
// Dólar» de justo debajo ensenaban EL MISMO NUMERO dos veces. Ahora cada
// escalon es su margen y, debajo, una fila por moneda.
//
// La fila de la moneda del negocio ES el precio; las otras son equivalencias
// con candado. Esto es lo que mantiene vivo el costo opcional, que es una
// decision del dueno del 2026-10-09: sin costo no hay nada que calcular, pero
// la fila del dolar sigue siendo un campo donde escribir.
//
// ─────────────────────────────────────────────────────────────────────────
// EL MARGEN Y EL PRECIO SIGUEN SIENDO UN SOLO DATO
//
// Elegir margen escribe el precio; editar el precio recalcula el margen. Lo
// que se guarda en `margin_*_pct` es siempre el margen de ese precio, asi que
// los dos no pueden contradecirse.
//
// Lo que anade el frame es un VALOR POR DEFECTO —30 % al detal, 15 % al
// mayor— y eso obliga a guardar la eleccion aparte mientras no haya precio
// del que derivar nada. En cuanto hay precio, manda el derivado.
//
// ─────────────────────────────────────────────────────────────────────────
// TRES COSAS EN LAS QUE ESTA PANTALLA SE APARTA DEL FRAME, Y POR QUE
//
// 1. La fila de la moneda del negocio NO lleva candado. El frame dibuja uno
//    en las tres. Pero esa fila es el precio, no una equivalencia de nada, y
//    su vinculo con el costo es el margen de arriba: un candado ahi seria un
//    segundo control para la misma decision.
//
// 2. Las filas no llevan bandera. El frame pone una por moneda, y para USDT
//    un logo. Dos banderas y un logo se leen como tres cosas distintas, y el
//    simbolo ₮ no lo reconoce casi nadie (ya esta razonado en price.ts).
//
// 3. Una moneda calculada se llama «Equivalencia», no «Precio». El frame dice
//    «Precio USDT»; el dueno decidio lo contrario el 2026-10-09 y el caso que
//    lo motivo sigue en pie: con el BCV a 160 y el USDT a 200, un producto de
//    $12 ensena 9,60 USDT. Es correcto y se lee como un error. La palabra es
//    lo unico que lo arregla.
export function CatalogProductDialog({
  open,
  onOpenChange,
  product,
  rates,
  defaultCurrency,
  overrides,
  ownerId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // null = crear uno nuevo.
  product: ProductRow | null;
  // null para un negocio colombiano: no hay equivalencias que enseñar.
  rates: BolivarRates | null;
  defaultCurrency: PriceCurrency;
  overrides: Record<PriceTier, Partial<Record<PriceCurrency, number>>>;
  ownerId: string;
}) {
  const router = useRouter();
  const [saving, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editing = product != null;
  const baseCurrency = product?.base_currency ?? defaultCurrency;

  const [name, setName] = useState(product?.name ?? "");

  // UNIDAD CON VALOR POR DEFECTO, del frame: un producto nuevo abre ya en
  // «Unidad». Si lo guardado no esta en la lista —un producto creado con
  // «Otro»— el formulario abre en «Otro» con su texto, en vez de perderlo
  // silenciosamente al guardar.
  const storedUnit = product?.unit ?? "";
  const unitIsPreset = (UNIT_OPTIONS as readonly string[]).includes(storedUnit);
  const [unitChoice, setUnitChoice] = useState<string>(
    storedUnit === "" ? (editing ? "" : "Unidad") : unitIsPreset ? storedUnit : "Otro",
  );
  const [unitOther, setUnitOther] = useState(unitIsPreset ? "" : storedUnit);
  const unit = unitChoice === "Otro" ? unitOther : unitChoice;

  const [stock, setStock] = useState(formatAmountForInput(product?.stock_opening));
  const [cost, setCost] = useState(formatAmountForInput(product?.cost));
  const [priceRetail, setPriceRetail] = useState(formatAmountForInput(product?.price_retail));
  const [priceWholesale, setPriceWholesale] = useState(
    formatAmountForInput(product?.price_wholesale),
  );
  const [marginRetail, setMarginRetail] = useState(DEFAULT_MARGIN.retail);
  const [marginWholesale, setMarginWholesale] = useState(DEFAULT_MARGIN.wholesale);

  // PUBLICAR, CON SUS DOS CASILLAS. El interruptor es el estado «esto se ve o
  // no se ve»; las casillas dicen en cual de los dos catalogos.
  const [pubRetail, setPubRetail] = useState(product?.published_retail ?? false);
  const [pubWholesale, setPubWholesale] = useState(product?.published_wholesale ?? false);
  const publishOn = pubRetail || pubWholesale;

  const [photoPath, setPhotoPath] = useState<string | null>(product?.photo_path ?? null);
  const [description, setDescription] = useState(product?.description ?? "");

  const toNumber = (v: string) => {
    const n = parseAmount(v);
    return n != null && n > 0 ? n : null;
  };

  const costNumber = toNumber(cost);

  const marginOf = (price: string): number | null => {
    const p = toNumber(price);
    if (p == null) return null;
    return marginFromPrice(costNumber, p);
  };

  // EL COSTO RELLENA LOS PRECIOS QUE ESTAN VACIOS, Y SOLO ESOS.
  //
  // Es lo que le da sentido al margen por defecto: escribes 50 de costo y los
  // dos precios aparecen a 15 % y 30 %. Lo que NO hace es mover un precio que
  // ya tiene valor — corregir el costo de un producto viejo no puede
  // reescribirle por detras un precio que alguien puso a mano. El margen de
  // ese precio simplemente se vuelve a derivar y se ve en pantalla.
  function handleCost(next: string) {
    setCost(next);
    const c = parseAmount(next);
    if (c == null || c <= 0) return;
    if (priceRetail.trim() === "") {
      const p = suggestedPrice(c, Number(marginRetail));
      if (p != null) setPriceRetail(formatAmountForInput(p));
    }
    if (priceWholesale.trim() === "") {
      const p = suggestedPrice(c, Number(marginWholesale));
      if (p != null) setPriceWholesale(formatAmountForInput(p));
    }
  }

  const input: ProductInput = {
    name,
    unit: unit || null,
    priceRetail: priceRetail || null,
    priceWholesale: priceWholesale || null,
    cost: cost || null,
    marginRetailPct: marginOf(priceRetail)?.toString() ?? null,
    marginWholesalePct: marginOf(priceWholesale)?.toString() ?? null,
    stockOpening: stock || null,
    publishedRetail: pubRetail,
    publishedWholesale: pubWholesale,
    photoPath,
    description: description || null,
  };

  // Lo que se fija a mano ANTES de que el producto exista. En edicion cada
  // candado escribe en la base al instante; al crear no hay fila donde
  // escribir, asi que se guarda aqui y se persiste justo despues del insert.
  const [pendingPins, setPendingPins] = useState<
    Record<PriceTier, Partial<Record<PriceCurrency, string>>>
  >({ retail: {}, wholesale: {} });

  function save() {
    setError(null);
    startTransition(async () => {
      const result = editing
        ? await updateProduct(product!.id, input)
        : await createProduct({ ...input, baseCurrency });

      if (result.error) {
        setError(result.error);
        return;
      }

      // Los candados que se cerraron antes de que el producto existiera. Si uno
      // falla NO se deshace el producto: lo que se perdio es un precio fijado,
      // y el tendero lo vuelve a fijar desde la ficha. Tirar el producto
      // entero por eso seria perder el trabajo grande para proteger el chico.
      if (!editing && result.id) {
        const fallos: string[] = [];
        for (const tier of ["retail", "wholesale"] as PriceTier[]) {
          for (const [currency, amount] of Object.entries(pendingPins[tier])) {
            if (!amount) continue;
            const r = await pinPrice(result.id, tier, currency as PriceCurrency, amount);
            if (r.error) fallos.push(currency);
          }
        }
        if (fallos.length > 0) {
          toast.error(
            `Guardamos el producto, pero no pudimos fijar el precio en ${fallos.join(", ")}. Ábrelo y vuelve a intentarlo.`,
          );
        }
      }

      onOpenChange(false);
      router.refresh();
      toast.success(editing ? "Producto actualizado." : "Producto creado.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
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
            baseCurrency={baseCurrency}
            rates={rates}
            productId={product?.id ?? null}
            overrides={overrides.wholesale}
            pending={pendingPins.wholesale}
            onPendingChange={(next) => setPendingPins((p) => ({ ...p, wholesale: next }))}
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
            baseCurrency={baseCurrency}
            rates={rates}
            productId={product?.id ?? null}
            overrides={overrides.retail}
            pending={pendingPins.retail}
            onPendingChange={(next) => setPendingPins((p) => ({ ...p, retail: next }))}
            disabled={saving}
          />

          {/* ── Publicar, con sus dos casillas ─────────────────────────── */}
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
                  // ENCENDER MARCA «AL DETAL», decision del dueno el
                  // 2026-10-10. Es el caso corriente y sale de un solo toque;
                  // y asi el producto nunca queda publicado sin aparecer en
                  // ningun catalogo, que es el estado del que un tendero no
                  // puede salir porque no hay nada en pantalla que lo
                  // explique.
                  if (next) {
                    setPubRetail(true);
                  } else {
                    setPubRetail(false);
                    setPubWholesale(false);
                  }
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
                  // Desmarcar la ultima apaga el interruptor, por lo mismo de
                  // arriba: «Publicar» encendido y ningun catalogo es mentira.
                  onChange={(v) => setPubWholesale(v)}
                />
                <PublishCheck
                  id="pub_detal"
                  label="Incluir precio al detal"
                  checked={pubRetail}
                  disabled={saving}
                  onChange={(v) => setPubRetail(v)}
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
// próxima actualización». Se pinta, entonces, y al tocarla lo dice.
//
// Es el unico control decorativo de esta pantalla, y conviene que siga
// siendolo: dos cosas que no funcionan a la vez dejan de leerse como «viene
// pronto» y empiezan a leerse como «esta roto».
//
// Lo que falta para que funcione: CT-57 (reseña de OpenRouter antes de
// integrarlo) y PL-8 (la cuota gratis de Gemini son 20 fotos al dia para TODOS
// los dueños juntos).
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
// El frame: «Botón '-' resta, Botón '+' suma, Valor entre paréntesis
// '(unidad)' depende de la unidad seleccionada».
//
// Y DICE QUE TODAVIA NO SE MUEVE SOLO, porque si no, miente. Decision del
// dueño el 2026-10-09: el campo entra ahora y la maquina de eventos despues,
// asi que fiar o vender NO descuenta de aqui. Un numero que no baja parece un
// inventario al dia hasta el dia que alguien lo compara con el estante — y ese
// dia se deja de confiar en la pantalla entera, no solo en este campo.
function QuantityStepper({
  value,
  onChange,
  unit,
}: {
  value: string;
  // El `Dispatch` del `useState` del padre, no una funcion cualquiera. Hace
  // falta para el `step` de abajo — ver el comentario que lleva.
  onChange: Dispatch<SetStateAction<string>>;
  unit: string | null;
}) {
  // ACTUALIZACION FUNCIONAL, Y NO ES PREFERENCIA DE ESTILO.
  //
  // Antes esto era `onChange(String(n + delta))` con `n` leido de la prop
  // `value`. Encontrado probando la ficha el 2026-10-10: **tres toques
  // seguidos al «+» dejaban la cantidad en 1**, no en 3, porque React agrupa
  // las actualizaciones de un mismo lote y los tres manejadores leian el mismo
  // `value` del render viejo. Con toques lentos no se nota; con el doble toque
  // que cualquiera le da a un contador, si.
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
        <span className="w-20 shrink-0 text-sm text-muted-foreground">({unitPlural(unit)})</span>
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
//
// La fila de la moneda del negocio es EL PRECIO: editable, sin candado,
// porque su vinculo con el costo es el margen de arriba. Las demas son
// equivalencias con candado. La de bolivares no lleva ninguno — decision del
// dueno el 2026-10-10 — y la migracion 085 lo impide tambien en el esquema,
// porque un precio en bolivares es el unico que se vuelve falso solo cuando
// la tasa se mueve.
function TierSection({
  tier,
  label,
  price,
  onPriceChange,
  margin,
  onMarginChange,
  cost,
  baseCurrency,
  rates,
  productId,
  overrides,
  pending,
  onPendingChange,
  disabled,
}: {
  tier: PriceTier;
  label: string;
  price: string;
  onPriceChange: (next: string) => void;
  margin: string;
  onMarginChange: (next: string) => void;
  cost: number | null;
  baseCurrency: PriceCurrency;
  rates: BolivarRates | null;
  productId: string | null;
  overrides: Partial<Record<PriceCurrency, number>>;
  pending: Partial<Record<PriceCurrency, string>>;
  onPendingChange: (next: Partial<Record<PriceCurrency, string>>) => void;
  disabled: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [draft, setDraft] = useState<Partial<Record<PriceCurrency, string>>>({});

  const priceNumber = (() => {
    const n = parseAmount(price);
    return n != null && n > 0 ? n : null;
  })();

  // El margen derivado manda EN CUANTO hay precio. Mientras no lo hay, el
  // desplegable ensena el valor por defecto del frame, que es lo que despues
  // rellena el precio al escribir un costo.
  const derived = priceNumber != null ? marginFromPrice(cost, priceNumber) : null;
  const shown = derived ?? Number(margin);
  const selectValue =
    derived != null
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
          disabled={disabled}
          onValueChange={(v) => {
            if (v === "otro") return;
            onMarginChange(v);
            // Sin costo no hay de que calcular: el margen queda elegido y el
            // precio se teclea en su fila. Es lo que mantiene vivo el alta
            // minima dentro de un fiado.
            if (cost == null) return;
            const next = suggestedPrice(cost, Number(v));
            if (next != null) onPriceChange(formatAmountForInput(next));
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
            {/* Se ensena y no se elige: «Otro» es lo que PASA cuando el precio
                se teclea a mano, no una opcion que haga nada. */}
            <SelectItem value="otro" disabled>
              Otro (escribe el precio)
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      <PriceRows
        tier={tier}
        price={price}
        onPriceChange={onPriceChange}
        basePrice={priceNumber}
        baseCurrency={baseCurrency}
        rates={rates}
        productId={productId}
        overrides={overrides}
        pending={pending}
        onPendingChange={onPendingChange}
        draft={draft}
        setDraft={setDraft}
        disabled={disabled || busy}
        startTransition={startTransition}
        router={router}
      />

      {cost == null ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Pon el costo arriba y calculamos el precio desde el margen. Sin costo, escribe tú el
          precio.
        </p>
      ) : derived != null && derived < 0 ? (
        /* UNA PERDIDA SE LLAMA PERDIDA. «Tu ganancia es del -10 %» es una
           contradiccion, y en una pantalla de dinero se lee como un fallo de
           cuentas en vez de como un aviso. No se bloquea: liquidar o mover
           mercancia por vencer son casos reales, y la 084 dejo de prohibirlo
           en el esquema por eso mismo. */
        <p className="text-xs leading-relaxed text-destructive">
          A ese precio vendes <strong>por debajo de lo que te costó</strong>: pierdes{" "}
          {formatPercent(Math.abs(derived))}.
        </p>
      ) : derived != null ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          A ese precio tu ganancia es del{" "}
          <strong className="text-foreground">{formatPercent(shown)}</strong>.
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
  baseCurrency,
  rates,
  productId,
  overrides,
  pending,
  onPendingChange,
  draft,
  setDraft,
  disabled,
  startTransition,
  router,
}: {
  tier: PriceTier;
  price: string;
  onPriceChange: (next: string) => void;
  basePrice: number | null;
  baseCurrency: PriceCurrency;
  rates: BolivarRates | null;
  productId: string | null;
  overrides: Partial<Record<PriceCurrency, number>>;
  pending: Partial<Record<PriceCurrency, string>>;
  onPendingChange: (next: Partial<Record<PriceCurrency, string>>) => void;
  draft: Partial<Record<PriceCurrency, string>>;
  setDraft: (d: Partial<Record<PriceCurrency, string>>) => void;
  disabled: boolean;
  startTransition: (cb: () => void) => void;
  router: ReturnType<typeof useRouter>;
}) {
  // COLOMBIA: UNA SOLA FILA, y eso no es un hueco.
  //
  // Un negocio colombiano cobra en pesos y no tiene tasa de ninguna clase —
  // no existe Bs/COP porque no hay bolivares de por medio. Decision del dueno
  // el 2026-10-10: la seccion mantiene su forma con una unica fila editable,
  // en vez de volver al campo suelto que el frame acaba de quitar.
  if (!rates || baseCurrency === "COP") {
    return (
      <PriceField
        label="Precio en pesos"
        value={price}
        onChange={onPriceChange}
        disabled={disabled}
        inputId={`precio_${tier}_COP`}
      />
    );
  }

  // Los fijados de la base MAS los que se acaban de fijar sin guardar todavia.
  const effective: Partial<Record<PriceCurrency, number>> = { ...overrides };
  for (const [currency, amount] of Object.entries(pending)) {
    const n = parseAmount(amount);
    if (n != null && n > 0) effective[currency as PriceCurrency] = n;
  }

  const rows =
    basePrice == null
      ? null
      : allPrices({ amount: basePrice, currency: baseCurrency }, rates, effective);

  return (
    <div className="flex flex-col gap-3">
      {/* La moneda del negocio: el precio, siempre editable, con o sin las
          demas. Va primero y fuera del mapa de `allPrices` justo porque no es
          una equivalencia — es el numero del que salen las otras. */}
      <PriceField
        label={`Precio ${baseCurrency === "USD" ? "Dólar" : baseCurrency}`}
        value={price}
        onChange={onPriceChange}
        disabled={disabled}
        inputId={`precio_${tier}`}
      />

      {rows == null ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Escribe un precio para ver las otras monedas.
        </p>
      ) : (
        rows
          .filter((row) => row.currency !== baseCurrency)
          .map((row) => {
            const pinned = row.origin === "manual";
            // BOLIVARES NO SE FIJA. Decision del dueno el 2026-10-10, y la
            // migracion 085 lo impide tambien en la base. Se ensena el numero
            // y una linea que dice por que no hay control, para que no se lea
            // como una fila rota entre tres editables.
            const fixable = row.currency !== "VES";

            return (
              <div key={row.currency} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-xs text-muted-foreground">
                    {priceRowLabel(row.currency, row.origin)}
                  </span>
                  <span className="truncate text-sm tabular-nums">
                    {/* Un hueco se dice, no se omite: «no tenemos el precio
                        del USDT ahora» se lee distinto a una moneda que no
                        aparece. */}
                    {row.amount == null ? "—" : formatPriceAmount(row.amount, row.currency)}
                  </span>
                </div>

                {fixable ? (
                  <div className="flex shrink-0 items-center gap-1">
                    {pinned ? null : (
                      <Input
                        inputMode="decimal"
                        value={draft[row.currency] ?? ""}
                        onChange={(e) => setDraft({ ...draft, [row.currency]: e.target.value })}
                        placeholder="Fijar"
                        className="h-10 w-24"
                        aria-label={`Fijar el precio en ${row.currency}`}
                      />
                    )}
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      disabled={disabled}
                      aria-label={
                        pinned
                          ? `Volver a calcular el precio en ${row.currency}`
                          : `Fijar el precio en ${row.currency}`
                      }
                      onClick={() => {
                        // Sin producto todavia: solo estado local, y la ficha
                        // lo escribe al guardar.
                        if (productId == null) {
                          const next = { ...pending };
                          if (pinned) delete next[row.currency];
                          else next[row.currency] = draft[row.currency] ?? "";
                          onPendingChange(next);
                          setDraft({ ...draft, [row.currency]: "" });
                          return;
                        }
                        startTransition(async () => {
                          const r = pinned
                            ? await unpinPrice(productId, tier, row.currency)
                            : await pinPrice(
                                productId,
                                tier,
                                row.currency,
                                draft[row.currency] ?? "",
                              );
                          if (r.error) {
                            toast.error(r.error);
                            return;
                          }
                          setDraft({ ...draft, [row.currency]: "" });
                          router.refresh();
                        });
                      }}
                    >
                      {pinned ? <Lock className="size-4" /> : <Unlock className="size-4" />}
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })
      )}

      {rows ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {/* NO dice «dólar»: esa fila es el precio y no lleva candado. Lo
              decía, y era una frase que describe un control que no está —
              encontrado mirando la pantalla el 2026-10-10. */}
          Las equivalencias se calculan con la tasa del día. Puedes fijar la de euro o la de
          USDT; la de bolívares no, porque la tasa se mueve y ese número dejaría de cuadrar con
          los demás al día siguiente.
        </p>
      ) : null}
    </div>
  );
}

function PriceField({
  label,
  value,
  onChange,
  disabled,
  inputId,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled: boolean;
  inputId: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label htmlFor={inputId} className="shrink-0 text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      <Input
        id={inputId}
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="00.00"
        disabled={disabled}
        className="h-10 w-36 text-right tabular-nums"
      />
    </div>
  );
}
