import Link from "next/link";
import { CircleUserRound, UserRoundSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDocumentId } from "@/lib/format";
import type { OrderClient } from "@/lib/orders/order-client-match";

// WHO ORDERED, AND WHETHER THE SHOP ALREADY HAS THEM — frames `1518:10879`
// (found) and `1514:10294` (not found).
//
// ═══════════════════════════════════════════════════════════════════════
// THE NOTICE IS THE POINT OF THE CARD, NOT A DECORATION
//
// Everything above it — initials, name, document, phone, address — the screen
// already showed as a list of rows. What this card adds is the one sentence
// the shopkeeper opens an order to find out: is this somebody I already lend
// to, or somebody new? From that answer hangs whether registering this order
// writes into a ficha that exists or creates one.
//
// GREEN WITH A SECOND LINE THAT NAMES THE PERSON, and that second line is not
// repetition: the card's header shows the name as the CUSTOMER typed it in
// the cart, and this line shows the ficha that matched. Reading «Pedro Pérez»
// twice is the shopkeeper confirming they are the same Pedro; reading two
// different names is how he catches a match that is wrong.
//
// AMBER AND NOT RED when there is no match. Nothing is broken: a new customer
// ordering is the ordinary case and the good news for a shop. Red would read
// as «this order has a problem».
//
// AND THE BUTTON ONLY EXISTS IN THE GREEN STATE. There is nowhere to send
// anybody when the client does not exist yet — the alta happens inside the
// registration flow, with the order's data already in hand, and a button here
// would open a second door into the same place from a screen the shopkeeper
// has not finished reading.
export function OrderClientCard({
  nombreDelPedido,
  documentoDelPedido,
  tipoDeDocumento,
  telefono,
  cliente,
}: {
  // As the CUSTOMER typed it in the cart, never the ficha's. The two can
  // differ and seeing both is what lets the shopkeeper judge the match.
  nombreDelPedido: string;
  documentoDelPedido: string;
  tipoDeDocumento: string | null;
  telefono: string;
  // The matching ficha, or null. See `findOrderClient` for why it is matched
  // by document and nothing else.
  cliente: OrderClient | null;
}) {
  // THE ADDRESS COMES FROM THE FICHA, NOT FROM THE ORDER. The owner's
  // decision, 2026-10-24: *«la sacamos de la ficha del cliente ya existente y
  // la dejamos vacía cuando no existe»*. The ficha's is the one he maintains;
  // an order from six months ago should not overwrite it on screen.
  //
  // Migration `157` starts storing the cart's own address, and that one will
  // prefill the alta form for a client who does not exist yet — a different
  // job from this line.
  const direccion = cliente?.address?.trim() || null;
  // INITIALS FROM WORDS THAT START WITH A LETTER, and that is not pedantry:
  // the name comes from a form the CUSTOMER filled in, so it carries whatever
  // they typed. «Jos (desde el catálogo)» produced «J(» in dev, because the
  // second word starts with a parenthesis. A nickname in quotes, a dash, a
  // «y señora» -- the avatar is two characters and any of those turns one of
  // them into punctuation.
  const iniciales = nombreDelPedido
    .trim()
    .split(/\s+/)
    .map((palabra) => palabra.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .slice(0, 2)
    .map((palabra) => palabra[0]!.toUpperCase())
    .join("");

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border p-4">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-xl text-muted-foreground"
        >
          {iniciales || "?"}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-base font-semibold">{nombreDelPedido}</p>
          {/* THE THREE LINES ALWAYS, EVEN EMPTY. `DESIGN-SYSTEM.md`'s rule:
              a missing fact that disappears cannot be told apart from one
              that was never asked for. */}
          <p className="truncate text-sm text-muted-foreground">
            Cédula: {formatDocumentId(documentoDelPedido, tipoDeDocumento)}
          </p>
          <p className="truncate text-sm text-muted-foreground">Teléfono: {telefono || "—"}</p>
          <p className="truncate text-sm text-muted-foreground">Dirección: {direccion || "—"}</p>
        </div>
      </div>

      {cliente ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
          <CircleUserRound className="mt-px size-4 shrink-0" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-semibold">El cliente ya existe en tu cuenta de Sevenz.</p>
            <p>
              {cliente.name} con cédula{" "}
              {formatDocumentId(cliente.document_id ?? "", cliente.document_type)}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-500">
          <UserRoundSearch className="mt-px size-4 shrink-0" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-semibold">No hemos encontrado este cliente en tu cuenta de Sevenz.</p>
            <p>
              {nombreDelPedido} con cédula{" "}
              {formatDocumentId(documentoDelPedido, tipoDeDocumento)}
            </p>
          </div>
        </div>
      )}

      {cliente ? (
        <Button variant="outline" size="sm" className="h-10 w-full" asChild>
          {/* THE FICHA'S NAME AND NOT THE ORDER'S. The button says where it
              goes, and it goes to the client this shop has on file — which is
              the name that will be at the other end. */}
          <Link href={`/clients/${cliente.id}`}>Ver {cliente.name}</Link>
        </Button>
      ) : null}
    </div>
  );
}
