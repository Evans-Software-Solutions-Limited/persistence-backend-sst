# 29 — Subscription restructure: Tasks

> Execution reservoir. Every item traces to `requirements.md` ACs and `design.md`
> sections. Gates on every PR: prettier · typecheck · lint · build · test:unit
> (≥90 % on changed files) + Inspector-Brad-local.
>
> **Runs ALONGSIDE spec-26 Mealprint and spec-21 Loadout, not after them.** Phases 0
> and 1 have no dependency on either and unblock the launch maths. Phase 2 must land
> before `premium_plus.is_active` flips, which is the same gate Mealprint's mobile
> half and Loadout Phase 4 already sit behind.
>
> ⚠ **C1 (App Review) blocks Phase 3 only.** Do not let it hold Phases 0–2.

## Phase 0 — Unblock (no code, parallel, do first)

- [ ] **0.1 App Review pre-submission question (C1)** — may an organisation/studio
      subscription be sold off-app while consumer and solo-coach tiers use IAP? Cite
      3.1.3(c). Get it **in writing**. ⚠ Blocks Phase 3; two prior rejections make this
      non-optional.
- [ ] **0.2 Measure the six estimated AI unit costs (C2)** — from `ai_usage_log`
      (byte sizes + duration already recorded; token counts need adding) or the AWS
      bill. 7 of 9 costs are derived. **The pooled budget is priced off these.**
- [ ] **0.3 Check Bedrock's real prices** against the Anthropic list prices the model
      assumes (`scripts/ai-cost-model.ts` `PRICE_PER_MTOK`).
- [ ] **0.4 Confirm price points** — annual ~30 %; web tiers (C3); Start Up Coach's
      46 % budget.
- [x] **0.5 Zero-grandfathering assumption — AUTHORISED, not verified.** Brad
      confirmed 2026-08-04 that prod and staging hold only test accounts and his own,
      and that data can be reset. So repricing is free. ⚠ No agent has touched
      prod/staging data; any reset is Brad's to run. If the app ever ships before the
      reprice lands, this reverts to a blocking check — an Apple price increase on an
      existing subscription needs the consent flow.

## Phase 1 — Pooled AI budget (backend only, ships independently)

- [ ] **1.1 Extract the cost table to a shared module** consumed by BOTH
      `scripts/ai-cost-model.ts` and the new enforcement, so they cannot drift —
      design § 2.
- [ ] **1.2 Migration + schema.ts: `subscription_tiers.ai_daily_budget_usd`** —
      per-tier, beside the price it derives from. Idempotent; prod apply MANUAL.
- [ ] **1.3 `aiBudget.ts`: `spentTodayUsd(userId)` + `assertAiBudget(userId, key)`** —
      denies when THIS call's cost would exceed the remainder, so a cheap call still
      succeeds where an expensive one would not — AC 2.1, 2.3.
- [ ] **1.4 Wire into all 9 endpoints** after the entitlement check and after the
      per-feature ceiling. ⚠ **Keep every per-feature ceiling** — AC 2.2.
- [ ] **1.5 429 `ai_budget_exhausted`**, distinct from `ai_daily_limit` in logs and
      analytics — AC 2.5.
- [ ] **1.6 Reshape bursty ceilings to MONTHLY** — recipe extract 12/day → 60/month;
      register `AI_RECIPE_ESTIMATE_DAILY_LIMIT` — design § 3.
- [ ] **1.7 Mobile: the fail-safe state** — temporary and blameless, no numbers, no
      credit balance, never reads as a hidden paywall — AC 2.4.
- [ ] **1.8 Tests**: budget arithmetic, the cheap-call-still-passes boundary, tier
      lookup, missing-budget fail-safe (never fail OPEN), and a guard that the shared
      cost table covers every registered endpoint.

## Phase 2 — Catalog + IAP tiers (before the `is_active` flip)

- [ ] **2.1 Migration: `display_name` → "Start Up Coach"** on `individual_trainer`.
      ⚠ `tier_name` UNCHANGED — it is a RevenueCat entitlement id — D6, design § 1.
- [ ] **2.2 Migration: insert `start_up_coach_plus`, `coach`, `coach_pro`** with
      client caps 5 / 15 / 30, suite flags on, `is_active = false` until 2.9.
- [ ] **2.3 Reprice** — Premium annual **£139.99**, Premium+ annual £249.99 — D12.
      ⚠ **This line said £109.99 until 2026-08-04 and that was STALE.** `design.md`
      § 1, `design.md` line 35 ("Premium £139.99, 31 % off £203.88") and D12 in
      `requirements.md` — which is marked **FINAL 2026-08-04** — all say £139.99.
      D12 was revised twice (£12.99 → £14.99 → £16.99 monthly) and this line was
      not carried along. **The decision record wins over this file.**
- [ ] **2.4 Grant `mealprint_access`** to every suite-bearing coach tier — D1.
      ⚠ Do NOT grant it to `individual_trainer` (the no-suite entry rung).
- [ ] **2.5 `revenuecat/entitlements.ts`** — extend `RC_ENTITLEMENT_IDS` and insert
      `TIER_RANK` correctly (rank decides which entitlement wins) — design § 5.4.
- [ ] **2.6 `purchaseOfferings.ts`** — product ids + `tierFromProductId` ladder.
      ⚠ Order-sensitive: `coach_pro` MUST precede `coach`, as `premium_plus` precedes
      `premium` — design § 5.5.
- [ ] **2.7 Paywall rails** — replace the hardcoded trainer allow-list with the new
      ladder; the athlete rail is already catalog-driven — design § 5.6.
- [ ] **2.8 `nextTrainerTierUp` + the two mobile gate Records** — design § 5.7-5.8.
- [ ] **2.9 ASC + RevenueCat products** — create, leave UNSUBMITTED until the launch
      build (mirrors spec-21 T-P0.10).
- [ ] **2.10 Update the seed-guard tests** — design § 5.9.

## Phase 3 — Organisation rail (coach ⊕ B2B, ONE workstream) — gated on 0.1

- [ ] **3.1 Migration: `organizations`, `organization_seats`, `seat_tier`** — a seat
      grants a real catalog tier — design § 4.
- [ ] **3.2 Migration: `user_subscriptions.source`** (`revenuecat|stripe|grant`); a
      rail may only write rows it owns — AC 3.4.
- [ ] **3.3 Insert `studio`, `studio_pro`, `enterprise`** — web-only, excluded from
      `listActive`'s IAP projection.
- [ ] **3.4 Stripe Checkout on the marketing site** + reactivate the dormant rail.
      ⚠ **Do NOT execute `specs/stripe-rail-removal/`.**
- [ ] **3.5 Seat grant/revoke + invite flow**, reusing `trainerSeats.ts` enforcement.
- [ ] **3.6 Org admin (web)** — aggregate, anonymised metrics ONLY, suppressed below a
      minimum cohort size. Never individual member health data.
- [ ] **3.7 In-app read-only state for web tiers** — "manage on the web". ⚠ **No
      purchase button, no price CTA, no external link** — AC 3.3.
- [ ] **3.8 Tests**: rail isolation (RC cannot overwrite a Stripe row and vice versa),
      seat-limit enforcement, cohort suppression.

## Phase 4 — Flip

- [ ] **4.1 `is_active = true`** on `premium_plus` + the new coach tiers.
- [ ] **4.2 Submit the ASC products** attached to the launch build.
- [ ] **4.3 Site copy live** — realigned `marketing/WEBSITE_PRICING_SPEC.md`, the dead
      taster copy gone, "AI Workout Suggestions" removed until it exists.
- [ ] **4.4 Re-examine whether M21 still gates the launch** — Phase 3 IS the org
      layer, which was M21's stated reason for gating `premium_plus`.
