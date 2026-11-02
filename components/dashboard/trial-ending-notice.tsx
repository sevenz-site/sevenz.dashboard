import { Clock } from "lucide-react";
import { WhatsappIcon } from "@/components/icons/whatsapp";
import { Button } from "@/components/ui/button";
import { SUPPORT_WHATSAPP } from "@/lib/config";

// THE TRIAL IS ABOUT TO END -- the owner's request of 2026-11-02: «propónlo tú
// siguiendo el sistema de diseño con un mensaje muy breve y preciso». Shown on
// Inicio during the last `TRIAL_NOTICE_DAYS` days, and nowhere else: Inicio is
// where the owner lands, so they read it before they start writing.
//
// THE COLOURS, each one ruled out on purpose (DESIGN-SYSTEM.md):
//   - not amber: in this app amber means «plazo vencido», a debt warning;
//   - not destructive: that is the blocked account (`CuentaPausada`), and
//     nothing is blocked yet;
//   - not the dark card: Inicio already has two (its header and the install
//     notice), and a third one takes the emphasis from the others.
// So a plain bordered card: a notice, not an alarm.
//
// THE SAME LAYOUT AS `CuentaPausada`, which takes its place on the end date:
// the owner sees the same box change its words, not a new thing appear.
//
// NO PRICE IN THE TEXT, on purpose: the price lives in the website and in
// /admin, and a third copy here would be the one nobody updates.
export function TrialEndingNotice({
  daysLeft,
  email,
}: {
  daysLeft: number;
  email: string | null;
}) {
  const titulo =
    daysLeft === 0
      ? "Tu prueba gratis termina hoy"
      : daysLeft === 1
        ? "Tu prueba gratis termina mañana"
        : `Tu prueba gratis termina en ${daysLeft} días`;
  // The email goes inside the message for the same reason as in
  // `CuentaPausada`: /admin finds an account by email, and without it the first
  // reply is always «¿con qué correo entras?».
  const mensaje = email
    ? `Hola, mi cuenta ${email} de Sevenz está por terminar su prueba gratis y quiero activar mi plan.`
    : "Hola, mi cuenta de Sevenz está por terminar su prueba gratis y quiero activar mi plan.";

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-start gap-2">
        <Clock className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{titulo}</p>
          <p className="text-sm text-muted-foreground">
            Después, tu cuenta queda en solo lectura hasta que actives tu plan.
          </p>
        </div>
      </div>
      <Button asChild variant="outline" className="w-fit">
        <a
          href={`https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent(mensaje)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          <WhatsappIcon className="size-4" />
          Activar mi plan
        </a>
      </Button>
    </div>
  );
}
