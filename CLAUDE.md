@AGENTS.md

# Sevenz working rules

## Dev-only by default

Every code change, SQL migration, and any git action that touches `main`
only happens when the user explicitly asks for it **in that specific
request**. A prior "go ahead" or a completed launch never carries forward
to the next batch of work — each production-facing action needs its own
explicit green light, no matter how many times it's been given before.

This covers, concretely:
- Writing or editing application code — always on `dev` unless told otherwise.
- Any SQL migration — write it, but do not tell the user to run it against
  production, and do not run it yourself, until they've said to launch.
- `git push` to `main`, or `git push origin dev:main` — never do this
  proactively. Merging `dev` into `main` is a production deploy.
- Anything that touches the production Supabase project directly (SQL
  editor scripts, env vars, dashboard settings).

As of 2026-08-27, dev is a **persistent Supabase branch** of the production
project (branch ref `vzqppwrwnmlbrxizskdh`), not a separate project — this
replaced the old standalone dev project (`ukufbludmpmcgdpqnvtm`, now retired
but left dormant, not deleted). Production is `rabmiyqodnvnrwiartuj`. A
migration still has to be run manually in both the branch and production —
branching only removed "two unrelated projects to remember," not "run every
migration twice."

**Gotcha if another branch is ever created**: branch creation clones
everything in the `public` schema (tables, functions, grants) correctly, but
a trigger defined on `auth.users` does not get cloned, even though the
function it calls does. Concretely, `handle_new_user()` existed on the new
branch but the `on_auth_user_created` trigger firing it didn't, so signups
silently created no `owners` row. A schema check that only verifies the
function exists won't catch this — only one that verifies a real signup
actually produced an owner row will. Fix, if it recurs:

```sql
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

**Second gotcha, found 2026-08-28: Storage buckets don't get cloned either.**
Branch creation clones the SQL schema (tables, policies, functions) but not
Storage buckets — the dev branch had zero buckets at all (`logos`,
`attachments` both existed only in production), meaning every logo/attachment
upload would fail outright until this was caught. A schema check that only
verifies `storage.objects` policies exist won't catch this either — the
policies can be perfectly correct while the buckets they apply to don't
exist. Fix, if it recurs (see `supabase/030_dev_storage_buckets.sql` for the
full version matching this project's actual buckets):

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('<bucket>', '<bucket>', <public bool>, <bytes>, array['<mime>', ...])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
```
Then recreate every policy on `storage.objects` for that bucket — they're
ordinary Postgres policies, droppable/creatable like any other.

## Record every dev SQL change in the migration ledger

`public.schema_migrations` (created by `supabase/028_schema_migrations_ledger.sql`)
tracks every schema change ever run against a database — not just numbered
migration files, and not just the one-time data conversions that
`applied_data_migrations` exists for. Its whole purpose is letting a
pre-launch check compare dev's and production's own copies of this table
and catch anything dev has that production doesn't, so a migration never
again gets forgotten before a production deploy.

Any SQL run against the dev branch — a numbered migration file **or** a
two-line manual fix typed directly into the SQL editor — must end with:

```sql
insert into public.schema_migrations (key, description)
values ('<key>', '<one-line description>')
on conflict (key) do nothing;
```

Use the migration file's own name as `<key>` when one exists (e.g.
`028_schema_migrations_ledger`); for an ad hoc fix with no file, use a short
dated slug (e.g. `2026-08-27_fix_stray_null_currency`). No exceptions for
"it's just a small fix" — an unlogged fix is exactly what this table exists
to prevent. When the same SQL is later run against production, insert the
same key there too — that match is what the parity check compares.

## Explicit ownership checks in server actions

Any server action that reads or writes a row identified by an ID that comes
from the browser (`clientId`, `movementId`, etc.) must verify that row
actually belongs to the authenticated owner **explicitly in code** — e.g.
`.eq("owner_id", user.id)`, or a pre-check against `clients` when the table
doesn't carry `owner_id` directly — matching the pattern already used in
`app/(app)/clients/[id]/actions.ts`. RLS is the backstop, not the only line
of defense.

A security audit (2026-08-28) found two functions that had skipped this and
relied on RLS alone — `getOrCreateShareLink` and `confirmImport`. Neither
was actually exploitable (RLS held in both cases), but each was a single
point of failure: if a future migration ever loosened the relevant RLS
policy by mistake, these were the only two places with no second layer of
defense. Both were fixed. Don't reintroduce this pattern in new server
actions — every new one should get the same explicit check from the start.

## Mask raw errors on unauthenticated endpoints

Before shipping any endpoint — a new one, or a change to an existing one —
ask: "who can call this without logging in?" If the answer isn't "nobody,"
its error responses must never leak raw upstream/third-party error text,
database error detail, or anything else internal. Return a generic,
user-facing message instead; log the real detail server-side only
(`console.error`), never in the response body.

Endpoints that *do* require authentication (a session, or a bearer secret
like `CRON_SECRET`) may keep surfacing real error text for debugging
convenience — see `signup/actions.ts`, `/api/extract`,
`/api/cron/exchange-rate`, all deliberate, all gated by auth. That's an
accepted tradeoff for a narrow, authenticated audience, not a gap. The
rule is specifically about endpoints anyone can reach with no account at
all — e.g. `/s/[token]` and its `get_shared_balance()` RPC, or any future
public page or webhook receiver.

## Ask before assuming

For product/data-modeling decisions, currency or financial-logic choices,
or anything with more than one reasonable reading, ask a clarifying
question before implementing. Don't guess and bake the guess into code or
a migration — this is doubly true for anything touching real customer
balances or money.

## Report QA and verification work as a table

Whenever a round of testing or verification wraps up — a security audit, a
live feature check, a full `qa-regression-checklist` run, anything where
something was actually tested rather than just written — report it as a
table, not prose alone. One row per specific test/check, minimum columns:

| Test | Skill/tool used | Result |
|------|-----------------|--------|

Add a **Notes** column whenever there's a caveat, a partial pass, or a
follow-up worth flagging. The point is to keep the work auditable and let
the user spot at a glance where confidence is real vs. where something
still needs scrutiny, and to give feedback on a specific row instead of
the effort as a whole.

After the table, add a short **Recommendations** section covering every
row that wasn't a clean pass (⚠️/❌/partial) — one line per row, naming the
concrete next action: what was already fixed and how, or what's still
open and the specific step to close it. Skip this section entirely if
every row is a clean pass — don't manufacture a recommendation where
there isn't a real one. This applies to the `qa-regression-checklist`
skill's own final report (see its section 7), to any security-audit pass
(e.g. the 2026-08-28 audit), and to any live verification of a new
feature (build checks, browser testing, etc.) — not just pre-launch runs.

## Explain bugs in two languages: dev and plain

Whenever explaining a bug, a fix, or a technical finding — by default,
not only when asked — give both:

1. **Dev explanation**: precise, references the actual code/state/logic
   and the exact condition that triggers it.
2. **Plain-language explanation**: no jargon, told as a real, concrete
   scenario with a name — something a non-technical shop owner could
   follow without reading code.

Reason: whoever's reading the report might not be a programmer, and even
when they are, a concrete story makes real-world severity legible faster
than a code trace does.

Real example (the `openForPayment()` currency bug, 2026-08-28):

- **Dev**: `openForPayment()` only corrected `currency` toward `"EUR"`
  (`if (currentDebtUsd <= 0 && currentDebtEur > 0) setCurrency("EUR")`),
  never back toward `"USD"`. If `currency` was already `"EUR"` from a
  prior interaction while `currentDebtUsd > 0` and `currentDebtEur <= 0`,
  `type` got set to `"payment"` but the existing
  `type === "payment" && !canPay` guard (computed against the stale
  `"EUR"` selection) immediately reverted it to `"charge"` before paint.
- **Plain**: imagine a Venezuelan owner who was just looking at a
  different client's account in euros. They open Pedro's page — Pedro
  owes $50 in dollars, nothing in euros — and tap "Agregar abono" to log
  that Pedro just paid. Because the app still remembered "euros" from
  moments ago, it quietly flips the screen back to "register a new
  charge" instead, with zero explanation. The owner tapped a button that
  said "record a payment" and landed on "add a debt" instead.

## Skills that apply automatically

- Before merging `dev` into `main`, or making any change to the production
  Supabase project: run the `qa-regression-checklist` skill first, and
  wait for the user's explicit confirmation before actually launching.
- Before adding any new third-party dependency, SDK, or external API: run
  the `new-api-risk-review` skill first, and wait for explicit approval
  before installing or integrating anything.
