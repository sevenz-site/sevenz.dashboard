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

## 5. Data-security pass

- No secrets, API keys, or service-role credentials appear in the diff
  (grep the diff for anything key-shaped, not just an obvious `.env` file).
- Any new SQL grant is least-privilege — matches the existing pattern of
  explicit per-table grants, not a broad grant that wasn't there before.
- Any new or changed RLS policy: confirm it still scopes to
  `owner_id = auth.uid()` (or the equivalent existing pattern) and hasn't
  been accidentally loosened.
- Any new API route authenticates the same way existing ones do (bearer
  secret for cron-style routes, session-based auth for owner-facing ones).

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

Summarize as a pass/fail list, one line per section above, calling out
anything not checked and why (e.g. "skipped — diff doesn't touch this
area"). End with a direct question: does the user want to proceed with
the launch, given these results.
