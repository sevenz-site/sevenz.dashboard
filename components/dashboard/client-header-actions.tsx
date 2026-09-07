"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, MessageCircle, MoreVertical, RotateCcw, Share2, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getOrCreateShareLink } from "@/app/(app)/dashboard/actions";
import { hideClientPermanently, restoreClient, trashClient } from "@/app/(app)/clients/[id]/actions";
import { track } from "@/lib/mixpanel";

// Which confirmation is on screen. One state rather than a boolean per dialog:
// two AlertDialogs can never be open at once, and modelling it as two booleans
// is how they end up both true.
type Confirming = "none" | "trash" | "hide";

// The client detail header carries exactly two controls: Chat, which is the
// thing owners do many times a day, and More, which holds everything else.
// Sharing moved into the menu deliberately — it was a second icon competing
// for the same corner, and on a phone that corner is the whole header.
export function ClientHeaderActions({
  clientId,
  clientName,
  whatsapp,
  balanceText,
  owesMoney,
  hasMovements,
  trashedAt,
}: {
  clientId: string;
  clientName: string;
  whatsapp: string | null;
  // Pre-formatted by the caller — "$47.000,00" for a COP client, or
  // "$50.00 y €20.00" for a VE client with debt in both currencies. Keeps this
  // component currency-agnostic rather than re-deriving formatting logic that
  // already lives in formatLedgerAmount/formatCurrency.
  balanceText: string;
  // Drives which confirmation the owner sees. A client who owes money is the
  // case owners regret, so it gets a confirmation that says the amount out
  // loud; an empty record created by mistake gets a one-line one.
  owesMoney: boolean;
  hasMovements: boolean;
  // Non-null means this client is already in the Papelera, and the menu offers
  // the way back out instead of the way in.
  trashedAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // The confirmations live outside DropdownMenu on purpose. Selecting an item
  // closes the menu and unmounts its children, so an AlertDialog nested inside
  // one disappears in the same frame it was asked to open.
  const [confirming, setConfirming] = useState<Confirming>("none");
  const [busy, setBusy] = useState(false);
  const isTrashed = trashedAt !== null;

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

  // One message, both routes. They differ only in how it leaves the app —
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

  async function handleChat() {
    const url = await resolveUrl();
    if (!url) return;
    const phone = whatsapp ? whatsapp.replace(/\D/g, "") : "";
    const wa = `https://wa.me/${phone}?text=${encodeURIComponent(buildMessage(url))}`;
    window.open(wa, "_blank", "noopener,noreferrer");
    track("Share Link Opened", { client_id: clientId, method: "whatsapp" });
  }

  async function handleTrash() {
    setBusy(true);
    const result = await trashClient(clientId);
    setBusy(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setConfirming("none");
    toast.success(`${clientName} está en la papelera`, {
      description: "Puedes restaurarlo cuando quieras desde Papelera.",
    });
    track("Client Trashed", { client_id: clientId, owed_money: owesMoney });
    // The client is no longer on any list this page could go back to, and this
    // page now shows a client the owner just asked to stop seeing. Cartera is
    // where they expect to land.
    router.replace("/dashboard");
  }

  async function handleRestore() {
    setBusy(true);
    const result = await restoreClient(clientId);
    setBusy(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    toast.success(`${clientName} volvió a tu cartera`);
    track("Client Restored", { client_id: clientId, source: "client_detail" });
    router.refresh();
  }

  async function handleHide() {
    setBusy(true);
    const result = await hideClientPermanently(clientId);
    setBusy(false);
    if (result.error) {
      toast.error(result.error);
      return;
    }
    setConfirming("none");
    toast.success(`${clientName} quedó oculto definitivamente`);
    track("Client Hidden Permanently", { client_id: clientId, owed_money: owesMoney });
    router.replace("/dashboard");
  }

  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" disabled={pending} onClick={handleChat} title="Chat">
        <MessageCircle className="size-5" />
        <span className="sr-only">Chat por WhatsApp</span>
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" disabled={pending} title="Más">
            <MoreVertical className="size-5" />
            <span className="sr-only">Más opciones</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => void handleShare()}>
            <Share2 />
            Compartir enlace
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {isTrashed ? (
            <>
              <DropdownMenuItem disabled={busy} onSelect={() => void handleRestore()}>
                <RotateCcw />
                Restaurar cliente
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={() => setConfirming("hide")}>
                <EyeOff />
                Ocultar definitivamente
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem
              variant="destructive"
              // Radix closes the menu on select and the dialog opens from the
              // state below, one frame later — which is what keeps the dialog
              // mounted after its trigger is gone.
              onSelect={() => setConfirming("trash")}
            >
              <Trash2 />
              Mover a papelera
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog
        open={confirming === "trash"}
        onOpenChange={(open) => setConfirming(open ? "trash" : "none")}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {owesMoney ? `${clientName} todavía debe ${balanceText}` : `Mover a ${clientName} a la papelera`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {owesMoney ? (
                <>
                  Su deuda de <strong className="text-foreground">{balanceText}</strong> deja de contar en tu
                  Cartera, pero no se borra: el historial y el enlace de saldo siguen funcionando, y puedes
                  restaurarlo desde Papelera cuando quieras.
                </>
              ) : hasMovements ? (
                <>
                  Deja de aparecer en tus listas. Su historial se conserva completo y puedes restaurarlo desde
                  Papelera cuando quieras.
                </>
              ) : (
                <>Este cliente no tiene movimientos. Puedes restaurarlo desde Papelera cuando quieras.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              // The label repeats the destination rather than saying
              // "Confirmar" — the owner should be able to read the button alone
              // and know what it does.
              onClick={(e) => {
                e.preventDefault();
                void handleTrash();
              }}
            >
              {busy ? "Moviendo…" : "Mover a papelera"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirming === "hide"} onOpenChange={(open) => setConfirming(open ? "hide" : "none")}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ocultar a {clientName} definitivamente</AlertDialogTitle>
            <AlertDialogDescription>
              Deja de aparecer también en la Papelera y no vas a poder restaurarlo tú mismo. Su historial no se
              borra y su enlace de saldo sigue funcionando, para que pueda pagarte si algún día vuelve.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void handleHide();
              }}
            >
              {busy ? "Ocultando…" : "Ocultar definitivamente"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
