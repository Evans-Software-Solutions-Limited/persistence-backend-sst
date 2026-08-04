# 29 — Subscription restructure: Design

Requirements: `./requirements.md`. Decision record: `STATE.md` § "TIER + PRICING
RESTRUCTURE". Live cost model: `bun run scripts/ai-cost-model.ts`.

## 1. The tier catalog

⚠ Prices are PROPOSED until Brad signs off. Client counts on the coach ladder mirror
Trainerize's own 5/15/30/…/200 rungs so a coach comparing both can read them.

| tier_name             | display_name       | £/mo      | £/yr       | Clients | Suite | Rail                      |
| --------------------- | ------------------ | --------- | ---------- | ------- | ----- | ------------------------- |
| `free`                | Free               | 0         | —          | —       | ✗     | —                         |
| `premium`             | Premium            | **14.99** | **124.99** | —       | ✗     | IAP                       |
| `premium_plus`        | Premium+           | 29.99     | **249.99** | —       | ✓     | IAP                       |
| `individual_trainer`  | **Start Up Coach** | 14.99     | 149.99     | 5       | ✗     | IAP                       |
| `start_up_coach_plus` | Start Up Coach +   | 34.99     | 349.99     | 5       | ✓     | IAP                       |
| `coach`               | Coach              | 59.99     | 599.99     | 15      | ✓     | IAP                       |
| `coach_pro`           | Coach Pro          | 99.99     | 999.99     | 30      | ✓     | **IAP — top in-app rung** |
| `studio`              | Studio             | 179.99    | —          | 75      | ✓     | Web                       |
| `studio_pro`          | Studio Pro         | 229.99    | —          | 200     | ✓     | Web                       |
| `enterprise`          | Enterprise         | invoiced  | —          | 200+    | ✓     | Web                       |

**Annual ~30 % off replaces the universal 10×-monthly rule** (D12). MyFitnessPal UK is
£9.99/mo but **£49.99/yr** — 58 % off — so our 16.7 % was too shallow either to compete
or to drive prepay. Web tiers are monthly or invoiced; annual there is a contract term.

⚠ **Only the two consumer rows actually apply the 30 % rule.** Premium £124.99 (30 %
off £179.88) and Premium+ £249.99 (31 % off £359.88) are correct; every COACH annual in
the table above is still the old 10×-monthly (16.7 %) — Start Up Coach £149.99 should
be ~£124.99, Coach £599.99 ~£499.99, Coach Pro £999.99 ~£839.99. Left unchanged
deliberately: a 30 % discount on the coach ladder is a bigger revenue decision than the
consumer one (coaches churn less, so the prepay incentive buys less) and it is Brad's
call, not a consistency fix. **Resolve before creating ASC products** — annual price
points are painful to change once purchasable.

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

| Tier             | net $/mo | typical $/day | budget $/day | budget $/mo | × typical | % of net |
| ---------------- | -------- | ------------- | ------------ | ----------- | --------- | -------- |
| Premium          | 13.19    | 0.047         | 0.163        | 4.90        | 3.5×      | 37 %     |
| Premium+         | 26.39    | 0.066         | 0.290        | 8.71        | 4.4×      | 33 %     |
| Start Up Coach   | 13.19    | 0.061         | **0.176**    | 5.28        | **2.9×**  | **40 %** |
| Start Up Coach + | 30.80    | 0.073         | 0.339        | 10.17       | 4.7×      | 33 %     |
| Coach            | 52.80    | 0.079         | 0.581        | 17.42       | 7.4×      | 33 %     |
| Coach Pro        | 88.00    | 0.085         | 0.968        | 29.05       | 11.5×     | 33 %     |

⚠ **Start Up Coach is the one row where the 40 % cap binds and the 3.5× floor loses**
— see AC 2.3a. It is the cheapest tier that reaches the coach-summary endpoint _and_ it
sits on the same £14.99 as consumer Premium while carrying more endpoints. The rule
does not "handle it without an exception"; it silently gives that tier less headroom
than every other. Decide it in Phase 1, don't inherit it.

### 2.1 What the budget means in queries — the answer to "will a normal user hit it?"

**No, not at any plausible call count.** At each tier's own typical mix:

| Tier     | typical calls/day | budget allows/day | headroom |
| -------- | ----------------- | ----------------- | -------- |
| Premium  | ~8                | ~27               | 3.5×     |
| Premium+ | ~11               | ~47               | 4.4×     |

⚠ **But call count is the wrong unit, and that is the whole risk.** The pool is spent
in money and the endpoints differ 44×, so headroom depends entirely on _which_ calls.
Premium's $0.163/day, spent on one endpoint only:

| Endpoint             | $/call | calls/day before the pool empties |
| -------------------- | ------ | --------------------------------- |
| Recipe photo extract | 0.0355 | **4.6** ⚠                         |
| Snap photo estimate  | 0.0155 | 10.5                              |
| Snap free-text       | 0.0020 | 82                                |
| Ingredient resolve   | 0.0008 | 204                               |

The only row that is remotely reachable by an honest user is the first, and it is
reachable — someone digitising a recipe folder on a Sunday does ten in a sitting. Two
things keep that from firing the fail-safe:

1. **AC 2.3b — the pool is rolling 30-day, not daily.** Premium's real allowance is
   $4.90/month = 138 recipe extracts, and the Sunday burst is absorbed.
2. **C5 — the bake-off.** Move `recipe_extract` off Opus and it goes $0.0355 → ~$0.007,
   the worst row becomes 23/day, and this table stops having a weak entry at all.

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
