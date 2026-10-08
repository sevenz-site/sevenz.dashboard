"use client";

import { useState, useTransition } from "react";
import { Share2, Loader2 } from "lucide-react";
import { WhatsappIcon } from "@/components/icons/whatsapp";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getOrCreateShareLink } from "@/app/(app)/dashboard/actions";
import { track } from "@/lib/mixpanel";
import { PedirWhatsappDialog } from "@/components/dashboard/pedir-whatsapp-dialog";
import type { OwnerCountry } from "@/lib/types";

export function ShareActions({
  clientId,
  clientName,
  whatsapp,
  balanceText,
  ownerCountry,
  variant = "icons",
}: {
  clientId: string;
  clientName: string;
  whatsapp: string | null;
  // Pre-formatted by the caller — "$47.000,00" for a COP client, or
  // "$50.00 y €20.00" for a VE client with debt in both currencies. Keeps
  // this component currency-agnostic rather than re-deriving formatting
  // logic that already lives in formatLedgerAmount/formatCurrency.
  balanceText: string;
  // Solo para el prefijo por defecto del diálogo que pide el número cuando el
  // cliente no lo tiene. Un tendero colombiano no debería tener que buscar
  // "+57" en una lista antes de escribir.
  ownerCountry: OwnerCountry;
  // "icons" es la pareja de botones redondos de la tabla de clientes.
  // "whatsapp-button" es el botón ancho de la ficha: la misma acción de
  // siempre —handleRemind—, solo que dicha con todas sus letras. Recordar el
  // saldo por WhatsApp es lo que más hace un tendero aquí, y estaba escondido
  // tras un icono sin etiqueta.
  variant?: "icons" | "whatsapp-button";
}) {
  const [pending, startTransition] = useTransition();
  const [pidiendoNumero, setPidiendoNumero] = useState(false);

  function resolveUrl(): Promise<string | null> {
    return new Promise((resolve) => {
      startTransition(async () => {
        const result = await getOrCreateShareLink(clientId);
        if ("error" in result) {
          toast.error(result.error);
          resolve(null);
          return;
        }
        resolve(`${window.location.origin}/s/${result.token}`);
      });
    });
  }

  // One message, both buttons. They differ only in how it leaves the app —
  // WhatsApp with the client's own number prefilled, or the share sheet, which
  // has no recipient of its own.
  function buildMessage(url: string) {
    return `Hola ${clientName}, tu saldo actual es ${balanceText}. Puedes verlo aquí: ${url}`;
  }

  async function handleShare() {
    const url = await resolveUrl();
    if (!url) return;
    const message = buildMessage(url);

    if (navigator.share) {
      try {
        await navigator.share({ text: message });
        track("Share Link Opened", { client_id: clientId, method: "native" });
      } catch {
        // Dismissing the sheet rejects. That is the owner deciding not to
        // send, not a failure, so it gets no toast and no event.
      }
      return;
    }

    // Desktop browsers without navigator.share fall back to the clipboard —
    // the whole message rather than the bare link, so what you paste is the
    // same thing the sheet would have sent.
    await navigator.clipboard.writeText(message);
    toast.success("Mensaje copiado", { description: message });
    track("Share Link Opened", { client_id: clientId, method: "copy" });
  }

  // Abrir wa.me con el número que toque. `phone` vacío es válido y es lo que
  // pasaba siempre antes: WhatsApp abre el selector de contacto con el
  // mensaje puesto. Sigue siendo la salida de "Compartir de otra forma".
  async function abrirWhatsapp(numero: string | null) {
    const url = await resolveUrl();
    if (!url) return;
    const phone = numero ? numero.replace(/\D/g, "") : "";
    const wa = `https://wa.me/${phone}?text=${encodeURIComponent(buildMessage(url))}`;
    window.open(wa, "_blank", "noopener,noreferrer");
    track("Share Link Opened", { client_id: clientId, method: "whatsapp" });
  }

  function handleRemind() {
    // Sin número guardado, se pregunta antes de salir de la app. Es el momento
    // en que el dato sirve, así que es cuando menos cuesta pedirlo — ver
    // pedir-whatsapp-dialog.tsx.
    if (!whatsapp) {
      setPidiendoNumero(true);
      return;
    }
    void abrirWhatsapp(whatsapp);
  }

  // Montado una vez y compartido por las dos variantes: es el mismo diálogo y
  // duplicarlo daría dos que pueden abrirse a la vez.
  const dialogo = (
    <PedirWhatsappDialog
      open={pidiendoNumero}
      onOpenChange={setPidiendoNumero}
      clientId={clientId}
      clientName={clientName}
      ownerCountry={ownerCountry}
      onGuardado={(n) => void abrirWhatsapp(n)}
      onSeguirSinNumero={() => void abrirWhatsapp(null)}
    />
  );

  if (variant === "whatsapp-button") {
    return (
      <>
      {/* NOT `Button variant="outline"`, AND THAT IS THE POINT.
          Since the spec of 2026-10-04 this button lives INSIDE the client
          detail's dark header, on `--brand-primary`, which does not invert
          with the theme. `outline` brings `bg-background` — white in the light
          theme — so the variant would paint a white slab on a #272727 header.
          Its border is `--border` too, which in dark resolves to white at 10%
          and composites to ~#3f3f3f against this header: a button with no
          visible edge.

          Both colours come from the brand layer instead, which is the same
          reason the filter chips and the back arrow of the other dark headers
          are plain elements with explicit classes rather than variants.

          What it was: `text-[#128C4A] dark:text-[#25D366]`. #128C4A on #272727
          is 3,47:1 and its label is 17px, so the light theme failed the 4,5:1
          floor the moment the button moved up here. `--brand-whatsapp` is
          6,87:1 and the same value in both themes — see `globals.css`. */}
      <button
        type="button"
        disabled={pending}
        onClick={handleRemind}
        className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-brand-secondary px-4 text-[17px] text-brand-whatsapp outline-none transition-colors hover:bg-white/10 focus-visible:border-white focus-visible:ring-3 focus-visible:ring-white/40 disabled:pointer-events-none disabled:opacity-50"
      >
        Compartir saldo vía WhatsApp
        {pending ? (
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        ) : (
          <WhatsappIcon className="size-5" />
        )}
      </button>
      {dialogo}
      </>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" disabled={pending} onClick={handleShare} title="Compartir saldo">
        <Share2 className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" disabled={pending} onClick={handleRemind} title="Recordar por WhatsApp">
        <WhatsappIcon className="size-4" />
      </Button>
      {dialogo}
    </div>
  );
}
