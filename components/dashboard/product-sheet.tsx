"use client";

import Image from "next/image";
import { ImageOff } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ProductDetail } from "@/components/public/product-detail";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import { formatCantidad } from "@/lib/products/cantidad";
import type { ProductoPublico } from "@/lib/products/public-pricing";
import type { BolivarRates, PriceCurrency } from "@/lib/products/price";
import { IconoVolver } from "@/components/dashboard/screen-chrome";

// EL DETALLE DE UN PRODUCTO, DENTRO DE UNA VENTA — frame `1389:8949`.
//
// ===========================================================================
// UNA HOJA, NO UNA VISTA, Y ESO ES LO QUE SE CORRIGIÓ
//
// La primera versión de esto, el 2026-10-18, reemplazaba la cuadrícula por el
// detalle dentro del mismo paso. El dueño lo rechazó: «el detalle del producto
// está mal, te dejo frame para que muestres producto en componente sheet».
//
// Y no es una preferencia de forma. Una hoja deja la cuadrícula DETRÁS: al
// cerrarla, el tendero sigue donde estaba, con el mismo scroll y la misma
// búsqueda escrita. Reemplazando la vista hay que reconstruir ese estado al
// volver, o se pierde — y quien está vendiendo abre tres o cuatro productos
// seguidos antes de cobrar.
//
// ===========================================================================
// EL CUERPO ES `ProductDetail`, EL MISMO QUE VE EL CLIENTE
//
// Escalones, mínimo de mayoreo, monedas con su equivalencia en bolívares y el
// aviso por debajo del mínimo son reglas de PRECIO: con dos versiones, el día
// que una cambie y la otra no, el tendero cobra un precio y su cliente ve
// otro. Lo que esta hoja añade es lo que en la pantalla del cliente pinta la
// PÁGINA y no el componente: la foto de cabecera, el nombre y la descripción.
export function ProductSheet({
  open,
  onOpenChange,
  producto,
  rates,
  monedasPermitidas,
  onAgregar,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  producto: {
    id: string;
    name: string;
    unit: string | null;
    photoPath: string | null;
    description: string | null;
    stock: number | null;
    producto: ProductoPublico;
  };
  rates: BolivarRates | null;
  monedasPermitidas: PriceCurrency[];
  onAgregar: (linea: { quantity: number; currency: PriceCurrency }) => void;
}) {
  const foto = producto.photoPath ? getPublicProductPhotoUrl(producto.photoPath) : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // `p-0` porque la foto va a sangre contra los bordes de la hoja, y
        // `gap-0` porque el espaciado lo llevan los bloques de dentro: el que
        // trae `SheetContent` por defecto metería 16px entre la foto y el
        // nombre que el frame no tiene.
        //
        // `dvh` y no `vh`: en un teléfono con la barra del navegador a la
        // vista, `vh` mide el viewport grande y la hoja se pasa de alto.
        className="max-h-[90dvh] gap-0 overflow-y-auto rounded-t-3xl p-0"
        // LA EQUIS DE SERIE NO SE PINTA: el frame cierra con la flecha
        // redonda sobre la foto, y dos controles de cerrar en la misma esquina
        // es un control de más.
        showCloseButton={false}
      >
        <div className="relative h-[200px] w-full shrink-0 overflow-hidden bg-muted">
          {foto ? (
            <Image src={foto} alt="" fill unoptimized sizes="100vw" className="object-cover" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <ImageOff className="size-8" aria-hidden="true" />
              <span className="text-xs">Sin foto</span>
            </div>
          )}
          {/* CIERRA LA HOJA, no navega. Es la misma flecha que en la pantalla
              del cliente vuelve al catálogo; aquí el catálogo está justo
              debajo, sin haberse movido. */}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Volver a productos"
            className="absolute left-4 top-4 flex size-10 items-center justify-center rounded-full bg-background/90 shadow-sm backdrop-blur transition-colors hover:bg-background"
          >
            <IconoVolver className="text-primary" />
          </button>
        </div>

        <div className="flex flex-col gap-4 px-4 py-5">
          <div className="flex flex-col gap-0.5">
            {/* `SheetTitle` Y NO UN `h1` SUELTO: Radix exige un título dentro
                del contenido para que un lector de pantalla anuncie qué se
                acaba de abrir, y sin él avisa por consola. Que además sea el
                nombre del producto es lo correcto, no un apaño. */}
            <SheetTitle className="text-2xl font-normal">{producto.name}</SheetTitle>
            {producto.stock != null ? (
              <span className="w-fit rounded-full bg-money-in/10 px-1.5 text-xs text-money-in">
                Disponible: {formatCantidad(producto.stock)}
              </span>
            ) : null}
            {producto.unit ? (
              <p className="text-xs text-muted-foreground">{producto.unit}</p>
            ) : null}
          </div>

          {producto.description ? (
            <div className="flex flex-col gap-0.5">
              <p className="text-xs text-muted-foreground">Descripción del producto</p>
              <p className="text-sm leading-relaxed">{producto.description}</p>
            </div>
          ) : null}

          <ProductDetail
            // TOKEN VACÍO A PROPÓSITO. Solo lo usan el carrito del cliente
            // (`useCarrito`) y el enlace de vuelta al catálogo público, y con
            // `alAgregar` puesto no se llega a ninguno: `useCarrito` LEE al
            // montar y no escribe si no se le llama. Pasar el token real del
            // negocio obligaría a crear su enlace de catálogo solo por abrir
            // esta hoja.
            token=""
            productId={producto.id}
            producto={producto.producto}
            rates={rates}
            stock={producto.stock}
            monedasPermitidas={monedasPermitidas}
            alAgregar={({ quantity, currency }) => {
              onAgregar({ quantity, currency });
              onOpenChange(false);
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
