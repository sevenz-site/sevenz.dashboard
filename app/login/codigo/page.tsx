import { redirect } from "next/navigation";
import { readLoginTicket } from "@/lib/security/second-factor";
import { CodeForm } from "./code-form";

// THE CODE SCREEN (C1 of PL-22). Reached only with the ticket the password step left in a
// ten-minute cookie; without it, back to /login. The cookie is what survives the trip to
// WhatsApp and back on an iPhone, which reloads the page more often than not.
export const dynamic = "force-dynamic";

export default async function LoginCodePage() {
  const ticket = await readLoginTicket();
  if (!ticket) redirect("/login");
  return (
    <CodeForm
      channel={ticket.channel}
      masked={ticket.masked}
      resends={ticket.resends}
      hasWhatsapp={Boolean(ticket.whatsapp)}
      maskedEmail={ticket.email.replace(/^(.)[^@]*(@.*)$/, "$1***$2")}
    />
  );
}
