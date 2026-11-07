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
type CodePurpose = "login" | "enable" | "password" | "number" | "admin_email";
type CodeChannel = "whatsapp" | "email";

export type Money<P extends string> = Partial<Record<`${P}_${CurrencyKey}`, number>>;

export type EntryPoint =
  | "register"
  | "client_profile"
  | "new_client"
  | "payment_no_fiados"
  | "transaction_detail"
  | "report"
  | "sale_step_client"
  | "order_step_client";

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

export type NewClientRejectionReason =
  | "paused_account"
  | "name_missing"
  | "document_missing"
  | "duplicate_document"
  | "invalid_debt"
  | "db_error";

export type ProductSource = "wizard" | "quick_sheet";
export type ProductRejectionReason =
  | "paused_account"
  | "validation"
  | "photo_gone"
  | "foreign_category"
  | "db_error";

export type ImportRejectionReason =
  | "paused_account"
  | "empty_batch"
  | "rate_missing"
  | "hidden_client"
  | "invalid_client"
  | "document_missing"
  | "duplicate_in_batch"
  | "document_taken"
  | "db_error"
  | "refused";

export type ConsentFlow = "sale" | "payment" | "new_client" | "import";

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

  // ── The steps of the owner's funnels. Gestures, so they go through the browser
  // and are a floor; what was saved is counted by the server events above. ───────
  "Register Menu Opened": { surface: "fab" | "desktop_button" | "report"; screen: string };
  "Register Option Selected": { option: "new_client" | "sale_or_fiado" | "payment"; surface: "fab" | "desktop_button" | "report" };
  "New Client Started": FlowContext;
  "New Client Details Completed": FlowContext & {
    has_document: boolean;
    has_phone: boolean;
    duplicate_document: boolean;
  };
  "New Client Rejected": FlowContext & { reason: NewClientRejectionReason };
  "Sale Started": FlowContext & { has_client: boolean };
  "Sale Product Added": FlowContext & { added_via: "catalog" | "quick_create"; cart_lines: number };
  "Sale Cart Confirmed": FlowContext & { lines: number; units: number; currencies_count: number };
  "Sale Payment Decided": FlowContext & { currency: string; decision: "full" | "partial" | "none" };
  "Sale Client Step Viewed": FlowContext;
  "Sale Client Chosen": FlowContext & {
    method: "existing" | "inline_new" | "walk_in" | "duplicate_separate" | "duplicate_existing";
  };
  "Mala Paga Warning Answered": FlowContext & { choice: "cancel" | "proceed"; flow: "sale" | "order" };
  "Sale Receipt Shared": { sale_id: string; method: "native" | "download" | "text" };
  "Payment Started": FlowContext & { mode: "split" | "directed" };
  "Payment Client Selected": FlowContext;
  "Payment Manual Split Opened": FlowContext;
  "Payment Submitted": FlowContext & { split: "auto" | "manual" | "directed"; entry_currency: string };
  "Payment Receipt Shared": { movement_id: string; method: "native" | "download" | "text" };
  "Return Started": FlowContext & { sale_kind: "fiado" | "cash" };

  "Product Creation Started": FlowContext;
  "Product Edit Started": FlowContext & { product_id: string };
  "Product Step Completed": FlowContext & { mode: "create" | "edit"; step: "info" | "price" | "details" };
  "Product Creation Rejected": FlowContext & { source: ProductSource; reason: ProductRejectionReason };
  "Product Created": FlowContext & {
    product_id: string;
    source: ProductSource;
    has_cost: boolean;
    has_wholesale: boolean;
    has_photo: boolean;
    has_description: boolean;
    has_category: boolean;
    has_supplier: boolean;
    published: boolean;
    satellites_failed: boolean;
  };
  "Product Updated": FlowContext & { product_id: string; fields_changed: string[] };
  "Product Publication Changed": { product_id: string; published_retail: boolean; published_wholesale: boolean };
  "Product Deleted": { product_id: string };
  "Product Restored": { product_id: string };
  "Category Changed": { action: "create" | "rename" | "delete" };
  "Catalog Link Shared": { method: "native" | "clipboard" };
  "Product Link Shared": { product_id: string };
  "Catalog Preview Opened": Record<string, never>;

  "Order Opened": { order_id: string };
  "Order Customer Contacted": { order_id: string };
  "Order Registration Started": FlowContext & { order_id: string };
  "Order Step Viewed": FlowContext & { order_id: string; step: "blocks" | "confirm" | "payment" | "client" };
  "Order Currency Registered": FlowContext & {
    order_id: string;
    sale_id: string;
    currency: string;
    currencies_left: number;
  };
  "Order Registration Rejected": FlowContext & { order_id: string; currency: string };
  "Order Status Changed": { order_id: string; action: "discard" | "restore" };
  "Import Started": { batch_id?: string };
  "Import Photos Selected": { batch_id: string; photos_count: number; photos_dropped: number };
  "Import Review Opened": { batch_id?: string; rows_count: number; photos_ok: number; photos_failed: number };
  "Import Currency Chosen": { batch_id?: string; choice: string };
  "Import Upload Tapped": { batch_id?: string; door: "detail" | "list"; clients_selected: number };
  "Import Rejected": { batch_id?: string; reason: ImportRejectionReason };
  "Import Batch Finished": { batch_id?: string; clients_uploaded: number; clients_left: number };
  "Import Draft Answered": { choice: "resume" | "discard" };

  "Signup Completed": { country: string; referral_source: string; email_confirmation_required: boolean };
  "Signup Rejected": { reason: string };
  "Login Completed": { new_device?: boolean; second_factor?: boolean };
  // C1 of PL-22: the optional code by WhatsApp (email as fallback). `purpose` is which door
  // asked for it; `reason` is why a code was refused: `expired` growing means WhatsApp
  // arrives late, `locked` means somebody is guessing, `send_failed` means Kapso or Resend.
  "Second Factor Code Sent": { purpose: CodePurpose; channel: CodeChannel };
  "Second Factor Code Verified": { purpose: CodePurpose; channel: CodeChannel };
  "Second Factor Code Rejected": {
    purpose: CodePurpose;
    reason: "mismatch" | "expired" | "locked" | "none" | "bad_ticket" | "send_failed" | "error";
    channel?: CodeChannel;
  };
  "Second Factor Enabled": Record<string, never>;
  "Second Factor Disabled": Record<string, never>;
  "WhatsApp Number Changed": { had_number: boolean };
  "Account Change Alert Sent": { what: "number" | "email" };
  "Owner Email Changed By Admin": { verified_by: "whatsapp_code" | "other" };
  "Recovery Email Resent By Admin": Record<string, never>;
  // The KAM of an account (migration 198). The commission stays out on purpose: what a
  // KAM earns is internal, and /admin already answers it from the tables.
  "KAM Assignment Changed": { action: "kam_assigned" | "kam_changed" | "kam_removed" };
  "Account Feedback Logged": { kind: "complaint" | "suggestion" | "praise" | "question"; has_attachment: boolean };
  // C2 of PL-22: an account opened from a device Sevenz did not know, and what came of it.
  "New Device Alert Sent": { known_devices: number };
  "Session Revoked By Owner": { reason: "not_me" };
  "Login Blocked Pending Reset": Record<string, never>;
  "Logout Completed": { scope: "local" | "global" };
  "Client Flagged": { client_id: string };
  "Client Unflagged": { client_id: string };
  "Client Notices Changed": { client_id: string; enabled: boolean };
  "WhatsApp Consent Declared": { client_id: string; flow: ConsentFlow };
  "WhatsApp Message Sent": { template: string; audience: "owner" | "client"; status: "sent" | "failed"; error_code?: string };
  "Business Profile Saved": {
    has_logo: boolean;
    has_whatsapp: boolean;
    has_address: boolean;
    has_tax_id: boolean;
  };
  "Business Profile Rejected": { reason: "required_field" | "invalid_whatsapp" | "invalid_country" | "logo_gone" | "db_error" };
  "Payment Method Changed": { action: "add" | "update" | "delete" };
  "Owner Notices Changed": { enabled: boolean };
  "Owner Notices Prompt Shown": { ask_number: number };
  "Password Change Attempted": { result: "success" | "rejected"; reason?: "complexity" | "mismatch" | "leaked" | "code" | "other" };
  "Report Export Failed": { que: string; reason: string };
  "Stock Threshold Changed": { threshold: number };

  "Share WhatsApp Dialog Answered": { choice: "save_and_share" | "other_way" | "dismissed" };
  "Transaction Detail Opened": { kind: "movement" | "cash_sale" };
  "Transaction Shared": { method: "native" | "clipboard" };

  "Search Performed": { screen: string; query_type: "text" | "transaction_code"; query_length: number; results_count: number };
  "Search Result Selected": { screen: string; result_type: "client" | "transaction" };
  "List Filtered": { screen: string; filter: "sort" | "status" | "amount" | "category" | "clear"; value?: string };
  "History Filtered": { filter: "type" | "status" | "date" | "clear_date" | "currency"; value?: string };
  "Report Filter Applied": { filter: "client" | "product" | "supplier" };

  "Home Card Tapped": { card: "balance" | "sales" | "orders"; destination: string };
  "Balance Visibility Toggled": { card: "balance" | "sales"; visible: boolean };
  "Calculator Used": { action: "opened" | "shared" };
  "Notifications Opened": { items_count: number };
  "Notification Tapped": { notification_type: string; action: "view" | "view_product" | "view_order" | "restore" };
  "Install Banner Shown": { mode: "prompt" | "steps" };
  "Install Prompt Result": { outcome: "accepted" | "dismissed" };
  "Install Steps Opened": { entry_point: "banner" | "sidebar" };
  "App Installed": Record<string, never>;
  "App Opened Installed": Record<string, never>;
  "Tour Finished": { outcome: "completed" | "skipped"; last_step: number; steps_total: number };
  "AI Report Viewed": { degraded: boolean };
  "Unsaved Changes Answered": { choice: "stay" | "leave" | "save_and_leave"; screen: string };
  "Account Paused Screen Viewed": { screen: string };

  // ── The client's side: filed under the owner. `viewer_signed_in` marks a visit
  // from someone with a session, usually the shopkeeper opening their own link. ──
  "Balance Link Opened": PublicContext;
  "Client Transaction Opened": PublicContext & { transaction_type?: string };
  "Client Signup Link Tapped": PublicContext;
  "Catalog Link Opened": PublicContext & { from_balance?: boolean };
  "Catalog Product Opened": PublicContext & { product_id?: string; from_balance?: boolean };
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
  "Client Hidden Permanently": { client_id: string; owed_money: boolean; source: "papelera" | "client_detail" };
  "Client Restored": { client_id: string; source: "papelera" | "client_detail" | "notification" | "import" };
  "Client Trashed": { client_id: string; owed_money: boolean };
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
  "Share Link Opened": {
    client_id: string;
    method: "native" | "copy" | "whatsapp";
    control: "whatsapp_wide" | "whatsapp_icon" | "menu_share" | "table_share" | "table_reminder";
    screen: string;
  };
};

export type EventName = keyof EventProps;
