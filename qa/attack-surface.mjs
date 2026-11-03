// THE ATTACK SURFACE OF SEVENZ, read from the repo -- and the reviewed list
// of what each piece is supposed to allow.
//
// Two halves, and the point of the file is that they are compared:
//
//   - `parseSurface()` reads what EXISTS today: every table and view, every
//     SECURITY DEFINER function with who can execute it (from the grants and
//     revokes in the migrations, in order), every route under app/api, every
//     public page and every storage bucket.
//   - `MANIFEST` says what was REVIEWED: the same pieces, each with the
//     exposure it is meant to have and how the attack reaches a victim's row.
//
// `qa:attack-coverage` fails when the two disagree -- a new table, function,
// route or bucket nobody classified, or a function whose exposure changed.
// That is the owner's rule of 2026-11-02 made mechanical: «con cada nueva
// liberación se debe evaluar qué nuevos casos se deben incluir en el qa
// checklist para no dejar por fuera batches de seguridad en esas nuevas
// funcionalidades». A checklist line can be skipped; a red suite cannot.
//
// `qa:attack` reads the same MANIFEST to aim its attacks, so adding a piece
// here is also what puts it under attack.
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath and not `.pathname`: the repo lives under «Jesus Delgado», and
// a URL path keeps that space as %20.
const ROOT = fileURLToPath(new URL("..", import.meta.url));

// ── 1. What exists ───────────────────────────────────────────────────────

function migrationFiles() {
  const dir = join(ROOT, "supabase");
  const numbered = readdirSync(dir).filter((f) => /^\d+_.*\.sql$/.test(f)).sort();
  return [join(dir, "schema.sql"), ...numbered.map((f) => join(dir, f))].filter((f) => existsSync(f));
}

const ROLES = ["public", "anon", "authenticated", "service_role"];

// Splits a role list such as «public, anon, authenticated».
const rolesIn = (txt) => ROLES.filter((r) => new RegExp(`\\b${r}\\b`, "i").test(txt));

export function parseSurface() {
  const tables = new Set();
  const views = new Set();
  const buckets = new Set();
  // name -> { securityDefiner, trigger, params: [{name, type}], acl: Set<role> }
  const functions = new Map();

  for (const file of migrationFiles()) {
    // Comments out first: they quote SQL all the time.
    const sql = readFileSync(file, "utf8").replace(/--[^\n]*/g, "");

    for (const m of sql.matchAll(/create table (?:if not exists )?public\.(\w+)/gi)) tables.add(m[1]);
    for (const m of sql.matchAll(/drop table (?:if exists )?public\.(\w+)/gi)) tables.delete(m[1]);
    for (const m of sql.matchAll(/create (?:or replace )?view public\.(\w+)/gi)) views.add(m[1]);
    for (const m of sql.matchAll(/insert into storage\.buckets[\s\S]*?values\s*\(\s*'([^']+)'/gi)) buckets.add(m[1]);

    // Statements in file order, so a revoke after a create wins, and a grant
    // after a revoke wins again.
    const stmt = /(create (or replace )?function public\.(\w+)\s*\(([\s\S]*?)\)\s*returns\s+([\s\S]*?)\bas\s+\$)|(drop function (?:if exists )?public\.(\w+))|(grant execute on function public\.(\w+)\s*\([^)]*\)\s*to\s+([^;]+);)|(revoke (?:execute|all)(?: privileges)? on function public\.(\w+)\s*\([^)]*\)\s*from\s+([^;]+);)|(alter function public\.(\w+)\s*\([^)]*\)\s*rename to (\w+))/gi;
    for (const m of sql.matchAll(stmt)) {
      if (m[1]) {
        const name = m[3];
        const prev = functions.get(name);
        const params = m[4]
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => {
            const [pname, ...rest] = p.replace(/\s+default\s+[\s\S]*$/i, "").split(/\s+/);
            return { name: pname, type: rest.join(" ").toLowerCase(), optional: /\bdefault\b/i.test(p) };
          });
        functions.set(name, {
          securityDefiner: /security definer/i.test(m[5]),
          trigger: /^\s*trigger\b/i.test(m[5]),
          params,
          // A NEW function is executable by PUBLIC *and*, on Supabase, by
          // anon, authenticated and service_role EXPLICITLY -- the project's
          // default privileges grant all three. So `revoke … from public,
          // anon` still leaves every logged-in owner in. That is not theory:
          // the first version of this reader modelled plain Postgres (PUBLIC
          // only), classified share_link_owner and get_shared_catalog_preview
          // as server-only, and `qa:attack` showed an owner calling both.
          // `create or replace` of an existing one keeps its grants.
          acl: m[2] && prev ? prev.acl : new Set(["public", "anon", "authenticated", "service_role"]),
        });
      } else if (m[6]) {
        functions.delete(m[7]);
      } else if (m[8]) {
        const f = functions.get(m[9]);
        if (f) for (const r of rolesIn(m[10])) f.acl.add(r);
      } else if (m[11]) {
        const f = functions.get(m[12]);
        if (f) for (const r of rolesIn(m[13])) f.acl.delete(r);
      } else if (m[14]) {
        const f = functions.get(m[15]);
        if (f) { functions.delete(m[15]); functions.set(m[16], f); }
      }
    }

    // THE LOOP FORM, used by 058, 061 and 062: a DO block walks an array of
    // 'public.fn(args)' strings and runs `execute format('revoke … %s from …')`
    // on each. A reader that only knows the plain statement classifies all of
    // those as public -- which is how this file first reported eight /admin
    // functions open to anyone while the database refused every call.
    for (const block of sql.matchAll(/do \$\$[\s\S]*?end \$\$;/gi)) {
      const body = block[0];
      const names = [...body.matchAll(/'public\.(\w+)\s*\(/g)].map((x) => x[1]);
      if (!names.length) continue;
      for (const r of body.matchAll(/format\('revoke (?:execute|all) on function %s from ([^']+)'/gi))
        for (const n of names) { const f = functions.get(n); if (f) for (const role of rolesIn(r[1])) f.acl.delete(role); }
      for (const g of body.matchAll(/format\('grant execute on function %s to ([^']+)'/gi))
        for (const n of names) { const f = functions.get(n); if (f) for (const role of rolesIn(g[1])) f.acl.add(role); }
    }
  }

  const exposure = (acl) =>
    acl.has("public") || acl.has("anon") ? "public" : acl.has("authenticated") ? "owner" : "service";

  const definers = new Map(
    [...functions]
      .filter(([, f]) => f.securityDefiner && !f.trigger)
      .map(([name, f]) => [name, { exposure: exposure(f.acl), params: f.params }]),
  );

  const apiDir = join(ROOT, "app", "api");
  const routes = [];
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full, `${rel}/${e}`);
      else if (e === "route.ts") routes.push(`/api${rel}`);
    }
  };
  walk(apiDir, "");

  // Server actions: every exported async function of a file that starts
  // with "use server". Keyed like the dev manifest keys them.
  const actions = [];
  const walkActions = (dir) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) { if (e !== "node_modules") walkActions(full); continue; }
      if (!/\.tsx?$/.test(e)) continue;
      const src = readFileSync(full, "utf8");
      if (!/^\s*["']use server["']/m.test(src.slice(0, 400))) continue;
      const rel = full.slice(ROOT.length).replace(/\\/g, "/").replace(/^\//, "");
      for (const m of src.matchAll(/^export async function (\w+)/gm)) actions.push(`${rel}#${m[1]}`);
    }
  };
  walkActions(join(ROOT, "app"));
  walkActions(join(ROOT, "lib"));

  return { tables: [...tables].sort(), views: [...views].sort(), definers, routes: routes.sort(), buckets: [...buckets].sort(), actions: actions.sort() };
}

// ── 2. What was reviewed ─────────────────────────────────────────────────
//
// For every table and view: how to find the VICTIM's rows (`via`), so the
// attack can try to read and write them as another owner. `none` means the
// table holds no owner data an owner should reach at all.

export const MANIFEST = {
  tables: {
    applied_data_migrations: { via: "none" },
    bcv_exchange_rate_fetches: { via: "none", note: "public BCV rate; owners read it" },
    catalog_order_items: { via: "order" },
    catalog_orders: { via: "owner" },
    catalog_share_links: { via: "owner" },
    client_feedback: { via: "none" },
    client_flags: { via: "owner" },
    client_hides: { via: "owner" },
    client_identities: { via: "none" },
    client_whatsapp_consents: { via: "none" },
    clients: { via: "owner" },
    import_notifications: { via: "owner" },
    // 180: the switch and the log of the ledger rules. No session may touch
    // either; the triggers reach them through definer helpers.
    ledger_rule_hits: { via: "none" },
    ledger_rules: { via: "none" },
    // Migration 182 (DM-12): the cleanup's switch and its log. Service role only.
    storage_cleanup_log: { via: "none" },
    storage_cleanup_settings: { via: "none" },
    link_opens: { via: "client" },
    movement_deletions: { via: "client" },
    movement_rejections: { via: "none" },
    movements: { via: "client" },
    owner_exchange_settings: { via: "owner" },
    // 179: payment handles. Nothing anonymous may read them (decision of `043`).
    owner_payment_methods: { via: "owner" },
    owners: { via: "id" },
    plans: { via: "none" },
    product_currencies: { via: "product" },
    product_hides: { via: "owner" },
    product_price_overrides: { via: "product" },
    products: { via: "owner" },
    rate_limit_counters: { via: "none" },
    rate_limiters: { via: "none" },
    report_assistant_notes: { via: "owner" },
    sale_lines: { via: "sale" },
    sale_payments: { via: "sale" },
    sales: { via: "owner" },
    schema_migrations: { via: "none" },
    share_links: { via: "client" },
    subscription_events: { via: "owner" },
    subscriptions: { via: "owner" },
    transaction_codes: { via: "none" },
    usdt_p2p_rate: { via: "none" },
    whatsapp_cron_runs: { via: "none" },
    whatsapp_sends: { via: "owner" },
    client_summary: { via: "owner" },
    client_summary_all: { via: "owner" },
  },

  // Every SECURITY DEFINER function, with the exposure it is MEANT to have:
  //   service -- only the server's key; anon and any owner must get 42501.
  //   owner   -- any logged-in owner; it must check ownership itself and never
  //              hand back another business's data.
  //   public  -- reachable without an account ON PURPOSE (the client's link,
  //              the catalogue); it must answer nothing for a wrong token and
  //              nothing for another business's ids.
  // A function whose exposure in SQL differs from this list fails
  // `qa:attack-coverage`: either the migration is wrong, or this review is.
  definers: {
    admin_asegura_suscripcion: "service",
    admin_bloquear: "service",
    admin_cambiar_plan: "service",
    admin_credit_inputs: "service",
    admin_credit_movements: "service",
    admin_cuenta_historial: "service",
    admin_cuentas_lista: "service",
    admin_dar_demo: "service",
    admin_desbloquear: "service",
    admin_guarda_comprobante: "service",
    admin_ingresos_por_mes: "service",
    admin_marcar_prueba: "service",
    admin_metrics_by_owner: "service",
    admin_metrics_by_owner_money: "service",
    admin_metrics_health: "service",
    admin_metrics_orders: "service",
    admin_metrics_summary: "service",
    admin_metrics_timeseries: "service",
    admin_metrics_totals: "service",
    admin_metrics_transactions: "service",
    admin_metrics_transactions_trend: "service",
    admin_owner_options: "service",
    admin_registrar_pago: "service",
    admin_report_assistant_health: "service",
    admin_tx_rows: "service",
    admin_whatsapp_cron_salud: "service",
    bloquear_vencidas: "service",
    // Finding 7, closed by 178: a stranger froze the libreta queue for 24.9 days.
    claim_rate_limit_slot: "service",
    // Finding 8, closed by 178: only SECURITY DEFINER triggers call it.
    generar_codigo_transaccion: "service",
    // 180, the ledger rules. The log is written only by this one, which no
    // session may execute.
    ledger_rule_hit: "service",
    // Migration 182: which files nobody uses. Only the cron route behind
    // CRON_SECRET calls them; a session gets 42501.
    storage_orphan_candidates: "service",
    storage_orphan_recheck: "service",
    // 180: the insert guard runs as the caller and asks whether the rules are
    // on, so any owner may execute it. It returns a boolean and nothing else.
    // Revoking it from `authenticated` refused every direct fiado and abono
    // with 42501 in dev (caught by qa:ledger-console on 2026-11-02).
    ledger_rules_enforced: "owner",
    // 180: granted to `authenticated` because the trigger functions run as the
    // caller and need it to log and refuse. Called over RPC instead of from a
    // trigger it does nothing (`pg_trigger_depth() = 0`), so an owner cannot
    // fill the log or raise anything with it.
    ledger_refuse: "owner",
    catalog_link_owner: "service",
    claim_rate_limit_quota: "service",
    client_whatsapp_consent_state: "service",
    create_catalog_order_core: "service",
    get_current_usdt_rate: "service",
    // Finding 9, closed by 178: its migration never named authenticated.
    get_shared_catalog_preview: "service",
    get_shared_client_profile: "service",
    motivo_de_bloqueo_de: "service",
    movement_notice_target: "service",
    payment_group_of: "service",
    payment_group_summary: "service",
    product_catalog_currencies: "service",
    record_client_whatsapp_consent: "service",
    revoke_client_whatsapp_consent: "service",
    set_usdt_p2p_rate: "service",
    // Finding 9, closed by 178: its migration never named authenticated.
    share_link_owner: "service",
    upsert_report_assistant_note: "service",
    whatsapp_cron_run_registrar: "service",
    whatsapp_destinatarios_atencion: "service",
    whatsapp_destinatarios_plazo: "service",
    whatsapp_destinatarios_resumen: "service",
    whatsapp_send_begin: "service",
    whatsapp_send_finish: "service",
    whatsapp_share_token_for_client: "service",
    client_accepts_whatsapp: "owner",
    import_libreta: "owner",
    // 175/177: only the owner's own trial end
    mi_fin_de_prueba: "owner",
    mi_motivo_de_bloqueo: "owner",
    // 177: no longer callable by a stranger
    owner_puede_escribir: "owner",
    record_movement_rejection: "owner",
    record_owner_declared_whatsapp_consent: "owner",
    registrar_abono_repartido: "owner",
    revoke_owner_declared_whatsapp_consent: "owner",
    whatsapp_consent_for_phone: "owner",
    // the public catalogue; the price comes from the product (qa:orden)
    create_catalog_order: "public",
    // the client's link, by token
    get_shared_balance: "public",
    // public catalogue, by token
    get_shared_catalog: "public",
    // the client's link, by token
    get_shared_days_since_payment: "public",
    // the client's link, by token
    get_shared_open_charges: "public",
    // public catalogue, by token
    get_shared_product: "public",
    // public catalogue, by token
    get_shared_products: "public",
    // token → client; nothing without a valid token
    resolve_shared_client: "public",
    // the client leaves their ID number, by token
    submit_shared_document_id: "public",
    // the client leaves feedback, by token
    submit_shared_feedback: "public",
  },

  // Every server action, and how it is attacked:
  //   atacada   -- by qa:attack-actions, over HTTP, with a positive control
  //   cubierta: -- by another suite that already attacks it, check named
  //   excluida: -- left out on purpose, reason written
  // A new action with no line here fails qa:attack-coverage.
  actions: {
    "app/(app)/abonos/actions.ts#registrarAbonoDirigido": "cubierta: qa:abono-accion, abono dirigido a un fiado de OTRO dueño",
    "app/(app)/abonos/actions.ts#registrarAbonoRepartido": "atacada",
    "app/(app)/actions.ts#completeOnboarding": "atacada",
    "app/(app)/actions.ts#getNotifications": "atacada",
    "app/(app)/actions.ts#getUnreadNotificationCount": "atacada",
    "app/(app)/actions.ts#logout": "atacada",
    "app/(app)/actions.ts#recordImportNotification": "atacada",
    "app/(app)/clients/[id]/actions.ts#flagClient": "atacada",
    "app/(app)/clients/[id]/actions.ts#hideClientPermanently": "atacada",
    "app/(app)/clients/[id]/actions.ts#restoreClient": "atacada",
    "app/(app)/clients/[id]/actions.ts#setClientProfilePicture": "atacada",
    "app/(app)/clients/[id]/actions.ts#setClientWhatsappNotices": "atacada",
    "app/(app)/clients/[id]/actions.ts#trashClient": "atacada",
    "app/(app)/clients/[id]/actions.ts#unflagClient": "atacada",
    "app/(app)/clients/[id]/actions.ts#updateClient": "atacada",
    "app/(app)/clients/nuevo/actions.ts#permisoDelNumero": "atacada",
    "app/(app)/clients/nuevo/actions.ts#registrarCliente": "atacada",
    "app/(app)/clients/nuevo/actions.ts#validarCliente": "atacada",
    "app/(app)/dashboard/actions.ts#deleteMovement": "atacada",
    "app/(app)/dashboard/actions.ts#getOrCreateShareLink": "atacada",
    "app/(app)/dashboard/actions.ts#guardarWhatsappDeCliente": "atacada",
    "app/(app)/dashboard/actions.ts#restoreMovement": "atacada",
    "app/(app)/dashboard/search-transactions.ts#searchTransactionsByCode": "atacada",
    "app/(app)/import/actions.ts#confirmImport": "atacada",
    "app/(app)/productos/actions.ts#buscarProductos": "atacada",
    "app/(app)/productos/actions.ts#createProduct": "atacada",
    "app/(app)/productos/actions.ts#getOrCreateCatalogLink": "atacada",
    "app/(app)/productos/actions.ts#restoreProduct": "atacada",
    "app/(app)/productos/actions.ts#setProductPublished": "atacada",
    "app/(app)/productos/actions.ts#trashProduct": "atacada",
    "app/(app)/productos/actions.ts#updateProduct": "atacada",
    "app/(app)/productos/ordenes/actions.ts#descartarPedido": "atacada",
    "app/(app)/productos/ordenes/actions.ts#quitarLineaDelPedido": "atacada",
    "app/(app)/productos/ordenes/actions.ts#quitarMonedaDelPedido": "atacada",
    "app/(app)/productos/ordenes/actions.ts#registrarPedidoComoVenta": "cubierta: qa:pedido-registro, filas 8 y 15a (pedido de OTRO dueño)",
    "app/(app)/productos/ordenes/actions.ts#restaurarMonedaDelPedido": "atacada",
    "app/(app)/productos/ordenes/actions.ts#restaurarPedido": "atacada",
    "app/(app)/profile/actions.ts#addPaymentMethod": "atacada",
    "app/(app)/profile/actions.ts#changePassword": "atacada",
    "app/(app)/profile/actions.ts#deletePaymentMethod": "atacada",
    "app/(app)/profile/actions.ts#updatePaymentMethod": "atacada",
    "app/(app)/profile/actions.ts#guardarAvisosWhatsapp": "atacada",
    "app/(app)/profile/actions.ts#registrarPreguntaAvisos": "atacada",
    "app/(app)/profile/actions.ts#updateBusinessSettings": "atacada",
    "app/(app)/reportes/actions.ts#calificarAsistente": "atacada",
    "app/(app)/reportes/actions.ts#guardarUmbralDeStock": "atacada",
    "app/(app)/ventas/actions.ts#buscarProductosParaVenta": "atacada",
    "app/(app)/ventas/actions.ts#cuentaDelCliente": "atacada",
    "app/(app)/ventas/actions.ts#datosDelCliente": "atacada",
    "app/(app)/ventas/actions.ts#eliminarVenta": "atacada",
    "app/(app)/ventas/actions.ts#guardarPermisoDeVenta": "atacada",
    "app/(app)/ventas/actions.ts#productoParaVentaPorId": "atacada",
    "app/(app)/ventas/actions.ts#registrarVenta": "cubierta: qa:venta-accion, fila 8a («cliente de OTRO dueño: rechazado»)",
    "app/(app)/ventas/actions.ts#resolverMostrador": "atacada",
    "app/(app)/ventas/actions.ts#resumenDeVenta": "atacada",
    "app/admin/actions.ts#runServiceChecks": "atacada",
    "app/admin/cuentas/actions.ts#accionBloquear": "atacada",
    "app/admin/cuentas/actions.ts#accionCambiarPlan": "atacada",
    "app/admin/cuentas/actions.ts#accionDarDemo": "atacada",
    "app/admin/cuentas/actions.ts#accionDesbloquear": "atacada",
    "app/admin/cuentas/actions.ts#accionMarcarPrueba": "atacada",
    "app/admin/cuentas/actions.ts#accionRegistrarPago": "atacada",
    "app/c/[token]/actions.ts#crearOrden": "atacada",
    "app/c/[token]/actions.ts#productosDelCarrito": "atacada",
    "app/forgot-password/actions.ts#requestPasswordReset": "excluida: manda correos reales a través de Supabase Auth, y su abuso lo frena el límite de Supabase",
    "app/login/actions.ts#login": "atacada",
    "app/reset-password/actions.ts#resetPassword": "atacada",
    "app/s/[token]/actions.ts#acceptWhatsappConsent": "atacada",
    "app/s/[token]/actions.ts#revokeWhatsappConsent": "atacada",
    "app/s/[token]/actions.ts#submitDocumentId": "atacada",
    "app/s/[token]/actions.ts#submitFeedback": "atacada",
    "app/s/[token]/actions.ts#uploadProfilePicture": "atacada",
    "app/signup/actions.ts#signup": "excluida: crea cuentas y manda correos reales a través de Supabase Auth",
  },

  // Routes under app/api and what stops a stranger.
  routes: {
    "/api/cron/exchange-rate": "cron",
    "/api/cron/storage-cleanup": "cron",
    "/api/cron/whatsapp": "cron",
    "/api/cron/whatsapp-cartera-attention": "cron",
    "/api/cron/whatsapp-cartera-summary": "cron",
    "/api/extract": "session",
    "/api/reportes/asistente": "session",
    "/api/reportes/catalogo": "session",
    "/api/reportes/movimientos": "session",
    "/api/usdt": "session",
    "/api/track": "public",
    "/api/share-contact": "public",
    "/api/share-catalog": "public",
  },

  buckets: {
    attachments: "private",
    "client-profile-pictures": "private",
    comprobantes: "private",
    logos: "public-read",
    "product-photos": "public-read",
  },
};
