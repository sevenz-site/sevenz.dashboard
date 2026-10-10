"use client";

import { useState, useTransition } from "react";
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

// COMPARTIR EL CATALOGO. El frame lo anota «URL compartible».
//
// ─────────────────────────────────────────────────────────────────────────
// DOS ENLACES, PORQUE HAY DOS PRECIOS
//
// Decision 11 del dueño y `CT-55`: uno de detal y uno de mayor. Es lo que
// pidio el Tendero 2 — tiene clientes de los dos tipos, y un solo catalogo le
// obliga a enseñarle a alguien el precio equivocado.
//
// ─────────────────────────────────────────────────────────────────────────
// CADA ENLACE SE CREA AL PEDIRLO, NO AL REGISTRARSE, Y NO LOS DOS A LA VEZ
//
// Mismo criterio que `getOrCreateShareLink`: un token acuñado en el alta
// pondria a los 24 negocios a una URL de distancia de un catalogo que nunca
// decidieron publicar. Y se piden de uno en uno porque un tendero que solo
// vende al detal no tiene por que tener un enlace de mayor existiendo por ahi.
//
// ─────────────────────────────────────────────────────────────────────────
// Y SE AVISA CUANDO EL CATALOGO ESTA VACIO, ANTES DE MANDARLO
//
// El enlace y los productos publicados son dos cosas distintas: se puede tener
// el enlace y cero productos con «Publicar» encendido, porque el interruptor
// nace apagado (migracion 084, y a proposito). Quien mande ese enlace manda a
// su cliente a una pagina que dice que no hay nada — y lo descubre por el
// cliente.
export function CatalogShare({
  publishedCount,
  businessName,
}: {
  publishedCount: number;
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
              Quien abra un enlace ve los productos que tengas publicados, con su foto y el precio
              de ese enlace. Nunca ve tus costos.
            </DialogDescription>
          </DialogHeader>

          {publishedCount === 0 ? (
            <p className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm leading-relaxed text-destructive">
              Todavía no tienes ningún producto publicado, así que por ahora estos enlaces abren un
              catálogo vacío. Enciende «Publicar» en los que quieras mostrar.
            </p>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              Ahora mismo se ven {publishedCount}{" "}
              {publishedCount === 1 ? "producto" : "productos"}.
            </p>
          )}

          <div className="flex flex-col gap-4">
            <LinkRow
              tier="retail"
              label="Para tus clientes de detal"
              help="Enseña el precio al detal."
              businessName={businessName}
            />
            <LinkRow
              tier="wholesale"
              label="Para tus clientes al mayor"
              help="Enseña el precio al mayor. Quien lo reenvíe le está dando precios de mayorista a quien lo reciba."
              businessName={businessName}
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
  help,
  businessName,
}: {
  tier: PriceTier;
  label: string;
  help: string;
  businessName: string;
}) {
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);

  function crear() {
    startTransition(async () => {
      const result = await getOrCreateCatalogLink(tier);
      if ("error" in result) {
        toast.error(result.error);
        return;
      }
      setUrl(`${window.location.origin}/c/${result.token}`);
    });
  }

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
      <Label>{label}</Label>
      <p className="text-xs leading-relaxed text-muted-foreground">{help}</p>

      {url == null ? (
        <Button type="button" variant="outline" disabled={pending} onClick={crear}>
          {pending ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Preparando...
            </>
          ) : (
            "Crear el enlace"
          )}
        </Button>
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
