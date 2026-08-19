"use client";

import { useTransition } from "react";
import { Share2, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getOrCreateShareLink } from "@/app/(app)/dashboard/actions";
import { formatCurrency } from "@/lib/format";

export function ShareActions({
  clientId,
  clientName,
  whatsapp,
  balance,
}: {
  clientId: string;
  clientName: string;
  whatsapp: string | null;
  balance: number;
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
  }

  async function handleRemind() {
    const url = await resolveUrl();
    if (!url) return;
    const message = `Hola ${clientName}, tu saldo actual es ${formatCurrency(balance)}. Puedes verlo aquí: ${url}`;
    const phone = whatsapp ? whatsapp.replace(/\D/g, "") : "";
    const wa = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    window.open(wa, "_blank", "noopener,noreferrer");
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
