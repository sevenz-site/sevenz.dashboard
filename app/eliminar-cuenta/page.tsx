import Image from "next/image";
import type { Metadata } from "next";
import { WebDeletionFlow } from "./flow";

// «ELIMINAR TU CUENTA», THE WEB DOOR (PL-48 step 1.3). Google Play requires a page where an
// account can be deleted without the app; sevenz.site/eliminar-cuenta explains both ways and
// sends here for this one. Public (lib/supabase/middleware.ts); how it stays safe without a
// session is in ./actions.ts.
//
// Frames «Eliminar · 6-8» drew the form on sevenz.site and promised «un enlace». The owner
// changed it on 2026-11-28 to a code («un código sin enlace»), which needs a server between
// the two steps, so the form lives here, on the app's host, and sevenz.site is a static
// page that links to it. The frames are to be redrawn to match (pending: the Figma bridge
// was down that day).

export const metadata: Metadata = {
  title: "Sevenz — Eliminar tu cuenta",
  robots: { index: false, follow: false },
};

export default function EliminarCuentaPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-4 py-10">
      <Image src="/fav-icon-primary.svg" alt="Sevenz" width={48} height={48} className="size-12" />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Eliminar tu cuenta de Sevenz</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Puedes pedir que borremos tu cuenta y todos sus datos: tu negocio, tus clientes, tus productos y tu historial.
          Si tienes la app, también puedes hacerlo desde Mi negocio.
        </p>
      </div>
      <WebDeletionFlow />
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">Qué pasa después</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Tienes 30 días para arrepentirte: entra a tu cuenta y cancélalo desde Mi negocio. Pasados los 30 días se borra
          todo y no se puede recuperar. Solo conservamos lo que la ley o WhatsApp nos obligan a guardar, como el registro
          de tu permiso para recibir mensajes.
        </p>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Sevenz nunca te pide tu contraseña ni códigos por WhatsApp. Esta página solo te pide tu correo y el código que te
        enviamos.
      </p>
    </main>
  );
}
