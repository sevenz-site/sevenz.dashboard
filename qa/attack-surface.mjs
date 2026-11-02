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

  return { tables: [...tables].sort(), views: [...views].sort(), definers, routes: routes.sort(), buckets: [...buckets].sort() };
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
    link_opens: { via: "client" },
    movement_deletions: { via: "client" },
    movement_rejections: { via: "none" },
    movements: { via: "client" },
    owner_exchange_settings: { via: "owner" },
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

  // Routes under app/api and what stops a stranger.
  routes: {
    "/api/cron/exchange-rate": "cron",
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
