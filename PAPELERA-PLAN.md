# Papelera y archivado de clientes — implementation plan

Status: **Phases 1–3 built on `dev`, 2026-09-07.** All decisions are settled
(§2, §3). What shipped and what is still open is listed in §9.

Written 2026-09-07 against production: **23 businesses, 168 clients, 468
movements.**

---

## 1. The problem, and what actually solves it

Owners want to stop seeing clients who never paid. Today the only tool is the
mala-paga flag, which marks them but keeps them in every list.

The risk they are trading against is real: **delete a debtor and you destroy the
record of the debt.** If that person walks back in six months with the money,
the owner has nothing — no amount, no dates, no history.

Two hiding states, plus a flag that is **orthogonal to both**:

| State | Visible where | Reversible | Exists today |
|---|---|---|---|
| Activo | Everywhere | — | **Yes** |
| Papelera | Papelera screen only (O2) | Yes, restore | No |
| Oculto definitivamente | Nowhere in the owner's UI | Support only | No |
| *Mala paga* (flag) | Independent of the above | Yes, unflag | **Yes** |

**Mala paga is NOT a prerequisite for the Papelera.** An earlier draft of this
plan treated the three as a sequence; that was wrong, and the reason matters.

Owners also need to remove duplicates, test clients, people who moved away and
records created by mistake — and this app *produces* duplicates, since `034`
deliberately dropped the unique-document index and photo import can create a
second record for one person. If the only route into the Papelera ran through
mala paga, owners would **mislabel people as bad payers in order to tidy up**.
That flag feeds `client_flags` and `computeCreditScore`, so gating on it would
corrupt the credit score to work around a missing delete button.

Mala paga is therefore one *entry point*, not a gate. Trashing preserves the
flag; restoring returns the client to exactly the state they left.

**"Ocultar definitivamente" is not deletion, and must not be labelled as such.**
Per §2 identity is retained and the share link keeps working. An owner who
clicks `Eliminar` and later finds their "deleted" client still viewing a live
balance has been misled by the button.

---

## 2. Decisions taken (2026-09-07)

**D1 — Layer 3 retains everything, including identity.** Name, document,
WhatsApp, address and history all stay. Nothing is anonymised.

> Recorded trade-off, made knowingly: a real person's debt record is retained
> indefinitely by a company they have no relationship with. Colombia's Ley 1581
> (habeas data) gives that person a deletion right. Revisit if a client ever
> exercises it — there is currently **no mechanism to honour such a request**,
> and building one later is far more work than a `document_id = null` today.

**D2 — A client with an outstanding balance can go to the Papelera, and their
balance leaves the totals.** This is the actual use case: malas pagas owe money,
which is why the owner wants them gone.

**D3 — The share link keeps working and keeps showing the balance.** The link
belongs to the client, not the owner, and it is the path by which a forgotten
debt gets paid.

**D4 — The Papelera is indefinite.** Nothing expires on its own; the owner
empties it deliberately. Layer 3 therefore only ever happens on an explicit act.

**D5 — Wording: `Papelera` and `Ocultar definitivamente`.** Never `Eliminar`,
for the reason in §1.

**D6 — Any client can be sent to the Papelera**, regardless of mala-paga status.
Trashing preserves the flag; restoring returns it.

**D7 — Notifications record all three transitions** — sent to Papelera, hidden
permanently, and restored. See §7.

---

## 3. Decisions taken (2026-09-07, second round)

**O1 — The Papelera is its own sidebar entry, directly below Malas pagas.**
The two screens answer the same question at different strengths, and an owner
looking for a client they can no longer find will try both in order.

**O2 — Hidden clients do NOT appear in the add-movement search.** Hidden means
hidden on every screen. The route back is Papelera → Restaurar, which is why
O1 gives it a permanent, findable place in the sidebar rather than burying it.

> This decision was taken against the recommendation in the earlier draft, so
> the risk it accepts is stated rather than dropped: §6.3 (the returning
> debtor) is now mitigated by the sidebar entry alone. If owners are ever
> observed recording a returning client's payment against a *new* record, that
> is this decision showing up in the data, and O2 is what to revisit.

**O3 — Photo import matches hidden clients rather than duplicating them.**
Creating a second record splits one person's history in two and the owner has
no tool to merge them back. See §10 for what was built and what was deferred.

**O4 — Notifications name the client, including a permanent hide.** *"Ocultaste
definitivamente a Juan Pérez."* Honest and searchable; the owner needs to know
which person they hid. The trade-off accepted is the one named in §7: the name
reappears once in the notifications feed.

---

## 4. Architecture — the part that carries the risk

The delete logic is trivial. **The risk is that 29 code paths and 19 SQL
references read clients, and every one must exclude hidden ones.** Miss a single
query — the search dialog, import matching, a notification, the credit score,
a report — and a hidden client reappears. That failure is silent and in the
worst direction.

**Do not add 29 filters.** Filter once, where everything already passes:

- `client_summary` gains `where trashed_at is null and deleted_at is null`.
  Every existing consumer inherits the correct behaviour with no change.
- A new `client_summary_all` (unfiltered) serves the Papelera screen and the
  `/admin` metrics, which must keep counting hidden clients — the whole point of
  D1 is that the platform keeps its numbers.

This makes **the safe behaviour the default**: a query someone forgets to update
shows *too little*, never too much. The opposite arrangement leaks.

### Schema

```
clients
  + trashed_at   timestamptz null   -- layer 2
  + deleted_at   timestamptz null   -- layer 3
  + trashed_balance      numeric null  -- balance at the moment of hiding
  + trashed_balance_usd  numeric null
  + trashed_balance_eur  numeric null
```

Two nullable timestamps, matching `movements.deleted_at`, which is the existing
soft-delete convention in this codebase.

The three `trashed_balance_*` columns exist because of D2 and §6.1: they are what
lets a report explain why a total dropped. Snapshot per currency — USD and EUR
are never summed anywhere in this app and must not start here.

### Events

Reuse the existing notification tables rather than inventing a log. Record
trashing, restoring and archiving with a timestamp so history is explicable
later — the same reason `client_flags` records `flagged_at` and `unflagged_at`
rather than a boolean.

---

## 5. Entry points and border cases

### Where an owner can send a client to the Papelera

| From | Why it belongs there |
|---|---|
| **Malas pagas** screen | The stated use case: "I never want to see this person again" |
| **Client detail** | Where an owner lands after realising a record is a duplicate or a mistake |
| **Clients** list, row action | Bulk tidying without opening each client |

All three reach the same action. None requires the mala-paga flag (D6).

### Border cases, and what each should do

| Case | Behaviour |
|---|---|
| Client has **no movements** (created by mistake, test row) | Trash with a light confirm. Nothing to lose |
| Client has a **zero balance** but real history | Trash with a normal confirm; history is preserved |
| Client **owes money** | Trash with a strong confirm naming the amount per currency — this is the case owners will regret |
| Client is **mala paga** | Trash; the flag is preserved, and restoring returns them flagged |
| Client is **not** mala paga | Trash; no flag is invented. Never auto-flag on trashing — that would corrupt `client_flags` exactly as §1 warns |
| Client has a **pending review** movement (`needs_review`) | Trash allowed; the review stays pending and reappears intact on restore |
| Client has an **unread notification** (e.g. opened their link) | The notification survives, relabelled per §6.4. Trashing must not silently clear an owner's unread items |
| Client is referenced by an **in-flight photo import** | The import holds `client_id`; confirming it after a trash would write movements onto a hidden client. Block with "este cliente está en la papelera — restaurar para continuar" (O3) |
| Client **submits their document** through the share link while trashed | Allowed. D3 keeps the link live, and a document arriving is useful. Do not surface it as a notification for a hidden client |
| **Last remaining client** is trashed | Dashboard must show the real empty state, not a broken zero |
| Client is **restored** while a duplicate exists | Warn on the normalized document (6.6) |

---

## 6. Worst cases and mitigations

### 6.1 — Totals change retroactively, with no explanation

**D2 means hiding a client with $200 owed drops "Capital por cobrar" by $200.**
Last week's report said one number, this week says another, and nothing on
screen says why. That is the silent-wrong-number pattern that has cost this
project repeatedly.

**Mitigation:** snapshot the balance at the moment of hiding
(`trashed_balance_*`), and show an explicit line in Reportes:
*"$200 archivado el 12 de marzo"*. The total may change; it must never change
inexplicably. This is also what keeps `REPORTES-PLAN.md`'s exports reproducible.

### 6.2 — A forgotten query leaks a hidden client

**Mitigation:** the `client_summary` default in §4. Plus a checklist item: any
new query touching clients states which view it uses and why.

### 6.3 — The returning client cannot be found (feature defeats itself)

The owner hides a mala paga; months later they arrive with cash; the owner
searches and finds nothing, so records the payment against a **new** client. Now
one person has two records and the original debt still shows as unpaid forever.

**Mitigation:** O1 — the sidebar entry. Hidden clients appear in the add-movement search, grouped and
labelled, with Restaurar inline.

### 6.4 — Hidden clients keep generating notifications

D3 keeps the share link alive, and opening it writes `link_opens`, which re-arms
"tu cliente vio su saldo". An owner who hid someone keeps being pinged by them.

**Mitigation, and it is an opportunity rather than a nuisance:** do not suppress
it — relabel it. *"Un cliente en la papelera abrió su saldo"* is a buying signal:
that person is thinking about the debt. Surfacing it is arguably the single most
valuable notification in the app.

### 6.5 — "Vaciar papelera" is bulk and irreversible

**Mitigation:** confirm with the count and the total amount involved
(*"18 clientes · $1.240.000"*), typed confirmation for more than N clients, and
never a default-focused destructive button.

### 6.6 — Restore collides with a client created since

No hard conflict: `034` deliberately dropped the unique document index, so
duplicates are permitted. But a restore that silently produces two records for
one person is a data-quality problem.

**Mitigation:** on restore, if a live client shares the normalized document,
warn and offer to open the existing one instead.

### 6.7 — Mala-paga history laundering

An owner could hide a client and re-create them to clear a bad history. **D1
prevents this** — identity is retained, so the match survives. Worth stating
because it is the one place D1 is strictly safer than anonymising.

### 6.8 — Hidden clients and future client accounts

`035_client_identity_foundations` will match future client logins on
`(document_country, normalized_document_id)`. A hidden client retains their
document, so a returning person **will** match a record their owner believes is
gone, and could see that balance.

**Mitigation:** decide, before Fase 2 of the identity work, whether a hidden
client is visible to a logged-in client. Not blocking now; must not be
discovered then.

### 6.9 — No way to honour a deletion request

Following from D1, there is currently no path to genuinely erase a person on
request.

**Mitigation:** the plumbing already exists — layer 3 plus a
`document_id = null, name = 'Cliente eliminado'` update would satisfy it while
keeping the amounts. Roughly an hour's work, and worth doing the first time
anyone asks rather than under pressure.

---

## 7. Notifications (D7)

Three transitions are recorded: **enviado a la papelera**, **ocultado
definitivamente**, **restaurado**.

Reuse the pattern that already exists for movements. `movement_deletions` plus
the notifications screen is exactly this shape — delete, get a notification,
restore from it — and it works. Trashing a client should feel identical, because
to an owner it *is* the same gesture at a different scale.

**Restore lives in the notification**, as it does for movements. That is the
undo path an owner reaches for when they realise the mistake ten minutes later.

### The trade-off O4 accepted

A notification saying *"Ocultaste definitivamente a Juan Pérez"* puts Juan's name
back in a list the owner reads daily. O4 chose to name him anyway: an owner
scanning the feed needs to know *which* person they hid, and a nameless
"ocultaste un cliente" is a record nobody can act on. The name appears once, in
one row, with no undo button — there is nothing to undo.

### Not a notification

Do not notify on **every** action an owner takes — the app does not do that
today, and it would bury the notifications that matter (a client opened their
link; a movement was deleted). These three qualify because each is either
destructive or reversible; ordinary edits do not.

---

## 8. Sequencing

Each phase ends with `qa-regression-checklist` and an explicit merge decision.

**Phase 1 — Schema + the `client_summary` filter.** Migration adding the
columns, the filtered view, and `client_summary_all`. No UI. Verify by comparing
every owner-facing screen before and after: with nothing hidden, **every figure
must be byte-identical**. This is the highest-risk phase and it ships alone.

**Phase 2 — Papelera.** Send to trash, Papelera screen, restore. Requires O1–O3
answered.

**Phase 3 — Archivar.** Layer 3, empty-trash with the confirmation from 6.5.

**Phase 4 — Integrations.** Search grouping (O2), import matching (O3),
notification relabelling (6.4), the Reportes line from 6.1.

---

## 9. What was built on `dev`, 2026-09-07

**Migration** — `supabase/044_client_papelera.sql`. Adds the two timestamps and
the three-currency balance snapshot, turns `client_summary` into the filtered
view, adds the unfiltered `client_summary_all`, creates `client_hides`, and
repoints `get_shared_balance` at the unfiltered view so D3 holds.

**Entry point** — the client detail header now carries two controls: **Chat**
(WhatsApp, unchanged) and **Más**, a menu holding *Compartir enlace* and *Mover
a papelera*. Sharing moved into the menu; it was a second icon competing for the
same corner, and on a phone that corner is the whole header. On a client already
in the Papelera the menu offers *Restaurar cliente* and *Ocultar
definitivamente* instead.

**Confirmations** — three tiers, per §5: a client who owes money gets a dialog
naming the amount; one with history but no balance gets a normal one; one with
no movements gets a single line.

**Papelera screen** — `/papelera`, sidebar entry below Malas pagas. One card per
client with the balance *at the moment of hiding*, the date, the mala-paga badge
if it was set, and both actions.

**Notifications** — all three transitions, each naming the client (O4), with
Restaurar living on the trashed row. The button disappears once the client is
restored by any route.

**Guards, so a hidden client cannot be written to by accident** — `addMovement`
rejects a trashed client; `confirmImport` stops the whole batch and names the
client; the manual and import duplicate checks both still see hidden clients and
say so, which is what prevents one person's history splitting in two (§6.6,
§6.7); the add-movement search on Cartera, Clientes and Malas pagas excludes
them (O2).

### Deferred, deliberately

- **O3's review-table affordance.** Import currently *blocks* on a hidden match
  with "restáuralo desde Papelera" rather than offering *restaurar* inline in
  the review table. Nothing duplicates and nothing writes to a hidden client,
  which is the part that carried the risk — but the smoother flow is not built.
- **Row action in the Clientes list** (§5's third entry point). The two other
  entry points are live; this one is a desktop-only icon column and can follow.
- **Vaciar papelera** (§6.5) — bulk permanent hide with a typed confirmation.
  Hiding is one client at a time today.
- **The Reportes line from §6.1.** `trashed_balance_*` is being written, so the
  data a report needs exists from today. The report itself belongs to
  `REPORTES-PLAN.md`.

## 10. Out of scope

- Real deletion / anonymisation (see 6.9 — plumbing noted, not built).
- Owner-initiated export of a hidden client's history — belongs to
  `REPORTES-PLAN.md`.
- Anything about client-side login. That is Fase 2+ of `035`.
