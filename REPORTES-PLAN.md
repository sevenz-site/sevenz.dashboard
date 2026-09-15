# Reportes — implementation plan

Status: **draft, not started.** Four decisions below are still open and are
marked as such; nothing should be built past Phase 1 until they are answered.

Written 2026-09-07 against production data: **23 businesses, 168 clients, 468
movements.** That number matters more than any other in this document — it is
why almost none of the performance concerns you would normally raise apply here,
and why the real risks are all about *correctness* instead.

---

## 1. What this is

Three related pieces, in the order they should ship:

| Piece | Who sees it | Ships as |
|---|---|---|
| **A** · Export a ledger to CSV / XLSX, with download history | Owner (shopkeeper) | New screen + export endpoint |
| **B** · Weekly account statement by email, PDF + data file | Owner | Cron + email provider + PDF |
| **C** · "Reportes" screen with metrics and AI analysis | Owner | New sidebar entry, below "Malas pagas" |

**Audience assumption, stated so it can be corrected:** "client" throughout the
original request is read as *the Sevenz user — the shopkeeper*, not their
customers. The sidebar placement settles it: the sidebar is the owner's app, and
their customers have no login yet (see `035_client_identity_foundations` — that
work is Fase 2+). If this is wrong, stop here; the whole plan changes.

---

## 2. Open decisions

These are product calls, not technical ones. Each has a recommendation, none is
decided.

### D1 — Weekly email: attachment or expiring link?

**Recommendation: expiring signed link.**

An attached CSV puts a permanent, unencrypted, complete copy of the business —
every client name, every debt — in an inbox forever, protected by whatever
password that owner uses on Gmail. One compromised email account exposes the
whole ledger, including data about people who never agreed to be in it.

This runs directly against the 2026-09-06/07 work, which spent two days removing
customer data from places it did not need to be. A signed link that expires in
7 days gives the owner the same access with none of the permanence.

### D2 — Is the "backup" goal recovery, or portability?

**Recommendation: say it is portability, and solve recovery separately.**

The original framing was "backup in case the system deletes the user data". A
CSV in an inbox **cannot restore anything** — there is no import path that
accepts it, and a shopkeeper could not rebuild their account from it. As
disaster recovery it is a comfort blanket.

Real recovery is Supabase point-in-time recovery, which is a **plan setting, not
a feature to build**. Decide that separately and deliberately.

The goal underneath is still legitimate and worth serving: *the owner should
hold their own copy of their own data*. That is portability and trust. It just
should not be described as a backup, because someone will one day rely on it as
one.

### D3 — AI on Gemini's free tier or paid?

**Recommendation: decide deliberately; do not inherit the free tier.**

Precedent exists — libreta photos already go to Gemini via `/api/extract`. But a
weekly structured summary of every client's debts is a step up in both volume
and sensitivity. Free-tier submissions may be used for model improvement; paid
tiers are not. Token cost either way is negligible at 23 owners × 4 per month.

### D4 — Does the report ship to all owners at once, or opt-in?

**Recommendation: opt-in for the first month.**

A weekly email that gets one number wrong reaches every owner simultaneously and
cannot be recalled. Opt-in gives a real audience without a business-wide blast
radius while the figures are still being trusted.

---

## 3. Part A — Export

### The design problem that matters

**A running balance is cumulative from the beginning of time.** Export "March
only" and the `running_balance` column begins mid-story — the first row reads
`$70.000` with nothing explaining where it came from. An owner reconciling
against their notebook gets figures that do not add up, and nothing on the page
says why.

This is independent of how the date range is chosen, and it is the single most
important requirement here:

> Every date-filtered export MUST open with a **saldo inicial** row —
> the balance as at the instant before the range starts — and close with a
> **saldo final**. Without both, the file does not reconcile and is worse than
> no export at all, because it looks authoritative.

For a VE owner that means an opening and closing balance **per currency**. Never
one combined figure. USD and EUR are independent debts; the app has never summed
them and this must not be the first place it does.

### Date range: open vs preset — the cost question

At 468 movements, **compute cost is zero either way**. Do not choose on
performance.

Ship **both**: presets (`Este mes`, `Mes pasado`, `Este año`) plus a custom
range. Presets are a thin wrapper over the same query — what they buy is that
the file can be *named what it is* (`Marzo-2026.xlsx`), so whoever opens it later
knows what they are holding. Custom stays for the accountant who needs 15 March
to 12 April.

### Timezone

Colombia is UTC−5, Venezuela UTC−4. A charge at 23:30 on the 31st falls into the
wrong month if the range is applied in UTC.

- Resolve the range in **the owner's country timezone**, from `owners.country`.
- The end date is **inclusive** — the user picked that day and expects it in.
  (`/admin` already does this: `to` becomes `${date}T23:59:59.999Z`.)
- Print the resolved range and timezone in the file header, so a disputed figure
  can be checked rather than argued about.

### Format

| Format | Library | Notes |
|---|---|---|
| CSV | none | Plain text. Must be UTF-8 **with BOM**, or Excel mangles `ñ` and accents on Windows — which is most of this user base. |
| XLSX | `exceljs` (new dependency → `new-api-risk-review`) | Buys number formatting, column widths, and a separate summary sheet. |

**Sheets in the XLSX:** `Resumen` (business, client, range, opening/closing
balance per currency), then `Movimientos`. Not one flat grid.

### Download history

One table, same shape as everything else here:

```
report_downloads
  id, owner_id, created_at,
  kind ('csv' | 'xlsx'), scope ('client' | 'cartera'),
  client_id (nullable), range_from, range_to, row_count
```

RLS scoped to `owner_id = auth.uid()`, matching every other table. `row_count` is
not decoration — it is what lets a later dispute be settled ("your export said
47 movements; the ledger has 47").

### Paging — non-negotiable

PostgREST caps a plain select at **1,000 rows and truncates silently**. This has
already produced wrong numbers in this project twice. Every export query pages,
and the export **asserts its row count against `movement_total`** before writing
the file. An export that quietly omits movements is far worse than one that
fails loudly.

---

## 4. Part B — Weekly statement email

### Scheduling

`vercel.json` already has one cron (`/api/cron/exchange-rate`, daily 13:00), and
Hobby fires crons **once a day** — the existing code comments say so.

So a weekly job is **a daily cron that checks whether it is Monday**. Cheap, no
Pro upgrade needed. Authenticate it with the existing `CRON_SECRET` bearer
pattern, exactly like the exchange-rate route.

### Provider

New third-party → **`new-api-risk-review` first**. Resend's free tier is
3,000/month; the volume here is 23 × 4 ≈ **92/month**. Free at this size for
years.

### PDF

`@react-pdf/renderer` or `pdfkit`. **Do not** use HTML-to-PDF — that needs
headless Chrome, which is too heavy for a serverless function.

### What goes in the statement

Only figures already computed elsewhere. Nothing in this report should be a new
calculation, or the report and the app will disagree.

- Total por cobrar **per currency**, and the change since last week
- Cobrado this week vs the week before
- Fiado this week vs the week before
- **Aging**: how much is 0–7 / 8–15 / 16–30 / 30+ days overdue
- New clients this week
- Clients marked mala paga this week
- Top 5 debtors by balance
- Clients with no payment in 30+ days

### AI recommendations — the guardrails matter more than the prompt

The risk is not cost. It is a **confident, wrong recommendation about a real
person**: "deja de fiarle a María" from a misread figure damages a relationship
the shopkeeper depends on, and the owner has no way to audit it.

Rules for the generated text:

1. **Every recommendation cites the figure it came from**, shown next to it.
2. **No invented numbers.** The model receives computed figures and may only
   reference those. Anything not in the input is not in the output.
3. **No collections tactics, no legal advice, no debt-shaming language.**
4. **Descriptive, not directive** — "3 clientes llevan más de 30 días sin
   abonar" rather than "cóbrale a estos tres hoy".
5. Failure is silent: if the model errors or returns something unparseable, the
   report ships **without** the recommendations section. It never blocks the
   statement, and it never ships a partial one.

---

## 5. Part C — "Reportes" screen

Sidebar, directly below **Malas pagas**.

### The metric that is genuinely missing

Owners already see balances and mala paga. What they do not have is **aging** —
how *stale* the money is. Everything needed already exists in `client_summary`
(`oldest_unpaid_charge_at`, `days_since_payment`, `oldest_unpaid_charge_plazo_dias`).

Aging is the number that decides who to call today, and it is the headline of
this screen.

### Layout

1. **Aging buckets** — 0–7 / 8–15 / 16–30 / 30+, per currency, as amounts and
   client counts.
2. **Cobros vs fiados** over the selected range, as a chart.
3. **Top debtors**, with days since last payment.
4. **Credit-score distribution** — reuses `computeCreditScore`, unchanged, so
   the number matches what an owner already sees on a client's page.
5. **Export buttons** — Part A lives here.
6. **AI analysis**, same guardrails as the email.

Almost all of this is presentation over existing data. The exception is aging
buckets, which is one new query.

### Constraints

- **375px first.** Charts inside `min-w-0` grid items — Recharts widens its
  track otherwise, which broke `/admin` at 375px on 2026-09-06.
- Wide tables scroll in their own `overflow-x-auto` container, never the page.
- Amounts **never summed across currencies**, on screen or in a file.

---

## 6. Worst cases and mitigations

| # | Scenario | Why it is bad | Mitigation |
|---|---|---|---|
| 1 | Date-filtered export shows a running balance with no opening balance | Figures do not reconcile; owner trusts a wrong total. Silent | Mandatory `saldo inicial` / `saldo final` rows, per currency |
| 2 | Range resolved in UTC, not the owner's timezone | Movements silently shift between months | Resolve from `owners.country`; print range + timezone in the file |
| 3 | Export truncated at PostgREST's 1,000-row cap | File is missing movements and looks complete. Has happened twice already | Page every query; assert row count against `movement_total`; fail loudly |
| 4 | USD and EUR summed into one total | A number that means nothing, presented as money | Per-currency columns and totals everywhere; no combined figure exists |
| 5 | Weekly CSV attachment sits in an inbox forever | One compromised email exposes the entire ledger, including client data | **D1** — expiring signed link |
| 6 | Owner relies on the email as disaster recovery | It cannot restore anything; discovered at the worst moment | **D2** — call it portability; solve recovery with Supabase PITR |
| 7 | AI recommends acting against a specific client, wrongly | Damages a real relationship; unauditable | Cite figures, no invented numbers, descriptive not directive |
| 8 | Weekly email ships a wrong figure to every owner at once | Cannot be recalled; erodes trust in every number in the app | **D4** — opt-in for the first month |
| 9 | Client financial summaries sent to a free-tier LLM | May be used for model improvement | **D3** — decide the tier deliberately |
| 10 | PDF generation exhausts serverless memory or time | Cron fails silently; nobody notices for a week | Cap movements in the PDF (summary + top N); log failures; surface on `/admin`'s service health panel |
| 11 | Cron silently stops firing | Owners simply stop receiving reports, with no error anywhere | Record each send in `report_downloads`; show "last sent" on the health panel |
| 12 | Export endpoint reachable for another owner's data | Cross-tenant leak | Owner-scoped RLS **plus** an explicit ownership check in the action, per CLAUDE.md's rule |

---

## 7. Cost summary

| Item | Cost |
|---|---|
| CSV export | None — no dependency |
| XLSX export | 1 dependency (`exceljs`), risk review |
| PDF | 1 dependency (`@react-pdf/renderer`), risk review |
| Email | 1 provider (Resend), risk review. **Free** at 92 sends/month |
| Cron | None — daily cron + Monday check. **No Pro upgrade needed** |
| AI | Negligible tokens. Real cost is the tier decision (D3) |
| Database | 1 table (`report_downloads`), 1 aging query |
| Compute | Negligible — 468 movements total |

**Three new third-party dependencies**, each requiring `new-api-risk-review`
before installation, per CLAUDE.md.

---

## 8. Sequencing

Each phase ships and is verified on its own. Every one ends with
`qa-regression-checklist` and an explicit merge decision.

**Phase 1 — CSV export, no new dependencies.** Screen, date range, per-currency
opening/closing balances, paging with the row-count assertion, `report_downloads`
table. Proves the hard parts — balances, timezone, paging — with zero new
supply chain. *Nothing below starts until this is right.*

**Phase 2 — XLSX.** Same data, formatted output, summary sheet. First risk
review.

**Phase 3 — Reportes screen.** Aging buckets, charts, top debtors, credit-score
distribution. Presentation over data Phase 1 already proved.

**Phase 4 — AI analysis on screen.** Guardrails first, on-screen only, where an
owner can compare it against the figures beside it before it is ever emailed.

**Phase 5 — Weekly email.** Last, because it is the only piece that reaches
people unprompted and cannot be recalled. Opt-in.

---

## 9. Explicitly out of scope

- Any client-facing report. Clients have no login (Fase 2+ of `035`).
- Scheduled/custom report builders.
- Restoring data *from* an export — there is no import path and this plan does
  not create one.
- Disaster recovery. That is a Supabase plan setting, and calling anything here
  a backup would be misleading.
