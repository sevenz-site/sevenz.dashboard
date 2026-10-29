"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ChevronRight, ImageOff } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { getPublicProductPhotoUrl } from "@/lib/supabase/storage";
import { formatPriceAmount, type PriceCurrency } from "@/lib/products/price";
import type { ProductoEnAviso } from "@/lib/reports/inventario";

// ═══════════════════════════════════════════════════════════════════════
// LA HOJA QUE ABRE UN AVISO DE INVENTARIO
//
// Encargo del dueño el 2026-10-28: *«Al seleccionar "Ver productos" en las
// alertas debe mostrar sheet de respectiva alerta con los cards de los
// productos mencionados (…) y al seleccionar el producto desde el sheet lleva
// al detalle»*.
//
// ───────────────────────────────────────────────────────────────────────
// LO QUE ARREGLA, QUE NO ES COMODIDAD
//
// «6 productos no tienen especificado su costo» sin decir CUÁLES obliga a
// salir al catálogo y cotejar de memoria cuáles son los seis. Es el mismo
// fallo que `order-client-card.tsx` ya tiene documentado para otra pantalla:
// *«mandaba al tendero FUERA del flujo, a cotejar de memoria»*.
//
// ───────────────────────────────────────────────────────────────────────
// LA TARJETA NO ES LA DEL CATÁLOGO ENTERA, Y SE DICE EN VOZ ALTA
//
// Él pidió «los mismos cards que el catálogo». Esta se le parece --misma
// foto de 48, mismo nombre, mismo precio, mismo borde y radio-- pero NO trae
// el interruptor de publicar ni el botón de compartir que lleva la del
// catálogo.
//
// Y es deliberado: esta hoja contesta «cuáles son», no «gestiónalos». Un
// interruptor de publicar dentro de un aviso sobre costos invita a tocar algo
// que no tiene nada que ver con el aviso -- y publicar un producto es una
// acción que sale del negocio hacia internet.
//
// LA FICHA ES DONDE SE ARREGLA, que es a donde lleva cada tarjeta: ahí están
// el costo y la cantidad, que es lo que el aviso pide escribir.
// ═══════════════════════════════════════════════════════════════════════

export function ReportesAvisoSheet({
  titulo,
  descripcion,
  productos,
  conFicha = true,
  children,
}: {
  titulo: string;
  descripcion: string;
  productos: ProductoEnAviso[];
  // ── ¿CADA TARJETA LLEVA A LA FICHA? ───────────────────────────────
  //
  // `false` para la hoja de los que están EN LA PAPELERA, y no es una
  // simplificación: `/productos/[id]` filtra `trashed_at is null` --como
  // `CLAUDE.md` exige de toda fila que se lee por un id del navegador-- así
  // que un producto borrado devuelve **404**. Comprobado el 2026-10-28
  // abriendo la ficha de uno borrado a mano en dev.
  //
  // Y TAMPOCO HAY A DÓNDE MANDARLO: `/papelera` solo pinta clientes. Lo dice
  // `restoreProduct` en `app/(app)/productos/actions.ts`: *«la papelera
  // todavía no sabe pintar productos (ver CT-44)»*, y por eso el único
  // camino de vuelta hoy es la notificación de borrado.
  //
  // UNA TARJETA QUE NO LLEVA A NINGUNA PARTE NO SE DIBUJA COMO ENLACE: sin
  // esto saldría con su flecha, invitando a tocarla, y lo que se abriría es
  // un 404 -- que el tendero lee como que la app está rota, no como que el
  // producto está borrado.
  conFicha?: boolean;
  /** El «Ver productos» que la abre. */
  children: React.ReactNode;
}) {
  const [abierta, setAbierta] = useState(false);

  return (
    <Sheet open={abierta} onOpenChange={setAbierta}>
      <SheetTrigger asChild>{children}</SheetTrigger>
      {/* `max-h-[90svh]` Y NO `vh`: `vh` mide el viewport GRANDE --el que
          habría sin la barra del navegador-- así que en un teléfono con la
          barra a la vista ese porcentaje es más alto que la pantalla. */}
      <SheetContent side="bottom" className="flex max-h-[90svh] flex-col rounded-t-xl">
        <SheetHeader>
          <SheetTitle>{titulo}</SheetTitle>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 px-4 pb-6">
          <p className="text-sm text-muted-foreground">{descripcion}</p>
          {/* LA LISTA SE DESPLAZA DENTRO DE LA HOJA, no la hoja entera: con
              veinte productos el título tiene que quedarse a la vista. */}
          <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
            {productos.map((p) => {
              const foto = p.fotoPath ? getPublicProductPhotoUrl(p.fotoPath) : null;
              return (
                <li key={p.id}>
                  <Fila id={p.id} conFicha={conFicha}>
                    {/* 48×48, como la del catálogo. Sin foto va el icono y no
                        un hueco: un cuadro vacío se lee como que la imagen no
                        cargó. */}
                    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                      {foto ? (
                        // `unoptimized` NO ES OPCIONAL, y cuesta la pantalla
                        // entera si falta: sin él, `next/image` exige que el
                        // dominio de Supabase esté en `next.config.ts`, y como
                        // no lo está LANZA al pintar. No sale una foto rota --
                        // sale «This page couldn't load» en todo /reportes.
                        //
                        // Pasó aquí el 2026-10-28, y es la razón por la que
                        // TODAS las demás fotos de producto del repo lo llevan
                        // (`order-product-card.tsx`, `catalog-table.tsx`,
                        // `product-detail.tsx`). Si algún día se configura el
                        // dominio, se quitan las once a la vez o ninguna.
                        <Image
                          src={foto}
                          alt=""
                          width={48}
                          height={48}
                          unoptimized
                          className="size-12 object-cover"
                        />
                      ) : (
                        <ImageOff className="size-5 text-muted-foreground" aria-hidden />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-medium">{p.nombre}</span>
                      {p.precio != null ? (
                        <span className="truncate text-xs text-muted-foreground tabular-nums">
                          {formatPriceAmount(p.precio, (p.moneda as PriceCurrency) ?? "USD")}
                          {p.unidad ? ` · ${p.unidad}` : ""}
                        </span>
                      ) : (
                        // SIN PRECIO SE DICE, no se deja la línea en blanco:
                        // un producto sin precio es otra cosa que falta por
                        // escribir, y callarlo aquí sería esconderla.
                        <span className="truncate text-xs text-muted-foreground">Sin precio</span>
                      )}
                    </span>
                    {conFicha ? (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    ) : null}
                  </Fila>
                </li>
              );
            })}
          </ul>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// LA MISMA TARJETA, CON Y SIN DESTINO. Dos bloques de JSX casi iguales se
// separan en cuanto alguien retoca uno: es la misma razón por la que el «−»
// del pedido reusa el del carrito en vez de copiar sus clases.
function Fila({
  id,
  conFicha,
  children,
}: {
  id: string;
  conFicha: boolean;
  children: React.ReactNode;
}) {
  const clases = "flex items-center gap-3 rounded-[10px] border p-2";
  if (!conFicha) return <div className={clases}>{children}</div>;
  return (
    <Link href={`/productos/${id}`} className={`${clases} transition-colors active:bg-accent`}>
      {children}
    </Link>
  );
}
