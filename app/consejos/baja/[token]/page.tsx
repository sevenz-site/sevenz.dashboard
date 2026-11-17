import Image from "next/image";
import type { Metadata } from "next";
import { verifyUnsubscribeToken } from "@/lib/inactivity-nudge/unsubscribe-token";
import { ConfirmUnsubscribe } from "./confirm";

// THE LINK AT THE FOOT OF A NUDGE EMAIL (MS-53, owner's decisions of 2026-11-17: «También
// correo», with one-click unsubscribe). It turns off «Consejos de Sevenz», on both channels,
// and nothing else: the Monday summary and the Thursday notice stay.
//
// GET ONLY LOOKS; THE TAP UNSUBSCRIBES. Mail clients and link scanners open URLs on their own,
// and a scanner must not unsubscribe anybody. The mail client's own «unsubscribe» button does
// not come here: it POSTs to /api/consejos/baja, which RFC 8058 allows to act at once.
//
// PUBLIC BY DESIGN: the email is read with no session. The proxy exempts `/consejos/baja/`.
// The token is checked here only to choose the screen; the action checks it again before
// writing. Nothing from the database is shown, so there is nothing to mask.

export const metadata: Metadata = {
  title: "Sevenz — Consejos de Sevenz",
  robots: { index: false, follow: false },
};

// `titulo` is optional: the valid link's heading lives in `ConfirmUnsubscribe`, which changes it
// once the tap succeeds.
function Marco({ titulo, children }: { titulo?: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <Image src="/fav-icon-primary.svg" alt="Sevenz" width={48} height={48} className="size-12" />
      {titulo ? <h1 className="text-xl font-semibold">{titulo}</h1> : null}
      {children}
      <p className="pt-4 text-xs leading-relaxed text-muted-foreground">
        Sevenz nunca te pide tu contraseña ni códigos. Esta página tampoco.
      </p>
    </main>
  );
}

export default async function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!verifyUnsubscribeToken(decodeURIComponent(token))) {
    return (
      <Marco titulo="Este enlace no es válido">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Puedes desactivar los consejos de Sevenz en Mi negocio, en Notificaciones.
        </p>
      </Marco>
    );
  }
  return (
    <Marco>
      <ConfirmUnsubscribe token={decodeURIComponent(token)} />
    </Marco>
  );
}
