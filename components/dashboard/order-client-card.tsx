import { CircleUserRound, UserRoundSearch } from "lucide-react";
import { OrderClientSheetButton } from "@/components/dashboard/order-client-sheet-button";
import type { LedgerDisplay } from "@/lib/exchange-rate/movement-display";
import { formatDocumentId } from "@/lib/format";
import { partirDocumento } from "@/lib/orders/order-client-match";
import type { OrderClientMatch } from "@/lib/orders/order-client-match";
import { OrderClientPickerSheet } from "@/components/dashboard/order-client-picker-sheet";

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
// AND THE BUTTON ONLY EXISTS IN THE GREEN STATES. There is nowhere to send
// anybody when the client does not exist yet — the alta happens inside the
// registration flow, with the order's data already in hand, and a button here
// would open a second door into the same place from a screen the shopkeeper
// has not finished reading.
//
// ═══════════════════════════════════════════════════════════════════════
// AND A THIRD STATE: VARIAS FICHAS CON LOS MISMOS DÍGITOS
//
// Frame `1634:30094`, the owner's own on 2026-10-24. It is GREEN and not
// amber, and that is the right call: the client DOES exist, the shop just has
// more than one ficha that could be them. Amber would have read as «this
// order has a problem» when the problem is older than the order.
//
// It happens because migration `033`'s unique index normalises with
// `[^a-z0-9]`, which keeps the letter: `V-21054832` and `E-21054832` are two
// valid keys. Dev holds three such groups today, one of them three deep.
//
// «Ver clientes» OPENS A SHEET WITH THE MATCHES instead of guessing one. What
// the shopkeeper does from there — read them and decide — is the only thing
// that can tell them apart, because the order carries nothing that does.
export function OrderClientCard({
  nombreDelPedido,
  documentoDelPedido,
  tipoDeDocumento,
  telefono,
  coincidencia,
  ledger,
}: {
  // As the CUSTOMER typed it in the cart, never the ficha's. The two can
  // differ and seeing both is what lets the shopkeeper judge the match.
  nombreDelPedido: string;
  documentoDelPedido: string;
  tipoDeDocumento: string | null;
  telefono: string;
  // One ficha, several, or none. See `findOrderClient` for why it is matched
  // by document and nothing else, and why «several» is its own answer.
  coincidencia: OrderClientMatch;
  // La tasa vigente, que la hoja de la cuenta necesita para enseñar bolívares.
  // `null` en un negocio colombiano, que no tiene segunda línea.
  ledger: LedgerDisplay | null;
}) {
  const cliente = coincidencia.kind === "uno" ? coincidencia.cliente : null;

  // Ver el comentario de «Cédula:» más abajo: la letra puede venir en la
  // columna del tipo, pegada al documento, o de la ficha emparejada.
  const { digits: digitosDelPedido, letter: letraPropia } = partirDocumento(
    documentoDelPedido,
    tipoDeDocumento,
  );
  const letraDelPedido = letraPropia ?? cliente?.document_type ?? null;
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
          {/* ── LA LETRA, AUNQUE EL PEDIDO NO LA TRAIGA EN SU COLUMNA ──
              El dueño lo reportó el 2026-10-25 con la captura: «Cédula:
              21.054.832», sin la V, mientras el recuadro verde de debajo —que
              lee la FICHA— decía «V-21.054.832» en la misma tarjeta.

              POR QUÉ FALTABA: `formatDocumentId` se llamaba bien; lo que
              llegaba nulo era el tipo. El carrito del cliente no siempre
              guarda `customer_document_type`, así que `catalog_orders` tiene
              filas con «V-24242424» dentro de `customer_document` y otras con
              los dígitos pelados y el tipo vacío.

              DE DÓNDE SE SACA, EN ESTE ORDEN: la columna del tipo; si no, la
              letra que venga pegada al propio documento --eso lo resuelve
              `partirDocumento`--; y si tampoco, la de la ficha emparejada,
              que es lícita porque el emparejamiento se hizo por los dígitos y
              el recuadro verde ya la está afirmando ahí mismo.

              SIN LETRA NO SE INVENTA NINGUNA. Un documento sin ficha y sin
              tipo sale con sus dígitos y nada más: poner la «V» por defecto
              sería afirmar algo que nadie dijo, y este producto distingue a
              dos personas por esa letra. */}
          <p className="truncate text-sm text-muted-foreground">
            Cédula: {formatDocumentId(digitosDelPedido, letraDelPedido)}
          </p>
          <p className="truncate text-sm text-muted-foreground">Teléfono: {telefono || "—"}</p>
          <p className="truncate text-sm text-muted-foreground">Dirección: {direccion || "—"}</p>
        </div>
      </div>

      {coincidencia.kind !== "ninguno" ? (
        <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
          <CircleUserRound className="mt-px size-4 shrink-0" aria-hidden="true" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="font-semibold">
              {coincidencia.kind === "varios"
                ? "El cliente ya existe en varias cuentas de Sevenz."
                : "El cliente ya existe en tu cuenta de Sevenz."}
            </p>
            {/* LA SEGUNDA LÍNEA CAMBIA DE SUJETO A PROPÓSITO. Con una sola
                ficha nombra LA FICHA, que es lo que deja comparar con el
                nombre de arriba —el que escribió el cliente— y cazar un
                emparejamiento malo. Con varias no hay una que nombrar, así que
                repite el documento del pedido, que es lo único común a todas.
                El frame `1634:30094` lo dibuja así. */}
            <p>
              {cliente
                ? `${cliente.name} con cédula ${formatDocumentId(cliente.document_id ?? "", cliente.document_type)}`
                : `${nombreDelPedido} con cédula ${formatDocumentId(digitosDelPedido, letraDelPedido)}`}
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
              {formatDocumentId(digitosDelPedido, letraDelPedido)}
            </p>
          </div>
        </div>
      )}

      {cliente ? (
        // ABRE UNA HOJA, NO NAVEGA. Petición del dueño el 2026-10-25, para no
        // salir del flujo de registrar el pedido. Ver `OrderClientSheetButton`.
        <OrderClientSheetButton
          clientId={cliente.id}
          clientName={cliente.name}
          ledger={ledger}
        />
      ) : null}

      {coincidencia.kind === "varios" ? (
        <OrderClientPickerSheet clientes={coincidencia.clientes} ledger={ledger} />
      ) : null}
    </div>
  );
}
