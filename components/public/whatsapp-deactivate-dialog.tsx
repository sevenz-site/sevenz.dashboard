"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { revokeWhatsappConsent } from "@/app/s/[token]/actions";

// "¿Seguro que quieres desactivar estas notificaciones?" — the last step
// before MS-31's way out. Figma frame 1156:5063, owner's flow of 2026-10-09.
//
// ─────────────────────────────────────────────────────────────────────────
// THE SAFE WAY OUT IS THE HEAVY BUTTON, AND IT IS NOT A STYLE CHOICE
//
// "Regresar" is filled; "Desactivar" is red text with no fill
// (`variant="destructiveText"`, added for this screen). The pair has to lean
// toward the reversible action, and `variant="destructive"` would not do it:
// it carries a `bg-destructive/10`, which weighs as much as the filled button
// beside it and turns a confirmation into a coin toss.
//
// ─────────────────────────────────────────────────────────────────────────
// THE COPY, AND THE ONE WORD THAT CHANGED
//
// The spec read "Un buen puntaje de crédito afectarán tus acceso a futuros
// créditos." Owner's decision, 2026-10-09: fix the grammar, keep the meaning.
// So: "un mal", "afectará", "tu acceso". The original said a GOOD score would
// affect you, which inverts the warning it is making.
//
// Nothing else was touched. The score it refers to is real — `lib/credit-score.ts`,
// built from whether charges are paid inside their plazo — but worth knowing
// before anyone edits this: THE CLIENT HAS NEVER SEEN IT. It is rendered on the
// shopkeeper's side only, never on /s/[token]. The sentence is therefore a
// warning about a consequence the person cannot go and check, which is a
// reason to keep it short and never to make it more specific.
//
// ─────────────────────────────────────────────────────────────────────────
// EVERY EXIT LANDS BACK ON THE BALANCE
//
// "Regresar", "Desactivar" and the X all close the whole settings stack and
// return to the shared link view — per the flow's own annotation. Deliberate:
// after answering a question about notifications, dropping the person back
// into a settings screen asks them to find their own way out of somewhere they
// never meant to be.
export function WhatsappDeactivateDialog({
  token,
  open,
  onOpenChange,
  // Called after the permission really is withdrawn, so the parent can close
  // the settings stack. Not called when it fails: an error leaves the person
  // where they are, with the message, instead of silently pretending.
  onDeactivated,
}: {
  token: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeactivated: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [saving, startTransition] = useTransition();

  function deactivate() {
    setError(null);
    startTransition(async () => {
      const result = await revokeWhatsappConsent(token);
      if (result.error) {
        setError(result.error);
        return;
      }
      onOpenChange(false);
      onDeactivated();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
        // The X means "no", same as Regresar, and it also leaves the settings
        // stack — the flow says any of the three exits lands on the balance.
        if (!next) onDeactivated();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>¿Seguro que quieres desactivar estas notificaciones?</DialogTitle>
          {/* The visible explanation is the pair of paragraphs below, which
              carry two different weights. This copy exists for a screen
              reader, which announces the dialog before reaching its body. */}
          <DialogDescription className="sr-only">
            Si las desactivas, Sevenz dejará de avisarte por WhatsApp de tu saldo y de tus
            plazos de pago.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed font-medium">
            Un mal puntaje de crédito afectará tu acceso a futuros créditos.
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            El objetivo de estas notificaciones es ayudarte a mantener tus deudas saldadas
          </p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <DialogFooter className="sm:flex-col-reverse sm:justify-start">
          {/* Order matters more than usual here, and so does that override.
              DialogFooter is `flex-col-reverse` on a phone — so the LAST child
              renders on top, which has to be "Regresar", the way out that
              changes nothing. But it flips to `sm:flex-row` above 640px, and
              `sm:` is the VIEWPORT, not this dialog: on a laptop the pair would
              become a row and "Desactivar" would land first in reading order,
              beside a button of a different weight. Stacked at every width
              keeps the hierarchy the mockup asked for. */}
          <Button
            type="button"
            variant="destructiveText"
            disabled={saving}
            onClick={deactivate}
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Desactivando...
              </>
            ) : (
              "Desactivar"
            )}
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => {
              onOpenChange(false);
              onDeactivated();
            }}
          >
            Regresar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
