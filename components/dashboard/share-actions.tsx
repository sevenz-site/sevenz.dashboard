"use client";

import { useTransition } from "react";
import { Share2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getOrCreateShareLink } from "@/app/(app)/dashboard/actions";
import { track } from "@/lib/mixpanel";

export function ShareActions({
  clientId,
  clientName,
  whatsapp,
  balanceText,
}: {
  clientId: string;
  clientName: string;
  whatsapp: string | null;
  // Pre-formatted by the caller — "$47.000,00" for a COP client, or
  // "$50.00 y €20.00" for a VE client with debt in both currencies. Keeps
  // this component currency-agnostic rather than re-deriving formatting
  // logic that already lives in formatLedgerAmount/formatCurrency.
  balanceText: string;
}) {
  const [pending, startTransition] = useTransition();

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

  async function handleRemind() {
    const url = await resolveUrl();
    if (!url) return;
    const phone = whatsapp ? whatsapp.replace(/\D/g, "") : "";
    const wa = `https://wa.me/${phone}?text=${encodeURIComponent(buildMessage(url))}`;
    window.open(wa, "_blank", "noopener,noreferrer");
    track("Share Link Opened", { client_id: clientId, method: "whatsapp" });
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" disabled={pending} onClick={handleShare} title="Compartir saldo">
        <Share2 className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" disabled={pending} onClick={handleRemind} title="Recordar por WhatsApp">
        <MessageCircle className="size-4" />
      </Button>
    </div>
  );
}
