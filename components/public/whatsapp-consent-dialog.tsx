"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { WhatsappIcon } from "@/components/icons/whatsapp";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { acceptWhatsappConsent } from "@/app/s/[token]/actions";
import { TEXTO_AVISOS_WHATSAPP_CLIENTE } from "@/lib/whatsapp-opt-in";

// "¿Te avisamos de tu saldo?" — the permission the final customer gives, on
// the only Sevenz surface they ever touch. MS-25, mockup of 2026-10-08,
// extended with the switch on 2026-10-09 (frame 1156:5063).
//
// ─────────────────────────────────────────────────────────────────────────
// ONE DIALOG, TWO MODES, AND WHY IT IS NOT TWO COMPONENTS
//
// "ask"    — the first-visit question. No switch; "Aceptar" / "Dejar para
//            luego". Comes back every visit until answered.
// "manage" — reached on purpose from Configuración › Notificaciones. The
//            switch shows the current state and IS the only control that does
//            anything; "Aceptar" merely closes.
//
// They share the sentence in the box, and that sentence is the evidence stored
// in the ledger. Two components would be two places for it to drift, and the
// day they drift is the day what we could show Meta stops matching what the
// person read. The copy lives in one constant precisely so this cannot happen,
// and splitting the component would walk it back.
//
// ─────────────────────────────────────────────────────────────────────────
// IT COMES BACK ON EVERY VISIT, AND THAT IS THE DECISION
//
// Owner's decision, 2026-10-08: shown on every visit until accepted. There is
// no counter and no cooldown, unlike the owner's version
// (`tocaPreguntarAvisos()` stops after three asks over 59 days).
//
// The reason the two differ is that the two audiences differ. The owner opens
// Sevenz twenty times a day, so asking again is nagging. The client opens
// their link when the shopkeeper sends it — maybe once a month. Three asks
// would be spent in a quarter and the question would be gone forever.
//
// Nothing is stored when it is dismissed, on purpose. A "shown N times" count
// would need either a column per client or browser storage, and browser
// storage is the one thing CLAUDE.md says never to depend on: iOS Safari wipes
// localStorage after a period of inactivity, so the count would reset itself
// and the "never ask again" it bought would evaporate anyway.
//
// ─────────────────────────────────────────────────────────────────────────
// WHY IT IS DISMISSIBLE WHEN DocumentIdDialog IS NOT
//
// That one blocks the page because the thing it asks for benefits the person
// asking and is needed to find their own record. This one asks permission to
// send them messages, and a permission dialog you cannot refuse is not asking.
// The X, Escape and tapping outside all mean "later" and write nothing.
export function WhatsappConsentDialog({
  token,
  // Already in the payload and already shown by VerifyBadge, so no new
  // disclosure: it is the last four digits, never the number. It is here
  // because the whole point of the number mattering is that the client can
  // notice their shopkeeper wrote down the wrong one — and a wrong number
  // means a stranger receives their balance.
  whatsappLast4,
  mode = "ask",
  // "manage" only: whether permission is currently given, which is what the
  // switch shows.
  granted = false,
  // "manage" only: the switch moving to off does not revoke here. It asks the
  // parent to put the confirmation in front of the person first, because the
  // consequence is not obvious from the control.
  onRequestDeactivate,
  open = true,
  onOpenChange,
}: {
  token: string;
  whatsappLast4: string;
  mode?: "ask" | "manage";
  granted?: boolean;
  onRequestDeactivate?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [selfOpen, setSelfOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [saving, startTransition] = useTransition();

  // "ask" owns its own open state (the page mounts it and walks away);
  // "manage" is driven by Configuración, which has to survive the dialog
  // closing to show the confirmation on top of itself.
  const isOpen = mode === "manage" ? open : selfOpen;
  const setOpen = (next: boolean) => {
    if (mode === "manage") onOpenChange?.(next);
    else setSelfOpen(next);
  };

  // Not `return null` on close: Radix needs the Dialog mounted to run its exit
  // animation, and unmounting mid-animation is what leaves a stuck overlay
  // (DESIGN-SYSTEM.md). After accepting, `router.refresh()` re-renders the
  // Server Component, which then stops mounting this at all.
  if (mode === "ask" && accepted && !selfOpen) return null;

  function accept() {
    setError(null);
    startTransition(async () => {
      const result = await acceptWhatsappConsent(token);
      if (result.error) {
        setError(result.error);
        return;
      }
      setAccepted(true);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={isOpen}
      // Plain setter: the X, Escape and tapping outside all mean "later". They
      // write nothing, which is why the question can come back next visit.
      onOpenChange={(next) => {
        if (!saving) setOpen(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WhatsappIcon className="size-5 shrink-0 text-brand-whatsapp" aria-hidden="true" />
            ¿Te avisamos de tu saldo?
          </DialogTitle>
          <DialogDescription>
            Te escribimos cuando se acerque la fecha de pago, para que no se te pase.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex items-start justify-between gap-4">
            {/* THE EXACT STRING THAT GETS STORED. Not a paraphrase of the
                consent: it IS the consent. If this line and
                TEXTO_AVISOS_WHATSAPP_CLIENTE ever stopped matching, the
                evidence we would show Meta would be false — which is worse
                than having none, because it reads as proof. */}
            <p className="text-sm leading-relaxed">{TEXTO_AVISOS_WHATSAPP_CLIENTE}</p>
            {mode === "manage" ? (
              <Switch
                checked={granted}
                disabled={saving}
                aria-label="Recibir avisos por WhatsApp"
                onCheckedChange={(next) => {
                  // Turning it ON is immediate: saying yes needs no
                  // confirmation. Turning it OFF goes through the parent,
                  // which shows what is lost first.
                  if (next) accept();
                  else onRequestDeactivate?.();
                }}
              />
            ) : null}
          </div>

          {/* Empty when the shopkeeper never wrote the number down. The page
              does not mount the dialog in that case, so this should be
              unreachable — checked anyway rather than printing "terminado en
              ." if that condition ever changes. */}
          {whatsappLast4 ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Te llegará al número que tiene registrado el negocio, terminado en{" "}
              <span className="font-medium tabular-nums">{whatsappLast4}</span>. Si no es tu
              número, pídele al negocio que lo corrija.
            </p>
          ) : null}
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter>
          {/* "Dejar para luego" and the X do the same thing, and both are
              offered on purpose: the X is a 24px target in a corner and this
              is a question about money on a cheap phone. The visible verb is
              what most people will reach for.

              In "manage" there is nothing to postpone — the person came here
              deliberately — so the pair collapses to one button that closes,
              matching the mockup. */}
          {mode === "ask" ? (
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              Dejar para luego
            </Button>
          ) : null}
          <Button
            type="button"
            disabled={saving}
            onClick={mode === "manage" ? () => setOpen(false) : accept}
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Guardando...
              </>
            ) : (
              "Aceptar"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
