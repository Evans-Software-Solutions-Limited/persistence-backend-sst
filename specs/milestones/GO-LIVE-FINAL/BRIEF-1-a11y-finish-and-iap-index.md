# GO-LIVE-FINAL · Brief 1 — Accessibility walkthrough + IAP DB uniqueness index

_Authored 2026-07-16. Two workstreams. **Part B (IAP index) is now SHIPPED** — merged as
#251 (`64c0870`) on 2026-07-16, incl. the atomic RC upsert (step 3). **Only Part A (the a11y
device walkthrough) remains** — Brad's manual gate; an agent can't drive a screen reader.
Part B is retained below for the record._

Repo state at authoring: `main` HEAD `57ff3e7`. Mobile is iOS-first Expo; backend is
SST + Neon/Supabase Postgres + Drizzle.

---

## Part A — Accessibility audit: finishing off (spec-12.7)

### Where it stands

The **code portion is DONE** (PR #244, merged). It added `accessibilityLabel` +
`accessibilityRole` to 21 icon-only elements, `role="switch"` + state to the 2
billing-cycle toggles, and `hitSlop={8}` to 4 sub-44pt buttons. Findings are logged in
[`packages/mobile/docs/a11y-audit-results.md`](../../../packages/mobile/docs/a11y-audit-results.md).
The shared `Btn`/`IconBtn` primitives are already covered by the regression suite at
`packages/mobile/src/ui/components/__tests__/a11y-audit.test.tsx`.

**The only thing left is the on-device manual VoiceOver (iOS) / TalkBack (Android)
walkthrough** — the one gate CI/an agent physically cannot run. Tracker item 12.7 stays
`partial` until this pass is signed off.

> Out of scope (do NOT attempt here): Dynamic-Type / font-scaling work — that is **M14
> (responsive hardening)**, tracked separately. This pass is screen-reader + touch-target
>
> - reduced-motion only.

### What to run

1. **Build:** cut an EAS dev build (or `bun run dev` on a physical device — the simulator's
   VoiceOver is unreliable; use a real iPhone, and a real Android for TalkBack).
2. **Primitives pass (already scripted):** follow the existing checklist at
   [`specs/01-design-system/A11Y_WALKTHROUGH.md`](../../01-design-system/A11Y_WALKTHROUGH.md)
   against the `/dev/primitives/*` routes. It covers Btn/IconBtn/Avatar/Card/Segmented/
   TabBar/Ring/Bar/Stat/BottomSheet/composites + the reduced-motion and contrast spot-checks.
3. **Feature-flow pass (new — the #244 surfaces):** with the screen reader on, swipe through
   each flow below and confirm every element the audit fixed announces a sensible name +
   role, focus order is logical (top→bottom, left→right), and no element is skipped or
   double-announced.

### Feature-flow checklist (the 12 files / 21 elements from #244)

| Flow / screen                                                 | Verify (screen reader announces…)                                                                                             |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Add-exercise popover** (`AddExercisePopover`)               | "Back to list, button" · "Close, button" · "Clear search, button" · each list item's info button → "Exercise details, button" |
| **Swap-exercise popover** (`SwapExercisePopover`)             | "Back to list" · "Close" · "Clear search"                                                                                     |
| **Add-to-superset popover** (`AddExerciseToSupersetPopover`)  | "Back to list" · "Close" · "Clear search"                                                                                     |
| **Workout detail** (`WorkoutDetailPresenter`)                 | "Close, button" · "Edit workout, button"; both feel ≥44pt (hitSlop)                                                           |
| **IAP purchase flow** (`IOSPurchaseFlowPresenter`)            | "Go back, button" · billing toggle → "Billing cycle, switch, on/off" and toggling flips the announced state                   |
| **Subscription selection** (`SubscriptionSelectionPresenter`) | "Go back" · billing toggle → "Billing cycle, switch, on/off"                                                                  |
| **Profile** (`ProfilePresenter`)                              | avatar → "Change profile picture, button"                                                                                     |
| **Home workout card** (`WorkoutCard`)                         | start button → "Start workout, button"; target feels ≥44pt (hitSlop)                                                          |
| **Coach workout library** (`CoachWorkoutLibraryPresenter`)    | "Go back, button"                                                                                                             |
| **Exercise notes popover** (`ExerciseNotesPopover`)           | header X → "Close, button"                                                                                                    |
| **Generic popover** (`Popover`)                               | close → "Close, button"; target feels ≥44pt (hitSlop)                                                                         |

Also spot-check a few **Category-B** rows (menu rows, CTA buttons with visible text) to
confirm they still announce **once** (not doubled) — #244 deliberately left ~60 already-named
elements untouched to avoid double-announce; this is confirming that decision held.

### Reduced-motion (already code-gated by #239)

With OS "Reduce Motion" on: Rings/Bars must **jump** to their value (no fill animation) and
BottomSheets must **snap** (no slide). The `useReducedMotionGate()` branches are unit-tested;
this confirms the OS setting is honoured on-device.

### Sign-off (updates tracker 12.7 → done)

- [ ] VoiceOver pass complete (iOS) — primitives + all feature flows above
- [ ] TalkBack pass complete (Android)
- [ ] Reduced-motion pass complete (both platforms)
- [ ] Contrast spot-check complete (no rendered text on `$text4`/`$text5`)

If the walkthrough surfaces a **code** defect (missing/incorrect label, wrong role, focus
trap), that becomes a small follow-up PR — hand the specific element(s) to an `implementer`;
keep it per-element (no bulk relabelling — that reintroduces the double-announce regression).

---

## Part B — IAP DB uniqueness index (spec-12.13) — ✅ SHIPPED (#251)

> **DONE 2026-07-16 via #251 (`64c0870`).** Migration
> `supabase/migrations/20260717120000_user_subscriptions_external_id_unique.sql` +
> matching `schema.ts` partial unique index landed, **and** step 3 (the atomic
> `INSERT … ON CONFLICT` upsert replacing the find→insert race) shipped too. Staging
> auto-applied on merge; verify the prod deploy applies the migration + run the pre-flight
> dedup `SELECT` against prod before the sandbox test. The rest of this section is kept as
> the historical record of what was done and why.

### What this is, in one line

Add a **partial UNIQUE index on `user_subscriptions.external_subscription_id`** so the same
store subscription can never produce two rows — closing a duplicate-grant race in the
RevenueCat/Apple webhook path — and unlocking a clean idempotent upsert.

### Why it matters / the current gap (verified against `main`)

- `user_subscriptions` (`packages/db/src/schema.ts:422-461`) has `external_subscription_id`
  as a **nullable `text`** column. For RevenueCat it holds a synthetic `rc_<appUserId>`
  (set in `revenueCatWebhookHandler.ts:115`); Stripe rows hold the raw `sub_…` id; free-tier
  / legacy rows leave it NULL.
- Today there is **no uniqueness** on that column — only a **non-unique** partial index
  `idx_user_subscriptions_external_id` (`001_initial_schema.sql:775`) and a separate partial
  unique index `user_subscriptions_active_unique` on **`(user_id)`** WHERE status is live
  (i.e. "one live row per _user_", not "one row per _subscription_").
- The webhook write path (`revenueCatWebhookHandler.ts` `syncCustomer`, L103-162) is a
  **non-atomic select-then-insert-or-update**: `findByExternalId` → `cancelLiveSubscriptions`
  → `updateById` _or_ `insert`. None of the repo methods use `.onConflict`. RevenueCat delivers
  at-least-once and unordered, so **two concurrent first-time events (or a webhook racing a REST
  re-sync) can both read `existing === null` and both insert** an `rc_<appUserId>` row.
- Right now that double-insert is caught only **incidentally** by the per-user
  `user_subscriptions_active_unique` index (both rows are live for the same user → the loser
  500s → RevenueCat retries into the update branch). The code says so itself in a comment
  (`revenueCatWebhookHandler.ts:146-152`): _"A true fix is an upsert on
  `external_subscription_id`; deferred (needs the unique constraint)."_ **This brief is that
  prerequisite.**

### The change — a two-step PR (step 3 optional)

**Step 1 — the migration** (SQL is source of truth; applied via `supabase db push`).
Create `supabase/migrations/<ts>_user_subscriptions_external_id_unique.sql` where `<ts>` is a
14-digit UTC timestamp **greater than** the current latest `20260716120000`
(e.g. `20260717120000`). Mirror the convention of the direct precedent
`20260605120000_widen_active_subscription_unique.sql` — plain `CREATE` (NOT `CONCURRENTLY`;
migrations run inside a transaction under `db push`), idempotent, with a pre-flight dedup note:

```sql
-- spec-12.13 — enforce one subscription row per external (store) subscription id.
-- Prevents duplicate grants from the non-atomic find->insert in the RevenueCat/Stripe
-- webhook paths, and unlocks INSERT ... ON CONFLICT (external_subscription_id) upserts.
--
-- PRE-FLIGHT (run manually against BOTH staging and prod BEFORE relying on this;
-- must return zero rows, else resolve the dupes as a reviewed data op — do NOT
-- auto-mutate billing rows inside a migration):
--   SELECT external_subscription_id, count(*)
--   FROM user_subscriptions
--   WHERE external_subscription_id IS NOT NULL
--   GROUP BY external_subscription_id
--   HAVING count(*) > 1;

-- Replace the non-unique lookup index with a partial UNIQUE index (also serves
-- findByExternalId lookups). Partial predicate is required: the column is nullable
-- and Postgres would otherwise treat multiple real values fine but this keeps it
-- aligned with the existing partial index and excludes NULL free-tier rows.
DROP INDEX IF EXISTS idx_user_subscriptions_external_id;
DROP INDEX IF EXISTS user_subscriptions_external_id_unique;
CREATE UNIQUE INDEX user_subscriptions_external_id_unique
  ON user_subscriptions (external_subscription_id)
  WHERE external_subscription_id IS NOT NULL;
COMMENT ON INDEX user_subscriptions_external_id_unique IS
  'spec-12.13: one row per store subscription id (partial, non-NULL). Enables idempotent upsert.';
```

**Step 2 — mirror it in the Drizzle schema** so `schema.ts` stays in sync (it does NOT
generate migrations, but query-building/type-inference reads it). In the
`userSubscriptions` table definition (`packages/db/src/schema.ts:422-461`), change the
existing external-id index to a partial `uniqueIndex(...)` with the same
`.where(sql\`external_subscription_id IS NOT NULL\`)`predicate and the name`user_subscriptions_external_id_unique`. Match the exact style of the neighbouring
`user_subscriptions_active_unique` partial unique index already in that file.

**Step 3 (OPTIONAL, recommended but scope-gated) — the upsert refactor.**
Once the unique index exists, replace the find→(cancel)→insert/update dance with a single
`INSERT ... ON CONFLICT (external_subscription_id) WHERE external_subscription_id IS NOT NULL
DO UPDATE ...` in `SubscriptionRepository`, consumed by both `revenueCatWebhookHandler`
(`syncCustomer`) and Stripe `subscriptionCreated`. This removes the race entirely (no more
incidental-500 + retry). **Caveat:** the interaction with `user_subscriptions_active_unique`
(one live row per user) must be preserved — `cancelLiveSubscriptions` still has to run so a
tier switch doesn't leave two live rows for the same user with _different_ external ids. Treat
step 3 as its own reviewed slice if it grows; steps 1+2 alone are enough to satisfy 12.13 and
gate the sandbox testing.

### Apply / rollout

- **Staging auto-applies on merge** (`deploy-staging.yml` runs `supabase db push` on push to
  `main`). So merging steps 1+2 immediately puts the index on staging.
- **Prod is release/manual-gated** (`production-deploy.yml` fires on a published release or
  manual dispatch) — the index reaches prod only on the next prod deploy. Run the pre-flight
  dedup `SELECT` against prod first.
- ⚠ Run the pre-flight dedup query on **both** environments before trusting the index; if it
  returns rows, resolve them as a reviewed data operation (not inside the migration).

### Gates for the PR (steps 1+2)

`bun run typecheck && bun run lint && bun run prettier:check && bun run test:unit`
(core coverage ≥90%; a `PgDialect` render test is the right way to prove the new partial-unique
SQL fragment, since the unit suite mocks `getDb` — see the Drizzle-GROUP-BY lesson in
project memory). Then `inspector-brad` local sweep, focused on: correct partial predicate,
no drop of the lookup path, and (if step 3) the active-unique interaction. Do NOT fire the CI
`@inspector-brad` action.

### Sequencing

**12.13 must be merged (and on prod) before the IAP sandbox sign-off in Brief 2 (12.11).**
The whole point is to prevent duplicate grants _during_ that testing.
