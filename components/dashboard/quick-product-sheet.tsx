"use client";

import { useState, useTransition } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { ProductPhotoInput } from "@/components/dashboard/product-photo-input";
import { createProduct } from "@/app/(app)/productos/actions";
import { currencyName, formatPriceAmount, parseAmount, type PriceCurrency } from "@/lib/products/price";

// REGISTRAR UN PRODUCTO SIN SALIR DE LA VENTA — frame `1389:9169`, 2026-10-18.
//
// ===========================================================================
// ES UN FORMULARIO SINTETIZADO, Y ESO ES LA DECISIÓN, NO UN ATAJO
//
// La ficha completa del catálogo (`CatalogProductDialog`) pide escalón al
// detal y al mayor, monedas activas por escalón, precios fijados a mano, costo
// con su moneda, margen, proveedor, stock inicial y mínimo de mayoreo. Todo
// eso existe porque el catálogo lo necesita.
//
// Aquí el tendero tiene un cliente delante y un producto en la mano que no
// está apuntado. Pedirle veinte campos en ese momento es garantizar que no lo
// apunte. El frame pide seis —nombre, precio, moneda, cuántas, publicar,
// foto— y una descripción opcional.
//
// LO QUE NO SE PREGUNTA SE GUARDA VACÍO, NO INVENTADO: sin costo no hay
// margen, sin mayoreo no hay mínimo. El producto queda a medias a propósito y
// se puede completar después desde el catálogo, que es donde esos campos
// tienen sentido.
//
// ===========================================================================
// Y CREA **Y** AGREGA, en un solo botón
//
// «Agregar $00.00» es lo que dice el frame, y describe las dos cosas: el
// producto nace en el catálogo y entra en el carrito con la cantidad elegida.
// Separarlo en «Guardar» y luego buscarlo en la cuadrícula sería devolverle al
// tendero el trabajo que esta hoja existe para quitarle.
export function QuickProductSheet({
  open,
  onOpenChange,
  ownerId,
  monedas,
  onCreado,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerId: string;
  // Las monedas en las que este negocio puede cobrar. La primera viene puesta.
  // Vienen del catálogo ya cargado — las mismas que ofrece el carrito.
  monedas: PriceCurrency[];
  // El producto recién creado y cuántas unidades van al carrito. La pantalla
  // de venta se encarga de recargar la cuadrícula y de meterlo.
  onCreado: (productId: string, cantidad: number) => void;
}) {
  const [nombre, setNombre] = useState("");
  const [precio, setPrecio] = useState("");
  const [moneda, setMoneda] = useState<PriceCurrency>(monedas[0] ?? "USD");
  // LA CANTIDAD ES UNA CADENA, NO UN NÚMERO, y por eso el campo se puede
  // escribir. Era `useState(1)` pintado en un `<span>` hasta el 2026-10-19:
  // solo se podía mover con los botones «−» y «+», así que poner 24 eran
  // veintitrés toques. Lo pidió el dueño con una captura del campo.
  //
  // CON UN `number` EN EL ESTADO NO SE PUEDE TECLEAR: para escribir «10» hay
  // que pasar por el instante en que el campo está vacío, y un estado numérico
  // no sabe representar «vacío» — o lo convierte en 0 y el cursor salta, o
  // rechaza la pulsación. Guardar el texto y parsearlo al leerlo es el mismo
  // patrón que ya usa `components/public/product-detail.tsx`, que es la otra
  // pantalla donde se elige una cantidad.
  const [cantidad, setCantidad] = useState("1");
  const [publicar, setPublicar] = useState(true);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();

  const unitario = parseAmount(precio) ?? 0;
  // La coma como separador decimal, igual que en la ficha pública: un tendero
  // venezolano escribe «2,5» antes que «2.5».
  const unidades = Number(cantidad.replace(",", ".")) || 0;
  const total = Math.round(unitario * unidades * 100) / 100;
  // `unidades > 0` ENTRA EN EL GUARDIA desde que el campo se puede escribir.
  // Antes el estado era un número que nunca bajaba de 1, así que no hacía
  // falta; ahora el tendero puede dejarlo vacío o en 0 mientras teclea, y sin
  // esto el botón ofrecería guardar un producto de cero unidades.
  const listo = nombre.trim() !== "" && unitario > 0 && unidades > 0;

  // Los botones «−» y «+» siguen funcionando igual y respetan lo tecleado:
  // leen lo que hay, suman o restan uno, y no bajan de 1.
  const paso = (delta: number) =>
    setCantidad((prev) => {
      const actual = Number(String(prev).replace(",", ".")) || 0;
      return String(Math.max(1, actual + delta));
    });

  function guardar() {
    setError(null);
    startTransition(async () => {
      const r = await createProduct({
        name: nombre.trim(),
        unit: null,
        // UNA SOLA MONEDA, Y LA MISMA EN LOS DOS ESCALONES.
        //
        // ESTO ESTABA ROTO Y NO FUNCIONÓ NI UNA VEZ. La primera versión mandaba
        // el mayoreo VACÍO, razonando que no se había preguntado y que un
        // escalón inventado haría que el carrito cobrara otro precio al subir
        // la cantidad. El razonamiento era bueno y la consecuencia no se
        // comprobó: `createProduct` exige al menos una moneda POR ESCALÓN, así
        // que toda alta desde esta hoja moría con «Deja al menos una moneda en
        // el precio al mayor» — un mensaje sobre un campo que esta pantalla ni
        // siquiera enseña. Lo reportó el dueño el 2026-10-18 con una captura.
        //
        // LA MONEDA NO ES UN PRECIO. `priceWholesale` sigue siendo `null`, y
        // `armarProductos` devuelve bloque nulo para todo escalón sin precio
        // — así que el carrito nunca puede elegir el mayoreo y el temor de la
        // primera versión no se cumple. Lo único que esto rellena es
        // `base_currency_wholesale`, que la tabla exige NOT NULL desde la
        // migración 114.
        //
        // Y NO ES UN ESTADO NUEVO: en dev hay cinco productos así —moneda de
        // mayoreo puesta, precio nulo— creados desde el diálogo del catálogo,
        // que es como se comprobó que esta forma ya vive y funciona.
        activeCurrenciesRetail: [moneda],
        activeCurrenciesWholesale: [moneda],
        priceRetail: precio,
        priceWholesale: null,
        fixedRetail: {},
        fixedWholesale: {},
        cost: null,
        costCurrency: null,
        costCurrencyOther: null,
        marginRetailPct: null,
        marginWholesalePct: null,
        stockOpening: null,
        supplier: null,
        wholesaleMinQuantity: null,
        publishedRetail: publicar,
        // PUBLICAR ES UNA SOLA CASILLA EN EL FRAME, y se aplica al detal. El
        // mayor no se publica porque no se creó: publicar un escalón sin
        // precio dejaría al cliente viendo un producto que no puede pedir.
        publishedWholesale: false,
        photoPath,
        description: descripcion.trim() || null,
      });
      if (r.error || !r.id) {
        setError(r.error ?? "No pudimos guardar el producto. Intenta de nuevo.");
        return;
      }
      onCreado(r.id, unidades);
      onOpenChange(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* `dvh` y no `vh`: en un teléfono con la barra del navegador a la vista,
          `vh` mide el viewport grande. Y `overflow-y-auto` porque esta hoja
          tiene siete campos y a 375px no caben sin desplazar. */}
      <SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle className="text-xl font-medium">Registrar producto</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor="qp-nombre">Nombre del producto</Label>
            <Input
              id="qp-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Escribe nombre"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="qp-precio">Precio unitario</Label>
            <div className="flex items-start gap-1">
              <Input
                id="qp-precio"
                className="min-w-0 flex-1"
                inputMode="decimal"
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
                placeholder="00"
              />
              {/* UN `select` NATIVO Y NO UNA LISTA PROPIA: en un teléfono abre
                  la rueda del sistema, que se usa con una mano y no hay que
                  construirla. Es lo mismo que hace el carrito con su
                  «Cambiar».

                  `text-base` Y NO MENOS: por debajo de 16px, Safari en iPhone
                  hace zoom al enfocar y deja la pantalla corrida. */}
              <div className="flex h-9 shrink-0 items-center gap-2 rounded-md border px-2">
                <CurrencyFlagIcon currency={moneda} className="size-4" />
                <select
                  aria-label="Moneda del precio"
                  value={moneda}
                  onChange={(e) => setMoneda(e.target.value as PriceCurrency)}
                  className="bg-transparent text-base outline-none"
                >
                  {monedas.map((c) => (
                    <option key={c} value={c}>
                      {currencyName(c)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label>¿Cuántas unidades compra?</Label>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-10 shrink-0"
                aria-label="Quitar una unidad"
                disabled={unidades <= 1}
                onClick={() => paso(-1)}
              >
                <Minus className="size-4" aria-hidden="true" />
              </Button>
              {/* `inputMode="decimal"` Y NO `type="number"`: el teclado del
                  teléfono sale numérico igual, y se evitan las dos cosas que
                  `number` trae de serie y aquí estorban — la rueda del ratón
                  cambiando la cifra sin querer, y un navegador que rechaza la
                  coma decimal que el tendero sí escribe. */}
              <input
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
                inputMode="decimal"
                aria-label="Cantidad"
                className="flex h-10 min-w-0 flex-1 items-center justify-center rounded-md border bg-transparent text-center text-base tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-10 shrink-0"
                aria-label="Agregar una unidad"
                onClick={() => paso(1)}
              >
                <Plus className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>

          <label className="flex items-center justify-between gap-2 rounded-xl border px-3 py-3.5">
            <span className="text-sm">Publicar producto en catálogo</span>
            <Switch checked={publicar} onCheckedChange={setPublicar} />
          </label>

          <div className="flex flex-col gap-2">
            <Label>Foto (opcional)</Label>
            <ProductPhotoInput ownerId={ownerId} value={photoPath} onChange={setPhotoPath} />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="qp-desc">Descripción (opcional)</Label>
            <Textarea
              id="qp-desc"
              className="h-[120px]"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Escribe descripción del producto"
            />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <div className="p-4">
          {/* EL TOTAL EN EL BOTÓN, como el frame. Dice lo que va a entrar en el
              carrito —precio por cantidad— y no solo «Agregar»: es la última
              cifra que el tendero ve antes de que la venta la dé por buena. */}
          <Button type="button" className="h-10 w-full" disabled={!listo || guardando} onClick={guardar}>
            {guardando ? "Guardando…" : `Agregar ${formatPriceAmount(total, moneda)}`}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
