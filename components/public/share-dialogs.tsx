"use client";

import { useState } from "react";
import { DocumentIdDialog } from "@/components/public/document-id-dialog";
import { WhatsappConsentDialog } from "@/components/public/whatsapp-consent-dialog";

// UNA PREGUNTA POR VISITA, y este componente existe solo para recordar cuál ya
// se hizo.
//
// ─────────────────────────────────────────────────────────────────────────
// EL PROBLEMA QUE RESUELVE, MEDIDO Y NO SUPUESTO
//
// Los dos diálogos nunca se apilaron — la página ya condicionaba el de
// WhatsApp a que hubiera cédula. Lo que sí pasaba, medido en dev el
// 2026-10-09 con un cliente de prueba: `DocumentIdDialog` llama a
// `router.refresh()` al guardar, el Server Component se vuelve a renderizar
// con `has_document_id` ya en true, y el de WhatsApp se montaba EN EL ACTO.
//
// Así que un cliente nuevo contestaba dos preguntas seguidas antes de ver su
// saldo, que es lo único que vino a ver. Owner's decision, 2026-10-09: the
// WhatsApp question waits for the next visit whenever the cédula was asked
// for on this one. Ticket CT-48.
//
// ─────────────────────────────────────────────────────────────────────────
// POR QUÉ UN COMPONENTE Y NO QUITARLE EL `router.refresh()` AL OTRO
//
// Quitarlo también funcionaría, y en una línea: la página seguiría creyendo
// que no hay cédula durante el resto de la visita, así que no montaría el
// segundo diálogo. Se descartó.
//
// Dejaría la regla invisible. Nadie que lea `DocumentIdDialog` adivinaría que
// su `router.refresh()` —o su ausencia— decide si OTRO diálogo aparece, y el
// primero que lo restaure, con toda la razón del mundo, rompería esto sin
// enterarse. Aquí la regla está escrita en el sitio donde se aplica.
//
// ─────────────────────────────────────────────────────────────────────────
// CÓMO AGUANTA LA CUENTA
//
// `useState` toma su valor inicial en el PRIMER render y no vuelve a mirarlo.
// `router.refresh()` vuelve a pedir los datos del servidor y reconcilia sin
// desmontar los componentes de cliente, así que esta bandera sobrevive al
// refresh que es justo el que causaba el problema.
//
// Una carga nueva de la página sí crea una instancia nueva, y entonces ya hay
// cédula, la bandera nace en false y la pregunta de WhatsApp sale. Que es
// exactamente "la siguiente visita".
//
// NADA DE ESTO SE GUARDA EN EL NAVEGADOR, a propósito: dura lo que dura la
// página abierta y no pretende durar más. iOS Safari borra `localStorage` tras
// un tiempo inactivo, así que una bandera guardada ahí se evaporaría sola — y
// una que se evapora sola es peor que ninguna, porque nadie lo nota.
export function ShareDialogs({
  token,
  clientName,
  ownerCountry,
  hasDocumentId,
  canConsent,
  consentGranted,
  whatsappLast4,
}: {
  token: string;
  clientName: string;
  ownerCountry: "CO" | "VE" | null;
  hasDocumentId: boolean;
  // false when the client has no usable phone number: the permission is keyed
  // to the number (migration 081), so there would be nothing to store and the
  // dialog must not be shown. Also false when the state could not be read at
  // all — the page fails toward not asking.
  canConsent: boolean;
  consentGranted: boolean;
  whatsappLast4: string;
}) {
  // Captured once per page load. Deliberately has no setter: nothing may
  // change it mid-visit, because "did we already ask?" is a fact about this
  // visit and not a piece of state that evolves.
  const [askedForDocument] = useState(!hasDocumentId);

  // Captured for the same reason, and it closes a trap that only appears once
  // the client can switch the notifications OFF (MS-31).
  //
  // Owner's decision, 2026-10-09: after revoking, the question DOES come back
  // on later visits. That overrides the rule written for the owner in
  // lib/whatsapp-opt-in.ts, where `whatsapp_opt_out_at` ends the asking for
  // good — both are recorded because if this is ever reverted, the older
  // reasoning is already here: a person who said no and keeps being asked has
  // only one way to make it stop, and that way is blocking the number.
  //
  // "Later visits" is the whole point, though. Reading the live prop instead
  // would mean revoking from Configuración drops `consentGranted` to false,
  // the server re-renders, and the "Te avisamos de tu saldo" dialog opens on
  // top of someone who just finished saying no. Freezing it at arrival makes
  // the rule what it says: not this visit, the next one.
  const [grantedOnArrival] = useState(consentGranted);

  return (
    <>
      <DocumentIdDialog
        token={token}
        clientName={clientName}
        ownerCountry={ownerCountry}
        hasDocumentId={hasDocumentId}
      />
      {!askedForDocument && canConsent && !grantedOnArrival ? (
        <WhatsappConsentDialog token={token} whatsappLast4={whatsappLast4} />
      ) : null}
    </>
  );
}
