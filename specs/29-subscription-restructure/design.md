# 29 — Subscription restructure: Design

Requirements: `./requirements.md`. Decision record: `STATE.md` § "TIER + PRICING
RESTRUCTURE". Live cost model: `bun run scripts/ai-cost-model.ts`.

## 1. The tier catalog

⚠ Prices are PROPOSED until Brad signs off. Client counts on the coach ladder mirror
Trainerize's own 5/15/30/…/200 rungs so a coach comparing both can read them.

⚠ **VAT presentation differs by rail and is not cosmetic** (AC 2.2a). IAP rows are
**VAT-INCLUSIVE by construction** — Apple is the merchant of record, so £14.99 is the
shelf price and £12.49 is ours before commission. Web rows must be quoted **"+ VAT"**,
because there we are the merchant of record and registering later would otherwise cut
16.7 % off every existing contract silently. Any pricing page showing both ladders must
label this, or the org tiers read ~20 % cheaper than they bill.

| tier_name             | display_name       | £/mo      | £/yr       | Clients | Suite | Rail                      |
| --------------------- | ------------------ | --------- | ---------- | ------- | ----- | ------------------------- |
| `free`                | Free               | 0         | —          | —       | ✗     | —                         |
| `premium`             | Premium            | **16.99** | **139.99** | —       | ✗     | IAP                       |
| `premium_plus`        | Premium+           | 29.99     | **249.99** | —       | ✓     | IAP                       |
| `individual_trainer`  | **Start Up Coach** | **18.99** | **159.99** | 5       | ✗     | IAP                       |
| `start_up_coach_plus` | Start Up Coach +   | 34.99     | 293.99     | 5       | ✓     | IAP                       |
| `coach`               | Coach              | 59.99     | 499.99     | 15      | ✓     | IAP                       |
| `coach_pro`           | Coach Pro          | 99.99     | 839.99     | 30      | ✓     | **IAP — top in-app rung** |
| `studio`              | Studio             | 179.99    | —          | 75      | ✓     | Web                       |
| `studio_pro`          | Studio Pro         | 229.99    | —          | 200     | ✓     | Web                       |
| `enterprise`          | Enterprise         | invoiced  | —          | 200+    | ✓     | Web                       |

**Annual ~30 % off replaces the universal 10×-monthly rule** (D12). MyFitnessPal UK is
£9.99/mo but **£49.99/yr** — 58 % off — so our 16.7 % was too shallow either to compete
or to drive prepay. Web tiers are monthly or invoiced; annual there is a contract term.

✅ **RESOLVED (Brad, 2026-08-05): the 30 % annual rule is extended to the ENTIRE coach
ladder.** All four coach annuals are now 30 % off 12×-monthly: Start Up Coach £159.99,
Start Up Coach + £293.99, Coach £499.99, Coach Pro £999.99 → £839.99. This supersedes
the earlier "consumer rows only" default; Premium £139.99 and Premium+ £249.99 are
unchanged. Every IAP annual across the catalog now carries the same ~30 % discount, so
the pricing page needs no per-ladder discount caveat.

⚠ **Start Up Coach's annual moved with its monthly.** At £18.99/mo, 30 % off 12× is
£159.99 (was £189.99 on the old 10×-monthly convention before this decision).

⚠ `individual_trainer` keeps its `tier_name`. `RC_ENTITLEMENT_IDS`
(`revenuecat/entitlements.ts:16-22`) **are** the tier_names and
`user_subscriptions.tier_name` is an FK, so a rename is a DB + RevenueCat + ASC change
for zero user-visible benefit — the user only ever sees `display_name`.

## 2. The pooled AI budget

New module `microservices/core/src/application/ai/aiBudget.ts`.

- **Cost table** — lift the per-endpoint profiles from `scripts/ai-cost-model.ts` into
  a shared module both consume, so the model and the enforcement cannot drift. That
  script is the only place the costs are currently written down.
- **Spend in window** — sum weighted cost over `ai_usage_log` rows for the trailing
  **30 days** (AC 2.3b), not the local day. The table already records per-inference
  rows and is written for real inferences only (402/429 pre-checks write nothing),
  which is exactly the right denominator. ⚠ A 30-day scan per inference needs an index
  on `(user_id, created_at)` and should be cached per request — this is now a range
  scan, not a same-day count.
- **`assertAiBudget(userId, endpointKey)`** — called after the entitlement check and
  after the per-feature ceiling, before the inference. Denies when _this call's_ cost
  would exceed the remaining budget, so a cheap call still succeeds when an expensive
  one would not.
- **Budget per tier** — `max(3.5 × typical, 33 % of net)`, capped at 40 % of net
  (AC 2.3). ⚠ **Recomputed 2026-08-04 at a 30 % Apple rate** (Small Business not
  approved) and at Premium £14.99. The previous table on this line assumed 15 % and
  £12.99; every figure in it was wrong in the optimistic direction.

⚠ **Endpoint sets, because getting one wrong is what produced a wrong table here
once already.** "Suite" in § 1 means Loadout **and** Mealprint. So:

| Tier             | Snap + Recipes AI | Coach summary | Loadout | Mealprint |
| ---------------- | ----------------- | ------------- | ------- | --------- |
| Premium          | ✓                 | —             | ✗       | ✗         |
| Premium+         | ✓                 | —             | ✓       | ✓         |
| Start Up Coach   | ✓                 | ✓ (5 clients) | **✗**   | **✗**     |
| Start Up Coach + | ✓                 | ✓ (5)         | ✓       | ✓         |
| Coach            | ✓                 | ✓ (15)        | ✓       | ✓         |
| Coach Pro        | ✓                 | ✓ (30)        | ✓       | ✓         |

⚠ Start Up Coach reaches **six** endpoints, not nine. The LIVE `individual_trainer`
row has `loadout_access = true` (`scripts/ai-cost-model.ts` § TIERS) — the proposal
takes it away, which is why the model script and this table legitimately disagree until
the Phase 1 migration lands.

| Tier             | £/mo  | net $/mo | typical $/day | budget $/day | budget $/mo | × typical | % of net |
| ---------------- | ----- | -------- | ------------- | ------------ | ----------- | --------- | -------- |
| Premium          | 16.99 | 12.46    | 0.047         | 0.163        | 4.89        | 3.50×     | 39 %     |
| Premium+         | 29.99 | 22.00    | 0.066         | 0.242        | 7.26        | 3.64×     | 33 %     |
| Start Up Coach   | 18.99 | 13.93    | 0.053         | 0.184        | 5.52        | 3.50×     | 40 %     |
| Start Up Coach + | 34.99 | 25.66    | 0.072         | 0.282        | 8.47        | 3.90×     | 33 %     |
| Coach            | 59.99 | 44.00    | 0.078         | 0.484        | 14.52       | 6.17×     | 33 %     |
| Coach Pro        | 99.99 | 73.34    | 0.084         | 0.807        | 24.20       | 9.56×     | 33 %     |

✅ **Every tier now clears the 3.5× floor and nothing is capped** — the two-sided rule is
satisfied everywhere for the first time. That is the whole reason Premium moved to
£16.99 and Start Up Coach to £18.99 (Brad, 2026-08-04); see AC 2.3a.

⚠ Includes VAT (`IAP_VAT_RATE`, AC 2.2a) — Apple is the merchant of record and takes its
commission on the VAT-EXCLUSIVE price. Regenerate with
`bun run scripts/ai-cost-model.ts`. ⚠ That script's `TIERS` still holds the LIVE
catalogue prices (£12.99 / £14.99), not these — deliberately, until the Phase 1
migration lands.

### 2.1 What the budget means in queries — the answer to "will a normal user hit it?"

**No, not at any plausible call count** — still true after VAT, with less margin.

| Tier     | typical calls/day | budget allows/day | headroom |
| -------- | ----------------- | ----------------- | -------- |
| Premium  | ~8                | ~27               | 3.50×    |
| Premium+ | ~11               | ~39               | 3.64×    |

⚠ **But call count is the wrong unit, and that is the whole risk.** The pool is spent
in money and the endpoints differ 44×, so headroom depends entirely on _which_ calls.
Premium's $0.163/day, spent on one endpoint only:

| Endpoint             | $/call | calls/day before the pool empties |
| -------------------- | ------ | --------------------------------- |
| Recipe photo extract | 0.0355 | **4.6** ⚠                         |
| Snap photo estimate  | 0.0155 | 10.5                              |
| Snap free-text       | 0.0020 | 82                                |
| Ingredient resolve   | 0.0008 | 204                               |

The only row remotely reachable by an honest user is the first, and it is reachable —
someone digitising a recipe folder on a Sunday does ten in a sitting. Two things keep
that from firing the fail-safe:

1. **AC 2.3b — the pool is rolling 30-day, not daily.** Premium's real allowance is
   $4.89/month = **138 recipe extracts**, and the Sunday burst is absorbed.
2. **C5 — the bake-off.** Move `recipe_extract` off Opus and it goes $0.0355 → ~$0.007,
   the worst row becomes ~23/day, and this table stops having a weak entry at all.

⇒ The pooled budget clears AC 2.3's "beats typical usage with headroom" condition (D9)
**on call count comfortably, and on mix only because of the rolling window.** If the
window ships as daily, D9's condition is NOT met for recipe extraction.

⚠ **Store the budget in the catalog** (`subscription_tiers.ai_monthly_budget_usd`), not
in env — it varies per tier and belongs beside the price it is derived from.

## 3. Ceiling reshape: daily → monthly for bursty endpoints

`AI_RECIPE_DAILY_LIMIT` (12/day) and programme import are **bursty-then-dormant**:
digitise ten recipes one evening, none for a month. A daily cap either throttles the
legitimate burst or permits the abuse.

⇒ **Recipe extract: 60/month.** Allows the burst, kills the 360/month abuse, and takes
the worst case $12.78 → $2.13. Same shape for programme import when it lands.

⚠ Note which of the two limits binds: 60/month × $0.0355 = $2.13, against Premium's
$4.90/month pool. **The per-feature cap binds first, and that is the intended order** —
the pool is the margin backstop, the feature cap is the runaway-retry backstop. If C5
lands and the unit cost drops, the feature cap keeps doing its job unchanged.
This supersedes STATE.md action 3 ("12 → ~4"), which would have cost a real
onboarding user real annoyance to defend against an abuser paying £12.99 to lose us $10.

Also register `AI_RECIPE_ESTIMATE_DAILY_LIMIT` in `infra/api.ts` — it is unset and
silently uses its code default of 30, invisible to a cost audit of the env block.

## 4. The organisation rail

**One rail for coach-above-30 and B2B, because 3.1.3(c) draws the same line for both.**

- `organizations` + `organization_seats` + `seat_tier` (FK to `subscription_tiers`).
  A seat grants a REAL catalog tier, so seat value is a contract lever with no code
  change — pricing lives in the invoice, capability in the tier.
- Stripe Checkout on the marketing site; the existing `/stripe/webhook`
  (`api.ts:270`, plus `reconcile`/`stripeIdempotency`/`subscriptionState`/`alerts`) is
  intact and becomes load-bearing again.
- **Entitlement source of truth** (AC 3.4): add `user_subscriptions.source`
  (`'revenuecat' | 'stripe' | 'grant'`). A rail may only write a row it owns. Prevents
  the two webhooks fighting over the single live row — and note the RC side has already
  produced one ingestion bug (PR #298, reconcile reading the wrong endpoint).
- **In-app**: web tiers render read-only. `holdsUnlistedPaidTier`
  (`IOSPurchaseFlowPresenter.tsx:130-132`) already exists for exactly this shape.

## 5. Every place a tier change lands

1. `subscription_tiers` migration (+ `ai_daily_budget_usd`).
2. App Store Connect — product per IAP tier per cycle.
3. RevenueCat — entitlement id + offering/package.
4. `revenuecat/entitlements.ts` — `RC_ENTITLEMENT_IDS` **and** `TIER_RANK` (rank
   decides which entitlement wins when RC reports several).
5. `purchaseOfferings.ts` — `tierFromProductId` substring ladder (⚠ order-sensitive:
   longer names first, as `premium_plus` must precede `premium`; `coach_pro` must
   precede `coach`) + `MONTHLY_ONLY_TIERS`.
6. `IOSPurchaseFlowPresenter.tsx:200-249` — the trainer rail is a **hardcoded
   allow-list**. New coach tiers are invisible until edited.
7. `assertEntitlement.ts` — `nextTrainerTierUp` ladder, `PREMIUM_PLUS_FEATURES`.
8. `useLoadoutGate.ts` / `useMealprintGate.ts` — hardcoded tier→boolean Records.
9. Seed-guard tests: `subscriptionTierSeed.test.ts`, `premiumPlusTierMigration.test.ts`.
