"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  type BolivarRates,
  type PriceCurrency,
  type PriceTier,
} from "@/lib/products/price";
import {
  createProduct,
  updateProduct,
  pinPrice,
  unpinPrice,
  trashProduct,
} from "@/app/(app)/productos/actions";
import type { ProductRow } from "@/lib/products/catalog";

// LA FICHA DE PRODUCTO, en sus dos modos.
//
// ─────────────────────────────────────────────────────────────────────────
// CREAR PIDE CUATRO COSAS; EDITAR LAS ENSEÑA TODAS
//
// Al crear: nombre, unidad, qué precio es (detal o mayor) y el precio. Nada
// más, y la unidad ni siquiera es obligatoria.
//
// No es minimalismo: los dos tenderos entrevistados el 2026-10-09 dijeron que
// NO llevan inventario. Una ficha que pide ocho campos no se llena dos veces,
// y este mismo formulario es el que va a aparecer dentro de un fiado cuando el
// producto no exista todavía (decisión 11 del dueño). Si aquí hubiera más
// campos, ese atajo sería imposible.
//
// Costo y margen son complementarios a propósito. Un producto que nace dentro
// de un fiado lleva precio y no lleva costo — y eso está bien: la señal útil no
// es «te falta cargar esto», es «de este producto todavía no sabemos la
// ganancia», que solo importa el día que quiera verla.
export function CatalogProductDialog({
  open,
  onOpenChange,
  product,
  rates,
  defaultCurrency,
  overrides,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // null = crear uno nuevo.
  product: ProductRow | null;
  // null para un negocio colombiano: no hay equivalencias que enseñar.
  rates: BolivarRates | null;
  defaultCurrency: PriceCurrency;
  overrides: Record<PriceTier, Partial<Record<PriceCurrency, number>>>;
}) {
  const router = useRouter();
  const [saving, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const editing = product != null;

  const [name, setName] = useState(product?.name ?? "");
  const [unit, setUnit] = useState(product?.unit ?? "");
  const [tier, setTier] = useState<PriceTier>(
    product?.price_wholesale != null && product?.price_retail == null ? "wholesale" : "retail",
  );
  const [priceRetail, setPriceRetail] = useState(product?.price_retail?.toString() ?? "");
  const [priceWholesale, setPriceWholesale] = useState(product?.price_wholesale?.toString() ?? "");
  const [cost, setCost] = useState(product?.cost?.toString() ?? "");
  const [marginPct, setMarginPct] = useState(product?.margin_pct?.toString() ?? "");

  // El precio que se escribe al CREAR. En edición hay dos campos separados, así
  // que este solo manda en el modo nuevo.
  const [newPrice, setNewPrice] = useState("");

  const toNumber = (v: string) => {
    const n = Number(v.trim().replace(/\./g, "").replace(",", "."));
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const costNumber = toNumber(cost);
  const marginNumber = marginPct.trim() === "" ? null : Number(marginPct.replace(",", "."));

  // SUGIERE, NO ESCRIBE. Decidido el 2026-10-09: si el tendero tecleó un
  // precio, ese es el precio. Costo y margen proponen uno y calculan la
  // ganancia, pero no le reescriben por detrás un número que puso a mano —
  // eso es lo mismo que ignorar un candado.
  const suggestion =
    costNumber != null && marginNumber != null && marginNumber >= 0
      ? suggestedPrice(costNumber, marginNumber)
      : null;

  const activePrice = editing ? toNumber(tier === "retail" ? priceRetail : priceWholesale) : toNumber(newPrice);
  const realMargin = activePrice != null ? marginFromPrice(costNumber, activePrice) : null;

  function save() {
    setError(null);
    startTransition(async () => {
      const result = editing
        ? await updateProduct(product!.id, {
            name,
            unit,
            priceRetail: priceRetail || null,
            priceWholesale: priceWholesale || null,
            cost: cost || null,
            marginPct: marginPct || null,
          })
        : await createProduct({
            name,
            unit,
            baseCurrency: defaultCurrency,
            tier,
            price: newPrice,
            cost: cost || null,
            marginPct: marginPct || null,
          });

      if (result.error) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      router.refresh();
      toast.success(editing ? "Producto actualizado." : "Producto agregado.");
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Editar producto" : "Agregar producto"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Lo que cambies aquí se usa la próxima vez que lo vendas o lo fíes."
              : "Con el nombre y un precio basta. Lo demás lo puedes completar después."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="producto_nombre">Nombre</Label>
            <Input
              id="producto_nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bulto de jabón"
              autoFocus={!editing}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="producto_unidad">Unidad (opcional)</Label>
            <Input
              id="producto_unidad"
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="unidad, docena, bulto, kilo"
            />
            {/* Dicho aquí y no descubierto después: la V1 no convierte entre
                unidades. Quien compre por docena y venda por unidad tiene que
                elegir en cuál cuenta. Ver CT-51. */}
            <p className="text-xs text-muted-foreground">
              El inventario se cuenta en esta unidad. Por ahora no convertimos entre unidades.
            </p>
          </div>

          {editing ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="producto_detal">Precio al detal</Label>
                <Input
                  id="producto_detal"
                  inputMode="decimal"
                  value={priceRetail}
                  onChange={(e) => setPriceRetail(e.target.value)}
                  placeholder="—"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="producto_mayor">Precio al mayor</Label>
                <Input
                  id="producto_mayor"
                  inputMode="decimal"
                  value={priceWholesale}
                  onChange={(e) => setPriceWholesale(e.target.value)}
                  placeholder="—"
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label>Este precio es</Label>
              {/* Dos chips y no un desplegable: son dos opciones y la decisión
                  tiene que caber en un toque. Misma forma que `TipoButtons`. */}
              <div className="grid grid-cols-2 gap-2">
                {(["retail", "wholesale"] as PriceTier[]).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    variant={tier === t ? "default" : "outline"}
                    onClick={() => setTier(t)}
                  >
                    {t === "retail" ? "Al detal" : "Al mayor"}
                  </Button>
                ))}
              </div>
              <Input
                id="producto_precio"
                inputMode="decimal"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                placeholder="12,00"
                className="mt-1"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="producto_costo">Costo (opcional)</Label>
              <Input
                id="producto_costo"
                inputMode="decimal"
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="—"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="producto_margen">Margen %</Label>
              <Input
                id="producto_margen"
                inputMode="decimal"
                value={marginPct}
                onChange={(e) => setMarginPct(e.target.value)}
                placeholder="30"
              />
            </div>
          </div>

          {suggestion != null ? (
            <p className="text-xs text-muted-foreground">
              Con ese costo y ese margen, el precio sería{" "}
              <strong className="text-foreground">
                {formatPriceAmount(suggestion, product?.base_currency ?? defaultCurrency)}
              </strong>
              . Lo decides tú: no se cambia solo.
            </p>
          ) : null}
          {realMargin != null ? (
            <p className="text-xs text-muted-foreground">
              Al precio que tiene ahora, tu ganancia es del{" "}
              <strong className="text-foreground">{formatPercent(realMargin)}</strong>.
            </p>
          ) : null}
          {editing && costNumber == null ? (
            <p className="text-xs text-muted-foreground">
              Sin costo no podemos decirte la ganancia de este producto.
            </p>
          ) : null}

          {editing && rates ? (
            <EquivalenceRows
              productId={product!.id}
              tier={tier}
              onTierChange={setTier}
              basePrice={activePrice}
              baseCurrency={product!.base_currency}
              rates={rates}
              overrides={overrides}
              disabled={saving}
            />
          ) : null}

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
            ) : (
              "Guardar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
function EquivalenceRows({
  productId,
  tier,
  onTierChange,
  basePrice,
  baseCurrency,
  rates,
  overrides,
  disabled,
}: {
  productId: string;
  tier: PriceTier;
  onTierChange: (t: PriceTier) => void;
  basePrice: number | null;
  baseCurrency: PriceCurrency;
  rates: BolivarRates;
  overrides: Record<PriceTier, Partial<Record<PriceCurrency, number>>>;
  disabled: boolean;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [draft, setDraft] = useState<Record<string, string>>({});

  if (basePrice == null) {
    return (
      <p className="text-xs text-muted-foreground">
        Escribe un precio para ver las equivalencias en otras monedas.
      </p>
    );
  }

  const rows = allPrices({ amount: basePrice, currency: baseCurrency }, rates, overrides[tier]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-sm">Equivalencias</Label>
        <div className="flex gap-1">
          {(["retail", "wholesale"] as PriceTier[]).map((t) => (
            <Button
              key={t}
              type="button"
              size="sm"
              variant={tier === t ? "secondary" : "ghost"}
              onClick={() => onTierChange(t)}
            >
              {t === "retail" ? "Detal" : "Mayor"}
            </Button>
          ))}
        </div>
      </div>

      {rows.map((row) => {
        const key = `${tier}:${row.currency}`;
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
                    value={draft[key] ?? ""}
                    onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
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
                  onClick={() =>
                    startTransition(async () => {
                      const r = pinned
                        ? await unpinPrice(productId, tier, row.currency)
                        : await pinPrice(productId, tier, row.currency, draft[key] ?? "");
                      if (r.error) {
                        toast.error(r.error);
                        return;
                      }
                      setDraft({ ...draft, [key]: "" });
                      router.refresh();
                    })
                  }
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
