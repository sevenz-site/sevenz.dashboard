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

**Today**, dev and production are two fully separate Supabase projects
(dev: `ukufbludmpmcgdpqnvtm`, prod: `rabmiyqodnvnrwiartuj`) — every
migration has to be run manually in both SQL editors. A persistent-branch
migration (production branching, replacing the standalone dev project) is
planned but not yet done — when it happens, update this note, not the rule
above; "dev environment" vs. "production environment" stays true either way.

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
