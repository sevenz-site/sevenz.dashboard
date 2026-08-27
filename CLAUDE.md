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

## Ask before assuming

For product/data-modeling decisions, currency or financial-logic choices,
or anything with more than one reasonable reading, ask a clarifying
question before implementing. Don't guess and bake the guess into code or
a migration — this is doubly true for anything touching real customer
balances or money.

## Skills that apply automatically

- Before merging `dev` into `main`, or making any change to the production
  Supabase project: run the `qa-regression-checklist` skill first, and
  wait for the user's explicit confirmation before actually launching.
- Before adding any new third-party dependency, SDK, or external API: run
  the `new-api-risk-review` skill first, and wait for explicit approval
  before installing or integrating anything.
