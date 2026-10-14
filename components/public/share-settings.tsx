"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, MoreVertical, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WhatsappConsentDialog } from "@/components/public/whatsapp-consent-dialog";
import { WhatsappDeactivateDialog } from "@/components/public/whatsapp-deactivate-dialog";

// ⋮ › Configuración › Notificaciones — the way a client reaches their own
// notification setting. Figma frame 1156:5063, owner's flow of 2026-10-09.
// MS-31.
//
// ─────────────────────────────────────────────────────────────────────────
// CONFIGURACIÓN IS A LAYER, NOT A ROUTE
//
// Owner's decision, 2026-10-09. `/s/[token]/configuracion` would have given a
// working browser Back for free, and was turned down for one reason: it is one
// more public endpoint hanging off a share token. `/s/[token]/perfil` was
// exactly that shape and had to be closed — see the dead `uploadProfilePicture`
// in app/s/[token]/actions.ts, which is still there as an explicit refusal
// precisely because removing a page does not stop anyone calling what it used.
//
// So the cost is paid knowingly: the browser's Back button leaves the site
// instead of returning to the balance. The arrow in the corner is the way
// back, and it works.
//
// ─────────────────────────────────────────────────────────────────────────
// AND IT IS NOT A RADIX DIALOG EITHER
//
// A plain fixed layer. If this were a `Dialog` or a `Sheet`, the two dialogs it
// opens would be nested inside one — and DESIGN-SYSTEM.md has a whole section
// on what that costs: a modal Radix Dialog sets `pointer-events: none` on the
// body and only re-enables it inside its own layers, so anything portalled as a
// sibling stops receiving TAPS while still looking perfect and working with a
// keyboard. It cost a library install and removal on 2026-09-20, and the fix
// was not a better library — it was removing the nesting.
//
// Radix handles Radix-inside-Radix, so this would probably have been fine. But
// "probably fine" on the surface the shopkeeper's customers use from cheap
// phones is not worth the saving, and flattening it costs nothing.
export function ShareSettings({
  token,
  whatsappLast4,
  canConsent,
  granted,
}: {
  token: string;
  whatsappLast4: string;
  // false when the client has no usable phone number. The permission is keyed
  // to the number (migration 081), so there is nothing to switch — and the row
  // says so instead of opening a dialog whose only control does nothing.
  canConsent: boolean;
  granted: boolean;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const backRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Set while the menu is closing BECAUSE its item opened the layer. See
  // onCloseAutoFocus below.
  const openingPanel = useRef(false);

  // RETURNING FOCUS IS OURS TO DO, and that is not the usual deal with Radix.
  // Normally its FocusScope restores focus to the trigger when a menu closes;
  // here it cannot, because the menu never unmounts (it sits at
  // `data-state="closed"` forever) and the restore runs on unmount. Measured
  // on 2026-10-09: without this, closing the layer left focus on `<body>` and
  // closing the menu with Escape left it on a menu item nobody can see.
  const focusTrigger = () => triggerRef.current?.focus();

  // Escape closes the layer, the way it would close a dialog. Written by hand
  // because this is deliberately not a Dialog (see above), and losing Escape
  // along with the nesting would be a real regression for anyone on a keyboard.
  // Skipped while a dialog is open: that dialog's own Escape has to win, or one
  // key press would close both and dump the person on the balance.
  useEffect(() => {
    if (!settingsOpen || notificationsOpen || deactivateOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSettingsOpen(false);
      focusTrigger();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [settingsOpen, notificationsOpen, deactivateOpen]);

  // Focus lands on the way out, not on the title: whoever opened this with a
  // keyboard or a screen reader needs to know how to leave before they need to
  // know what is here. One row deep, that is the whole screen.
  //
  // This only sticks because the menu above is `modal={false}`. With the
  // default, Radix's focus trap pulled it straight back to the hidden menu
  // item — measured, twice, on 2026-10-09.
  useEffect(() => {
    if (settingsOpen) backRef.current?.focus();
  }, [settingsOpen]);

  // Every exit from the notification flow lands on the balance, per the flow's
  // own annotation — not back on Configuración, which is a place the person
  // never meant to be.
  function closeEverything() {
    setNotificationsOpen(false);
    setDeactivateOpen(false);
    setSettingsOpen(false);
    focusTrigger();
  }

  return (
    <>
      {/* `modal={false}` no es cosmético. Radix deja este menú MONTADO con
          `data-state="closed"` para siempre —medido en dev el 2026-10-09, la
          misma conducta que DESIGN-SYSTEM.md documenta para los diálogos— así
          que su FocusScope sigue vivo y atrapado. Con el trampa puesta, el
          foco que esta pantalla intenta llevar a la flecha de volver se lo
          devuelve al ítem oculto, y quien navega con teclado o lector queda en
          un elemento que ya no se ve.

          De paso quita el `pointer-events: none` que un Radix modal pone en el
          `<body>`, que es justo el mecanismo de la trampa de los popups
          anidados del DESIGN-SYSTEM. Un menú de un solo ítem no necesita
          atrapar nada. */}
      <DropdownMenu
        modal={false}
        onOpenChange={(open) => {
          // Al cerrarse sin haber elegido nada. Si el ítem abrió la capa, el
          // foco va a la flecha de volver y no aquí.
          if (!open && !openingPanel.current) focusTrigger();
        }}
      >
        <DropdownMenuTrigger asChild>
          {/* No back arrow beside it. The mockup drew one, and the owner
              dropped it on 2026-10-09: the client arrives from a WhatsApp
              message with no history, so an arrow there would either do
              nothing or leave the site — and a control that does nothing
              teaches that Sevenz's controls sometimes do nothing, on the one
              screen that most needs to look trustworthy. */}
          <Button ref={triggerRef} variant="ghost" size="icon" aria-label="Más opciones">
            <MoreVertical className="size-5" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          // MEASURED IN DEV ON 2026-10-09, not assumed. Radix returns focus to
          // the trigger when the menu closes, and it does so AFTER the effect
          // below has run — so focus ended on the ⋮ button, now sitting behind
          // the full-screen layer. Invisible on a touch screen and a dead end
          // with a keyboard or a screen reader: the next Tab walks through a
          // page the person cannot see.
          //
          // Only when the item opened the layer. Closing the menu any other
          // way — Escape, tapping outside — still returns focus to the
          // trigger, which is correct there and is what Radix does for free.
          onCloseAutoFocus={(e) => {
            if (!openingPanel.current) return;
            openingPanel.current = false;
            e.preventDefault();
            // Moved here from an effect, after measuring twice. The effect ran
            // the instant `settingsOpen` flipped, and Radix keeps the menu
            // mounted through its exit animation and then takes focus back —
            // so the focus landed on the back button and was pulled onto the
            // menu item a moment later. This callback IS the moment Radix
            // hands focus over, which makes it the only place that wins.
            backRef.current?.focus();
          }}
        >
          <DropdownMenuItem
            onSelect={() => {
              openingPanel.current = true;
              setSettingsOpen(true);
            }}
          >
            <Settings aria-hidden="true" />
            Configuración
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {settingsOpen ? (
        <div
          className="fixed inset-0 z-40 overflow-y-auto bg-background"
          role="group"
          aria-label="Configuración"
        >
          <div className="mx-auto flex w-full max-w-md flex-col gap-6 p-4">
            <Button
              ref={backRef}
              variant="ghost"
              size="icon"
              aria-label="Volver a mi saldo"
              onClick={() => {
                setSettingsOpen(false);
                focusTrigger();
              }}
              className="-ml-2 self-start"
            >
              <ArrowLeft className="size-6" aria-hidden="true" />
            </Button>

            <h1 className="text-xl font-medium">Configuración</h1>

            {/* One row, so no list abstraction. The chevron-row pattern is
                written out by hand in five other places in this codebase and
                inventing a component for a single use would be the sixth
                variant, not the first standard. */}
            <button
              type="button"
              onClick={() => setNotificationsOpen(true)}
              className="flex h-14 w-full items-center justify-between rounded-lg border px-4 text-left text-sm transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring"
            >
              <span>Notificaciones</span>
              <ChevronRight className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>

            {/* Said out loud rather than left as a dead row. Without a number
                stored there is nothing to switch on, and the only person who
                can fix that is the shopkeeper. */}
            {canConsent ? null : (
              <p className="text-xs leading-relaxed text-muted-foreground">
                Para recibir avisos, el negocio necesita tener tu número de WhatsApp
                registrado.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {notificationsOpen ? (
        <WhatsappConsentDialog
          token={token}
          whatsappLast4={whatsappLast4}
          mode="manage"
          granted={granted}
          open={notificationsOpen && !deactivateOpen}
          onOpenChange={(next) => {
            setNotificationsOpen(next);
            // Closing this one with its own X or Escape goes all the way out,
            // like the two buttons do.
            if (!next && !deactivateOpen) setSettingsOpen(false);
          }}
          onRequestDeactivate={() => setDeactivateOpen(true)}
        />
      ) : null}

      <WhatsappDeactivateDialog
        token={token}
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        onDeactivated={closeEverything}
      />
    </>
  );
}
