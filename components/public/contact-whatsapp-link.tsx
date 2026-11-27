"use client";

import { WhatsappIcon } from "@/components/icons/whatsapp";
import { cn } from "@/lib/utils";
import { PUBLIC_CONTACT_BUTTON, PUBLIC_CONTACT_TONE } from "@/components/public/contact-button-styles";
import { cameFromBalance, sendPublicEvent } from "@/components/public/public-event";

// El botón "Contactar vía WhatsApp" de la pantalla del cliente, con su aviso
// a Mixpanel. Lo que mide y por qué está en `app/api/share-contact/route.ts`,
// junto al evento; aquí solo queda cómo se envía.
//
// SIGUE SIENDO UN `<a>` Y NO SE INTERCEPTA EL CLIC. La navegación a `wa.me`
// ocurre como siempre: no hay `preventDefault`, no se espera a nada y no se
// abre nada por JavaScript. Si el aviso falla, se pierde el dato y el cliente
// escribe igual, que es el orden correcto de prioridades en una pantalla cuyo
// único propósito es que esa persona resuelva su duda.
//
// `keepalive` es lo que hace que esto funcione: sin él el navegador cancela
// la petición en cuanto el mismo clic se lleva la página por delante, que es
// exactamente cuando ocurre. Es la misma razón por la que `lib/mixpanel.ts`
// lo usa desde que se escribió.
//
// ALSO THE CATALOGUE'S BUTTON since 2026-11-26 (migration 225, frames `2291:25034`), so
// the customer sees one button on his balance and on the catalogue, not two lookalikes.
// Two things the catalogue needs that the balance page did not:
//   - `token` is OPTIONAL and is a BALANCE token: `/api/share-contact` resolves it to its
//     owner, and a catalogue has none. The catalogue passes `catalogToken` instead, and
//     the tap goes through `/api/public-event` as `catalog_whatsapp_tapped` (owner's
//     decision of 2026-11-27, «medirlo en esta versión»; the question it answers is in
//     `lib/analytics/public-events.ts`). With neither, nothing is sent: that is the
//     owner's «Ver cómo queda» preview, where the person tapping is the shopkeeper.
//   - `tone="light"` for the catalogue's white header (CatalogBrandHeader). The dark
//     tone's green, `--brand-whatsapp` #7EC070, is 2.2:1 on white: unreadable. The light
//     tone takes `emerald-700`, the green of the order screen's «Contactar vía WhatsApp»,
//     on white already (5.5:1).

export function ContactWhatsappLink({
  token,
  catalogToken,
  href,
  tone = "dark",
  className,
}: {
  token?: string;
  catalogToken?: string;
  href: string;
  tone?: "dark" | "light";
  className?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        if (!token) {
          // `sendPublicEvent` never throws and uses `keepalive`, like the fetch below.
          if (catalogToken) {
            sendPublicEvent(catalogToken, "catalog_whatsapp_tapped", { from_balance: cameFromBalance() });
          }
          return;
        }
        try {
          void fetch("/api/share-contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
            keepalive: true,
          }).catch(() => {
            // Un fallo de analítica no puede asomar en la consola del cliente
            // ni convertirse en una promesa rechazada sin dueño.
          });
        } catch {
          // Por lo mismo.
        }
      }}
      /* LOS MISMOS TOKENS QUE «Compartir saldo vía WhatsApp» de la ficha del
         cliente, desde el 2026-10-17 y a petición del dueño. Los dos botones
         dicen lo mismo a los dos lados del mismo trato y ahora viven los dos
         sobre `--brand-primary`, así que no hay razón para que se vean
         distintos.

         LO QUE HABÍA ERA ADEMÁS ILEGIBLE, y la razón ya estaba escrita en
         `share-actions.tsx` cuando ese botón subió a su cabecera oscura:
         `#128C4A` —que es `emerald-700`— sobre `#272727` da 3,47:1, por
         debajo del piso de 4,5:1. `--brand-whatsapp` da 6,87:1 y vale igual
         en los dos temas. Y el `border` a secas resuelve a `--border`, que
         sobre este fondo compone un gris casi idéntico al fondo: un botón sin
         borde visible. `--brand-secondary` sí se ve.

         `h-10` y `text-[17px]`, también del otro: la altura que `DESIGN-SYSTEM.md`
         pide para cualquier botón con etiqueta, y que despeja un pulgar. */
      className={cn(
        PUBLIC_CONTACT_BUTTON,
        PUBLIC_CONTACT_TONE[tone],
        tone === "dark" ? "text-brand-whatsapp" : "text-emerald-700",
        className,
      )}
    >
      {/* El nombre del negocio está en el encabezado, justo encima. El botón
          lo repetía y en un nombre largo se partía en dos líneas. */}
      Contactar vía WhatsApp
      {/* El icono va DETRÁS del texto, como en "Compartir saldo vía WhatsApp"
          de la ficha del cliente: los dos botones dicen lo mismo a los dos
          lados del mismo trato, y tenerlos espejados se leía como dos cosas
          distintas. */}
      <WhatsappIcon className="size-5 shrink-0" />
    </a>
  );
}
