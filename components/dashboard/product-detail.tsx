"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ImageOff } from "lucide-react";
import { toast } from "sonner";
import { avisarCuentaPausada } from "@/lib/cuenta-pausada";
import { Button } from "@/components/ui/button";
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
  BloqueDePrecios,
  Fila,
  TarjetaDePublicacion,
} from "@/components/dashboard/product-detail-rows";
import { ProductShareButton } from "@/components/dashboard/product-share-button";
import { StockBadge } from "@/components/stock-badge";
import { trashProduct } from "@/app/(app)/productos/actions";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import type { ProductRow } from "@/lib/products/catalog";
// `formatPriceAmount` Y NO UN FORMATEADOR PROPIO: es la misma regla que la
// cabecera de `product-detail-rows.tsx` deja escrita. Dos fichas del mismo
// producto con dos redondeos distintos no se leen como un descuido de
// maquetación, se leen como que la app no sabe cuánto cuesta.
import {
  formatPriceAmount,
  type BolivarRates,
  type PriceCurrency,
} from "@/lib/products/price";

// ═══════════════════════════════════════════════════════════════════════
// LA FICHA DEL PRODUCTO, DEL LADO DEL DUEÑO — frame `1730:14329`
//
// Encargo del dueño el 2026-10-27: *«El detalle del producto al abrirlo desde
// el catálogo vamos a rediseñarlo»*, corregido por él mismo el mismo día --
// *«es detalle del producto al abrirlo desde el lado del dueño, no del
// cliente»*.
//
// ───────────────────────────────────────────────────────────────────────
// ANTES DE ESTA PANTALLA, TOCAR UNA TARJETA ABRÍA DIRECTAMENTE EL EDITOR
//
// Y eso NO era un descuido: la anotación del frame del catálogo
// (`1175:6069`) lo dice con todas las letras, *«Al seleccionar el producto
// entra a editar»*. Lo que la desplaza es un CONECTOR más nuevo, de la misma
// tarjeta `1175:5758` a `1730:14330`, que es la foto de esta ficha.
//
// Las dos cosas están escritas en el mismo archivo de Figma y se contradicen.
// Gana el conector porque es posterior --sus nodos son de la serie `1730`, la
// anotación de la `1175`-- y porque el encargo del dueño habla de «abrir el
// detalle desde el lado del dueño», que no existiría si la tarjeta siguiera
// yendo al editor. Queda anotado por si algún día se quiere volver atrás.
//
// ───────────────────────────────────────────────────────────────────────
// ES DE LEER, NO DE EDITAR, Y ESO YA ESTABA DECIDIDO
//
// Los tres interruptores de publicación son de solo lectura. No es una
// decisión nueva: la tomó el paso 4/4 del alta --«editing it here would make
// this a fifth editing screen instead of the re-read it exists to be;
// «Editar» goes back to the step that owns it»-- y aquí vale igual, porque
// esta pantalla también termina en un «Editar» que lleva justo ahí.
//
// Ver `product-detail-rows.tsx` para por qué van sin `disabled`.
// ═══════════════════════════════════════════════════════════════════════

export function ProductDetail({
  product,
  rates,
  businessName,
  catalogToken,
  lowStockThreshold,
}: {
  product: ProductRow;
  // null en un negocio colombiano: no hay equivalencias que calcular.
  rates: BolivarRates | null;
  businessName: string;
  catalogToken: string | null;
  /** `owners.low_stock_threshold`, so the chip knows what «running low» means here. */
  lowStockThreshold: number;
}) {
  const router = useRouter();
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [borrando, startTransition] = useTransition();

  const fotoUrl = product.photo_path ? getPublicProductPhotoUrl(product.photo_path) : null;

  const baseDetal =
    product.price_retail != null && product.base_currency_retail
      ? {
          amount: Number(product.price_retail),
          currency: product.base_currency_retail as PriceCurrency,
        }
      : null;
  const baseMayor =
    product.price_wholesale != null && product.base_currency_wholesale
      ? {
          amount: Number(product.price_wholesale),
          currency: product.base_currency_wholesale as PriceCurrency,
        }
      : null;

  const publicando = product.published_retail || product.published_wholesale;

  return (
    // ── `-m-4`: ESTA PANTALLA SE COME EL RELLENO DE `main` ────────────────
    //
    // `app-main.tsx` le pone `p-4` a TODAS las pantallas, y aquí estorba por
    // las dos puntas:
    //
    //   · LA FOTO VA A SANGRE en el frame, y con los 16px de `main` quedaba
    //     flotando con un marco blanco alrededor -- medido en el navegador:
    //     empezaba en x=16 en vez de en x=0.
    //   · EL CONTENIDO LLEVABA 32, los 16 de `main` más los 16 de este
    //     bloque, cuando la regla del dueño --y `DESIGN-SYSTEM.md`-- dice 16.
    //
    // SE CANCELA AQUÍ Y NO EN `app-main.tsx` a propósito: ese archivo lo usan
    // todas las pantallas de la app, y una excepción allí es una lista más
    // que mantener a mano. Aquí es una línea que vive al lado de lo que la
    // necesita.
    <div className="-m-4 flex flex-1 flex-col">
      {/* ── LA FOTO, A SANGRE, CON SUS DOS DISCOS ENCIMA ─────────────────
          200px de alto y SIN los 16px de los lados -- nodo `1730:14330`. Es
          la única parte de esta pantalla que llega a los bordes, y por eso la
          flecha de volver va aquí dentro y no en una fila aparte: el frame no
          dibuja ninguna.

          POR ESO ESTA RUTA ESTÁ EN LAS CUATRO LISTAS de `lib/products/
          routes.ts`. La cabecera de la app taparía exactamente esta banda. */}
      <div className="relative h-50 w-full shrink-0 bg-muted">
        {fotoUrl ? (
          <Image
            src={fotoUrl}
            alt={product.name}
            fill
            unoptimized
            sizes="(max-width: 640px) 100vw, 640px"
            className="object-cover"
          />
        ) : (
          // El hueco dibujado en vez de nada, igual que en la hoja de una
          // línea de pedido: dice que aquí cabe una foto y este producto no
          // la tiene. Un rectángulo gris liso se lee como que no cargó.
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-muted-foreground">
            <ImageOff className="size-6" aria-hidden />
            <span className="text-xs">Sin foto</span>
          </div>
        )}

        {/* LA FLECHA VUELVE AL CATÁLOGO, Y NO ES `router.back()`.
            Hoy la única puerta es la tarjeta del catálogo, así que las dos
            harían lo mismo; `back()` empieza a divergir en cuanto haya una
            segunda puerta --volvería a ella-- y entonces la flecha de una
            ficha haría cosas distintas según de dónde se entró, que es
            justamente lo que un botón de volver no puede permitirse. */}
        <Link
          href="/productos"
          aria-label="Volver al catálogo"
          className="absolute left-4 top-2 z-10 flex size-[45px] items-center justify-center rounded-full bg-background/72 backdrop-blur-sm transition-colors active:bg-background"
        >
          <ChevronLeft className="size-5" aria-hidden="true" />
        </Link>

        <ProductShareButton
          productId={product.id}
          productName={product.name}
          businessName={businessName}
          initialToken={catalogToken}
          variante="grande"
        />
      </div>

      <div className="flex flex-1 flex-col gap-4 px-4 py-4">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl leading-8 break-words">{product.name}</h1>
          {/* «Disponible: 00» — nodo `1730:14438`.
              THE CHIP AND ITS COLOUR NOW COME FROM `StockBadge`, shared with
              the other seven screens that draw it. What used to be here was
              the green pill, hardcoded, for every quantity — which is how the
              owner ended up looking at a green «Disponible: 0» on 2026-10-29
              and asking for this. A product at or below his alert threshold
              now reads amber, and zero reads red.

              THE «SOLO SI HAY CIFRA» RULE SURVIVES, inside the badge: a
              product nobody counts renders nothing rather than «Disponible:
              —», which informs no one and takes the place of something that
              would. */}
          <StockBadge quantity={product.stock_opening} threshold={lowStockThreshold} />
        </div>

        <div className="flex flex-col">
          <Fila
            nombre="Costo"
            bandera={
              product.cost != null && product.cost_currency && product.cost_currency !== "OTHER"
                ? (product.cost_currency as PriceCurrency)
                : undefined
            }
          >
            {product.cost == null
              ? "—"
              : product.cost_currency === "OTHER"
                ? // La moneda «Otro» se escribe a mano y no tiene bandera ni
                  // formato: se enseña tal cual la tecleó el tendero.
                  `${product.cost} ${product.cost_currency_other ?? ""}`.trim()
                : formatPriceAmount(Number(product.cost), product.cost_currency as PriceCurrency)}
          </Fila>
          <Fila nombre="Proveedor">{product.supplier?.trim() || "No registrado"}</Fila>
        </div>

        {/* ── LA DESCRIPCIÓN, Y SOLO SI LA HAY ─────────────────────────
            EL FRAME NO DIBUJA NINGÚN ESTADO VACÍO. Lo que se lee en él
            --«Añade una descripción del producto para el propietario.»-- es
            la descripción GUARDADA de ese producto de ejemplo, no un texto de
            maqueta. Lo aclaró el dueño el 2026-10-27, y hasta entonces estaba
            puesto como si fuera el hueco.

            Es exactamente el fallo que `CLAUDE.md` ya tiene escrito con otro
            nombre: el 2026-10-20 se inventó «Todavía sin abonos» donde el
            frame tenía un importe. Un estado vacío que nadie dibujó se
            entrega con la misma seguridad que lo que sí está en el frame.

            SIN DESCRIPCIÓN NO SE PINTA NADA, que es lo que ya hace la hoja de
            una línea de pedido con esta misma ficha. Un rótulo con un guion
            debajo ocupa el sitio de algo que sí informa. */}
        {product.description?.trim() ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-xs text-muted-foreground">Descripción del producto</span>
            <p className="text-sm leading-5 break-words whitespace-pre-line">
              {product.description}
            </p>
          </div>
        ) : null}

        <BloqueDePrecios
          titulo="Venta al detal"
          margenLabel="Margen al detal"
          margen={product.margin_retail_pct == null ? null : Number(product.margin_retail_pct)}
          base={baseDetal}
          rates={rates}
          enTarjeta
        />
        {/* «Margen al mayor», y el frame dice «Margen al detal» en los dos
            bloques. No se copia literal, y no es una decisión nueva: el dueño
            ya la corrigió el 2026-10-17 en la hoja del pedido, por la misma
            razón --repetir la etiqueta hace que los dos márgenes se lean como
            el mismo número puesto dos veces--. */}
        <BloqueDePrecios
          titulo="Venta al mayor"
          margenLabel="Margen al mayor"
          margen={
            product.margin_wholesale_pct == null ? null : Number(product.margin_wholesale_pct)
          }
          base={baseMayor}
          rates={rates}
          enTarjeta
        />

        <TarjetaDePublicacion
          publicando={publicando}
          alMayor={product.published_wholesale}
          alDetal={product.published_retail}
          tresInterruptores
        />
      </div>

      {/* ── EL PIE — nodo `1730:14421` ───────────────────────────────────
          NO VA PEGADO ABAJO. El frame lo dibuja al final del contenido, no
          flotando, y esta pantalla no tiene ni un campo que escribir, así que
          nada de lo que `StickyActions` resuelve --el teclado tapando el
          botón-- puede pasar aquí.

          LOS 40px DE ABAJO SON LOS DEL FRAME, y por eso esta ruta está también
          en la lista `conBarraDeBotones` de `app-main.tsx`: sin ella `main` le
          suma sus 16 de pantalla normal y quedan 56. */}
      <div className="mt-auto flex flex-col gap-2 border-t px-4 pt-4 pb-10">
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full text-base"
          onClick={() => router.push(`/productos/${product.id}/editar`)}
        >
          Editar
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-10 w-full text-base text-destructive hover:text-destructive"
          onClick={() => setConfirmarBorrado(true)}
          disabled={borrando}
        >
          Eliminar
        </Button>
      </div>

      {/* MISMO TEXTO QUE EL DEL FLUJO DE EDICIÓN, a propósito: es la misma
          acción, y dos avisos distintos para lo mismo harían dudar de si son
          lo mismo.

          NO DICE «esta acción no se puede deshacer», porque sí se puede: el
          producto va a la papelera y la notificación trae su botón de
          restaurar (migración 090). */}
      <AlertDialog open={confirmarBorrado} onOpenChange={setConfirmarBorrado}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar {product.name}?</AlertDialogTitle>
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
                  const r = await trashProduct(product.id);
                  if (r.error) {
                    if (avisarCuentaPausada(r.error)) return;
                    toast.error(r.error);
                    return;
                  }
                  // SALE DE LA FICHA: quedarse en la ficha de un producto que
                  // acaba de irse a la papelera enseñaría datos de algo que ya
                  // no está en el catálogo.
                  router.push("/productos");
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

