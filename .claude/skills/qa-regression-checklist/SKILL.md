---
name: qa-regression-checklist
description: Run a manual QA regression checklist across Sevenz's core money-path flows before launching anything to production — merging dev into main, or making any change (SQL, env vars, config) against the production Supabase project. Use whenever a production launch is being considered or requested, even if the user doesn't name this skill explicitly.
---

This is a manual checklist, not an automated test suite — this codebase
has no automated tests. Walk through each item below, actually verifying
it (read the code, check the diff since the last production release, ask
the user to run a read-only SQL query when direct DB access isn't
available), and report the result per item. Don't skip an item because it
"probably still works" — that's exactly the assumption this checklist
exists to catch.

**End state, always**: report the full checklist result to the user and
wait for their explicit confirmation before merging to `main` or touching
production. This skill never approves a launch on its own — it only
informs the user's decision. See CLAUDE.md's "dev-only by default" rule.

## 1. Scope the change

- `git diff origin/main origin/dev --name-only` (or equivalent) — what
  actually changed since the last production release. Read every touched
  file's diff, not just the commit messages.
- Identify which of the flows below are actually affected. Don't run the
  full checklist blindly if the diff only touches something narrow (e.g.
  the calculator's icon) — but do check anything that touches shared code
  (server actions, the `movements`/`client_summary` schema, RLS policies,
  auth) even if the change looks unrelated, since those are exactly the
  places a small change breaks something distant.

## 2. Core money-path flows (COP owners)

- Create a new client with a first movement (charge). Balance appears
  correctly.
- Add a charge to an existing client. Running balance increases correctly.
- Add a payment (abono). Running balance decreases correctly; payment
  can't exceed current debt.
- Delete a movement, then restore it. Balance recalculates correctly both
  times (`recalc_client_running_balance`).
- Mala paga flag/unflag cycle still works and affects status correctly.

## 3. Per-currency (VE owner) flows

- New movement (manual entry, "Registrar movimiento"): `currency` actually
  gets set to USD or EUR — never silently null. This exact class of bug
  has shipped twice before (stale-session default, and the photo-import
  path never setting currency at all) — treat this as high-risk on every
  release that touches `resolveMovementRateSnapshot`,
  `app/(app)/dashboard/actions.ts`, or `app/(app)/import/actions.ts`.
- Photo-import ("libreta") flow: imported movements for a VE owner also
  get a real currency, not null.
- `client_summary.balance_usd` / `balance_eur` reflect the actual sum of
  each currency's movements — spot-check one client with real data.
- The exchange-rate strip and calculator render for a VE owner, and the
  "Calcular" drawer/popover opens correctly (mobile drawer vs. desktop
  popover, per screen size).
- Signup's "País" field: still defaults correctly, still syncs the
  WhatsApp dial code, "Mi negocio" still renders País/rate-mode disabled
  (not editable) post-signup.

## 4. Public, unauthenticated surfaces

- The public client balance page (`/s/[token]`) — easy to forget since
  it's not behind login. Confirm it still renders for both a COP and a VE
  client, and that `get_shared_balance()`'s returned shape actually
  matches what the page destructures (a function signature change here is
  a silent breakage, not a build error).

## 5. Security checklist

From the full security audit done 2026-08-28. Two cadences: **re-check
every launch** (things new code can regress) vs. **stable** (structural
facts that only need re-checking if the diff actually touches that area).

### Re-check every launch

- **Ownership checks in the diff**: any new/changed server action that
  takes an ID from the browser (`clientId`, `movementId`, etc.) explicitly
  verifies it belongs to `auth.getUser()`'s owner — not just RLS. This is
  the exact bug class found and fixed in `getOrCreateShareLink` and
  `confirmImport` (see CLAUDE.md's "Explicit ownership checks" rule).
  Don't let it back in.
- **No secrets in the diff or in the client bundle**: grep the diff for
  anything key-shaped. If the diff touches build config or adds a new
  server-only env var, run `next build` and grep `.next/static` for that
  var's raw value (should be zero matches) — this is how
  `GEMINI_API_KEY`/`SUPABASE_SERVICE_ROLE_KEY`/`CRON_SECRET` were verified
  clean.
- **RLS parity, dev vs. prod** — if the diff touches any table or policy,
  run this in both environments and confirm they match:
  ```sql
  select t.tablename, t.rowsecurity, count(p.policyname) as policy_count
  from pg_tables t
  left join pg_policies p on p.schemaname = t.schemaname and p.tablename = t.tablename
  where t.schemaname = 'public'
  group by t.tablename, t.rowsecurity
  order by t.tablename;
  ```
  For any table holding real customer data, also pull `pg_policies.qual`/
  `with_check` and confirm it scopes to `owner_id = auth.uid()` (directly
  or via a join) — a policy existing isn't the same as a policy being
  correct.
- **`Confirm email` is ON in production** (Auth → Sign In / Providers) —
  this gets toggled off in dev-branch test-signup sprints; confirm it
  never leaked into prod before a launch.
- **New API routes** authenticate the same way existing ones do (bearer
  secret for cron-style routes, session-based auth for owner-facing ones).
- **Mask raw errors on anything unauthenticated** — for any new or changed
  endpoint, ask "who can call this without logging in?" (see CLAUDE.md's
  rule of the same name). If the answer isn't "nobody," its error
  responses must be a generic message only — no raw upstream/third-party
  error text, no database error detail. An authenticated endpoint (session
  or bearer secret) may keep surfacing real error text for debugging —
  that's a deliberate, accepted tradeoff, not a gap.

### Stable — only re-check if the diff touches the relevant area

- `.env*` never committed (`git log --all -- .env*` across all refs) —
  re-check only if `.gitignore` changes.
- No SQL built by string concatenation anywhere — re-check only if a new
  Postgres function or raw query is added.
- IDs are `uuid`/`gen_random_uuid()`, and any public-facing token uses
  `gen_random_bytes` with real entropy — re-check only if a new table or
  public-facing identifier is added.
- No admin panel or route outside `(app)`'s session guard — re-check only
  if a new top-level route is added.
- No CORS header set on custom API routes (Supabase's own APIs don't need
  one — they're policy-gated, not origin-gated) — re-check only if a route
  sets response headers.

### Not yet formalized — tracked, not blocking

Some of the original audit's items haven't been closed out yet: output
HTML sanitization beyond the one `dangerouslySetInnerHTML` in
`components/ui/chart.tsx`, stack traces / raw third-party error bodies in
production responses, request-body logging depth, webhook signature
verification (relevant once Kapso/WhatsApp or any webhook integration
ships — pair with the `new-api-risk-review` skill then), dependency
freshness (`npm outdated`/`npm audit`), Supabase's leaked-password check
(HaveIBeenPwned toggle in Auth settings), and Storage bucket-level
MIME/size policies. Flag these as open follow-up in the launch report —
they don't block a launch unless the diff being reviewed touches one of
them directly.

## 6. Migration hygiene

- **Hard blocking check — ledger parity.** Ask the user to run
  `select key from public.schema_migrations order by key;` in both the dev
  branch's SQL editor and production's, and paste both results. Diff the
  key sets. If dev has any key production doesn't, **stop — do not approve
  the launch**: tell the user exactly which key(s) are missing and that
  those SQL statements need to be run against production first (see
  CLAUDE.md's migration-ledger rule). This is the check that exists
  specifically to prevent a repeat of a deploy going out before its
  migrations ran — do not treat it as optional or skip it because the diff
  "looks small."
- Every new SQL migration is idempotent / safe to re-run (matches this
  project's established pattern: `if not exists`, `create or replace`,
  guard tables for one-time data conversions).
- If the migration touches existing data (not just schema), confirm
  there's a real rollback path — either a written reverse script, or an
  explanation of why one isn't needed.
- Every migration and every ad hoc SQL fix run against dev ends with an
  insert into `public.schema_migrations` recording it (see CLAUDE.md) — if
  a diff shows raw SQL without that insert, flag it before proceeding.

## 7. Final report format

Report as a table (see CLAUDE.md's "Report QA and verification work as a
table" rule) — one row per section above, not prose alone:

| Section | Skill/tool used | Result |
|---------|-----------------|--------|

Add a Notes column for anything skipped and why (e.g. "skipped — diff
doesn't touch this area"), or any caveat worth flagging. End with a direct
question: does the user want to proceed with the launch, given these
results.
