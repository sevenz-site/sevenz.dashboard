"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { WhatsappIcon } from "@/components/icons/whatsapp";
import { Button } from "@/components/ui/button";
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
// the only Sevenz surface they ever touch. MS-25, mockup of 2026-10-08.
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
//
// The page also will not mount both at once — see the comment at the mount
// site. A non-dismissible dialog underneath a dismissible one would trap the
// client behind two layers over the balance they came to read.
export function WhatsappConsentDialog({
  token,
  // Already in the payload and already shown by VerifyBadge, so no new
  // disclosure: it is the last four digits, never the number. It is here
  // because the whole point of the number mattering is that the client can
  // notice their shopkeeper wrote down the wrong one — and a wrong number
  // means a stranger receives their balance.
  whatsappLast4,
}: {
  token: string;
  whatsappLast4: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [saving, startTransition] = useTransition();

  // Not `return null` on close: Radix needs the Dialog mounted to run its exit
  // animation, and unmounting mid-animation is what leaves a stuck overlay
  // (DESIGN-SYSTEM.md). After accepting, `router.refresh()` re-renders the
  // Server Component, which then stops mounting this at all.
  if (accepted && !open) return null;

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
      // The parent Server Component decided whether to mount this from data
      // fetched at page load, so without this the page keeps believing there
      // is no permission until a manual reload — and would ask again on the
      // next navigation within the page.
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
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
          {/* THE EXACT STRING THAT GETS STORED. Not a paraphrase of the
              consent: it IS the consent. If this line and
              TEXTO_AVISOS_WHATSAPP_CLIENTE ever stopped matching, the evidence
              we would show Meta would be false — which is worse than having
              none, because it reads as proof. */}
          <p className="text-sm leading-relaxed">{TEXTO_AVISOS_WHATSAPP_CLIENTE}</p>

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
              what most people will reach for. */}
          <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>
            Dejar para luego
          </Button>
          <Button type="button" disabled={saving} onClick={accept}>
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
