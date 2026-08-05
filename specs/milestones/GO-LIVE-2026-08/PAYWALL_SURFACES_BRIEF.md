# PAYWALL SURFACES BRIEF — spec-29 Phase 2, the catalog + IAP tiers

**Written 2026-08-04.** A self-contained, **parallelisable** slice: it can run alongside
Mealprint Phase 2/3 (`claude/mealprint-phase2-backend`) because the two touch disjoint
files. Executes `specs/29-subscription-restructure/tasks.md` **Phase 2 (2.1–2.10)**.

⚠ **Read `STATE.md` § "▶ START HERE" and § "⚠⚠ REVISED PLAN OF RECORD — M21 IS DESCOPED"
first.** Several facts below only make sense against that revision.

---

## Why this is its own brief

The paywall must be correct **before** a new build goes to App Review, and it is the one
place three workstreams collide:

1. spec-29 Phase 2 rewrites the tier catalog and every surface that reads it.
2. Brad's incoming **Claude Design subscription-layout revamp** re-lays out the same
   screens.
3. The App Store resubmission needs the IAP products submitted **with** the build
   (`RESUBMISSION_BRIEF.md`).

🔴 **Sequence 1 and 2 deliberately.** Task 2.7 rewrites the trainer rail inside
`IOSPurchaseFlowPresenter.tsx:200-249` — the exact component the revamp re-lays out.
Landing them independently means one clobbers the other. **Agree an order with Brad before
starting 2.7**; 2.1–2.6 and 2.9–2.10 are safe to do regardless.

---

## Ground truth — the prices are SETTLED (Brad, 2026-08-04)

Source of record is `specs/29-subscription-restructure/design.md` § 1. Reproduced so this
brief is executable, but **the spec wins if they ever disagree**:

| tier_name             | display_name       | £/mo  | £/yr   | Clients | Suite | Rail |
| --------------------- | ------------------ | ----- | ------ | ------- | ----- | ---- |
| `free`                | Free               | 0     | —      | —       | ✗     | —    |
| `premium`             | Premium            | 16.99 | 139.99 | —       | ✗     | IAP  |
| `premium_plus`        | Premium+           | 29.99 | 249.99 | —       | ✓     | IAP  |
| `individual_trainer`  | **Start Up Coach** | 18.99 | 189.99 | 5       | ✗     | IAP  |
| `start_up_coach_plus` | Start Up Coach +   | 34.99 | 349.99 | 5       | ✓     | IAP  |
| `coach`               | Coach              | 59.99 | 599.99 | 15      | ✓     | IAP  |
| `coach_pro`           | Coach Pro          | 99.99 | 999.99 | 30      | ✓     | IAP  |

⚠ **`studio` / `studio_pro` / `enterprise` are OUT OF SCOPE.** They are web-rail rows in
spec-29 **Phase 3**, and Phase 3 ≡ M21, which Brad **descoped on 2026-08-04**. Do not
create them, do not add them to any ladder, do not add a "manage on the web" state.

⚠ **`tasks.md` task 2.3 said Premium annual £109.99 until 2026-08-04. It was STALE** —
corrected to £139.99, which is what `design.md` § 1, `design.md` line 35 and D12 (marked
**FINAL**) all say. If any other stale price surfaces, **the decision record in
`requirements.md` wins over `tasks.md`.**

---

## The retirement — this is the part with no spec coverage

**`small_business` and `medium_enterprise` ARE being retired** (Brad, 2026-08-04),
replaced on the IAP ladder by `coach` (15 clients) and `coach_pro` (30, the top in-app
rung). ⚠ **spec-29's triplet never names either tier** — `grep` returns zero hits — so
this decision lives in `STATE.md` and this brief only.

🔴 **This is a `tier_name` change in substance, which collides head-on with the standing
"never rename a `tier_name`" hazard.** `RC_ENTITLEMENT_IDS` **are** the tier_names and
`user_subscriptions.tier_name` is an FK. What makes it safe is narrow and conditional:

- Brad authorised a **full prod + staging data reset** (2026-08-04) and only test accounts
  exist, so there is **no grandfathering** — no live row references either tier.
- **Therefore: verify the reset has actually happened before writing the migration.**
  If any `user_subscriptions` row still references `small_business` or
  `medium_enterprise`, STOP and raise it. Do **not** write a data migration to move
  subscribers; that is a product decision, not a mechanical one.
- Keep the old rows in `subscription_tiers` with `is_active = false` rather than deleting
  them, so the FK stays satisfiable and any straggler resolves to something.

---

## The nine touchpoints (design § 5) — every one, or the tier is half-live

A tier change that misses any of these ships a visible bug. Numbered as the design does:

1. **`subscription_tiers` migration** (+ `ai_daily_budget_usd` if Phase 1 has landed).
2. **App Store Connect** — a product per IAP tier per cycle. **Brad's** (task 2.9).
3. **RevenueCat** — entitlement id + offering/package. **Brad's** (task 2.9).
4. **`revenuecat/entitlements.ts`** — `RC_ENTITLEMENT_IDS` **and** `TIER_RANK`. ⚠ Rank
   decides which entitlement wins when RC reports several; a new tier absent from
   `TIER_RANK` can lose to a cheaper one.
5. **`purchaseOfferings.ts`** — `tierFromProductId`'s substring ladder and
   `MONTHLY_ONLY_TIERS`. 🔴 **ORDER-SENSITIVE:** `premium_plus` must precede `premium`,
   and `coach_pro` must precede `coach`, or the shorter name swallows the longer one and
   a Premium+ purchase resolves as Premium. **Add a test that pins the order by asserting
   `tierFromProductId('app.persistence.premium_plus.monthly') === 'premium_plus'`.**
6. **`IOSPurchaseFlowPresenter.tsx:200-249`** — the trainer rail is a **hardcoded
   allow-list** (`baseNames`). New coach tiers are **invisible** until it is edited. This
   is task 2.7 and the file that collides with the design revamp.
7. **`assertEntitlement.ts`** — `nextTrainerTierUp` ladder + `PREMIUM_PLUS_FEATURES`.
8. **`useLoadoutGate.ts` / `useMealprintGate.ts`** — hardcoded tier→boolean Records
   (task 2.8).
9. **Seed-guard tests** — `subscriptionTierSeed.test.ts`,
   `premiumPlusTierMigration.test.ts` (task 2.10).

---

## Two gates that fail SILENTLY — fold into this slice

⚠ **1 · `assertEntitlement`'s catch-all returns `{ allowed: true }`.**
`assertEntitlement.ts:730-735` documents it: an `EntitlementFeature` added **without** its
routing line falls through to allowed — **a paid gate becomes a no-op with no type error
and no failing test.** Three keys are ALREADY live stubs returning `allowed: true`:
`ai_workout`, `gym_buddy`, `unlimited_exercise_library`. Any feature this slice touches
needs its routing line, and **a test that proves denial for an unentitled tier** (not just
that the happy path allows).

⚠ **2 · The ORPHANED `useLoadoutGate` fix — fold into task 2.8.**
`/subscriptions/me` never projects `loadout_access`, so `useLoadoutGate` mirrors a
hardcoded `TIER_GRANTS_LOADOUT` Record over the tier union client-side. It was explicitly
scheduled to "land with M21" (~4 lines) — **the descope orphaned it and it now has no
home.** Fix properly: project the flag on `subscriptionRepository.findForUser` +
`MySubscription` + the mobile read, and delete the hardcoded Record. Same treatment for
`useMealprintGate`. ⚠ Adding a coach tier while the client mirrors the map by hand is how
a paying coach sees a padlock.

---

## Task list

Straight from `tasks.md` Phase 2. Do them in this order — the migrations must precede the
readers.

- **2.1** Migration: `display_name` → "Start Up Coach" on `individual_trainer`. ⚠ Change
  the `display_name` ONLY. The `tier_name` stays.
- **2.2** Migration: insert `start_up_coach_plus`, `coach`, `coach_pro`.
- **2.3** Reprice — Premium £16.99 / **£139.99**, Premium+ £249.99 annual. See the stale-price
  warning above.
- **2.4** Grant `mealprint_access` to every **suite-bearing** coach tier. ⚠ **NOT
  `individual_trainer`** — it is the no-suite entry rung.
- **2.5** `revenuecat/entitlements.ts` — `RC_ENTITLEMENT_IDS` + `TIER_RANK`.
- **2.6** `purchaseOfferings.ts` — product ids + the order-sensitive ladder.
- **2.7** Paywall rails — replace the hardcoded trainer allow-list. 🔴 **Sequence with the
  design revamp first.**
- **2.8** `nextTrainerTierUp` + the two mobile gate Records + the orphaned fix above.
- **2.9** ASC + RevenueCat products — **Brad's.** Create them; per
  `RESUBMISSION_BRIEF.md` they are submitted **with** the new build, not before.
- **2.10** Update the seed-guard tests.

---

## Hazards

- ⚠ **Never rename a `tier_name`** — see the retirement section for the one conditional
  exception and its precondition.
- ⚠ **Do not flip `is_active`.** That is `PLAN.md` Stage 4 / task 4.1, after Mealprint and
  Loadout Phase 4 land.
- ⚠ **Do not execute `specs/stripe-rail-removal/`** — that rail is the organisation-tier
  plan.
- ⚠ **`bun run prettier:check` fails at repo root** on untracked files outside your diff.
  Scope it: `bunx prettier --check $(git diff --name-only HEAD)`.
- ⚠ **Use `bun run test:unit`**, never `bunx vitest` — there is no root `vitest`, so `bunx`
  resolves a newer version against a repo pinned to 2.1.9 and invents failures.
- ⚠ **Cost figures come from `bun run scripts/ai-cost-model.ts`, never from prose.** Its
  `TIERS` mirrors the **live DB catalog**, so it will disagree with spec-29 until 2.1–2.3
  land — that is expected, and it should be re-run after.

## Gates before any PR

```bash
bun run typecheck && bun run lint && bun run build && bun run test:unit
```

Then the local `inspector-brad` subagent on the full branch diff; fix every 🔴/🟠/🟡 and
re-run until clean. **Do NOT fire the `@inspector-brad` CI action** — Brad triggers that.

⚠ **When you add a test for a fix, revert the fix and watch it fail.** Three tests on the
Mealprint branch passed against their own reverted fix before being caught. Reading a test
is not evidence.

## Done when

Every one of the nine touchpoints is updated, a test pins the order-sensitive substring
ladder, an unentitled tier is proven to be **denied** (not merely that an entitled one is
allowed), the seed guards pass, and `ai-cost-model.ts` re-run shows no tier above ~50 % of
net at its ceiling. `is_active` is still `false` everywhere.
