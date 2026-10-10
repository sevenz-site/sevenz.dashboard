"use client";

import { useEffect, useState, useTransition } from "react";
import { Copy, Loader2, Share2 } from "lucide-react";
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
import type { PriceTier } from "@/lib/products/price";

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
      {/* Elemento plano con clases explicitas y no `Button variant="outline"`:
          vive dentro de la cabecera oscura, sobre `--brand-primary`, y
          `outline` trae `bg-background` —blanco en el tema claro— asi que
          pintaria una losa blanca sobre #272727. Mismo motivo que el boton de
          WhatsApp de la ficha del cliente y que los chips de filtro. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-brand-field-border px-3 text-sm text-white outline-none transition-colors hover:bg-white/10 focus-visible:border-white focus-visible:ring-3 focus-visible:ring-white/40"
      >
        <Share2 className="size-4" aria-hidden="true" />
        Compartir
      </button>

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

          <div className="flex flex-col gap-4">
            <LinkRow
              tier="retail"
              label="Para tus clientes de detal"
              count={publishedCount.retail}
              businessName={businessName}
              open={open}
            />
            <LinkRow
              tier="wholesale"
              label="Para tus clientes al mayor"
              count={publishedCount.wholesale}
              extra="Quien lo reenvíe le está dando precios de mayorista a quien lo reciba."
              businessName={businessName}
              open={open}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LinkRow({
  tier,
  label,
  count,
  extra,
  businessName,
  open,
}: {
  tier: PriceTier;
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
      const result = await getOrCreateCatalogLink(tier);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setUrl(`${window.location.origin}/c/${result.token}`);
    });
  }, [open, url, count, tier]);

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
          Marca «Incluir precio {tier === "retail" ? "al detal" : "al mayor"}» en algún producto y
          el enlace aparece aquí.
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
        </>
      )}
    </div>
  );
}
