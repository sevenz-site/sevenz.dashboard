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
};

export const PUBLIC_EVENTS = {
  balance_opened: { event: "Balance Link Opened", surface: "balance", props: {} },
  client_transaction_opened: {
    event: "Client Transaction Opened",
    surface: "balance",
    props: { transaction_type: ["fiado", "old_debt", "payment", "return", "cash_sale"] },
  },
  client_signup_tapped: { event: "Client Signup Link Tapped", surface: "balance", props: {} },
  catalog_opened: { event: "Catalog Link Opened", surface: "catalog", props: { from_balance: "boolean" } },
  catalog_product_opened: { event: "Catalog Product Opened", surface: "catalog", props: { product_id: "uuid" } },
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
