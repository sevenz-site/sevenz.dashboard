---
name: new-api-risk-review
description: Analyze any new third-party dependency, SDK, or external API before it's added to Sevenz — what it actually does, pros/cons, data security risk, cost, and worst-case scenarios. Use whenever a new package, service, or integration (WhatsApp, payments, analytics, AI providers, anything external) is being considered, even if the user doesn't name this skill explicitly. Never install or integrate anything from this analysis without the user's explicit go-ahead.
---

Produce this analysis **before** running any install command or writing
any integration code — this is a research and decision-support pass, not
an implementation step. See CLAUDE.md's "dev-only by default" and "ask
before assuming" rules; this skill is how "ask before assuming" applies to
new dependencies specifically.

## What to actually research

Don't answer from training data alone — pricing, APIs, and product
positioning change constantly, and this project has already been burned
by assuming stale details. Use WebSearch/WebFetch against the vendor's
current docs and pricing pages, and cite sources.

- What the service actually offers (API shape — REST/webhooks/SDK,
  official vs. reverse-engineered, verification/compliance requirements).
- Current pricing tiers and what specifically counts toward billing.
- Anything Sevenz-specific that changes the calculus — e.g. Meta business
  verification being historically harder for Venezuelan entities matters
  a lot here, since VE is a core part of Sevenz's user base.

## Structure the analysis as

1. **What it is** — grounded in current docs, not assumption.
2. **How it maps onto Sevenz today** — what exists now (e.g. a plain
   `wa.me` link) vs. what this would add, so the upgrade is concrete.
3. **Pros** — specific to Sevenz's actual product and users, not generic.
4. **Cons / risks** — cost model, vendor lock-in, onboarding friction for
   Sevenz's actual (often non-technical, sometimes Venezuelan) owners.
5. **Data security risk** — what customer/financial data would flow to
   this third party, whether it's a new data-processor relationship worth
   disclosing, whether the integration needs new secrets/webhooks and how
   those get authenticated.
6. **Worst-case scenarios** — concrete failure modes, not vague caution
   ("you build it, adoption is blocked by X" is useful; "there could be
   issues" is not).
7. **Suggested phased approach** — cheapest validation step first (a free
   tier, a single test account) before any real commitment, mirroring how
   the Kapso/WhatsApp analysis was structured.

## End every review with

A direct question to the user: proceed, hold off, or need something
checked first. Do not add the dependency to `package.json`, run an
install command, or write integration code until they've explicitly said
to go ahead — an analysis they read is not the same as a decision to
build.
