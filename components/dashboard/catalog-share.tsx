"use client";

import { useEffect, useState, useTransition } from "react";
import { Copy, Eye, Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WhatsappIcon } from "@/components/icons/whatsapp";
import { getOrCreateCatalogLink } from "@/app/(app)/productos/actions";

export type PublishedCount = { retail: number; wholesale: number; any: number };

// COMPARTIR EL CATALOGO.
//
// ─────────────────────────────────────────────────────────────────────────
// AQUI YA NO SE ELIGE NADA: SOLO SE COPIA
//
// Decision del dueno el 2026-10-10. Antes este dialogo tenia dos botones
// «Crear el enlace», uno por escalon, y era el sitio donde se decidia que
// catalogo existia. Eso estaba en el sitio equivocado: lo que se publica es
// una propiedad del PRODUCTO, y el frame 1187:3728 la puso donde va — en la
// ficha, con «Publicar producto en catálogo» y sus dos casillas.
//
// Asi que aqui solo quedan los enlaces, y cada uno existe porque hay algo
// publicado en ese escalon. El que no tenga nada publicado dice eso en vez de
// ofrecer un enlace a una pagina vacia.
//
// Los tokens se crean al abrir este dialogo y no antes: un token acunado en el
// alta pondria a los 24 negocios a una URL de distancia de un catalogo que
// nunca decidieron publicar.
//
// ─────────────────────────────────────────────────────────────────────────
// Y DESDE EL 2026-10-15, UN SOLO ENLACE
//
// Decision del dueno. Habia dos —uno de detal y uno de mayor— y cada uno
// ensenaba su lista de precios: era su propia decision del 2026-10-10, hecha
// para el Tendero 2, que tiene clientes de los dos tipos.
//
// Lo que la desplaza es el entregable B: el detalle de un producto ya decide
// por CANTIDAD que escalon aplica, asi que los dos enlaces dejaron de separar
// dos audiencias y pasaron a ser dos formas de ver lo mismo. Este dialogo
// obligaba a elegir entre dos cosas que ya no se diferenciaban.
//
// La razon vieja queda escrita porque seria la que haria falta para revertir:
// con dos enlaces el tendero elegia a quien le daba precios mayoristas.
// Ahora cualquiera llega a ellos pidiendo suficiente, que es como funciona
// una tienda. Migracion 106.
export function CatalogShare({
  publishedCount,
  businessName,
}: {
  publishedCount: PublishedCount;
  businessName: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* MISMO ASPECTO QUE «SUBIR LIBRETA» en la cabecera de Clientes, a
          petición del dueño el 2026-10-10: texto e icono, sin recuadro. Antes
          llevaba borde y se leía como la acción principal de la pantalla,
          cuando la principal es crear un producto.

          Las clases salen de la variante `dark` de `ImportarCartera` y se
          copian en vez de importarse porque ese componente abre una hoja de
          subir fotos — lo compartible es el aspecto, no el comportamiento.
          Ninguno de esos colores es un token semántico, por lo de siempre:
          sobre un fondo que no se invierte con el tema, un color que sí lo
          hace rompe el contraste en silencio. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-auto shrink-0 px-0 py-1.5 text-sm text-brand-secondary hover:bg-transparent hover:text-white focus-visible:ring-2 focus-visible:ring-white/40 [&_svg]:size-5"
      >
        <Share2 aria-hidden="true" />
        Compartir
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Comparte tu catálogo</DialogTitle>
            <DialogDescription>
              Quien abra un enlace ve los productos que publicaste para ese precio, con su foto.
              Nunca ve tus costos.
            </DialogDescription>
          </DialogHeader>

          {publishedCount.any === 0 ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive">
              Todavía no has publicado ningún producto. Abre uno, enciende «Publicar producto en
              catálogo» y marca si va al mayor, al detal o a los dos.
            </p>
          ) : null}

          <LinkRow
            label="El enlace de tu catálogo"
            count={publishedCount.any}
            extra="Quien pida la cantidad que marcaste para el mayor, verá el precio al mayor."
            businessName={businessName}
            open={open}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

function LinkRow({
  label,
  count,
  extra,
  businessName,
  open,
}: {
  label: string;
  count: number;
  extra?: string;
  businessName: string;
  open: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);

  // Se pide al abrir, y solo si hay algo publicado en este escalon. Pedirlo
  // sin productos crearia un token para una pagina que dice «no hay nada»,
  // que es justo el enlace que no conviene tener a mano.
  useEffect(() => {
    if (!open || url != null || count === 0) return;
    startTransition(async () => {
      const result = await getOrCreateCatalogLink();
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setUrl(`${window.location.origin}/c/${result.token}`);
    });
  }, [open, url, count]);

  const mensaje = url ? `Mira lo que tenemos en ${businessName} y a qué precio: ${url}` : "";

  async function compartir() {
    if (!url) return;
    if (navigator.share) {
      try {
        await navigator.share({ text: mensaje });
      } catch {
        // Cerrar la hoja de compartir la rechaza. Eso es el dueño decidiendo
        // no mandarlo, no un fallo, asi que no lleva aviso.
      }
      return;
    }
    await navigator.clipboard.writeText(mensaje);
    toast.success("Mensaje copiado");
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <Label>{label}</Label>
        <span className="shrink-0 text-xs text-muted-foreground">
          {count === 0 ? "sin productos" : `${count} ${count === 1 ? "producto" : "productos"}`}
        </span>
      </div>
      {extra ? <p className="text-xs leading-relaxed text-muted-foreground">{extra}</p> : null}

      {count === 0 ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Enciende «Publicar producto en catálogo» en algún producto y el enlace aparece aquí.
        </p>
      ) : pending || !url ? (
        <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Preparando el enlace...
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <Input readOnly value={url} aria-label={label} className="flex-1" />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-10 shrink-0"
              aria-label="Copiar el enlace"
              onClick={async () => {
                await navigator.clipboard.writeText(url);
                toast.success("Enlace copiado");
              }}
            >
              <Copy className="size-4" />
            </Button>
          </div>
          <Button type="button" onClick={compartir}>
            <WhatsappIcon className="size-4" /> Compartir
          </Button>

          {/* LA VISTA PREVIA ES LA PÁGINA DE VERDAD, abierta en otra pestaña.
              No hay una copia del catálogo rindiéndose dentro del panel, y es
              a propósito: una copia es una cosa más que puede quedarse atrás
              del original sin que nadie se entere, y entonces el tendero
              revisaría una pantalla que su cliente no ve.

              Un `iframe` tampoco: esta página mide `min-h-dvh` y se maqueta
              para un teléfono. Dentro de un marco de 400px de ancho se vería
              perfecta por accidente, y justo lo que el tendero necesita
              comprobar —«¿se lee esto en un teléfono?»— es lo que un marco
              dentro del panel no puede responder.

              Y la previa no miente: `get_shared_catalog` y
              `get_shared_product` son `security definer` y no miran
              `auth.uid()` en ningún sitio —comprobado en las migraciones 084 y
              104—, así que la página se pinta igual con la sesión del dueño
              abierta que sin ninguna sesión.

              `noopener noreferrer` por costumbre, no por este caso: el destino
              es nuestro propio dominio. Es la clase de línea que se queda
              puesta cuando la URL cambia. */}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Eye className="size-4" aria-hidden="true" /> Ver cómo lo ve tu cliente
          </a>
        </>
      )}
    </div>
  );
}
