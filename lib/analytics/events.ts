// THE EVENT CATALOGUE, AS TYPES.
//
// `track` and `trackServer` only accept a name listed here, and an event with a
// shape below only accepts that shape. A typo in a name or a missing property
// now fails `tsc`, where before it created a second column in Mixpanel that
// nobody noticed. `Movement Added` vanished on 2026-10-24 for the same reason:
// nothing in the repo knew which events were supposed to exist.
//
// The human side of this list, with each event's business question and its
// funnels, is `../docs/Sevenz-Eventos-Mixpanel.xlsx`. The `analytics-event` skill
// keeps the two in step.
//
// Names are English, `Object Verb` in the past tense. Properties are English
// `snake_case`, and their values are codes, never prose: a reason written as a
// sentence cannot be grouped. Never here: names, phones, documents, tokens, or
// the text of a search or a note. Internal ids are fine, by the owner's decision
// of 2026-11-04.

type CurrencyKey = "usd" | "eur" | "cop" | "usdt" | "ves";

// One number per currency and never a total across them: dollars and euros do
// not add up. `lib/analytics/amounts.ts` builds these.
export type Money<P extends string> = Partial<Record<`${P}_${CurrencyKey}`, number>>;

export type EntryPoint =
  | "register"
  | "client_profile"
  | "new_client"
  | "payment_no_fiados"
  | "transaction_detail"
  | "report";

// Ties the steps of one attempt together, so a funnel can hold it constant.
export type FlowContext = { flow_id?: string; entry_point?: EntryPoint };

export type TransactionType = "fiado" | "old_debt" | "payment" | "return";
export type PaymentForm = "cash" | "fiado" | "partial" | "saldo" | "mixed";

export type SaleRejectionReason =
  | "paused_account"
  | "empty_sale"
  | "too_many_lines"
  | "client_not_found"
  | "context_unavailable"
  | "products_unreadable"
  | "order_not_found"
  | "order_part_registered"
  | "product_gone"
  | "invalid_quantity"
  | "currency_not_allowed"
  | "below_minimum"
  | "price_missing"
  | "payment_currency_invalid"
  | "rate_missing"
  | "invalid_amount"
  | "overpayment"
  | "walk_in_debt"
  | "walk_in_credit"
  | "credit_changed"
  | "term_missing"
  | "term_invalid"
  | "installments_invalid"
  | "db_error";

export type PaymentRejectionReason =
  | "paused_account"
  | "client_not_found"
  | "fiado_not_found"
  | "fiado_settled"
  | "no_open_fiados"
  | "fiados_unreadable"
  | "rate_missing"
  | "conversion_failed"
  | "invalid_amount"
  | "exceeds_debt"
  | "exceeds_fiado"
  | "split_incomplete"
  | "split_invalid"
  | "mixed_currencies"
  | "duplicate_fiado"
  | "db_error";

export type ReturnRejectionReason =
  | "paused_account"
  | "invalid_quantity"
  | "not_found"
  | "no_products"
  | "sale_deleted"
  | "quantity_exceeded"
  | "sale_value_exceeded"
  | "no_value"
  | "fiado_settled"
  | "exceeds_fiado"
  | "split_mismatch"
  | "debt_in_currency"
  | "has_fiado"
  | "no_client"
  | "db_error";

export type DeleteRejectionReason =
  | "paused_account"
  | "not_found"
  | "credit_spent"
  | "has_returns"
  | "db_error";

export type RestoreRejectionReason =
  | "paused_account"
  | "not_found"
  | "client_deleted"
  | "client_trashed"
  | "already_returned"
  | "fiado_deleted"
  | "no_longer_fits"
  | "db_error";

export type CatalogOrderRejectionReason =
  | "invalid_link"
  | "too_many_orders"
  | "invalid_name"
  | "invalid_document"
  | "invalid_whatsapp"
  | "empty_cart"
  | "too_many_products"
  | "product_gone"
  | "invalid_quantity"
  | "below_minimum"
  | "price_missing"
  | "currency_invalid"
  | "rate_missing"
  | "db_error";

type PublicContext = { client_id?: string; viewer_signed_in?: boolean };

type Loose = Record<string, unknown>;

export type EventProps = {
  // ── Transactions ───────────────────────────────────────────────────────
  "Sale Completed": FlowContext &
    Money<"total"> &
    Money<"collected"> &
    Money<"owed"> &
    Money<"credit_used"> & {
      sale_id: string;
      client_id: string;
      origin: "wizard" | "catalog_order";
      payment_form: PaymentForm;
      client_kind: "named" | "walk_in";
      lines: number;
      units: number;
      currencies_count: number;
      charges_count: number;
      used_credit: boolean;
      has_term: boolean;
      installments: number;
    };
  "Sale Rejected": FlowContext & {
    origin: "wizard" | "catalog_order";
    reason: SaleRejectionReason;
  };
  "Sale Deleted": {
    sale_id: string;
    client_id: string;
    charges_deleted: number;
    from_order: boolean;
    restorable: boolean;
  };
  "Payment Recorded": FlowContext &
    Money<"amount"> & {
      movement_id: string | null;
      group_id?: string;
      client_id: string;
      mode: "split" | "directed";
      lines: number;
      entry_currency: string | null;
      crosses_books: boolean;
      settles_debt: boolean;
      consent_declared: boolean;
    };
  "Payment Rejected": FlowContext & {
    mode: "split" | "directed";
    reason: PaymentRejectionReason;
  };
  "Return Recorded": FlowContext &
    Money<"value"> &
    Money<"to_own"> &
    Money<"to_fiados"> &
    Money<"to_credit"> &
    Money<"to_cash"> & {
      return_id: string | null;
      movement_id: string | null;
      client_id: string;
      sale_kind: "fiado" | "cash";
      quantity: number;
    };
  "Return Rejected": FlowContext & {
    sale_kind: "fiado" | "cash";
    reason: ReturnRejectionReason;
  };
  "Old Debt Recorded": Money<"amount"> & {
    client_id: string;
    has_term: boolean;
    installments: number;
  };
  "Transaction Deleted": {
    movement_id: string;
    client_id: string;
    transaction_type: TransactionType;
    payments_deleted: number;
  };
  "Transaction Delete Rejected": {
    target: "movement" | "sale";
    reason: DeleteRejectionReason;
  };
  "Transaction Restored": {
    movement_id: string;
    client_id: string;
    transaction_type: TransactionType;
    revived_sale: boolean;
    source: "notification";
  };
  "Transaction Restore Rejected": { reason: RestoreRejectionReason };

  // ── The client's side: filed under the owner. `viewer_signed_in` marks a visit
  // from someone with a session, usually the shopkeeper opening their own link. ──
  "Balance Link Opened": PublicContext;
  "Client Transaction Opened": PublicContext & { transaction_type?: string };
  "Client Signup Link Tapped": PublicContext;
  "Catalog Link Opened": PublicContext & { from_balance?: boolean };
  "Catalog Product Opened": PublicContext & { product_id?: string };
  "Catalog Product Added": PublicContext & { product_id?: string; cart_lines?: number };
  "Catalog Cart Opened": PublicContext & { lines?: number };
  "Catalog Order Form Opened": PublicContext & { lines?: number };
  "Catalog Filtered": PublicContext & { filter?: string; results_count?: number };
  "Client Document Submitted": { client_id?: string; result: "success" | "rejected" | "rate_limited" };
  "Client WhatsApp Consent Answered": { client_id?: string; decision: "accept" | "revoke" };
  "Client Feedback Answered": { client_id?: string; result: "success" | "rate_limited" };
  "Catalog Order Rejected": { reason: CatalogOrderRejectionReason };

  // ── Older events, with the loose shape they were written with. Each one
  // gets a real shape the day it is touched, as the skill asks. ────────────
  "AI Report Failed": Loose;
  "AI Report Rated": Loose;
  "Business Contacted On WhatsApp": Loose;
  "Catalog Opened From Share Link": Loose;
  "Catalog Order Received": Loose;
  "Catalog Order Registered": Loose;
  "Client Created": Loose;
  "Client Details Opened": Loose;
  "Client Hidden Permanently": Loose;
  "Client Restored": Loose;
  "Client Trashed": Loose;
  "Import Confirmed": Loose;
  "Import Photo Failed": Loose;
  "Import Photo Processed": Loose;
  "Install Prompt Accepted": Loose;
  "Install Prompt Dismissed": Loose;
  "Movement Rejected": Loose;
  "Page Viewed": Loose;
  "Report Export Downloaded": Loose;
  "Report Opened": Loose;
  "Report Range Changed": Loose;
  "Report Sheet Opened": Loose;
  "Share Link Opened": Loose;
};

export type EventName = keyof EventProps;
