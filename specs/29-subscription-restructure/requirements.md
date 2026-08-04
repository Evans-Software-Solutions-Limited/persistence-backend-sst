# 29 — Subscription restructure (tiers, pooled AI budget, organisation rail): Requirements

**Opened 2026-08-04 by Brad.** Canonical decision record is `STATE.md`
§ "TIER + PRICING RESTRUCTURE". This spec is the executable form of it.

**Why now:** nothing is purchasable yet — **no ASC products are live** — so every
price and tier name here can change with zero grandfathering. That window closes at
launch, and it is the only reason this is cheap to do.

## Locked decisions (Brad)

| #   | Decision                                                                                                                                                                                                                                                                               |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Coaches get Mealprint. Coach tiers move on BOTH client count and features.                                                                                                                                                                                                             |
| D2  | Loadout + Mealprint stay Premium+-only on the CONSUMER track.                                                                                                                                                                                                                          |
| D3  | ⚠ No small daily allowance as an upgrade lever. Metering only converts if the median user hits the cap; at ~2/day typical a 3/day allowance converts nobody and spends the exclusivity.                                                                                                |
| D4  | AI ceilings are a **backend fail-safe, never an advertised quota**, and become a TOTAL per-user cost budget.                                                                                                                                                                           |
| D5  | Programme import lands on athlete Premium+ **and** the coach tiers — an imported programme is just a collection of workouts.                                                                                                                                                           |
| D6  | `individual_trainer` displays as "Start Up Coach". ⚠ `display_name` only.                                                                                                                                                                                                              |
| D7  | AI workout generation is a FUTURE Premium+ addition, built on Loadout + Mealprint. Justifies a later price rise, not a current one.                                                                                                                                                    |
| D8  | Coach entry £14.99.                                                                                                                                                                                                                                                                    |
| D9  | Pooled AI budget adopted, conditional on beating typical usage with headroom.                                                                                                                                                                                                          |
| D10 | Split rail adopted: single-user tiers via IAP, organisation tiers via web.                                                                                                                                                                                                             |
| D11 | **The top IN-APP coach tier is 30 clients** — the realistic ceiling for one PT.                                                                                                                                                                                                        |
| D12 | ~~Premium HOLDS at £12.99/mo.~~ **REVISED 2026-08-04: Premium → £14.99/mo.** The annual discount deepens to ~30 %. Reason: the 15 % Apple Small Business rate is NOT approved, so every tier is modelled at 30 %. £12.99 at 30 % nets $11.43 — less than the tier's own worst-case AI. |

## STORY-001 — A solo coach can buy a plan that fits their book

**AC 1.1** The coach ladder offers 5 / 15 / 30 client rungs in-app, and 75 / 200 /
invoiced above that on the web.
**AC 1.2** 30 clients is the highest client cap purchasable in-app (D11). Industry
data: full-time in-person PT 15–25 active clients; online coach 20–30; hybrid 25–35.
Above 30 a solo coach is running a business with systems or other trainers.
**AC 1.3** The suite/no-suite split exists at the ENTRY rung only. Every rung above
Start Up Coach includes Loadout + Mealprint.
**AC 1.4** No tier carrying the adaptive suite is priced below £29.99 — otherwise it
undercuts consumer Premium+.

## STORY-002 — AI cost is bounded by ONE budget the user never sees

**AC 2.1** A per-user **rolling 30-day cost budget** per tier (see AC 2.3b — sized
per-day, enforced over the window), summed across every AI endpoint, weighted by that
endpoint's cost. ⚠ Weighted by COST, not call count: the endpoints
differ ~44× ($0.0008 ingredient resolve vs $0.0355 recipe extract), so a pooled call
count would let a user spend the whole budget on the dearest one.
**AC 2.2** Per-feature ceilings are **RETAINED**, raised so the pool normally binds.
Defence in depth — the pool protects margin, the per-feature caps stop one runaway
retry loop draining a whole day's budget. Deleting them makes a client bug a full AI
outage.
**AC 2.3** Budget sizing rule: **`max(3.5 × typical daily cost, 33 % of net daily
revenue)`, hard-capped at 40 % of net.** The floor is in real usage, the cap is in
margin. No bespoke per-tier percentages. (Revised down from 4×/50 % on 2026-08-04:
at a 30 % Apple rate, 50 % of net was a 50 % gross margin at abuse.)

**AC 2.3a** ⚠ **The cap BINDS on Start Up Coach and the rule cannot be satisfied
there.** At £14.99 net $13.19, 40 % of net is $5.28 but 3.5 × typical is $6.41 — the
coach tier gets **2.9 × typical, not 3.5 ×**, because it carries the athlete endpoints
_plus_ Loadout _plus_ client summaries on the same price as consumer Premium. This is
a pricing signal, not a rounding error. Resolve it in Phase 1 by ONE of: price Start
Up Coach at £17.99; accept 2.9 × and record it; or land the C5 bake-off first and
re-derive typical. Do not silently ship the capped number.

**AC 2.3b** The pool is a **rolling 30-day** window, not a daily one. A daily pool
turns a legitimate Sunday batch — someone digitising ten recipe cards in a sitting —
into a fail-safe firing. The per-feature daily caps (AC 2.2) are what bound a single
day; the pool bounds the month.
**AC 2.4** Never advertised. No credit balance, no "4 of 5 used", no numbers. The one
user-visible state is the fail-safe firing, which must read as temporary and blameless
rather than as a hidden paywall.
**AC 2.5** Exhaustion returns 429 with a distinct reason (`ai_budget_exhausted`),
separable from the per-feature `ai_daily_limit` in logs and analytics.

## STORY-003 — Organisations buy seats on the web; individuals buy in-app

**AC 3.1** Tiers up to 30 clients are sold **only** by Apple IAP.
**AC 3.2** Tiers above 30 clients are sold **only** on the web (Stripe or invoice),
and are positioned as organisation products — gyms, studios, clinics, teams.
**AC 3.3** ⚠ In-app, a web tier renders **read-only**: "manage your plan on the web".
**No purchase button, no price CTA, no external link.** UK link-out is not permitted
(the CMA gave Apple Strategic Market Status; conduct requirements expected ~12 months
out. The EU has the External Purchase Link Entitlement at 17 %, or 15 % within 7 days
of a tap) — and even when it lands, this spec does not depend on it.
**AC 3.4** A user's tier resolves from exactly ONE rail, keyed on which system sold
it. RevenueCat and Stripe must never compete for the single live `user_subscriptions`
row (`user_subscriptions_active_unique`).
**AC 3.5** The coach platform and the B2B/organisation layer are ONE workstream.
Guideline 3.1.3(c) is what sets the boundary, so they share a rail by construction.

## ⚠ Open checkpoints — BLOCKING

| #   | Checkpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Blocks         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| C1  | **App Review pre-submission question** on the 3.1.3(c) split. Guideline text says _"Consumer, single-user or family sales must use in-app purchase"_; 3.1.3(f) needs a FREE app (we sell IAP) and 3.1.3(b) requires IAP parity. My reading is that Studio-and-above qualify as organisation sales — **that reading is not advice, and this product has been rejected twice (2.1 PassKit, 4.0 logo).** Get it in writing.                                                                              | Phase 3        |
| C2  | **Measure the seven estimated unit costs** from `ai_usage_log` or the AWS bill. 7 of 9 are derived, not measured, and the pooled budget is priced off them.                                                                                                                                                                                                                                                                                                                                           | Phase 1 sizing |
| C3  | Web-tier price points (Studio £179.99/75, Studio Pro £229.99/200). Desk research only — validate against real pilot conversations.                                                                                                                                                                                                                                                                                                                                                                    | Phase 3        |
| C4  | Programme-import ceiling. Needs the ROADMAP § 5.3 Phase-0 eval; estimated $0.10–0.20/import makes it the dearest endpoint in the app by 3–5×.                                                                                                                                                                                                                                                                                                                                                         | its own spec   |
| C5  | **Vision-model bake-off on `recipe_extract`.** At $0.0355/call it is 55 % of Premium's entire worst case and 44× the cheapest endpoint — one endpoint, on Opus, is the whole margin problem. If it holds quality on a cheaper vision model it drops to ~$0.007 and both the price rise and the cap-binding in AC 2.3a mostly dissolve. **Bigger lever than any pricing decision in this spec** — run it FIRST, in the same Phase 0 as C2. Same question for `nutrition_photo` (2nd dearest, $0.0155). | Phase 1 sizing |

## Non-goals

- Building AI workout generation (D7).
- Removing the Stripe rail. ⚠ `specs/stripe-rail-removal/` must NOT be executed — the
  rail is the enabler for STORY-003.
- Renaming any `tier_name` (D6).
