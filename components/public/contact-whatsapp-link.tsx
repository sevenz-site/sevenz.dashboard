"use client";

import { WhatsappIcon } from "@/components/icons/whatsapp";

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
export function ContactWhatsappLink({ token, href }: { token: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
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
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-500/10"
    >
      {/* El nombre del negocio está en el encabezado, justo encima. El botón
          lo repetía y en un nombre largo se partía en dos líneas. */}
      Contactar vía WhatsApp
      {/* El icono va DETRÁS del texto, como en "Compartir saldo vía WhatsApp"
          de la ficha del cliente: los dos botones dicen lo mismo a los dos
          lados del mismo trato, y tenerlos espejados se leía como dos cosas
          distintas. */}
      <WhatsappIcon className="size-4" />
    </a>
  );
}
