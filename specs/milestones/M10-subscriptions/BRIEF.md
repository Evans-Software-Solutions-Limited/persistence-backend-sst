# M10 — Subscriptions & payments (Stripe) — BRIEF (stub)

Briefs to be authored before milestone starts.

**Parent spec:** [`../../11-payments-subscriptions/`](../../11-payments-subscriptions/).

**Scope sketch:**

Deferred to last feature milestone. Upsell chrome appears in earlier milestones but CTAs no-op until M10.

- Backend: Stripe webhook receiver, plan catalog (`GET /subscriptions/plans`), checkout (`POST /subscriptions/checkout`), portal (`POST /subscriptions/portal`), entitlement (`GET /subscriptions/me`).
- Frontend: subscription selection screen (post-auth or Profile upgrade flow); entitlement gates per screen; Stripe React Native SDK.
