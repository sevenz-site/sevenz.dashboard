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

  async function handleShare() {
    const url = await resolveUrl();
    if (!url) return;
    await navigator.clipboard.writeText(url);
    toast.success("Link copiado", { description: url });
    track("Share Link Opened", { client_id: clientId, method: "copy" });
  }

  async function handleRemind() {
    const url = await resolveUrl();
    if (!url) return;
    const message = `Hola ${clientName}, tu saldo actual es ${balanceText}. Puedes verlo aquí: ${url}`;
    const phone = whatsapp ? whatsapp.replace(/\D/g, "") : "";
    const wa = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
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
