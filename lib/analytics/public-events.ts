import type { EventName } from "./events";

// WHAT THE PUBLIC ROUTE ACCEPTS, AND NOTHING ELSE.
//
// `/api/public-event` takes requests from people with no account, so the event
// name is never the caller's words. The browser sends a code from this list, the
// server turns it into the event, and any property not declared here is dropped.
// A script can make a floor count higher; it cannot invent an event, write text
// into Mixpanel, or file anything under another business.
//
// `balance` tokens belong to `/s/[token]`, `catalog` tokens to `/c/[token]`.

export type PublicSurface = "balance" | "catalog";

type PropRule = readonly string[] | "uuid" | "count" | "boolean";

type PublicEventSpec = {
  event: EventName;
  surface: PublicSurface;
  props: Record<string, PropRule>;
  // Properties the SERVER adds, whatever the browser sends. For an event that two
  // surfaces share, so the one telling them apart is never the caller's to forget or fake.
  fixed?: Record<string, string>;
};

export const PUBLIC_EVENTS = {
  balance_opened: { event: "Balance Link Opened", surface: "balance", props: {} },
  client_transaction_opened: {
    event: "Client Transaction Opened",
    surface: "balance",
    props: { transaction_type: ["fiado", "old_debt", "payment", "return", "cash_sale"] },
  },
  client_signup_tapped: { event: "Client Signup Link Tapped", surface: "balance", props: {} },
  // The rate calculator on the balance link (2026-11-19). Business question, the
  // owner's: «¿los clientes calculan antes de pagar?». Read next to the payments
  // recorded for the same clients: many openings and no more payments means the
  // obstacle was never the arithmetic. One event per opening, not per session --
  // someone who opens it twice before paying is the signal. `prefilled` is the
  // balance it opened with, `none` for a client with nothing owed. A floor, not a
  // count: it is sent from the client's browser.
  balance_calculator_opened: {
    event: "Client Calculator Opened",
    surface: "balance",
    props: { prefilled: ["USD", "EUR", "none"] },
  },
  catalog_opened: { event: "Catalog Link Opened", surface: "catalog", props: { from_balance: "boolean" } },
  catalog_product_opened: {
    event: "Catalog Product Opened",
    surface: "catalog",
    props: { product_id: "uuid", from_balance: "boolean" },
  },
  catalog_product_added: {
    event: "Catalog Product Added",
    surface: "catalog",
    props: { product_id: "uuid", cart_lines: "count" },
  },
  catalog_cart_opened: { event: "Catalog Cart Opened", surface: "catalog", props: { lines: "count" } },
  catalog_order_form_opened: { event: "Catalog Order Form Opened", surface: "catalog", props: { lines: "count" } },
  catalog_filtered: {
    event: "Catalog Filtered",
    surface: "catalog",
    props: { filter: ["search", "category"], results_count: "count" },
  },
  // THE CATALOGUE'S «Contactar vía WhatsApp» (migration 225). Owner's decision of
  // 2026-11-27, with v0.14.0 about to launch and the button sending nothing: «medirlo en
  // esta versión».
  //
  // BUSINESS QUESTION: of the people who open a catalogue, how many write to the shop
  // instead of ordering? Read next to `Catalog Order Form Opened` and the orders received
  // for the same business. Many contacts and few orders: the catalogue is not answering
  // what a customer needs before ordering (delivery, stock, how to pay) and what they ask
  // is the thing to go and read. Few contacts and orders coming in: the button is a
  // safety net. Few of both: the visit is not turning into anything, and the button is
  // not the reason.
  //
  // THE SAME EVENT AS THE BALANCE LINK'S BUTTON, `Business Contacted On WhatsApp`
  // (`app/api/share-contact/route.ts`), told apart by `surface`: one series answers the
  // owner's question of 2026-10-16, «¿con cuál frecuencia los clientes contactan al dueño
  // del negocio a través del botón de WhatsApp?», for both screens. `surface` is fixed by
  // the server. `from_balance` separates a client who came from his own balance from a
  // visitor who got the catalogue's link.
  //
  // Filed under the OWNER's profile, resolved from the catalogue token, and with no
  // `client_id`: a catalogue visitor is nobody the app knows. A floor, not a count: it
  // is sent from the customer's browser on the same tap that leaves for WhatsApp. The
  // owner's «Ver cómo queda» preview draws the button and sends nothing.
  catalog_whatsapp_tapped: {
    event: "Business Contacted On WhatsApp",
    surface: "catalog",
    props: { from_balance: "boolean" },
    fixed: { surface: "catalog" },
  },
} as const satisfies Record<string, PublicEventSpec>;

export type PublicEventCode = keyof typeof PUBLIC_EVENTS;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function accepts(rule: PropRule, value: unknown): boolean {
  if (rule === "uuid") return typeof value === "string" && UUID.test(value);
  if (rule === "count") return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 10000;
  if (rule === "boolean") return typeof value === "boolean";
  return typeof value === "string" && rule.includes(value);
}

export function isPublicEventCode(code: unknown): code is PublicEventCode {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(PUBLIC_EVENTS, code);
}

// Keeps only the declared properties whose value has the declared shape. A bad
// value costs that property, not the event.
export function cleanPublicProps(code: PublicEventCode, raw: unknown): Record<string, unknown> {
  const rules: Record<string, PropRule> = PUBLIC_EVENTS[code].props;
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const clean: Record<string, unknown> = {};
  for (const [key, rule] of Object.entries(rules)) {
    if (accepts(rule, source[key])) clean[key] = source[key];
  }
  return clean;
}

// What the server adds to an event, after the caller's properties so it always wins.
export function fixedPublicProps(code: PublicEventCode): Record<string, string> {
  const spec: PublicEventSpec = PUBLIC_EVENTS[code];
  return spec.fixed ?? {};
}
