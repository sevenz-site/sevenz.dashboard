"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DescriptionField } from "@/components/dashboard/description-field";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { CurrencyFlagIcon } from "@/components/dashboard/currency-flag-icon";
import { avisarCuentaPausada } from "@/lib/cuenta-pausada";
import { ProductPhotoInput } from "@/components/dashboard/product-photo-input";
import { createProduct, productNameTaken, updateProduct } from "@/app/(app)/productos/actions";
import { DuplicateProductNameDialog } from "@/components/dashboard/duplicate-product-name-dialog";
import {
  currencyName,
  formatPriceAmount,
  marginFromPrice,
  parseTypedAmount,
  type PriceCurrency,
} from "@/lib/products/price";
import { useGroupedAmount } from "@/hooks/use-grouped-amount";
import { BarcodeField } from "@/components/barcode/barcode-field";

// REGISTRAR UN PRODUCTO SIN SALIR DE LA VENTA — frame `1389:9169`, 2026-10-18.
//
// ===========================================================================
// ES UN FORMULARIO SINTETIZADO, Y ESO ES LA DECISIÓN, NO UN ATAJO
//
// La ficha completa del catálogo (`ProductoFlujo`) pide escalón al
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
// What the sheet typed beyond name, price and currency, which the product row does not carry
// back to the cart. Kept on the cart line so «Editar» reopens the sheet as it was left.
export type DatosRapidos = {
  publicar: boolean;
  descripcion: string | null;
  // The unit cost as typed (CT-182, owner's decision of 2026-11-23). Optional so a line
  // created before this field existed still reopens.
  costo?: string | null;
};

// A product this sheet created, as «Editar» reopens it.
export type ProductoRapido = DatosRapidos & {
  productId: string;
  nombre: string;
  precio: number;
  moneda: PriceCurrency;
  cantidad: number;
  photoPath: string | null;
};

export function QuickProductSheet({
  open,
  onOpenChange,
  ownerId,
  monedas,
  onCreado,
  editando = null,
  onEditado,
  codigos,
  textoBoton,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerId: string;
  // Las monedas en las que este negocio puede cobrar. La primera viene puesta.
  // Vienen del catálogo ya cargado — las mismas que ofrece el carrito.
  monedas: PriceCurrency[];
  // El producto recién creado y cuántas unidades van al carrito. La pantalla
  // de venta se encarga de recargar la cuadrícula y de meterlo.
  // What was typed rides along so the cart can reopen this same sheet to edit it.
  onCreado: (productId: string, cantidad: number, datos: DatosRapidos) => void;
  // EDIT MODE: the product this sheet created earlier in the same sale, opened from its cart
  // line's «Editar» (owner's request of 2026-11-16). Same fields, prefilled; saving updates
  // the product instead of creating one. Without it the sheet is exactly what it was.
  editando?: ProductoRapido | null;
  onEditado?: (productId: string, cantidad: number, datos: DatosRapidos) => void;
  // BARCODES (CT-182). Undefined -- the business does not work with codes -- hides the field
  // and sends nothing, so the product's codes are never touched. A list shows the field with
  // those codes already in it (a scan that found no product).
  codigos?: string[];
  // The button's words when the scanner opened the sheet: «Guardar y vender» from Home,
  // «Guardar y agregar» inside a sale (frames 8 and 12). Without it, the total as before.
  textoBoton?: string;
}) {
  const [listaDeCodigos, setListaDeCodigos] = useState<string[]>(codigos ?? []);
  const [nombre, setNombre] = useState(editando?.nombre ?? "");
  const [precio, setPrecio] = useState(editando ? String(editando.precio).replace(".", ",") : "");
  const [moneda, setMoneda] = useState<PriceCurrency>(editando?.moneda ?? monedas[0] ?? "USD");
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
  const [cantidad, setCantidad] = useState(editando ? String(editando.cantidad) : "1");
  const [publicar, setPublicar] = useState(editando?.publicar ?? true);
  const [photoPath, setPhotoPath] = useState<string | null>(editando?.photoPath ?? null);
  const [descripcion, setDescripcion] = useState(editando?.descripcion ?? "");
  // «COSTO UNITARIO (OPCIONAL)», THE ONE CATALOGUE FIELD ADDED HERE. Owner's decision of
  // 2026-11-23, asked whether this sheet should carry every field of the catalogue's
  // «Crear producto»: «agreguemos solo el input de costo». It displaces, by one field, the
  // decision written at the top of this file (six fields, because twenty with a customer
  // waiting means the product never gets written down); the rest of that reasoning stands.
  //
  // IN THE PRICE'S CURRENCY, with no selector of its own: the owner asked for the input
  // only. The catalogue's form, where the cost has its own currency, still edits it.
  const [costo, setCosto] = useState(editando?.costo ?? "");
  const { ref: refCosto, onChange: alTeclearCosto } = useGroupedAmount(costo, setCosto);
  const [error, setError] = useState<string | null>(null);
  const [guardando, startTransition] = useTransition();

  // `parseTypedAmount` y no `parseAmount` desde el 2026-10-24, que es cuando
  // este campo pasó a agrupar los miles: en un campo agrupado la convención
  // ya está decidida, y la adivinanza de `parseAmount` lee «1,234» como mil
  // doscientos treinta y cuatro. De este número sale el total que el tendero
  // confirma, así que el que manda es el que él escribió.
  const unitario = parseTypedAmount(precio) ?? 0;
  // Null when empty or not a positive number: then no cost is saved at all.
  const costoParsed = parseTypedAmount(costo);
  const costoNumero = costoParsed != null && costoParsed > 0 ? costoParsed : null;
  // LOS MILES, MIENTRAS SE TECLEA.
  const { ref: refPrecio, onChange: alTeclearPrecio } = useGroupedAmount(precio, setPrecio);
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

  // A REPEATED NAME IS WARNED ABOUT, NEVER REFUSED (owner's request of 2026-11-15), the
  // same dialog as the product wizard. Here it also catches the case the comment below
  // describes: a save whose answer was lost, retried, would have made a second copy.
  const [repetido, setRepetido] = useState(false);

  function intentarGuardar() {
    // EDITING DOES NOT ASK ABOUT A REPEATED NAME: the product wizard only asks when creating,
    // which is what the owner asked for («cuando se crea un producto repetido»), and this
    // product already exists under this name.
    if (editando) {
      guardar();
      return;
    }
    setError(null);
    startTransition(async () => {
      if (await productNameTaken(nombre)) {
        setRepetido(true);
        return;
      }
      guardar();
    });
  }

  function guardar() {
    setError(null);
    startTransition(async () => {
      // A DROPPED REQUEST THROWS instead of returning `{ error }`, and an error
      // thrown inside a transition reaches the page's error boundary: the whole
      // sale, cart included, was replaced by the error screen. Caught here, the
      // sheet stays open with what was typed. The product MAY have been saved
      // before the answer was lost, and `createProduct` does not refuse a
      // repeated name, so the message asks to look before saving again.
      let r: Awaited<ReturnType<typeof createProduct>>;
      try {
        const datos = {
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
          // THE COST AND ITS MARGIN, like the catalogue: the margin is stored, and Reportes
          // reads it, so it is computed here in the cost's currency, which is the price's.
          cost: costoNumero != null ? costo : null,
          costCurrency: costoNumero != null ? moneda : null,
          costCurrencyOther: null,
          marginRetailPct:
            costoNumero != null ? (marginFromPrice(costoNumero, moneda, unitario, moneda, null)?.toString() ?? null) : null,
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
          barcodes: codigos === undefined ? undefined : listaDeCodigos,
        };
        // THE SAME FIELDS EITHER WAY. The product was created from this sheet with no cost,
        // stock or wholesale price, so writing them back as null changes nothing the owner
        // set; what changes is only what he can see and edit here.
        r = editando
          ? await updateProduct(editando.productId, datos)
          : await createProduct({ analitica: { source: "quick_sheet" }, ...datos });
      } catch (e) {
        console.error("[QuickProductSheet] save:", e);
        setError(
          "No pudimos confirmar que se guardó, revisa tu conexión. Antes de intentar de nuevo, búscalo en la venta: puede que ya esté guardado.",
        );
        return;
      }
      if (avisarCuentaPausada(r.error)) return;
      // `updateProduct` answers without an id (it already has one), so only a create needs it.
      if (r.error || (!editando && !r.id)) {
        setError(r.error ?? "No pudimos guardar el producto. Intenta de nuevo.");
        return;
      }
      const escrito = { publicar, descripcion: descripcion.trim() || null, costo: costoNumero != null ? costo : null };
      if (editando) onEditado?.(editando.productId, unidades, escrito);
      else if (r.id) onCreado(r.id, unidades, escrito);
      onOpenChange(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/* `dvh` y no `vh`: en un teléfono con la barra del navegador a la vista,
          `vh` mide el viewport grande. Y `overflow-y-auto` porque esta hoja
          tiene siete campos y a 375px no caben sin desplazar. */}
      <SheetContent
        side="bottom"
        className="max-h-[90dvh] overflow-y-auto rounded-t-xl"
        // THE FIRST FIELD GETS THE FOCUS, AND IT IS NEVER THE CODE. Radix focuses the first
        // focusable element, and since the scanner put «Código de barras» first that was the
        // code just read, selected: one key and it was gone (owner's report of 2026-11-23,
        // «se puede editar por error el código y registrar mal»). The name is what the
        // shopkeeper types next, so it gets it, as before the code field existed.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          document.getElementById("qp-nombre")?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle className="text-xl font-medium">
            {/* «Crear producto» when the scanner opened it (frames 8 and 12 of the scanner
                flow, approved 2026-11-23; owner's request of the same day to align the
                title). The ordinary sheet of a sale keeps «Registrar producto», its own
                frame `1389:9169`. `textoBoton` is only ever set by the scanner. */}
            {editando ? "Editar producto" : textoBoton ? "Crear producto" : "Registrar producto"}
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-5 p-4">
          {/* First, as frame 8 draws it: the code is what brought the shopkeeper here. */}
          {codigos !== undefined ? (
            <BarcodeField values={listaDeCodigos} onChange={setListaDeCodigos} idPrefix="qp-codigo" />
          ) : null}
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
                ref={refPrecio}
                onChange={alTeclearPrecio}
                placeholder="00"
              />
              {/* EL DESPLEGABLE DE LA APP, NO EL DEL SISTEMA.
                  Instrucción del dueño el 2026-10-23.

                  AQUÍ HUBO UN `select` NATIVO Y NO ERA UN DESCUIDO: se eligió
                  porque en un teléfono abre la rueda del sistema, que se usa
                  con una mano y no hay que construirla, y porque —decía el
                  comentario— «es lo mismo que hace el carrito con su
                  “Cambiar”». Esa razón se quedó sin la mitad que la sostenía
                  el día anterior, cuando el desplegable de la pantalla de
                  pago pasó a ser el de la app: desde entonces el mismo flujo
                  de venta preguntaba la misma cosa de dos formas distintas en
                  dos pasos seguidos, que es peor que cualquiera de las dos
                  opciones coherentes.

                  La razón vieja queda escrita porque sigue siendo verdad: se
                  pierde la rueda de una mano. Lo que se gana es que la app se
                  vea como una sola app.

                  MISMO MONTAJE QUE `abono-monto.tsx` Y `nueva-venta.tsx`: si
                  a uno hay que cambiarle algo, a los tres. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9 shrink-0 gap-2"
                    aria-label="Moneda del precio"
                  >
                    <CurrencyFlagIcon currency={moneda} className="size-4 shrink-0" />
                    <span className="text-xs">{currencyName(moneda)}</span>
                    <ChevronDown className="size-4 shrink-0 opacity-60" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {monedas.map((c) => (
                    <DropdownMenuItem key={c} onSelect={() => setMoneda(c)}>
                      <CurrencyFlagIcon currency={c} className="size-4 shrink-0" />
                      {currencyName(c)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="qp-costo">Costo unitario (opcional)</Label>
            <div className="flex items-center gap-2">
              <Input
                id="qp-costo"
                className="min-w-0 flex-1"
                inputMode="decimal"
                value={costo}
                ref={refCosto}
                onChange={alTeclearCosto}
                placeholder="00"
              />
              {/* No selector: the cost goes in the price's currency, said here. */}
              <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <CurrencyFlagIcon currency={moneda} className="size-4 shrink-0" />
                {currencyName(moneda)}
              </span>
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
            {/* THE SAME FIELD AS THE WIZARD (CT-171): this sheet sends to the same
                `createProduct` action, so it gets the same 500 limit and the same
                format buttons. A second plain textarea here would be the door through
                which a 600-character description reaches a server that now refuses it. */}
            <DescriptionField id="qp-desc" value={descripcion} onChange={setDescripcion} />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <div className="p-4">
          {/* EL TOTAL EN EL BOTÓN, como el frame. Dice lo que va a entrar en el
              carrito —precio por cantidad— y no solo «Agregar»: es la última
              cifra que el tendero ve antes de que la venta la dé por buena. */}
          <Button type="button" className="h-10 w-full" disabled={!listo || guardando} onClick={intentarGuardar}>
            {guardando
              ? "Guardando…"
              : textoBoton ?? `${editando ? "Guardar" : "Agregar"} ${formatPriceAmount(total, moneda)}`}
          </Button>
        </div>
      </SheetContent>
      <DuplicateProductNameDialog
        open={repetido}
        name={nombre}
        onCancel={() => setRepetido(false)}
        nameInputId="qp-nombre"
        onCreateAnyway={() => {
          setRepetido(false);
          guardar();
        }}
      />
    </Sheet>
  );
}
