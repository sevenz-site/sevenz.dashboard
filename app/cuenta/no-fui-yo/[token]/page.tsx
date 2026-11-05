import Image from "next/image";
import type { Metadata } from "next";
import { createServiceClient } from "@/lib/supabase/service";
import { hashNotMeToken } from "@/lib/security/new-device";
import { ConfirmNotMe } from "./confirm";

// «NO FUI YO» (C2 of PL-22). The button of the WhatsApp `new_device_login_alert` lands here.
//
// THE PAGE ASKS FOR NOTHING. Not a password, not a code, not a name: a message with a link
// about the safety of an account is exactly what a scammer imitates, and the one defence is
// that Sevenz's never asks for anything. It shows one button, «Sí, cerrar todas las
// sesiones», and that is the whole screen.
//
// GET ONLY LOOKS; THE TAP CLOSES. WhatsApp, link scanners and a curious preview fetch URLs
// without anyone deciding to. If the GET consumed the token, a shopkeeper would be signed out
// of every device by a bot. `peek_not_me_token` reads; `confirmNotMe` (the server action)
// consumes, closes every session and starts the password reset.
//
// PUBLIC BY DESIGN: the owner has no session on the phone that taps this, and if the thief
// is the one signed in, that is the session to end. The proxy exempts `/cuenta/no-fui-yo/`.
// Errors are masked (CLAUDE.md): three fixed sentences, nothing from the database.

export const metadata: Metadata = {
  title: "Sevenz — Proteger tu cuenta",
  robots: { index: false, follow: false },
};

function Marco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-4 px-4 py-10 text-center">
      <Image src="/fav-icon-primary.svg" alt="Sevenz" width={48} height={48} className="size-12" />
      <h1 className="text-xl font-semibold">{titulo}</h1>
      {children}
      <p className="pt-4 text-xs leading-relaxed text-muted-foreground">
        Sevenz nunca te pide tu contraseña ni códigos por WhatsApp. Esta página tampoco.
      </p>
    </main>
  );
}

export default async function NoFuiYoPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const hash = hashNotMeToken(token);

  let estado: "valido" | "usado" | "caducado" | "invalido" = "invalido";
  if (hash) {
    try {
      const { data, error } = await createServiceClient().rpc("peek_not_me_token", { p_token_hash: hash });
      const r = (error ? null : data) as { ok?: boolean; code?: string | null } | null;
      if (r?.ok) estado = "valido";
      else if (r?.code === "used") estado = "usado";
      else if (r?.code === "expired") estado = "caducado";
      if (error) console.error("[no fui yo] peek:", error.message);
    } catch (e) {
      console.error("[no fui yo]:", e instanceof Error ? e.message : e);
    }
  }

  // Also what the owner sees right after tapping the button: Next re-renders the page
  // once the action returns, and by then the token is used. So this reads as the
  // confirmation, not as a complaint about a second visit.
  if (estado === "usado") {
    return (
      <Marco titulo="Listo: las sesiones están cerradas">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Cerramos todas las sesiones de tu cuenta, en todos los aparatos. Te enviamos un enlace al correo para elegir una contraseña nueva; hasta que la cambies, nadie puede entrar con la anterior. Este enlace ya no hace nada más.
        </p>
      </Marco>
    );
  }
  if (estado === "caducado") {
    return (
      <Marco titulo="Este enlace caducó">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Vale 24 horas. Si todavía quieres cerrar las sesiones de tu cuenta, entra a Sevenz, abre el menú y elige «Cerrar sesión en todos mis dispositivos».
        </p>
      </Marco>
    );
  }
  if (estado === "invalido") {
    return (
      <Marco titulo="Este enlace no es válido">
        <p className="text-sm leading-relaxed text-muted-foreground">
          Si llegaste aquí desde un mensaje que no era de Sevenz, no hagas nada más y avísanos.
        </p>
      </Marco>
    );
  }

  return (
    <Marco titulo="¿No fuiste tú?">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Si no reconoces ese inicio de sesión, cerramos todas las sesiones de tu cuenta, en todos los aparatos, y te enviamos al correo un enlace para elegir una contraseña nueva.
      </p>
      <ConfirmNotMe token={token} />
    </Marco>
  );
}
