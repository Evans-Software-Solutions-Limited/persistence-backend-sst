# MARKETING-PLANS — start here (next session)

> **Superseded in part on 5 Sep 2026.** Read `ADDENDUM-2026-09-05-paid-founding-offer.md` first: the founding offer is now a paid web purchase (Stripe Checkout, Premium £30/6 mo · £60/12 mo, Premium+ £50/6 mo · £100/12 mo, live until 30 September), WP8 is withdrawn, WP10–WP12 are added, and `LANDING_PAGE.md` v2 carries the sales-page copy. Where this file conflicts with the addendum, the addendum wins.

Everything needed to run this milestone is in this folder. Read in this order, then act.

0. `ADDENDUM-2026-09-05-paid-founding-offer.md` — the current decision (paid web checkout, WP10–WP12, sprint order). Then `LANDING_PAGE.md` (v2, sales page).

1. `BRIEF.md` — the coding-agent brief. Hand it to the coding agent verbatim, or paste the prompt below.
2. `MARKETING_BRIEF.md` § 0 — the decision and the Phase 0 values P1–P5 (codes, the four store offers, caps/expiry ownership, VAT, £210 cap).
3. `EXECUTION_PLAN.md` — Brad's ordered checklist with gates.
4. `CREATIVE_BRIEF.md` — constraints for the ads Brad makes himself.

## Kick-off prompt for the coding agent

```
Read specs/milestones/MARKETING-PLANS/BRIEF.md and implement it on a new branch
feat/marketing-plans off origin/main, one PR, one conventional commit per work
package (WP1–WP7). Root CLAUDE.md and STATE.md rules apply; the FOUNDING-OFFER
2026-09-04 amendment in specs/milestones/FOUNDING-OFFER/BRIEF.md § 2 controls
wherever older text conflicts. Do not invent, suggest or hard-code any referral or
offer code word; link existing codes only. Do not touch packages/mobile. Run the
full gates before each commit, the local inspector-brad on the final diff, add
SMOKE_TEST.md and FOLLOW_UPS.md as § WP7 and § 4 describe, update STATE.md, and
ping Brad via slack-progress-updates when the PR is green.
```

## Brad's own first three actions (no code)

1. Create the first referral code(s) in `/admin → Referral codes` (P1).
2. Configure the four App Store offers and custom codes with caps and expiry in App Store Connect (P2, P3); redeem one end to end on a fresh Apple ID and confirm a `user_subscriptions` row exists.
3. Raise the Meta ad-account spending limit to £210 (P5).

Then follow `EXECUTION_PLAN.md` Phase 1 → 5.
