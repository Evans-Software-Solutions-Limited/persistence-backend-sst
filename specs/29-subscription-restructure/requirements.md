# 29 — Subscription restructure (tiers, pooled AI budget, organisation rail): Requirements

**Opened 2026-08-04 by Brad.** Canonical decision record is `STATE.md`
§ "TIER + PRICING RESTRUCTURE". This spec is the executable form of it.

**Why now:** nothing is purchasable yet — **no ASC products are live** — so every
price and tier name here can change with zero grandfathering. That window closes at
launch, and it is the only reason this is cheap to do.

## Locked decisions (Brad)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Coaches get Mealprint. Coach tiers move on BOTH client count and features.                                                                                                                                                                                                                                                                                                                                                    |
| D2  | Loadout + Mealprint stay Premium+-only on the CONSUMER track.                                                                                                                                                                                                                                                                                                                                                                 |
| D3  | ⚠ No small daily allowance as an upgrade lever. Metering only converts if the median user hits the cap; at ~2/day typical a 3/day allowance converts nobody and spends the exclusivity.                                                                                                                                                                                                                                       |
| D4  | AI ceilings are a **backend fail-safe, never an advertised quota**, and become a TOTAL per-user cost budget.                                                                                                                                                                                                                                                                                                                  |
| D5  | Programme import lands on athlete Premium+ **and** the coach tiers — an imported programme is just a collection of workouts.                                                                                                                                                                                                                                                                                                  |
| D6  | `individual_trainer` displays as "Start Up Coach". ⚠ `display_name` only.                                                                                                                                                                                                                                                                                                                                                     |
| D7  | AI workout generation is a FUTURE Premium+ addition, built on Loadout + Mealprint. Justifies a later price rise, not a current one.                                                                                                                                                                                                                                                                                           |
| D8  | Coach entry £14.99.                                                                                                                                                                                                                                                                                                                                                                                                           |
| D9  | Pooled AI budget adopted, conditional on beating typical usage with headroom.                                                                                                                                                                                                                                                                                                                                                 |
| D10 | Split rail adopted: single-user tiers via IAP, organisation tiers via web.                                                                                                                                                                                                                                                                                                                                                    |
| D11 | **The top IN-APP coach tier is 30 clients** — the realistic ceiling for one PT.                                                                                                                                                                                                                                                                                                                                               |
| D12 | ~~Premium HOLDS at £12.99/mo.~~ ~~REVISED: → £14.99.~~ **FINAL 2026-08-04: Premium → £16.99/mo** (annual £139.99, 31 % off). Two revisions, two causes: the 15 % Apple Small Business rate is NOT approved (so model at 30 %), and VAT is deducted before commission on IAP whether or not we are registered (AC 2.2a). £16.99 is the price at which Premium clears the 3.5× usage floor without the 40 % margin cap binding. |
| D13 | **Start Up Coach → £18.99/mo** (annual £189.99), up from £14.99. Same reason as D12: it is the price that clears the 3.5× floor. Brad accepted both on the basis that MyFitnessPal Premium offers no AI barcode/photo logging at all, so the £9.99 comparison is not like-for-like.                                                                                                                                           |

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
**AC 2.2a** ⚠ **VAT is deducted on the IAP rail whether or not we are VAT
registered, and it is NOT deferrable.** Added 2026-08-04 after Brad asked whether
prices should be adjusted now to absorb VAT later. They should — but the reasoning is
the reverse of the question.

Apple is the **merchant of record** in the UK and EU. It collects VAT from the customer
and remits it, and developer proceeds are commission applied to the **VAT-exclusive**
price. £14.99 is £12.49 ex-VAT; 70 % of that is £8.74, not 70 % of £14.99. Being under
the £90k threshold does not help: the VAT liability on that consumer sale is Apple's,
so there is nothing to defer and nothing to reclaim.

⇒ **Every net figure in this spec before 2026-08-04 was ~17 % too high**, because
`scripts/ai-cost-model.ts` had no VAT term at all. It now does (`IAP_VAT_RATE`), with a
test pinning it. Corrected nets at the FINAL prices: Premium £16.99 → **$12.46/mo**; Start Up Coach
£18.99 → **$13.93**; Premium+ £29.99 → **$22.00** (was $26.39 before VAT).

⚠ **The WEB rail is the one place VAT genuinely is deferrable** — we are the merchant
of record, and below the threshold no VAT is charged. **Therefore quote Studio /
Studio Pro / Enterprise as "+ VAT" from day one.** Registering later then changes
nothing about our net; quoting VAT-inclusive now turns registration into a silent
16.7 % revenue cut on every existing contract. B2B buyers expect ex-VAT and reclaim it
anyway, so the label is free. **This is the price adjustment to make now.**

⚠ Verify against a real App Store Connect proceeds report once any transaction exists.
The mechanism above is Apple's documented behaviour, not a measurement.

**AC 2.3** Budget sizing rule: **`max(3.5 × typical daily cost, 33 % of net daily
revenue)`, hard-capped at 40 % of net.** The floor is in real usage, the cap is in
margin. No bespoke per-tier percentages. (Revised down from 4×/50 % on 2026-08-04:
at a 30 % Apple rate, 50 % of net was a 50 % gross margin at abuse.)

**AC 2.3a** ✅ **RESOLVED 2026-08-04 by repricing — every tier now clears the 3.5×
floor with nothing capped.** Premium → £16.99 (D12), Start Up Coach → £18.99 (D13).
Range across the ladder is 3.50× to 9.56×; see design § 2.

Brad's reasoning for accepting the rise rather than the shortfall: **MyFitnessPal
Premium does not offer AI barcode/photo logging at all**, so the £9.99 anchor I had been
treating as a ceiling is not a like-for-like comparison. Our Premium sells an AI
capability their Premium does not have.

⚠ **Record of how this AC moved, because it was wrong twice and the pattern matters
more than the current number:**

| Revision                    | Start Up Coach | What was wrong                                                        |
| --------------------------- | -------------- | --------------------------------------------------------------------- |
| First draft                 | 2.9×           | Priced the LIVE `individual_trainer` endpoint set (which has Loadout) |
| After Brad's suite question | 3.3×           | Right endpoints, but the model had no VAT term                        |
| After the VAT fix           | 2.79×          | Correct — and Premium was also capped, at 3.15×                       |
| **After repricing**         | **3.50×**      | Resolved                                                              |

⚠ **C5 could have solved this without a price rise, and did not get the chance.** Off
Opus, `recipe_extract` drops Premium's typical to $0.041/day, which clears 3.5× at
£14.65. The rise was taken on the evidence available; if C5 lands later it becomes
margin rather than a repricing. **Do not read D12/D13 as evidence C5 is unnecessary.**

⚠ **The no-suite decision still REMOVES Loadout from `individual_trainer`**, which holds
it today. Free — nothing is purchasable — but it is a takeaway, and
`TIER_GRANTS_LOADOUT` in `useLoadoutGate` grants all three trainer tiers, so the client
mirror must move with the catalogue or the gate will disagree with the server. Phase 1
task, not a side effect.

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

| #   | Checkpoint                                                                                                                                                                                                                                                                                                                                                                                                               | Blocks         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- |
| C1  | **App Review pre-submission question** on the 3.1.3(c) split. Guideline text says _"Consumer, single-user or family sales must use in-app purchase"_; 3.1.3(f) needs a FREE app (we sell IAP) and 3.1.3(b) requires IAP parity. My reading is that Studio-and-above qualify as organisation sales — **that reading is not advice, and this product has been rejected twice (2.1 PassKit, 4.0 logo).** Get it in writing. | Phase 3        |
| C2  | **Measure the seven estimated unit costs** from `ai_usage_log` or the AWS bill. 7 of 9 are derived, not measured, and the pooled budget is priced off them.                                                                                                                                                                                                                                                              | Phase 1 sizing |
| C3  | Web-tier price points (Studio £179.99/75, Studio Pro £229.99/200). Desk research only — validate against real pilot conversations.                                                                                                                                                                                                                                                                                       | Phase 3        |
| C4  | Programme-import ceiling. Needs the ROADMAP § 5.3 Phase-0 eval; estimated $0.10–0.20/import makes it the dearest endpoint in the app by 3–5×.                                                                                                                                                                                                                                                                            | its own spec   |
| C5  | **Vision-model bake-off on `recipe_extract`.** See § "C5 in detail" below — it is the largest single cost lever in the app, the swap is one env var, and the nearest existing measurement argues AGAINST the obvious choice.                                                                                                                                                                                             | Phase 1 sizing |

## C5 in detail — can `recipe_extract` run on a cheaper model?

**Mechanically: yes, it is a one-line change.** The model is already env-driven per
endpoint — `AI_RECIPE_MODEL_ID` in `infra/api.ts:157`, defaulting to
`eu.anthropic.claude-opus-4-6-v1` in
`microservices/core/src/application/nutrition/services/recipeExtraction.ts:27`. The
Bedrock IAM grant is wildcarded (`foundation-model/anthropic.*` +
`inference-profile/eu.anthropic.*`), so **no IAM change is needed** for any Anthropic
model. No code, no deploy shape change.

**Commercially it is the biggest lever in the app.** 85 % of the call's cost is OUTPUT
tokens (1,200 out × $25/Mtok = $0.030 of the $0.0355), because it returns a whole
ingredient list plus method — the largest output of any endpoint.

| Option           | in/out $/Mtok | $/call     | vs Opus 4.6      |
| ---------------- | ------------- | ---------- | ---------------- |
| Opus 4.6 (today) | 5 / 25        | 0.0355     | —                |
| Haiku 4.5        | 1 / 5         | **0.0071** | **5.0×** cheaper |
| Sonnet-class     | 3 / 15 ⚠      | ~0.0213    | 1.7× cheaper     |

⚠ Sonnet-class pricing is a **list-price assumption and is not in the cost model** —
the model only carries `haiku` and `opus` tiers, and its own header warns these are
Anthropic list prices, not Bedrock's partner prices. Treat the middle row as
indicative only.

### ⚠ The evidence in this repo argues against Haiku, and it is real evidence

**Do not assume the cheap swap works.** The spec-21 Phase E1 eval measured exactly
this substitution on the app's other vision endpoint (equipment scan) and Haiku 4.5
**failed it** (`infra/api.ts` § `AI_EQUIPMENT_SCAN_MODEL_ID`):

- recall **0.759** vs Opus 4.6's **0.966** (0.500 vs 1.000 on the one real phone photo)
- **2 hallucinated ids** to Opus's 0
- missed `Squat Rack` in **3 of 7** photos

That comment records the finding as having proved the intuition _backwards_. So the
honest prior is: Haiku 4.5 is materially weaker on this product's vision inputs.

**Why it is still worth running:** the two tasks are not the same shape. Equipment scan
is open-set object detection across a cluttered scene; recipe extraction is closer to
OCR plus structuring of text that is already legible in the image. Haiku is much more
often adequate at the second than the first. That is a hypothesis, not a result — which
is the entire reason this is a checkpoint and not a decision.

### How to run it

Reuse the harness that produced the E1 numbers: `scratchpad/loadout-phase-e/` (real
Bedrock calls, `src/armB.ts`, results committed as JSON). Needs AWS credentials for the
Bedrock role, so it is Brad-gated, not agent-runnable.

Fixtures must include the hard cases, or the eval will pass and production will not:
handwritten cards, a photographed cookbook page with two recipes on it, a phone
screenshot of a blog recipe, non-English units, and a photo at an angle. Score
ingredient recall, quantity/unit accuracy, and step fidelity separately — a model can
hold ingredients and mangle the method, and only one of those affects macros.

### ⚠ Two hazards before shipping any swap

1. **Check the model id is GRANTED in production.** `eu.anthropic.claude-opus-5` is
   ungranted in prod, and assuming otherwise caused a **30-day silent production
   outage** (STATE.md 2026-07-26). The wildcard IAM policy does not imply Bedrock model
   access has been enabled on the account.
2. **`nutrition_photo` is the same question and the 2nd dearest endpoint** ($0.0155,
   also Opus 4.6 via `AI_PHOTO_MODEL_ID`) — but it is a genuinely harder visual task
   (estimating portions), so E1's result transfers to it more directly. Evaluate it
   separately and expect a worse answer.

### The other lever, which carries no quality risk to macros

Output tokens are 85 % of the cost, and `steps` is the bulk of the output
(`RECIPE_MAX_TOKENS = 2500`). Capping or omitting step extraction cuts the call cost on
the CURRENT model, with no effect on the ingredient/macro path at all. It is a product
decision (the recipe detail screen shows the method), not a model decision — but it is
worth pricing next to the swap, because it is the one option whose downside is known.

## Non-goals

- Building AI workout generation (D7).
- Removing the Stripe rail. ⚠ `specs/stripe-rail-removal/` must NOT be executed — the
  rail is the enabler for STORY-003.
- Renaming any `tier_name` (D6).
