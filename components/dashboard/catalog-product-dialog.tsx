"use client";

import { useState, useTransition, type Dispatch, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Minus, Plus, Sparkles, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

// LA FICHA DE PRODUCTO, segun el frame 1175:5881.
//
// ─────────────────────────────────────────────────────────────────────────
// EL MARGEN NO SE GUARDA APARTE DEL PRECIO: SE DERIVA DE EL
//
// Esta es la decision de diseño que sostiene toda la pantalla. El frame enseña
// «Costo», «Margen al mayor» y «Margen al detal» como tres campos, y la
// tentacion es guardar los tres y que el precio salga de ellos. Con eso, el dia
// que alguien teclee un precio a mano, el margen guardado pasa a describir otro
// numero — y no hay forma de saber cual de los dos miente.
//
// Aqui la unica verdad son el COSTO y el PRECIO. El margen es el resultado:
//
//   - elegir un margen en el desplegable ESCRIBE el precio,
//   - editar el precio RECALCULA el margen,
//   - y lo que se guarda en `margin_*_pct` es siempre el margen de ese precio.
//
// Asi los dos no pueden contradecirse, porque solo hay uno.
//
// ─────────────────────────────────────────────────────────────────────────
// EL COSTO ES OPCIONAL — DECISION DEL DUEÑO, 2026-10-09
//
// Se le advirtio que una ficha que calcula desde el costo deja medio
// formulario muerto cuando el costo esta vacio, y lo decidio asi igualmente:
// exigirlo mataria el alta rapida dentro de un fiado (decision 11), que es el
// camino por el que esta tabla se va a llenar de verdad.
//
// Lo que esta pantalla hace con eso, para que no haya un hueco mudo: el
// desplegable del margen se inhabilita **diciendo por que**, y el precio se
// teclea directo. Nunca hay un control apagado sin explicacion.
//
// ─────────────────────────────────────────────────────────────────────────
// LA UNIDAD SIGUE SIENDO TEXTO EN LA BASE, aunque aqui sea un desplegable: ver
// lib/products/options.ts. "Otro" tiene que poder escribir su propia palabra.
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

  // La unidad llega del frame como lista cerrada mas "Otro". Si lo que hay
  // guardado no esta en la lista —un producto viejo, o uno creado con "Otro"—
  // el formulario abre YA en "Otro" con su texto, en vez de perderlo
  // silenciosamente al guardar.
  const storedUnit = product?.unit ?? "";
  const unitIsPreset = (UNIT_OPTIONS as readonly string[]).includes(storedUnit);
  const [unitChoice, setUnitChoice] = useState<string>(
    storedUnit === "" ? "" : unitIsPreset ? storedUnit : "Otro",
  );
  const [unitOther, setUnitOther] = useState(unitIsPreset ? "" : storedUnit);
  const unit = unitChoice === "Otro" ? unitOther : unitChoice;

  const [stock, setStock] = useState(formatAmountForInput(product?.stock_opening));
  const [cost, setCost] = useState(formatAmountForInput(product?.cost));
  const [priceRetail, setPriceRetail] = useState(formatAmountForInput(product?.price_retail));
  const [priceWholesale, setPriceWholesale] = useState(
    formatAmountForInput(product?.price_wholesale),
  );
  const [published, setPublished] = useState(product?.published ?? false);
  const [photoPath, setPhotoPath] = useState<string | null>(product?.photo_path ?? null);
  const [description, setDescription] = useState(product?.description ?? "");

  // Los dos interruptores de «Agregar precio por moneda». Abren si ese escalon
  // ya tiene algun precio fijado a mano: un candado cerrado que no se ve es un
  // precio que el tendero no sabe que tiene.
  const [byCurrencyWholesale, setByCurrencyWholesale] = useState(
    Object.keys(overrides.wholesale).length > 0,
  );
  const [byCurrencyRetail, setByCurrencyRetail] = useState(
    Object.keys(overrides.retail).length > 0,
  );

  // Lo que se fija a mano ANTES de que el producto exista. En edicion cada
  // candado escribe en la base al instante; al crear no hay fila donde
  // escribir, asi que se guarda aqui y se persiste justo despues del insert.
  const [pendingPins, setPendingPins] = useState<
    Record<PriceTier, Partial<Record<PriceCurrency, string>>>
  >({ retail: {}, wholesale: {} });

  // `parseAmount` y no un parser propio: el que vivía aquí quitaba los puntos
  // como separadores de miles y convertía el "11.5" que devuelve la base en
  // 115. Ver su comentario en lib/products/price.ts — hay una sola copia a
  // propósito.
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

  const input: ProductInput = {
    name,
    unit: unit || null,
    priceRetail: priceRetail || null,
    priceWholesale: priceWholesale || null,
    cost: cost || null,
    // Derivados, nunca tecleados. Ver la cabecera.
    marginRetailPct: marginOf(priceRetail)?.toString() ?? null,
    marginWholesalePct: marginOf(priceWholesale)?.toString() ?? null,
    stockOpening: stock || null,
    published,
    photoPath,
    description: description || null,
  };

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
              placeholder="Bulto de jabón"
              autoFocus={!editing}
            />
          </div>

          {/* ── Unidad ──────────────────────────────────────────────────── */}
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

          {/* ── Cantidad ────────────────────────────────────────────────── */}
          <QuantityStepper value={stock} onChange={setStock} unit={unit || null} />

          {/* ── Costo ───────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="producto_costo">Costo (opcional)</Label>
            <Input
              id="producto_costo"
              inputMode="decimal"
              value={cost}
              onChange={(e) => setCost(e.target.value)}
              placeholder="—"
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Lo que te costó a ti. Con esto calculamos el precio desde el margen y te decimos tu
              ganancia.
            </p>
          </div>

          {/* ── Los dos escalones ──────────────────────────────────────── */}
          <TierRow
            tier="wholesale"
            label="Margen al mayor"
            price={priceWholesale}
            onPriceChange={setPriceWholesale}
            cost={costNumber}
            baseCurrency={baseCurrency}
            byCurrency={byCurrencyWholesale}
            onByCurrencyChange={setByCurrencyWholesale}
            rates={rates}
            productId={product?.id ?? null}
            overrides={overrides.wholesale}
            pending={pendingPins.wholesale}
            onPendingChange={(next) => setPendingPins((p) => ({ ...p, wholesale: next }))}
            disabled={saving}
          />

          <TierRow
            tier="retail"
            label="Margen al detal"
            price={priceRetail}
            onPriceChange={setPriceRetail}
            cost={costNumber}
            baseCurrency={baseCurrency}
            byCurrency={byCurrencyRetail}
            onByCurrencyChange={setByCurrencyRetail}
            rates={rates}
            productId={product?.id ?? null}
            overrides={overrides.retail}
            pending={pendingPins.retail}
            onPendingChange={(next) => setPendingPins((p) => ({ ...p, retail: next }))}
            disabled={saving}
          />

          {/* ── Publicar ───────────────────────────────────────────────── */}
          <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
            <div className="flex min-w-0 flex-col gap-1">
              <Label htmlFor="producto_publicar">Publicar en catálogo</Label>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Lo ve cualquiera que abra el enlace de tu catálogo, con su foto y su precio al
                detal.
              </p>
            </div>
            <Switch
              id="producto_publicar"
              checked={published}
              onCheckedChange={setPublished}
              disabled={saving}
            />
          </div>

          {/* ── Foto ───────────────────────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <Label>Foto</Label>
            <ProductPhotoInput
              ownerId={ownerId}
              value={photoPath}
              onChange={setPhotoPath}
              disabled={saving}
            />
          </div>

          {/* ── Descripción ────────────────────────────────────────────── */}
          <div className="flex flex-col gap-2">
            <Label htmlFor="producto_descripcion">Descripción (opcional)</Label>
            <Textarea
              id="producto_descripcion"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Marca, tamaño, color... lo que ayude a reconocerlo."
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

// LA TARJETA DE LA FOTO CON IA, QUE TODAVIA NO HACE NADA.
//
// El frame la pide con una nota: «de momento mostrar mensaje que será una
// próxima actualización». Se pinta, entonces, y al tocarla lo dice.
//
// Un control decorativo es una deuda, asi que lleva su propio limite escrito:
// es UNO, y es el unico de esta pantalla. El boton "Compartir" del catalogo,
// que tambien podria haber salido asi, se construyo de verdad — porque dos
// cosas que no funcionan en la misma pantalla dejan de leerse como «viene
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
// ─────────────────────────────────────────────────────────────────────────
// Y DICE QUE TODAVIA NO SE MUEVE SOLO, porque si no, miente.
//
// Decision del dueño el 2026-10-09: el campo entra ahora y la maquina de
// eventos despues. Asi que fiar o vender NO descuenta de aqui. Un numero que
// no baja parece un inventario llevado al dia hasta el dia que alguien lo
// compara con el estante — y ese dia se deja de confiar en la pantalla entera,
// no solo en este campo.
//
// La frase de abajo es lo que compra esa confianza por adelantado. Sale cuando
// hay una cantidad escrita, no siempre: a quien deja el campo vacio no hay
// nada que advertirle.
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
  // seguidos al «+» dejaban la cantidad en 1**, no en 3.
  //
  // El motivo es que React agrupa las actualizaciones de un mismo lote: los
  // tres manejadores corren antes de que ninguno vuelva a renderizar, asi que
  // los tres leen el MISMO `value` del render viejo y los tres calculan
  // 0 + 1. Dos de los tres toques se pierden.
  //
  // Con toques lentos no se nota, porque cada uno alcanza a renderizar — por
  // eso es la clase de fallo que pasa una revision y aparece en un telefono
  // barato, o con el doble toque que cualquiera le da a un contador. Leyendo
  // `prev` dentro del propio actualizador, cada uno ve el resultado del
  // anterior y los tres cuentan.
  const step = (delta: number) =>
    onChange((prev) => {
      const n = Number(String(prev).replace(",", ".")) || 0;
      return String(Math.max(0, n + delta));
    });

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="producto_cantidad">Cantidad</Label>
      <div className="flex items-center gap-2">
        {/* 40px, que es el minimo del DESIGN-SYSTEM para un control con
            etiqueta. Un boton de 32 junto a un campo de 40 tambien se ve raro
            alineado. */}
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

// UN ESCALON: SU MARGEN, SU PRECIO Y SUS MONEDAS.
//
// El desplegable del margen y el campo del precio son el MISMO dato visto de
// dos formas, y el costo es el que los une:
//
//   - elegir margen   →  precio = costo × (1 + margen)
//   - escribir precio →  el desplegable pasa a enseñar ese margen, o "Otro"
//
// Sin costo no hay margen que calcular, asi que el desplegable se inhabilita
// Y LO DICE. Esa frase es la unica razon por la que un control apagado aqui no
// es un error de la pantalla.
function TierRow({
  tier,
  label,
  price,
  onPriceChange,
  cost,
  baseCurrency,
  byCurrency,
  onByCurrencyChange,
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
  cost: number | null;
  baseCurrency: PriceCurrency;
  byCurrency: boolean;
  onByCurrencyChange: (next: boolean) => void;
  rates: BolivarRates | null;
  productId: string | null;
  overrides: Partial<Record<PriceCurrency, number>>;
  pending: Partial<Record<PriceCurrency, string>>;
  onPendingChange: (next: Partial<Record<PriceCurrency, string>>) => void;
  disabled: boolean;
}) {
  const priceNumber = (() => {
    const n = parseAmount(price);
    return n != null && n > 0 ? n : null;
  })();

  const margin = priceNumber != null ? marginFromPrice(cost, priceNumber) : null;

  // El desplegable enseña el preset exacto si el margen cae en uno, y "otro"
  // en cualquier otro caso. No se redondea para que encaje: un 29,7 % que se
  // enseñara como 30 % haria pensar que el precio es otro.
  const presetValue =
    margin != null && (MARGIN_PRESETS as readonly number[]).includes(margin)
      ? String(margin)
      : margin != null
        ? "otro"
        : "";

  const currencyLabel = tier === "wholesale" ? "al mayor" : "al detal";

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor={`margen_${tier}`}>{label}</Label>
          <Select
            value={presetValue}
            disabled={disabled || cost == null}
            onValueChange={(v) => {
              if (v === "otro") return;
              const next = suggestedPrice(cost!, Number(v));
              if (next != null) onPriceChange(formatAmountForInput(next));
            }}
          >
            <SelectTrigger id={`margen_${tier}`} className="w-full">
              <SelectValue placeholder={cost == null ? "—" : "Elige"} />
            </SelectTrigger>
            <SelectContent>
              {MARGIN_PRESETS.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {formatPercent(m)}
                </SelectItem>
              ))}
              {/* Se enseña y no se elige: "Otro" es lo que PASA cuando el
                  precio se teclea a mano, no una opcion que haga nada. */}
              <SelectItem value="otro" disabled>
                Otro (escribe el precio)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor={`precio_${tier}`}>Precio {currencyLabel}</Label>
          <Input
            id={`precio_${tier}`}
            inputMode="decimal"
            value={price}
            onChange={(e) => onPriceChange(e.target.value)}
            placeholder="—"
            disabled={disabled}
          />
        </div>
      </div>

      {cost == null ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Pon el costo arriba y elegimos el precio desde el margen. Sin costo, escribe tú el
          precio.
        </p>
      ) : margin != null && margin < 0 ? (
        /* UNA PERDIDA SE LLAMA PERDIDA.
           Encontrado probando la ficha el 2026-10-10: con costo 10 y precio 9
           la linea decia «tu ganancia es del -10 %», que es una contradiccion
           —una ganancia negativa— y en una pantalla de dinero se lee como un
           fallo de cuentas, no como un aviso. Quien se equivoque de tecla no
           recibia ninguna alarma.

           NO se bloquea: vender bajo costo es un caso real y corriente
           —liquidacion, mercancia por vencer, una promocion para mover stock
           parado— y la migracion 084 deja de prohibirlo por eso mismo. Lo que
           hace falta es que se vea, no que se impida. */
        <p className="text-xs leading-relaxed text-destructive">
          A ese precio vendes <strong>por debajo de lo que te costó</strong>: pierdes{" "}
          {formatPercent(Math.abs(margin))}.
        </p>
      ) : margin != null ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          A ese precio tu ganancia es del{" "}
          <strong className="text-foreground">{formatPercent(margin)}</strong>.
        </p>
      ) : null}

      {/* El interruptor por moneda. Solo existe donde hay tasas: un negocio
          colombiano cobra en pesos y no tiene ninguna. */}
      {rates ? (
        <>
          <div className="flex items-center justify-between gap-4 border-t pt-3">
            <Label htmlFor={`moneda_${tier}`} className="text-sm font-normal">
              Agregar precio {currencyLabel} por moneda
            </Label>
            <Switch
              id={`moneda_${tier}`}
              checked={byCurrency}
              onCheckedChange={onByCurrencyChange}
              disabled={disabled}
            />
          </div>
          {byCurrency ? (
            <EquivalenceRows
              tier={tier}
              productId={productId}
              basePrice={priceNumber}
              baseCurrency={baseCurrency}
              rates={rates}
              overrides={overrides}
              pending={pending}
              onPendingChange={onPendingChange}
              disabled={disabled}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

// LAS EQUIVALENCIAS, CON SU CANDADO.
//
// Cada moneda se enseña calculada y se puede fijar. Cerrar el candado inserta
// una fila; abrirlo la borra — no hay un booleano «está fijado» que pueda
// quedar desincronizado del valor, porque un precio calculado no se guarda en
// ningún sitio: se calcula.
//
// LA PALABRA ES «EQUIVALENCIA» Y NO «PRECIO», y eso lo decide `priceRowLabel`.
// Con el BCV a 160 y el USDT a 200, un producto de $12 enseña 9,60 USDT: es
// correcto y se lee como un error, porque en la cabeza de cualquiera un USDT
// es un dólar. La palabra es lo que lo arregla.
//
// ─────────────────────────────────────────────────────────────────────────
// Y FUNCIONA ANTES DE QUE EL PRODUCTO EXISTA
//
// Al crear no hay fila donde escribir un override, asi que el candado guarda
// en `pending` y la ficha lo persiste tras el insert. La alternativa —esconder
// los candados hasta el segundo guardado— obligaba a abrir el producto otra
// vez para hacer lo que el frame pide en la pantalla de creacion.
function EquivalenceRows({
  tier,
  productId,
  basePrice,
  baseCurrency,
  rates,
  overrides,
  pending,
  onPendingChange,
  disabled,
}: {
  tier: PriceTier;
  // null mientras el producto no existe.
  productId: string | null;
  basePrice: number | null;
  baseCurrency: PriceCurrency;
  rates: BolivarRates;
  overrides: Partial<Record<PriceCurrency, number>>;
  pending: Partial<Record<PriceCurrency, string>>;
  onPendingChange: (next: Partial<Record<PriceCurrency, string>>) => void;
  disabled: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [draft, setDraft] = useState<Partial<Record<PriceCurrency, string>>>({});

  if (basePrice == null) {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        Escribe un precio arriba para ver las equivalencias en otras monedas.
      </p>
    );
  }

  // Los fijados de la base MAS los que se acaban de fijar sin guardar todavia.
  // Los locales mandan: son los mas recientes.
  const effective: Partial<Record<PriceCurrency, number>> = { ...overrides };
  for (const [currency, amount] of Object.entries(pending)) {
    const n = parseAmount(amount);
    if (n != null && n > 0) effective[currency as PriceCurrency] = n;
  }

  const rows = allPrices({ amount: basePrice, currency: baseCurrency }, rates, effective);

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => {
        const pinned = row.origin === "manual";
        const isBase = row.origin === "base";
        return (
          <div key={row.currency} className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-xs text-muted-foreground">
                {priceRowLabel(row.currency, row.origin)}
              </span>
              <span className="truncate text-sm tabular-nums">
                {/* Un hueco se dice, no se omite: «no tenemos el precio del
                    USDT ahora» se lee distinto a una moneda que no aparece. */}
                {row.amount == null ? "—" : formatPriceAmount(row.amount, row.currency)}
              </span>
            </div>

            {/* La moneda base no lleva candado: es el precio, no una
                equivalencia de nada. */}
            {isBase ? null : (
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
                  disabled={disabled || busy}
                  aria-label={
                    pinned
                      ? `Volver a calcular el precio en ${row.currency}`
                      : `Fijar el precio en ${row.currency}`
                  }
                  onClick={() => {
                    // Sin producto todavia: solo estado local, y la ficha lo
                    // escribe al guardar.
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
                        : await pinPrice(productId, tier, row.currency, draft[row.currency] ?? "");
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
            )}
          </div>
        );
      })}

      <p className="text-xs leading-relaxed text-muted-foreground">
        Las equivalencias se calculan con la tasa del día. Si fijas una, se queda como la dejaste
        hasta que vuelvas a abrir el candado.
      </p>
    </div>
  );
}
