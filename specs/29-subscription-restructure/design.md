# 29 — Subscription restructure: Design

Requirements: `./requirements.md`. Decision record: `STATE.md` § "TIER + PRICING
RESTRUCTURE". Live cost model: `bun run scripts/ai-cost-model.ts`.

## 1. The tier catalog

⚠ Prices are PROPOSED until Brad signs off. Client counts on the coach ladder mirror
Trainerize's own 5/15/30/…/200 rungs so a coach comparing both can read them.

| tier_name             | display_name       | £/mo     | £/yr       | Clients | Suite | Rail                      |
| --------------------- | ------------------ | -------- | ---------- | ------- | ----- | ------------------------- |
| `free`                | Free               | 0        | —          | —       | ✗     | —                         |
| `premium`             | Premium            | 12.99    | **109.99** | —       | ✗     | IAP                       |
| `premium_plus`        | Premium+           | 29.99    | **249.99** | —       | ✓     | IAP                       |
| `individual_trainer`  | **Start Up Coach** | 14.99    | 149.99     | 5       | ✗     | IAP                       |
| `start_up_coach_plus` | Start Up Coach +   | 34.99    | 349.99     | 5       | ✓     | IAP                       |
| `coach`               | Coach              | 59.99    | 599.99     | 15      | ✓     | IAP                       |
| `coach_pro`           | Coach Pro          | 99.99    | 999.99     | 30      | ✓     | **IAP — top in-app rung** |
| `studio`              | Studio             | 179.99   | —          | 75      | ✓     | Web                       |
| `studio_pro`          | Studio Pro         | 229.99   | —          | 200     | ✓     | Web                       |
| `enterprise`          | Enterprise         | invoiced | —          | 200+    | ✓     | Web                       |

**Annual ~30 % off replaces the universal 10×-monthly rule** (D12). MyFitnessPal UK is
£9.99/mo but **£49.99/yr** — 58 % off — so our 16.7 % was too shallow either to compete
or to drive prepay. Web tiers are monthly or invoiced; annual there is a contract term.

⚠ `individual_trainer` keeps its `tier_name`. `RC_ENTITLEMENT_IDS`
(`revenuecat/entitlements.ts:16-22`) **are** the tier_names and
`user_subscriptions.tier_name` is an FK, so a rename is a DB + RevenueCat + ASC change
for zero user-visible benefit — the user only ever sees `display_name`.

## 2. The pooled AI budget

New module `microservices/core/src/application/ai/aiBudget.ts`.

- **Cost table** — lift the per-endpoint profiles from `scripts/ai-cost-model.ts` into
  a shared module both consume, so the model and the enforcement cannot drift. That
  script is the only place the costs are currently written down.
- **Spend today** — sum weighted cost over `ai_usage_log` rows for the user's local
  day. The table already records per-inference rows and is written for real
  inferences only (402/429 pre-checks write nothing), which is exactly the right
  denominator.
- **`assertAiBudget(userId, endpointKey)`** — called after the entitlement check and
  after the per-feature ceiling, before the inference. Denies when _this call's_ cost
  would exceed the remaining budget, so a cheap call still succeeds when an expensive
  one would not.
- **Budget per tier** — `max(4 × typical, 33 % of net)`, capped at 50 % of net (AC 2.3):

| Tier             | net $/mo | budget $/day | × typical | % of net |
| ---------------- | -------- | ------------ | --------- | -------- |
| Premium          | 13.88    | 0.188        | 4.0×      | 41 %     |
| Premium+         | 32.05    | 0.353        | 6.4×      | 33 %     |
| Start Up Coach   | 16.02    | 0.244        | 4.0×      | **46 %** |
| Start Up Coach + | 37.39    | 0.411        | 6.7×      | 33 %     |
| Coach            | 64.08    | 0.705        | 11×       | 33 %     |
| Coach Pro        | 106.79   | 1.175        | 19×       | 33 %     |

Start Up Coach lands highest as a % because it is the cheapest tier that also reaches
the coach-summary endpoint — the rule handles it without a bespoke exception, which is
the point of having a usage floor rather than only a margin ceiling.

⚠ **Store the budget in the catalog** (`subscription_tiers.ai_daily_budget_usd`), not
in env — it varies per tier and belongs beside the price it is derived from.

## 3. Ceiling reshape: daily → monthly for bursty endpoints

`AI_RECIPE_DAILY_LIMIT` (12/day) and programme import are **bursty-then-dormant**:
digitise ten recipes one evening, none for a month. A daily cap either throttles the
legitimate burst or permits the abuse.

⇒ **Recipe extract: 60/month.** Allows the burst, kills the 360/month abuse, and takes
the worst case $12.78 → $2.13. Same shape for programme import when it lands.
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
