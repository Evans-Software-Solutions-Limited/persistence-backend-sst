# Project memory · persistence-backend-sst

**Canonical state ledger. Read at session start; update before ending a session.**

Older sessions live in [`STATE-ARCHIVE.md`](./STATE-ARCHIVE.md) (2026-07-24 and
back). This file keeps the durable facts, the gotchas that still bite, the open
items, and the four most recent sessions. Trimmed 2026-07-27 from 1554 lines.

If anything here contradicts `git log --oneline -30`, the git history wins —
say so and fix this file.

## ▶ START HERE — next session (rewritten 2026-08-04, post-Mealprint-merge)

### 🔴 2026-08-05 — APP STORE: a THIRD rejection is OPEN, and it is NOT the two you think

**Build 1.0 (40) was rejected AGAIN on 2026-08-04** (submission
`9b3438b9-0ed2-4a46-9ebb-78faa0e495b5`, status Unresolved Issues, iPhone 17 Pro Max + iPad
Air 11-inch M3). The 2.1-PassKit and 4.0-Apple-logo reasons this repo's briefs were written
for were **NOT re-cited** — build 40 carried both fixes and they appear cleared. The two
LIVE reasons are new, and **neither is a code defect**:

1. **2.1(a) Information Needed** — Apple wants a **coach invite code** in App Review
   Information to assess the coach↔client flow. Brad's, operational.
2. **2.1(b) App Completeness** — "In-app purchase products … could not be found in the
   submitted binary." The app-side code is CORRECT (verified: `revenuecat.adapter.ts`
   reads offering `default`; product ids match ASC byte-for-byte). Points at the RevenueCat
   `default` offering (`ofrng79adc3c998`) / RC↔App Store product mapping — a dashboard
   config fix, Brad's.

**Full detail + the ASC product state (six subs, all Ready for Review, no `premium_plus`
product exists) is in [`specs/milestones/GO-LIVE-2026-08/RESUBMISSION_BRIEF.md`](specs/milestones/GO-LIVE-2026-08/RESUBMISSION_BRIEF.md)**
(TASK 0 done; the release PR #344 exists and is green; prod migrations are AUTOMATIC on
release, not manual). ⚠ **There is NO outstanding CODE work for the resubmission** — it is
all Brad's operational/dashboard work.

### ⚠ M21 IS DESCOPED (Brad, 2026-08-04) — plan of record changed

The Premium+ launch bundle is now **Mealprint + Premium+ + the new subscription layers on
ONE new build**; M21 (the B2B org rail ≡ spec-29 Phase 3) is deferred. `PLAN.md` Stage 5
reflects this. ⚠ Consequence: the `useLoadoutGate` / `/subscriptions/me` `loadout_access`
projection fix that was scheduled to "land with M21" is orphaned — fold it into spec-29
Phase 2 (`PAYWALL_SURFACES_BRIEF.md` task 2.8). Also settled: `small_business` +
`medium_enterprise` are RETIRED, replaced on the IAP ladder by `coach` + `coach_pro`
(a `tier_name` change in substance — safe only because of the authorised prod+staging data
reset; no grandfathering).

### 🎯 SIGN-OFF SCOPE for the launch build (Brad, 2026-08-05) — the finish line

Brad's "main pieces" + the order to the App Store submission:

1. **Mealprint (spec-26)** — backend done (#350/#357); REMAINING = replace-meal route
   (small), **Phase 2 mobile** (plan-flow UI + Fuel integration, the big chunk), and
   **Phase 3** (week gen, shopping list, adherence). ~half the feature by user surface.
2. **Loadout single-workout (spec-21)** — feature-complete & merged; REMAINING = a device
   pass on an EAS build with an entitled account.
3. **Loadout Phase 4 / program import (spec-22) — IN SCOPE** (Brad: "we've done a lot of
   the leg work"). ⚠ **Honest caveat recorded:** the reused leg-work is the single-workout
   ADAPTATION engine; the IMPORT half (extraction from screenshot/PDF/link + exercise-name
   resolution) is **net-new AND eval-gated** — Phase 0 is an accuracy+cost eval and NO code
   ships until it clears the C2 bar (~85 % field accuracy, no whole-workout drops, ≥95 %
   auto-match). The eval is the first step, not skippable.
4. **Subscription DESIGN revamp (mobile paywall) — do FIRST, before web.** The catalog+code
   is done (PR #361); this is the incoming **Claude Design subscription-layout revamp** of
   the paywall screens (PAYWALL_SURFACES_BRIEF § "sequence 2.7 with the revamp"). ⚠ Needs
   the design source / the `mcp__claude-design__*` connector RE-AUTHORISED (not available in
   a non-interactive session) — a Brad dependency.
5. **Web — pricing page + read-only, to START with.** Rewrite `packages/web/Pricing.tsx` to
   the new 6-tier catalog/prices (it is STALE — £12.99 Premium, old structure) + in-app
   read-only for web tiers. **This is a FOLLOW-UP after the mobile revamp.**
6. **Stripe / org rail (spec-29 Phase 3) — PARALLEL with App Review, NON-BLOCKING for
   submission** (Brad). Build it in web while the app approval is in flight; it does not
   gate the submission.

**Not blocking submission:** spec-29 Phase 1 (pooled AI budget — margin protection) and the
org rail (#6). **App Store submission happens only when ALL the above sign-off code is
done** (Brad — do not submit early).

### ✅ 2026-08-05 — Mealprint spec-26 PHASE 2 BACKEND is MERGED to `main` (PR #357, `3f047bec`)

Inspector Brad clean @ `270870d3`; all 5 CI checks green; squash-merged. **Staging deploy
fired on merge and auto-applied the `20260804120000_mealprint_plans.sql` migration there.**
Nothing user-reachable (`premium_plus` inactive, no mobile caller). ⚠ CI caught one thing
the local scoped lint missed — a `react/no-unescaped-entities` error in the mobile privacy
bullet; fixed in the same PR. **Lesson: run the mobile package's own `expo lint`, not just
`bunx eslint` on core dirs, before pushing anything touching `packages/mobile`.**

What shipped (all spec-26 Phase 2 backend, the whole loggable loop server-side):
`meal_plans` + `meal_plan_meals` migration/schema · `mealPlanRepository` ·
`resolveByIds` (accept/swap macro-recompute boundary) · `POST /nutrition/plans` (accept) ·
`GET /plans/active|/plans|/plans/:id` · `PATCH`/`DELETE /plans/:id` ·
`POST /plans/:id/meals/:mealId/log` · `POST /nutrition/ai/plan-generate` +
`plan-meal-swap` + `planModel` · infra ceilings (`AI_MEAL_PLAN_DAILY_LIMIT=5`,
`AI_MEAL_SWAP_DAILY_LIMIT=10`) · privacy-policy "Meal plans" bullet in BOTH copies.

⚠ **IB's first sweep found a real 🟠 isolation leak (fixed in the merged PR,
revert-verified):** `resolveByIds` read `foods` UNSCOPED, reopening the PR #124 private-food
leak — a user could pull another user's custom food's macros into their plan via the accept
body. Fixed to mirror `foodRepository.getByIds` (`createdBy = userId OR source =
'openfoodfacts'`). The test had certified the leak; rewritten. **Lesson restated: a
mocked-DB test can pin a security hole as correct — assert the scope, not the absence of
it.**

**Two decisions still open for Brad (do not guess):**
1. **`ai_generated` recipes on accept?** Design § 3 says accept "creates ai_generated
   recipes"; the accept handler currently stores one-off item lists instead. Recommend
   minting a recipe only on an explicit "save as recipe", NOT per accepted plan. UNBUILT
   either way.
2. **Loadout Phase 4 / programme import** — ✅ **COMBINED SPEC WRITTEN 2026-08-05:
   `specs/22-program-import-and-adaptation/`** (triplet). Phase 4 MOVED there from
   spec-21 (spec-21 keeps the single-workout engine + § 2.4 columns). Cap confirmed 10.
   **Eval-gated: Phase 0 is an accuracy+cost eval, no code until it clears.** Includes
   the source-keyed `extraction_cache` (content-hash, copy-on-import, public_url shared
   / upload per-user — Brad greenlit the direction). Shared cross-user library PARKED
   (design § 9). ✅ **Both checkpoints RESOLVED (Brad, 2026-08-05): C1 = Option A**
   (public-URL shared cross-user, uploads per-user, NO exclusion list); **C2 = framing
   + starting thresholds accepted** (~85 % field accuracy, no whole-workout drops,
   ≥95 % auto-match precision; Phase-0 eval validates). Recorded in design § 10/§ 11.
   Still ZERO code — spec only; Phase 0 (the eval) is now unblocked to start.

**NEXT SLICE for "whole of Mealprint" — pick up here:** the post-accept **replace-meal
ROUTE** (`replaceMeal` exists on the repo + swap returns the meal, but no route wires them —
small, do this first); **Phase 2 MOBILE** (tasks 2.6/2.7 — plan flow UI + Fuel integration,
the big chunk, `packages/mobile`, ⚠ run `expo lint` locally); **Phase 3** 3.2–3.5 (week
plans, shopping list, adherence; 3.1 async spine already shipped). The paywall-surfaces work
(`PAYWALL_SURFACES_BRIEF.md`, spec-29 Phase 2) is parallelisable and independent.

---

**The two paths below (A subscription-restructure, B go-live) still hold, but note the two
blocks ABOVE supersede their framing: a THIRD App Store rejection is open, and M21 is
descoped.** Read those first.

### The one thing that is NOT done on Mealprint

⚠ **The entitled half of Mealprint has never executed on a device.** Everything
locked/pending/stalled is device-verified; every path a Premium+ user takes is proven
only by unit tests. It is merged because it is gate-green and design-signed-off, not
because it has run. **Before it reaches a real user it needs:**

1. A `user_subscriptions` row on staging (`nxkhlrvjxotyjulodxzk`) with
   `tier_name='premium_plus'`, `payment_status='active'`. ⚠ Read § "The RevenueCat
   claim in the old brief was WRONG for staging" and the trap warnings there FIRST —
   the `update_subscription_limits` trigger sets `profiles.role='user'` for any
   non-trainer tier, which will knock Brad's account out of coach mode. Use a second
   test account or accept the flip knowingly.
2. The device pass in § "What IS device-verified" — specifically the suggest sheet's
   draft-stage scroll, the pinned footer, and the `KeyboardAvoidingView` on the
   preferences wizard (simulator hardware keyboard cannot prove the last one).
3. Prod is `opcvjypsoivaxerahbal`. **Do not touch it.**

### A · Subscription restructure — `specs/29-subscription-restructure/`

⚠ **UPDATE 2026-08-05: Phase 2 (the IAP coach ladder) is BUILT on branch
`claude/spec29-phase2-coach-ladder` — not yet a PR.** Two pricing decisions
resolved this session and recorded in `design.md` § 1: (1) coach-ladder annual
discount extended to **approximately 30 % across the board** (Start Up Coach
£159.99, Start Up Coach + £289.99 — nearest permitted ASC GBP price point —,
Coach £499.99, Coach Pro £839.99; consumer annuals unchanged at
£139.99 / £249.99); (2) the six-tier IAP ladder is final. What shipped on the
branch: migration `20260805120000_coach_ladder_restructure.sql` (rename
individual_trainer→"Start Up Coach" + reprice; insert `start_up_coach_plus` /
`coach` / `coach_pro` suite-bearing, `is_active=false`; retire
`small_business`/`medium_enterprise` as inactive tombstones); both
`SubscriptionTierName` unions; `RC_ENTITLEMENT_IDS`/`TIER_RANK`/`tierFromProductId`;
both gate Records; paywall rail; `MONTHLY_ONLY_TIERS` now empty; and three
untyped-literal survivors fixed (GreetingSection map + two deep-link checks now
derive from `TRAINER_TIER_NAMES`). **Gates all green** (prettier · typecheck 8/8 ·
core 3880/3880 · mobile 5928/5928 · build 13/13); Inspector-Brad-local
**clean @ `adf7111e`**; **PR [#361](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/361)
MERGED**. ⚠ The tiers remain launch-gated with `is_active=false` until App Store
Connect and RevenueCat are aligned.

⚠ **PRICE-POINT FOLLOW-UP:** migration
`20260805180000_start_up_coach_plus_annual_asc_price.sql` updates the
Start Up Coach + annual price from £293.99 to ASC's supported £289.99 price point.
The original merged migration remains unchanged so the correction runs on databases
that already recorded it.

⚠ **Design call baked in:** `individual_trainer` (entry coach rung) LOSES the
suite; the paid coach tiers carry it; a coach denied the suite upsells
`start_up_coach_plus` (not premium_plus — that would strip coach mode). This
collapsed the old `PREMIUM_PLUS_ONLY_FEATURES` split entirely.

⚠ **The RC/ASC/Stripe alignment RUNBOOK was delivered to Brad in chat this session
(not committed, per `feedback_setup_briefs_as_chat_copy`).** It covers ASC product
ids to create/retire, RС entitlements + the `default` offering (the 2.1(b)
rejection fix), and the web org-tier Stripe products (forward-setup only; org rail
descoped).

⚠ **`scripts/ai-cost-model.ts` TIERS now DISAGREES with the DB catalog** — Phase 2
repriced the DB but the script deliberately still holds the OLD live prices until
Phase 1 lands. Reconcile when Phase 1 (pooled AI budget) is built. NOT stale by
accident.

**Phases 0, 1 and 3 remain.** Start at `tasks.md` **Phase 0** (no code) for the
rest; ⚠ run checkpoint C5 FIRST before any Phase-1 pricing/budget task.

⚠ **Run checkpoint C5 FIRST, before any pricing task.** `recipe_extract` on Opus is
$0.0355/call — 55 % of Premium's whole worst case and 44× the cheapest endpoint. If it
holds quality on a cheaper vision model the number becomes ~$0.007 and most of the
margin problem, including the Start Up Coach cap-binding in AC 2.3a, dissolves. Every
other pricing decision is downstream of that one measurement.

Then C2 (measure the 7 estimated unit costs), then Phase 1 (the pooled budget, which
retro-protects margin on everything already shipped). The App Review question (C1)
gates Phase 3 **only** — do not let it block Phases 0–2.

**Two prices are still open, and both are recorded as open, not guessed:**
Start Up Coach £14.99 vs £17.99 (AC 2.3a), and whether the ~30 % annual discount
applies to the coach ladder or only the two consumer rows (design § 1).

### B · Go-live — `specs/milestones/GO-LIVE-2026-08/PLAN.md`

Five ordered stages with done-when criteria per stage. Unchanged by this session.

### ⚠ Standing hazards, all easy to trip

- `specs/stripe-rail-removal/` must **NOT** be executed — the rail is the coach-tier plan.
- Never rename a `tier_name` — RevenueCat entitlement ids **are** the tier_names.
- **`bun run prettier:check` fails at repo root** on two of Brad's UNTRACKED files
  (`.agents/skills/sst-resource-change/SKILL.md`, `microservices/core/probe-steps.ts`).
  Not a regression; scope the check to your own diff.
- Cost figures: `bun run scripts/ai-cost-model.ts`. **Never quote them from prose** —
  that is why they live in a tested script, and it has gone stale twice.
  ⚠ Its `TIERS` mirrors the **LIVE DB catalog**, not spec-29's proposal — they
  deliberately disagree until the Phase 1 migration lands.
- **Brad authorised a full prod + staging data reset (2026-08-04)** — only test
  accounts and his own exist, so zero-grandfathering for repricing holds. No agent has
  touched prod/staging data; the reset is Brad's to run.

### ⚠ The lesson this branch cost six review sweeps to learn

Every one of the first five sweeps found that the **previous sweep's fix had created
the next defect**, all in one container, and the suite stayed green through all of it.
Two tests — and a third on this last commit — **passed against their own reverted
fix**. The discipline that actually worked: *when you add a test for a fix, revert the
fix and watch it fail.* Reading the test is not evidence. Also: the in-memory storage
fake never self-notifies, so a whole family of `useCachedResource` staleness bugs is
invisible unless a test calls `storage.emitChange(...)` explicitly.

## Current state (2026-08-02)

### ⚠ PLAN OF RECORD — the Premium+ launch is now a BUNDLE (Brad, 2026-08-02)

**`premium_plus` does not go active until Loadout Phase 4, spec-26 Mealprint AND
the M21 B2B org layer are all shipped.** Brad's call, made after the Loadout
athlete flow signed off. This supersedes the previous plan, in which T-P0.10
(the ASC + RevenueCat flip) followed the Loadout release on its own, and it
supersedes `GTM-EXPANSION/BRIEF.md`'s sequencing, which puts M21 **post**-launch
on a pilot trigger.

Two things make the bundling coherent rather than merely bigger:

- **The catalog row already promises Mealprint.** The `premium_plus` row's
  `features` jsonb is `{"loadout": true, "mealprint": true}`, and
  `SubscriptionSelectionPresenter` renders a "Mealprint — AI meal planning
  around your targets" bullet off it. Flipping `is_active` today would put a
  £29.99/mo card on the live paywall advertising a feature with **zero code**.
- **B2B changes the entitlement SEAM, not just the surface.** M21's
  org-aware resolution ("live personal sub, else highest active grant") rewrites
  how `assertEntitlement` resolves a tier. Landing that before the tier is
  purchasable means it is never retrofitted underneath paying subscribers.

⚠ **The honest cost:** the consumer subscription now waits on an enterprise
layer whose own brief says "build trigger: a real pilot conversation (Brad says
go), not the calendar" — and no pilot is recorded. If revenue timing starts to
bite, the separable piece is M21: Loadout Phase 4 + Mealprint alone close the
"paywall promises what it cannot deliver" gap, which is the launch-blocking half.

**Step 0 (the shared async-job spine) is SHIPPED as of 2026-08-03**, and
**spec-26 Mealprint's BACKEND (Phase 0 + Phase 1) shipped the same day** — see
§ Mealprint below. Phase 4 and M21 remain zero code; Mealprint's MOBILE half
(tasks 0.6, 1.5) is also still zero code. See § Next plan of action.

### spec-26 Mealprint — ✅ MERGED to main 2026-08-04 (design pass + 6 review sweeps)

> **Merged after SIX Inspector Brad sweeps.** Sweeps 1–5 each found that the previous
> sweep's fix had created the next defect; sweep 6 returned MERGE and independently
> confirmed the monotonic-latch fix holds under StrictMode, the change-bus flush and
> the user-change path. Its four residual findings (one 🟡, three 🟢) were fixed in
> `0c1ce767`, each with a test verified to fail against its own reverted fix.
>
> **✅ MERGED as `fa0567fc` (PR #352), all 5 CI checks green.**
>
> ⚠ **The sweep was on `0c1ce767`; TWO commits landed after it and Inspector Brad never
> saw them.** One is docs. The other, `949436ef`, is a PRODUCT change: `onGenerate` read
> `gate.allowed` without `gate.isResolved`, so a tap inside the `/subscriptions/me`
> first-fetch window sent an entitled Premium+ user to the paywall to buy the tier they
> already own. It is covered by a revert-verified test and it is a strictly narrowing
> guard — but it is unreviewed, and it was found by CI failing twice on two DIFFERENT
> tests in this suite, not by review. **If anything in Mealprint misbehaves around
> entitlement, start there.**
>
> ⚠ **Still not device-verified on the ENTITLED path** — see § START HERE item A.1.
>
> Everything below this line is the build history — the design pass, the five sweeps
> and the allergen-wipe routes. Kept because the allergen-wipe record is the reason
> that container is the way it is, and a future session must not "simplify" it.

**Branch `claude/mealprint-mobile-ui-9347a0`, HEAD `ac3a7ac5`** (updated from
`main` @ `dcc9726a`; PR still NOT raised). T-0.6 + T-1.5 plus a design pass over
all four surfaces. Gates: prettier, full-workspace typecheck (8/8, web's Eden
client clean), mobile lint 0 errors, build 13/13, **476 suites / 5910 tests**.

⚠ `bun run lint` FAILS at the workspace level on `microservices/core/probe-steps.ts`
— an UNTRACKED local scratch file of Brad's with 4 `no-explicit-any` errors. Not on
the branch, so it cannot reach CI; but it will keep failing the local gate until
Brad deletes or fixes it.

#### ⚠ The stale-bundle diagnosis was RIGHT, and it is now fixed

The previous session's three "misses" were all the stale bundle, exactly as
diagnosed. A fresh `expo run:ios --device <udid>` from this checkout (build
succeeded, `PersistenceStaging` scheme) resolved all three: the Mealprint card
renders on Fuel, the "Food preferences" row renders on Fuel Targets, and
`/(app)/fuel/preferences?mode=wizard` deep-links correctly instead of bouncing to
Home. **Do not re-diagnose these as rendering bugs.**

#### ⚠ The RevenueCat claim in the old brief was WRONG for staging

A promotional entitlement is needed for TestFlight/production, **not** for staging.
A direct `user_subscriptions` row is sufficient, and the code path was verified
here: `subscriptionRepository.findForUser` (`:512`) and `assertMealprint` both
`innerJoin subscription_tiers ON tier_name` with **no `is_active` filter**, so
`premium_plus` resolves despite its inactive catalog row.

**⚠ BLOCKED, not done.** The Supabase MCP connector only exposes
`persistence-prod` (`opcvjypsoivaxerahbal`); staging (`nxkhlrvjxotyjulodxzk`) is not
in its project list, so the row could not be written. Needs either the connector
re-scoped to the staging project or Brad running the SQL. **And the write needs a
decision first** — see the trap below.

⚠ **The `update_subscription_limits` trigger will DEMOTE the account.** Verified in
`supabase/migrations/004_subscriptions_and_roles.sql:95-121`: the role is derived
solely from `is_trainer_tier`, and `premium_plus` ships `is_trainer_tier = false`
(`20260725194527_premium_plus_tier.sql:62`). So the trigger sets `role = 'user'` —
which knocks a `personal_trainer` out of coach mode **and would demote an `admin`
too**, since the else-branch is an unconditional `'user'`. The brief flagged the
coach case; the admin case is worse and was not flagged. Decide between switching
the main staging account and using a second test account BEFORE writing the row.

What shipped:

| Slice | Contents |
| --- | --- |
| T-0.6 | `domain/models/mealprint.ts` (wire contract + vocabularies mirrored from the backend + the two pieces of contract copy), api-port/SST-adapter methods, `cached_mealprint_preferences` SQLite table, an offline-queued coalesced write command, the wizard/editor at `/(app)/fuel/preferences`, and both entry points (Fuel card, Fuel Targets row) |
| T-1.5 | `useMealSuggest` (imperative, never queued, five-way failure taxonomy), the suggest sheet, draft-confirm, and logging by REFERENCE through the existing `POST /nutrition/entries` |

Decisions worth not re-deriving (all in docstrings):

- `useMealprintGate` grants **premium_plus ONLY** — mirrors `mealprint_access`, not
  `loadout_access`. Upsell target is premium_plus even for a coach.
- The entry card has **FOUR** states. `pending` and `stalled` exist so a paying
  subscriber never meets a padlock during the cold-start round trip, and a hung
  socket never renders as a paywall. `GymsSegmentContainer` is the precedent.
- The label-check disclaimer renders on `labelCheckRequired` (always true), never
  on `containsUnverified`. Defaults to `true` when a result omits the field.
- Preferences are **ungated** on both endpoints and both surfaces — the paywall is
  on generation, and an expired subscriber must still be able to read and correct
  their allergen list.

#### The design pass (2026-08-04) — and the one place the prototype is WEAKER

There was no Mealprint design at port time. Brad supplied the **AnyMeal GTM D8
standalone HTML** (a Claude Design bundle); its JSX unpacks from the
`__bundler/manifest` script as `anymeal-parts/screens/sheets.jsx` + `ui/icons/iOS`
— that is the design source of record for this feature, and it post-dates
`~/Downloads/handoff/design-source/`, so `feedback_prototype_first_source_of_truth`
has no older prototype to defer to.

⚠ **The Claude Design connector is NOT authorised** — `mcp__claude-design__*` returns
"run /design consent", which cannot be granted in a non-interactive session. The
pass was done from the HTML bundle instead. Re-consent before relying on the
connector.

**Accent decision: Mealprint is GOLD, not cyan.** The design makes nutrition gold
throughout and our Fuel tab already agrees (`MacroHeroPresenter` is "a single gold
ring"); the card had shipped `primary`, the one cyan object on a gold screen. The
rule now written into the docstrings: **gold marks Mealprint where it is being
OFFERED or GENERATED; cyan stays the control accent where preferences are SET;
amber is reserved for safety and never competes with a gold fill in the same block.**

⚠ **NOTHING outside Mealprint was restyled, and that was Brad's explicit
instruction** (2026-08-04): the design source never saw our tokens, so differences
from it are often OUR palette being right. The hero ring, `MacroHeroPresenter`,
`QuickAddRowPresenter` and every other Fuel surface are **untouched** — the gold in
the Mealprint card comes from `$gold`/`$goldDim`/`$goldInk`, which already existed.
The only non-Mealprint files in the diff are `BottomSheet.tsx` (a new OPTIONAL
`footer` prop; no other caller passes it, verified no regression) and
`FuelPresenter`/`FuelTargetsPresenter`, which only compose the Mealprint surfaces
and pass them props. **Do not "finish the job" by aligning the rest of Fuel to the
prototype.**

⚠ **The prototype's chip treatment was REJECTED, deliberately.** `AMChip` makes
allergens and dietary patterns both pills, separated by hue alone (gold patterns vs
amber allergens). That is weaker than what shipped and would breach AC 1.2 — ours
keeps amber + square-shouldered (radius 8) + warning glyph against the patterns'
cyan pill (radius 19), so the distinction survives greyscale. Strengthened further:
the allergen SECTION now carries the alert glyph and an amber sub-line. **If a
future pass "aligns the chips to the prototype", that is a regression.**

#### ⚠ `BottomSheet` gained a `footer` — and it is a correctness fix, not styling

The draft stage stacks items + meal picker + two conditional caveats in an 86 %
sheet, so `Log N kcal` sat below the fold — on the step that writes to a food log,
for reasons the user does not control. Reachability was a property of content
length. The confirm (and the setup stage's Generate) now live in
`BottomSheet.footer`, a flex **sibling** of `BottomSheetScrollView` inside the same
definite-height column, with the bottom safe-area inset handed from the scroll
content to the footer. Ports the prototype's `AMSticky`. The wizard's
"Save and continue" got the same treatment as a plain sticky footer.

⚠ **A footer nested INSIDE the scroll view satisfies a naive test and reintroduces
the whole bug.** The first version of the structural test only proved the CTA sat in
a node *named* footer; it passed against the reverted fix. It now asserts against
`BottomSheetScrollView` directly. Same class of error bit the day-nav test below.

#### What IS device-verified (iPhone 17 Pro, fresh build) — and what is not

✅ Verified end-to-end: the Fuel entry card in **locked** state (gold wash, padlock,
PREMIUM+ pill, gold CTA, no price literal); the "Food preferences" row; the
preferences **editor** rendering, scrolling, selecting an allergen, showing
`LABEL_CHECK_COPY` verbatim, saving, and the summary row updating to
"1 allergen avoided · 4 meals a day · balanced"; `MEDICAL_SCOPE_COPY` at the foot;
the **wizard** via deep link with its pinned CTA holding through a full scroll.

❌ **NOT verified, and all of it needs the staging entitlement:** the unlocked card,
the suggest sheet (shape toggle, steer, generating), `no_candidates`, the happy
path, and — the one that matters most — **the draft stage scrolling to its pinned
confirm inside gorhom**. The pinned-footer mechanism is proven on the preferences
screen, but that is a plain `View`, not a `BottomSheet`; the gorhom container is
unproven on device. Jest mocks gorhom, so no test can close this.

❌ **The KeyboardAvoidingView fix on the wizard is NOT device-verified** — the
simulator had a hardware keyboard connected, so the software keyboard never
appeared. It follows `CreateExercisePresenter`'s reference implementation verbatim,
which IS device-proven for this exact case, but that is inheritance, not proof.

#### The follow-up Inspector Brad sweep — fixes sound, one SIBLING missed

A second sweep on the fix commit mutation-tested the two load-bearing assertions and
confirmed none of the fixes was itself the new defect (the failure mode this branch
hit twice before). It found what the first sweep had missed: **the false "today"
claim removed from the entry card was still live in the SHEET the card opens** — and
the sheet is where the write happens (it generates and logs against
`useFuelSheets().date`). Same defect class, one component over, on the only path the
card leads to. Now `isToday`-aware in both places, with off-today copy that says
plainly that anything logged goes to that day.

⚠ **The lesson: fixing a copy-vs-data-source mismatch on one surface does not fix
its siblings.** Grep for the claim, not the component.

#### 🔴 THE THIRD ROUTE INTO AN ALLERGEN WIPE — found by Brad, on device

He asked why the wizard has no Cancel, only a Skip. The missing button and a
data-loss bug were the same defect, and this one is reachable in **normal use**:

1. `useMealprintEntry` reads preferences **cache-only** (deliberate — an eager fetch
   on the Fuel tab was part of the launch fan-out).
2. So on a reinstall / new device / sign-out-in, `data === null` → the card reports
   `needsSetup` → it opens the **wizard**.
3. The wizard's container *does* fetch, succeeds, and seeds the form with the user's
   real allergen list — so `isUnseeded` is **false**.
4. Dismiss fell through to `commit(DEFAULT_MEALPRINT_PREFERENCES)`. One tap on the
   only exit offered, allergens gone.

⚠ **`isUnseeded` cannot catch this, because the read SUCCEEDED.** The earlier 🔴 was
this wipe via a *failed* read. So the guard is not "did we read the row" but
**"does the row contain anything worth keeping"** — `hasSavedChoices`
(`data !== null && data.isDefault !== true`). Dismiss now leaves without writing
whenever there are saved choices.

⚠ **The write still happens on a genuine first run, and must.** AC 1.4: persisting
the skip is what flips `isDefault` and stops the card re-offering the wizard forever.
Not writing when choices exist is safe precisely because `isDefault` is already
false there.

**The label follows the behaviour** (`dismissLabel`, container-supplied, NOT derived
from `mode`): "Skip" only on a genuine first run, "Cancel" otherwise. So does the
intro copy — "or skip it entirely" would promise to discard what is now kept.
Both verified on device.

**The generalisable lesson:** three separate routes have now produced the same
allergen wipe, and each guard was written against the route that had just been
found. A destructive default is not made safe by guarding the path you noticed —
`PUT /nutrition/preferences` is a full last-write-wins replacement, so **every**
exit from that form is a candidate wipe until proven otherwise.

#### ⚠ Nine review findings across THREE Inspector Brad sweeps. One was serious.

| # | Finding | Where |
| --- | --- | --- |
| 🔴 | A failed preferences GET turned the wizard's **Skip into a delete button** | `MealprintPreferencesContainer` |
| 🟠 | `labelCheckRequired` defaulted false → suggestions with no disclaimer | suggest container |
| 🟠 | The server's `partialEnforcementOnly` had no reader at all | suggest container/presenter |
| 🟠 | `reset()` left `inFlightRef` set with no signal → dead Generate button | `useMealSuggest` |
| 🟠 | …and the FIX to that left `lastInputRef` nulled → dead retry (2nd sweep) | `useMealSuggest` |
| 🟡 | `summarisePreferences` threw on an unknown `effortLevel` mid-render | `models/mealprint.ts` |
| 🟠 | …and the FIX to *that* was committed with no test, the count unchanged (3rd sweep) | `useMealprintHooks.test.tsx` |
| 🟢 ×2 | A test comment promising an absent assertion; a docstring describing an unreachable path | — |

**The 🔴 is the one to remember.** `PUT /nutrition/preferences` is a full
last-write-wins replacement and the form renders empty defaults until it is
seeded — so on a device with an empty cache (reinstall, new device, sign-out/in) a
failed read left the whole form live with four empty arrays in it. And that is the
DEFAULT path: an empty cache makes `useMealprintEntry` report `needsSetup`, so the
first thing a reinstalled device does is open the wizard. Skip then queued a write
that deleted the user's allergen list, dietary pattern and both free-text lists,
silently. Fixed in two places deliberately (`commit()` refuses an unseeded write;
the presenter replaces the whole form with a retry panel), because the general
lesson is that **a seed latch protects the FORM from a late fetch and protects
nothing at all from an unseeded write — those are two guards, not one.**

Second lesson, from the pair of `useMealSuggest` findings: when a guard says "this
in-flight request still owns the state", it owns ALL of it. Fixing the stage and
leaving the input was half a decision, and half a decision read as a whole one is
how the second sweep found a bug the first sweep's fix created.

⚠ **Third lesson, and the cheapest one to repeat: a `cd` inside a compound command
can fail and silently skip everything `&&`-chained after it.** The fix commit
claimed a regression test it did not contain — the edit never ran, and jest going
green on the UNCHANGED file read as confirmation. A third sweep caught it (suite
count identical at both commits, which is the tell). The test now exists and was
verified BOTH ways: passing with the guard, failing with 1 call where 2 are
expected without it. **Verify a test by making it fail on purpose, not by watching
it pass.**

#### Backend, for reference — MERGED 2026-08-03 (PR #350, `d1c40b30`)

**Phase 0 (0.1–0.5) + Phase 1 (1.1–1.4) + the `meal_ai` gate + infra config are on
`main`.** 6 commits squashed; all 5 CI checks green. Staging deploy fired on merge,
which auto-applies the three migrations there.

Nothing is user-reachable: `premium_plus` is `is_active = false`,
`mealprint_access` is granted to that tier only, and no client calls the endpoints.

**Endpoints:** `GET`/`PUT /nutrition/preferences` (404-free, returns defaults) and
`POST /nutrition/ai/meal-suggest` (auth → `meal_ai` 402 → ceiling 429 → pipeline).
`AI_MEAL_SUGGEST_DAILY_LIMIT` = 20/day, `AI_MEAL_MODEL_ID` Haiku-class, both
registered in `infra/api.ts`. Mounted inside `nutritionRoutes` — the root chain in
`api.ts` is at TS's TS2589 ceiling.

**⚠ THE OFF RE-SEED IS OUTSTANDING AND THE FEATURE LOOKS BROKEN WITHOUT IT.** The
tag columns are NULL on all ~144k seeded rows, and `avoidanceFilter` treats a NULL
`allergen_tags` as unknown-and-unsafe — so every curated food is excluded from any
allergen-filtered pool. Brad's job; recipe is in the migration header AND
`seedOpenFoodFacts.ts`. ⚠ Release FIRST, then seed: the script writes
`allergen_tags` and 42703s before the migration lands.

#### ⚠ `mealprint_access` diverges from `loadout_access` — Brad review pending

`loadout_access` = Premium+ **and all three trainer tiers**; `mealprint_access` =
**Premium+ only** (no coach surface in v1; `individual_trainer` is already the most
cost-exposed tier). This is the subject of the open pricing gate above — do not
flip `is_active` until it is settled.

⚠ It also forced a fix the existing code did not anticipate: `pickUpgradeTier`
returned `individual_trainer` for a `personal_trainer` BEFORE looking at the
feature, so a coach denied `meal_ai` would have been upsold a £14.99 tier that
still locks them out. Hence `PREMIUM_PLUS_ONLY_FEATURES`, checked before the role
branch.

#### ⚠ `avoidanceFilter` took FOUR review passes and 23 findings. Read this before touching it.

It is a CLAUDE.md dangerous area and the review history is the documentation:

| pass | findings | commit |
| --- | --- | --- |
| Sweep 1 | 4 ways a restricted eater could be served an excluded food | `52b93df0` |
| Sweep 2 | 9 | `a389968e` |
| Verification | 4 (1 🔴) | `141e5c57` |
| Verification, fresh inspector | 6 (2 🟠) | `501d6a86` |

**Every pass found the previous fix incomplete, and passes 3 and 4 each found that
the FIX was the new defect.** The two general lessons:

1. **An allergen tag's SILENCE is not evidence about an axis it was never about.**
   Three successive gates (`allergenTags === null`, `tagsUsable`, "did it make a
   complete `[]` claim") all leaked, because all three asked the wrong question.
   The pattern name channel is now **unconditional**; false positives are held off
   by POSITIVE evidence only — `negators`, `clearedBy`, `tokenQualifiers`.
2. **⚠ OFF's `categories_tags` is HIERARCHICAL and that cuts both ways.** It is why
   a vegan cheese carries `en:vegan-cheeses` AND `en:cheeses` — and why
   `en:plant-based-foods` is an ancestor of breads/pastas/sauces. Letting any
   marker-bearing tag clear an axis served an **All Butter Croissant** to a
   dairy-free user. A marker now only clears an axis when its tag is ABOUT that
   axis (matches the axis' `categorySubstrings` OR its `tokens`).
3. **Qualifier DIRECTION is a property of the entry, not the rule.** Preceding-only
   breaks `Red Kidney Beans` (qualifier is the head noun that follows); either-side
   breaks `Maliban Butter Coconut Biscuits` (trailing co-ingredient). Hence
   `{ before?, after? }`, with `kidney` the lone `after`.

⚠ **NO finding in any pass was allergen-grade.** The allergen chip path is
tag-derived, fails closed, and was verified still to do so on every leaking product.
Everything above is the PATTERN channel.

⚠ **218 tests, and green gates prove nothing here.** Each pass's tests pinned the
cases its fix was written for; the next pass's findings were all outside them.
**Verify a change by RUNNING `assessAvoidance` against real UK product names**, not
by reading it — that is what caught every one of the 23.

#### Accepted residuals, tested and documented

- `Alpro Soya Chocolate Milk Drink` excluded for `dairy_free` (qualifier 3 tokens
  away). Both inspectors agreed; UK labelling law forbids "milk" on plant products
  so the en-GB slice says "Oat Drink" anyway.
- `Egg Fried Rice Noodle Box` — genuinely ambiguous, no direction rule fixes it.
- `Shepherd's Pie` needs the possessive-"s" skip in `everyOccurrenceQualified`.

#### Chipped follow-ups

- ✅ DONE in the mobile slice: the label-check copy renders on `labelCheckRequired`,
  never on `containsUnverified` — and defaults to `true` when a result omits the
  field, because `suggestMeals` is an unvalidated cast over the wire.
- Recall gaps are inherent to a name-token heuristic; they shrink as the re-seed
  populates category tags.

#### What is left before a user can reach Mealprint

1. **Raise the PR** for `claude/mealprint-mobile-ui-9347a0` (not done — Brad's
   call whether to review the commits as-is or squash).

   ⚠ **The PR body must state plainly which surfaces have executed and which have
   not.** The ungated half is now device-verified (see § What IS device-verified);
   the **entire entitled half has still never run**. A clean sweep line is true and
   does NOT mean the feature works — and the two things most likely to be wrong are
   still exactly the two static review cannot reach: the draft stage's pinned confirm
   inside gorhom, and the `no_candidates` path, which is the FIRST thing a real
   entitled user will see until the re-seed lands.

2. **Write the staging entitlement row.** ⚠ Read the trigger warning above first —
   this demotes `personal_trainer` and `admin` to `'user'`. Blocked on connector
   access. The write, once the account question is settled:

   ```sql
   -- 0. VERIFY (staging nxkhlrvjxotyjulodxzk — NOT prod opcvjypsoivaxerahbal)
   select tier_name, is_active, mealprint_access, is_trainer_tier
     from subscription_tiers where tier_name = 'premium_plus';
   -- expect mealprint_access = true (migration 20260803120200, auto-applied on
   -- merge to main). If false, the gate denies with no useful error.

   select p.id, p.role, s.id as sub_id, s.tier_name, s.payment_status
     from profiles p
     left join user_subscriptions s
       on s.user_id = p.id
      and s.payment_status in ('active','pending','trialing','past_due')
    where p.email = '<the staging account>';
   -- ⚠ If a LIVE row exists, UPDATE it. A second INSERT violates
   -- `user_subscriptions_active_unique` (one live sub per user).

   -- 1a. No live row → insert
   insert into user_subscriptions (user_id, tier_name, payment_status, starts_at)
   values ('<uuid>', 'premium_plus', 'active', now());

   -- 1b. Live row exists → switch it (records what it was, so it can be put back)
   update user_subscriptions
      set tier_name = 'premium_plus', payment_status = 'active',
          metadata = coalesce(metadata,'{}'::jsonb)
                     || jsonb_build_object('device_qa_prev_tier', tier_name)
    where user_id = '<uuid>'
      and payment_status in ('active','pending','trialing','past_due');
   ```

   Then verify by calling `GET /subscriptions/me` as that user and checking
   `tierName` comes back `premium_plus`. **A row that exists but does not resolve is
   the failure mode to look for.** Reversible: restore `tier_name` from
   `metadata.device_qa_prev_tier` and the trigger restores the role.

3. **The OFF re-seed.** Brad's, operational. Until it runs, every allergen chip
   empties the candidate pool and the sheet correctly answers
   `emptyReason: "no_candidates"`. QA the happy path with NO allergen chips.
4. **Finish the device pass** on the entitled half once 2 lands — the suggest
   sheet's six stages, and above all the draft stage's pinned confirm inside gorhom.
   Also worth a look with a SOFTWARE keyboard (disable Connect Hardware Keyboard in
   the simulator's I/O menu): the wizard's KeyboardAvoidingView fix is unverified.
5. **The coach/Premium+ pricing decision** still gates T-P0.10 and therefore
   `is_active`. Unchanged by this slice.

## Superseded state (2026-07-31)

- **⚠ APP STORE: build 1.0 (39) REJECTED under Guideline 4 (Design)** — the Sign
  in with Apple button used app-drawn logo artwork. Fixed on **PR
  [#340](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/340)**
  (`claude/signin-apple-design-fix-78rvv9`, see § Last session). Needs a new
  build + resubmission once merged.
- **⚠ PR #337 is MERGED but UNRELEASED — production still has the SQLSTATE 23514
  session-rating bug.** `c8a0b6d` sits above the latest tag
  `persistence-v1.10.0` (`1ad9caa`). Shipping it needs a release PR + prod
  deploy. An Apple reviewer tripped a production Sentry error on 2026-07-30
  22:26 UTC while prod was unpatched; whether it is this error is UNVERIFIED
  (Sentry connector was down — see § Last session).
- **Sentry production hotfix — MERGED to `main` 2026-07-30 as `c8a0b6d`
  (PR #337), NOT yet in any release tag.** The shipped
  mobile app asks only for a 1–10 difficulty rating but serializes it into both
  `sessionRating` and `difficultyRanking`; production's legacy
  `session_rating` column has a 1–5 check, causing SQLSTATE 23514 for answers
  6–10. All backend session record paths now persist only
  `difficulty_ranking`; `sessionRating` remains a deprecated 1–10 wire alias
  for installed clients. The PATCH path normalizes the alias too. No migration
  or mobile rebuild is required. Verified with a sensitive repository
  regression test, 71 focused tests, prettier, forced typecheck, lint, build,
  and forced full unit suite (19/19 tasks).
- **Loadout Phase 2's SCREENS + Phase 3's scan — MERGED via PR
  [#339](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/339)**
  (2026-08-02, off `main` @ `c7ad458`). Supersedes **#328**, which should be
  closed; the mirror branch `claude/pr-339-review-ci-7f7ydu` is stale too.
  Inspector Brad **clean @ `61698f8`** after 6 sweeps / 22 findings, all 5 CI
  checks green, 1 × 🟢 chipped (replace-path parent-404 gets the saved-setup
  copy — the mirror of a create-path nuance already fixed; the clean fix is a
  distinct `PARENT_NOT_FOUND` backend code, which also deletes the `isReplace`
  param).
  - **⚠ NEXT ACTION: the post-merge staging deploy is the first time the mobile
    client and the API agree — re-run the device pass once it lands.** Until
    #339, `PUT /workouts/:parentId/variations/:variationId` did not exist on
    staging at all, so every device run to date tested a mismatched pair. See
    § Loadout (spec-21) for the full feature status.
  - **⚠ The first cut of #339 was rebased from a STALE snapshot of #328 and
    silently dropped `edeb93f`'s fixes** — five files' changes were missing
    entirely (`exercisesSubstitutesHandler` + its test, `exerciseRepository` +
    `exerciseRepositoryLoadout.test.ts`, `.env.example`) along with three
    in-file guards in `LoadoutFlowContainer` (`saveRunRef`, `gymCreateKey`, the
    undecided-`intensity_mismatch` drop filter). **The CI failure was NOT the
    only problem, and the green-after-one-fix state was misleading**: the
    typecheck error was real but shallow, and fixing it alone would have merged
    a PR missing eight Inspector-Brad fixes. The branch was rebuilt from
    `edeb93f`'s content onto `c8a0b6d` instead. **LESSON: when a PR is "a
    rebase of another PR", diff the two branches' CONTENT — a green pipeline
    says nothing about whether the rebase captured the source branch's head.**
  - **The load-bearing loss was `EMPTY_EQUIPMENT_CONTEXT`** on the create AND
    replace variation handlers. Without it an empty kit left
    `containmentContext.length > 0` false, so **equipment containment was
    SKIPPED entirely and `EQUIPMENT_NOT_AVAILABLE` could never fire** — any
    exercise saveable against any kit, i.e. the guard the whole review step
    exists to enforce, silently absent. It would have merged looking green.
  - The 2026-07-30 CI failure itself was a real merge-state type error: current
    `main` removed the Stripe `Adapters.payments` rail, while five Loadout-only
    test fixtures still supplied it. Those stale fixture properties are removed.
  - **Gates after merging current `main`:** forced typecheck 8/8, build 13/13,
    forced full-workspace unit tests, full mobile test 466 suites / 5,528 tests,
    focused affected mobile suites 5/5 (150 tests), focused backend 90 tests,
    tracked-file Prettier/diff checks clean, and mobile/core ESLint zero errors.
    Whole-tree Prettier/lint remain blocked only by unrelated untracked
    `.agents/skills/sst-resource-change/SKILL.md` and
    `microservices/core/probe-steps.ts` (four `no-explicit-any` errors).
  - **Local Inspector Brad follow-up:** the first sweep found and this branch now
    fixes eight edge cases: Loadout is available on every readable parent
    (AC-1.2), undecided intensity mismatches are actually dropped, swap search
    covers the visibility-scoped pool and reports slicing, explicit empty kit
    snapshots 400 on create/replace, stale gym-create/save completions cannot
    mutate a newer flow, workout-A variations never paint under workout B, and
    failed saved-gym deletes show an actionable error. The locked-card tests now
    wait for their async entitlement verdict before pressing, removing the one
    full-suite timing failure exposed under parallel load. A second sweep found
    and this branch now fixes three more boundary cases: saved-gym creation is
    keyed by name as well as kit, substitute name search runs server-side before
    the 400-row cap, and create/replace reject every empty equipment context
    (including omitted snapshots and empty saved gyms). The final closed sweep
    also aligned punctuation tokenisation across the picker and repository
    (`bench-press` remains visible after the debounced response) and returned
    `INSPECTOR_VERDICT: CLEAN`.
  - The local Claude agent (`~/.claude/agents/inspector-brad.md`), Codex agent
    (`~/.codex/agents/inspector-brad.toml`) and manual GitHub workflow
    (`.github/workflows/claude-review.yml`) use the same impact-graph review
    contract. The CI action remains human-triggered only; Codex did not fire it.
  **NOT device-verified** — that is the review Brad asked for and it needs an EAS
  dev build against staging. The PR body carries a ~40-item checklist. This is the
  first user-reachable Loadout surface.
  - ⚠ An entitled test account needs a RevenueCat **promotional entitlement** —
    `premium_plus` is still `is_active = false`, so there is no purchasable card.
- **2026-07-30 follow-ups (originally `b9bdeba7` on #328) are carried in #339's
  squashed commit.** Saved setup
  detail now offers **Re-adapt** against the
  ROOT workout; `PUT /workouts/:parentId/variations/:variationId` atomically
  replaces the owned variation's metadata + exercise rows while preserving its
  id, `created_at` and session history. Every save freezes the server-resolved
  equipment snapshot. Variation summaries include the linked gym's current kit,
  so exact set comparison can flag equipment additions/removals (order and
  duplicates ignored). Review exercise names push the normal exercise-detail
  page without losing flow state. Workout detail itself is now a normal pushed
  page; temporary filters, create/edit and active-session steps remain
  intentionally modal.
  - **Gates:** typecheck 8/8, build 13/13, full test 19/19 (mobile 467 suites /
    5,561 tests), focused backend 128 tests and focused mobile 256 tests. New
    replacement handler: 100% lines/statements/functions, 97.77% branches.
    Changed-file Prettier + ESLint are clean. Whole-tree Prettier/lint are
    blocked only by unrelated untracked `.agents/skills/sst-resource-change/SKILL.md`
    and `microservices/core/probe-steps.ts` (four `no-explicit-any` errors).
  - **Visual pass:** current staging simulator workout detail remains correctly
    laid out as a pushed page. Re-adapt, gym-change and review drill-in states
    are covered by presenter/container render tests; the OS custom-scheme
    confirmation prevented non-interactive navigation into the saved variation
    for an additional device screenshot.
- **Last CODE change on `origin/main` = `f0e8929`** (PR #326, Loadout **Phase 3
  equipment scan + Phase 2 foundation**, merged 2026-07-27, branch deleted). Released
  to production: **v1.8.0**.
  - Stated as the last code change rather than the literal `HEAD`, because a
    ledger update is itself a commit — quoting the head sha here guarantees this
    line is one commit stale the moment it lands. `git log --oneline -20` is the
    authority for the head; this line tells you what the last SUBSTANTIVE change
    was, which is the thing worth knowing.
- **⚠ Production is one release behind `main`, and the gap is now much bigger
  than migrations.** Open release PR
  **[#319](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/319)
  (v1.9.0)** is the only thing that ships it. Merging it publishes the release;
  the prod deploy then migrates and deploys.
  - **Migrations pending on prod: exactly Loadout Phase 0's four.**
    `20260720230030_data_sharing_consents.sql` also shows in the diff but is
    ALREADY applied (present at tag `persistence-v1.8.0`); only its comment header
    changed in #317, and `supabase db push` keys on version, not content, so it
    will not re-run. **Phase 1 added NO migration.**
  - **⚠ #319 now also carries Loadout Phase 1's engine and its two new
    endpoints** (`POST /workouts/:id/loadout/preview`,
    `GET /exercises/substitutes`), plus Phase E's eval scripts. It stopped being
    "the Phase 0 migration carrier" the moment #322 merged. Nothing on it is
    user-reachable — no mobile surface calls either endpoint yet, and `loadout`
    is gated on `premium_plus`, which is seeded `is_active = false` — but the
    Lambda will be serving them.
  - ~~**⚠ Phase 1's model path needs Haiku 4.5 in the PRODUCTION Bedrock
    account.**~~ **RESOLVED — Brad confirmed both model ids granted and complete in
    prod, 2026-07-27** (§ Ops / launch).
- `premium_plus` / `loadout_access` **are** already on prod (verified present at
  tag `persistence-v1.8.0`). The tier row is deliberately `is_active = false`.
- Feature state: coach mode complete; spec-19 Programs shipped; nutrition (incl.
  Snap AI) shipped; consent (spec-28) + read-audit shipped; coach↔client
  offboarding shipped; **Loadout Phase 0 (data model), Phase E (eval) and
  Phase 1 (adaptation engine) are ALL MERGED to `main`. Phase 2 (mobile athlete
  flow, with the Phase 3 scan inside it) is next** — it needs the design handoff
  at `~/Downloads/Any Gym/project/`.
- **Loadout's athlete flow is now COMPLETE end to end on the branch above** —
  entry card, collect, scan, manual picker, adapting, review with per-row swap,
  save / save-and-start, success, and saved-gym management in Profile. What
  remains before it is real: merge, and a device pass.
- **On `main`, Loadout is BACKEND-COMPLETE for the single-workout athlete flow,
  INCLUDING the equipment scan, and still has ZERO user-facing surface.** Phase 2's foundation
  (ports/adapters, the pure review-copy + save-path logic, the step machine) is
  **MERGED to `main`** (#326), but **no screen exists**, so nothing in
  `packages/mobile` yet calls the preview, the substitutes feed or the scan. The
  screens (T-2.2…T-2.9, T-3.4) are what make the feature exist for a user, and they
  are the NEXT slice — to be reviewed in a local dev build against the staging
  backend (Brad, 2026-07-27).

### Releasing an additive migration alongside an OFF re-seed — checked 2026-08-03

Brad asked, before releasing spec-26's three migrations to production, whether the
**already-shipped mobile build** would break. It does not, and the reasoning
generalises to any future additive migration, so it is recorded rather than
re-derived:

1. **Additive DDL is safe under migrate-then-deploy.** `production-deploy.yml`
   migrates BEFORE `sst deploy`, so the previous release's Lambda briefly serves
   against the new schema. `ADD COLUMN` / `CREATE TABLE` / `CREATE INDEX` are all
   fine there. A drop or rename is NOT, and still needs expand/contract across two
   releases.
2. **Drizzle's bare `select()` expands from the caller's OWN `schema.ts`,** so an
   old Lambda never names a column it does not know about. This is why the window
   is safe in the forward direction — and why the REVERSE (new code, old database)
   is the dangerous one.
3. **⚠ The wire shape is what actually matters to a shipped app, and an explicit
   DTO mapper is what protects it.** All four `foods` reads are bare `select()`, so
   the three new tag columns would have started appearing in API responses — except
   `toFoodDTO` maps field by field and does not include them. Every
   `subscription_tiers` read projects explicitly too, and `listActive()` omits
   `mealprint_access`. **When adding a column, grep for the DTO mapper, not just
   the query.**
4. **Denormalised macros are why a re-seed cannot rewrite history.**
   `nutrition_entries` stores `kcal`/`protein_g`/`carbs_g`/`fat_g` at write time,
   and `recipes`/`meals` totals are materialised on write — so refreshing ~144k
   catalogue rows from a newer OFF dump does not retroactively change anyone's
   logged days.

⚠ **ORDER: release first, then re-seed.** The seed script writes `allergen_tags`,
so running it before the migration lands fails with Postgres 42703 on every batch.
Harmless but wasted.

💡 A re-seed is not a novel operation — the daily OFF delta cron already upserts
these rows through the same code path. And if the cron fires mid-backfill from the
OLD Lambda, its `onConflictDoUpdate` set does not list the tag columns, so it
cannot null out work in progress.

## Verified facts

- SST 3.19.3 (Ion). Workspaces: `packages/` (api-utils, db, mobile, seed, web) +
  `microservices/core`.
- **Database is Supabase Postgres reached with `postgres.js` over TCP** — NOT
  Neon, NOT `neon-http` (that driver speaks Neon's proprietary HTTP protocol and
  produced opaque 500s here; never reintroduce it). Transaction-mode pooler on
  **:6543**, `prepare: false` mandatory for pgbouncer.
- Supabase projects: staging `nxkhlrvjxotyjulodxzk`, prod `opcvjypsoivaxerahbal`.
  (The old `dfeyebgdktfteqlacmru` is dead and 401s.)
- **Production migrations are AUTOMATIC**: `production-deploy.yml` runs
  `supabase db push --linked` (after a `--dry-run`) on `release: published`, and
  migrates **before** `sst deploy`. Do not hand-apply. Staging auto-applies on
  merge. ⚠ Migrate-then-deploy is only safe for **additive** migrations — a
  drop/rename leaves the old Lambda on the new schema for the deploy window and
  needs expand/contract across two releases.
- AWS profiles: `ess-dev` (dev/staging), `ess-prod` (production), both via the
  `ess-dev` SSO session. Dev account `111315405717`, prod `465891279888`.
- **Bedrock model access is PER-ACCOUNT and PER-MODEL.** Haiku 4.5 and Opus 4.6
  are granted in both; **Opus 5 is UNGRANTED in prod**. Staging green says nothing
  about prod. `eu.anthropic.claude-opus-4-6-v1` looks malformed (no `:0`) but is
  valid. **Never use a `global.` inference profile** — it routes outside the EU
  and breaks the DPIA's data-residency commitment.
- Mobile env source of truth = `packages/mobile/eas.json` `build.*.env`.
- Legacy mobile app (the port reference) at sibling path `../persistence-mobile/`.
- Slack progress channel `#brad-claude-agents` = `C0ATYL6T11V`.
- `specs/milestones/ROADMAP.md` § Phase status lags. This file + `git log` win.

## Active gotchas — these will bite

- **Turbo caches `typecheck` AND `test:unit`.** `supabase/migrations/**` is not an
  input to `@persistence/core#test:unit`, so editing a migration leaves a stale
  green. Run `TURBO_FORCE=true` on both before pushing. Cost two red CI runs.
- **The staging deploy runs `prettier --check .` over the whole tree**; the PR
  prettier job is change-scoped only. A green PR does not mean a green deploy.
- **`bun run test:unit` is NOT a typecheck.** Run `tsc` separately, always.
- **Never interpolate a JS array before a `::uuid[]` cast in a Drizzle `sql`
  template.** ``sql`${ids}::uuid[]` `` renders `($1, $2)` — a Postgres ROW
  constructor — and dies at execution: `cannot cast type record to uuid[]` with
  2+ ids, `malformed array literal` with one. Use the `uuidArray()` helper in
  `exerciseRepository.ts` (`ARRAY[$1, $2]::uuid[]`, still one placeholder per
  id). This 500'd Loadout's preview on device 2026-07-28, and two of the four
  call sites had carried the bug since 2026-04-20 without anyone noticing —
  the mobile exercise library filters locally from its SQLite cache and never
  sends `targeted_muscles_any`/`equipment_any`, so nothing had executed them.
  **A green render test is not proof:** `exerciseRepositoryLoadout.test.ts` had
  rendered the SQL via `PgDialect` and asserted the *broken* shape, pinning it.
  `exerciseRepositoryArrayPredicates.test.ts` now bans the paren form
  mechanically and exercises both arities.
- **`equipment_types.description` is in `schema.ts` but NOT in the live DB.** A
  bare `select()` 500s. Project columns explicitly. Same class of drift:
  `listActive()` on `subscription_tiers` must omit young columns.
- **`assertEntitlement`'s catch-all** — `if (feature !== "create_workout") return
  { allowed: true }` — means any new feature name added without an explicit
  routing line **silently allows everyone**, with no type error.
- **A Bedrock failure is logged nowhere**, and both AI surfaces collapse every
  non-429 error into "Couldn't estimate that — try rephrasing"
  (`QuickAddSheetContainer.tsx:267`, `SnapAISheetContainer.tsx:100`). If AI
  "mysteriously stops working", that is why. The fix exists on the **closed**
  branch `claude/ai-model-preflight` (HEAD `844fd01`, deliberately unmerged per
  Brad) — cherry-pick it, don't rebuild it.
- **`@persistence/core#test:unit` flakes under parallel load** — `returns 401 when
  unauthenticated` tests in `application/nutrition/ai/*` time out at vitest's
  5000 ms. Passes in isolation (99/99). Re-run a single-suite failure alone before
  chasing it.
- **`packages/web`'s Eden `treaty<CoreApi>` sits at TS's instantiation ceiling** —
  backend route changes can flip TS2589/TS2578 in web with no web file touched.
  Run a full-workspace typecheck.
- **Reusing a parameterised `sql` expression in SELECT + GROUP BY** gives
  different bind slots → Postgres 42803. Group by ordinal.
- **The mocked-`getDb` blind spot**: unit tests mock the DB, so SQL bugs ship
  green. Render the real `WHERE`/projection via `PgDialect` in a test.
- **⚠ A literal U+0000 in a `.tsx` file passes EVERY gate and breaks git.**
  Prettier, ESLint, Babel and `tsc` all accept it; git's binary heuristic then
  reports the file as `Bin 0 -> N bytes`, GitHub renders it as "Binary file not
  shown", and it cannot be 3-way merged or rebased. One reached a commit on the
  Phase 2 branch (an array-separator string) and only Inspector Brad caught it.
  Check with `file <path>` — "data" instead of "text" is the tell.
- **⚠ A NEW heavy container test suite needs `jest.setTimeout(15_000)`/`(20_000)`,
  and CI is where you find out.** Nine existing suites already set it
  (`ProfileContainer`, `ExerciseListContainer`, `SubscriptionSelectionContainer`…)
  because a case that mounts the real Tamagui provider + a React Query client +
  gorhom sheets costs ~200 ms locally and ~7× that on a runner sharing itself with
  459 other suites — past jest's 5 s DEFAULT. **The tell is the SUITE's duration,
  not "it passes in isolation"**: Loadout Phase 2's flow suite was 7.6 s locally
  and 50.76 s on CI. Two red runs were spent chasing individual tests before
  reading that number.
- **⚠ Testing Library's `fireEvent.press` honours `accessibilityState.disabled`,
  the device honours the `disabled` prop.** So a component carrying both — which
  it should — will always report one of them as a SURVIVING mutant, because each
  covers for the other in exactly one environment. Annotate rather than chase, and
  do not "simplify" by deleting one.
- **A store action named `use*` trips `react-hooks/rules-of-hooks` at every call
  site** ("cannot be called inside a callback"). `loadout-flow`'s were renamed
  `selectGym` / `selectEquipmentIds` for this. Don't name zustand actions `useX`.
- **Worktree cwd drifts mid-session** and edits land on the wrong branch. Prefix
  every tool path with the worktree path; re-check `pwd`. Never `git checkout --`
  a file with uncommitted work.

## Lessons learned

### ⚠ `bunx vitest` at the repo ROOT silently installs the LATEST vitest and invents failures

2026-08-04, and it cost a false bug report to Brad. There is **no `vitest` in the root
`package.json`** — it lives in the workspace packages (`scripts`, `microservices/core`,
`packages/web`, …), pinned at **2.1.9**. So `bunx vitest run scripts/__tests__/...` from
the root resolves vitest from the registry and runs **4.1.10**.

Vitest 4 changed how `new`-ing a mock behaves: it now CONSTRUCTS the implementation, so
`mockImplementation(() => ({...}))` on an arrow function throws *"is not a constructor"*.
`reconcile-stripe.test.ts` uses exactly that shape for `new Stripe(key)`, so **3 tests
"failed"** — and I reported them to Brad as a pre-existing regression in a script that
guards against DB errors being silently reported as COMMITTED.

**They were never broken.** Under the project's own runner all 116 pass:

```bash
cd scripts && bun run test:unit
```

⇒ **Always run a workspace's OWN test command** (`bun run test:unit`, or
`turbo run test:unit` from the root). If you reach for `bunx vitest`, you are testing
against a version this repo has never used. A second tell was there and I ignored it:
the first run printed *"Resolving dependencies / Saved lockfile"*, which a pinned local
binary would never do.

Related trap: `bunx vitest run scripts/__tests__/` also collects a duplicate copy from a
stale worktree at `.claude/worktrees/adoring-morse-78ba5f/`, so the same failure appears
twice and looks like six.

- **Commit with explicit pathspecs and inspect `git diff --cached --name-only`.**
  `git commit` takes the whole index — pre-staged WIP rides along (caused #159;
  nearly swept Brad's untracked `docs/app-store/` + `marketing/` twice since).
- **Mutation-test every new guard — it is the only thing that catches a test that
  cannot fail.** Repeat offenders: asserting a property of your own mock;
  asserting the mock's return instead of the SQL projection; using an error shape
  the driver never produces; an assertion both branches satisfy.
- **A default standing in for "not applicable" is a value that cannot fail.** An
  eval metric returned `1` for plans with nothing to measure and was averaged in,
  misstating three published figures. Use `null`.
- **When catching a Postgres error by SQLSTATE, walk `.cause`** — Drizzle puts the
  code there, not on the thrown error. A duplicate-name 500'd instead of 409'ing.
- **If a doc quotes a measurement, ship the command that regenerates it.**
  Hand-derived figures drift from the data (a cost table used the wrong
  denominator).
- **Deciding a spec question means sweeping every doc that assumed the old
  answer** — flipping D7 left five surviving contradictions, the worst in the
  section another spec mirrors. Grep for the old premise; don't just add the new
  section.
- **When de-claiming a feature, trace every channel it reaches the user through**
  — the same string lived in an unreachable code branch, hardcoded JSX, and a
  seeded DB `description` column that TypeScript cannot reach.
- **Don't take a single Inspector Brad sweep at face value on a "this doesn't
  exist" claim** — grep for the endpoint. One sweep wrongly flagged a shipped
  feature as unbuilt.
- **Cap Inspector Brad at two sweeps + one CLOSED verification pass** ("confirm
  these N items, findings only"). Five open-ended sweeps on one PR burned a large
  share of a context window.
- **"Passes in isolation" diagnoses nothing on its own.** It is true of a
  load-sensitive assertion, a suite over its time budget, AND a genuine race —
  so it cannot distinguish them, and treating it as an all-clear cost two red CI
  runs on the Phase 2 PR. Both real causes were only visible in numbers next to
  it: a two-round-trip chain racing `waitFor`'s 1 s default (which was hiding a
  real UX wart — a deleted row reappearing until the server answered), and a
  suite at 50 s on CI versus 7.6 s locally.
- **A mutation surviving has three possible causes, and only one is a test gap.**
  Either the test is missing (write it), or the branch is genuinely dead (delete
  it), or two layers legitimately guard different channels (annotate it). The
  Phase 2 sweep hit all three; guessing wrong in either direction costs real
  quality — a test that cannot fail, or a deleted safety net.
- **Ask recon agents for conclusions with `file:line` pointers**, not quoted code.

## Open items

### DECIDED by Brad 2026-07-27 — Loadout Phase 1. Do not re-raise.

Swept through code, `infra/api.ts`, `requirements.md` AC-10.2 and `tasks.md`
T-1.9 — no doc still describes these as open.

- **Re-map daily ceiling = 30/day.** `AI_LOADOUT_REMAP_DAILY_LIMIT` is no longer a
  placeholder. At $0.0057/adaptation that is ~$0.51/user/month at realistic use and
  ~$5.13 if an abuser consumes the lot, against £29.99 — abuse control, not unit
  economics, and deliberately generous because the bad failure is a real athlete
  hitting it mid-session.
- **Re-map retry = keep `createWithRetry`** (12 s × 2). The retry path is only
  reached after an actual first failure, where a ~24 s worst case beats failing
  outright. ⚠ **NOT abandoned:** the single ~20 s attempt still has to be built for
  the scan (T-E1.6), and this decision can be revisited once that harness exists
  and is measured.
- **A Bedrock failure stays a 503** — no silent fallback to the § 6.2 ranker.
  Ranker-only output is what the bake-off rejected 4-50 (`Barbell Deadlift → Atlas
  Stones` in a bands-only context), so a visible outage beats a quietly worse plan
  under a Premium+ badge.
- **Equipment-scan ceiling = 6/day** (Claude recommended, Brad accepted
  2026-07-27 — "go with your recommendation, calculated against all costs from one
  user vs their subscription"). NOT design § 8.1's proposed 10, and the 10's
  reasoning was the flaw: it was analogised from Mealprint's daily-use surfaces,
  but **a scan is a once-per-GYM action** because `saved_gyms` persists it. At
  $0.0272/scan, 6/day is ~$4.90/user/mo worst case — parity with the re-map's
  $5.13, so both Premium+ AI surfaces together are ~$10/mo against ~$32 net.
  10/day would have been $8.16 for one endpoint. The asymmetry with the re-map's
  30 is deliberate: hitting this cap blocks no workout (AC-2.1/AC-2.2 are the
  floor, not fallbacks), whereas the re-map has no alternative path. Revisit if
  § 8.1's 640 px downscale is ever measured.

### ⚠ OPEN BRAD DECISION, GATES PRODUCTION — how coaches get Premium+ (2026-08-03)

**Brad, 2026-08-03: "premium plus needs reviewing on how we give it to coaches,
alongside the ability to train as we have a bit of a pricing dilemma here (maybe
we sell it as a way to upgrade their membership), but before we go live in
production with this, we need review this approach."**

A **go-live gate**, not a background nicety — and it must be decided as ONE
question rather than per-feature, because the two adaptive-suite flags currently
answer it in opposite directions:

| flag | premium_plus | trainer tiers | decided by |
| --- | --- | --- | --- |
| `loadout_access` | ✅ | ✅ all three | Brad 2026-07-27, "live with it for now" |
| `mealprint_access` | ✅ | ❌ none | Claude 2026-08-03, this slice |

Neither is obviously right, which is the dilemma:

- **Granting trainer tiers the suite** (Loadout's answer) means a coach gets at
  £14.99 what an athlete pays £29.99 for. `individual_trainer` is already the
  most cost-exposed tier at ~212 % of net at saturated ceilings; adding
  Mealprint's ~£7/mo would make the worst tier materially worse.
- **Withholding it** (Mealprint's answer) is coherent on cost and on scope — no
  coach surface exists in v1 — but coaches ARE athletes too, and telling a paying
  coach to buy a second consumer subscription to plan their own eating is a bad
  product answer. It also breaks the "role beats feature" upsell rule and needed
  `PREMIUM_PLUS_ONLY_FEATURES` so they are not sold a tier that stays locked.

**Brad's own steer is the third option: sell it as an UPGRADE to their coach
membership** — a coach add-on rather than folding the suite into the trainer tiers
wholesale. Nothing is built for that, and it is worth recording what it would
need before it can be costed: a purchasable coach-facing SKU in ASC +
RevenueCat, a catalog representation (either new tier rows like
`individual_trainer_plus`, or a separate entitlement the webhook grants alongside
a trainer tier), and a decision on whether Loadout Phase 4's coach programme
adaptation rides on the base trainer tier or on the upgrade.

⚠ **Do not flip `premium_plus.is_active` (T-P0.10) before this is settled.** The
paywall's tier set and the coach upsell path both depend on the answer, and
repricing or re-scoping after real subscribers exist is the expensive version.

⚠ **Nothing shipped is hard to change** — both flags are catalog columns and the
upsell is one set in `assertEntitlement`. Deferring the decision is cheap;
shipping the wrong one to paying users is not.

### ⚠ The Lambda timeout was 20s, not 30s — FIXED, and it had bitten Snap AI already

**`coreAPI.route("$default", …)` set no `timeout`, and SST defaults a function to 20
seconds** (`.sst/platform/src/components/aws/function.ts` — `timeout ?? "20 seconds"`).
Every AI adapter comment in the repo was budgeting against the **30 s API Gateway
integration ceiling**, which was never the binding constraint. Found by Inspector
Brad on the Loadout Phase 2/3 sweep; `infra/api.ts` now sets
`timeout: "29 seconds"` explicitly.

Two consequences, and the second is the one that costs money:

- **`createWithRetry` is 2 × 12 s = 24 s, so on the Snap AI photo path the RETRY
  could never finish** — the function was killed ~8 s into the second attempt. That
  is a **pre-existing latent bug on `main`**, not something Loadout introduced.
- **A Lambda hard-kill does not run the handlers' `finally` blocks**, so **no
  `ai_usage_log` row was written for an inference Bedrock had already performed and
  billed.** The request escaped the per-user daily ceiling entirely. At $0.0272 a
  scan that is the most expensive failure mode in the feature.

⚠ **Do not lower that route timeout without re-deriving `CLIENT_TIMEOUT_MS` and
`EQUIPMENT_SCAN_TIMEOUT_MS`** — both docstrings now say so.

### ⚠ Daily AI ceilings are not concurrency-safe — recorded, deliberately unfixed

`countForUserToday` reads BEFORE the inference and the usage row is written after,
so N requests inside that window all see the same count and all proceed: ~100
parallel POSTs at count 0 yield ~100 inferences. On the scan that is ≈$2.72 in one
burst against a ceiling meant to bound $4.90/month.

**Left as-is on purpose.** This is the #156 pattern that **all seven** AI endpoints
share, and making one transactional would leave it enforcing a different contract
from its six siblings. The real fix belongs in `AiUsageLogRepository` for all of them
at once — a reserve-then-reconcile row, or a conditional insert. Exposure needs a
deliberate parallel burst from an authenticated, entitled, paying account.

### 🔵 TIER + PRICING RESTRUCTURE — Brad's decisions 2026-08-04, numbers PROPOSED

> ### ⚠⚠ READ THIS BEFORE ANY NUMBER BELOW — `specs/29-subscription-restructure/` IS NOW CANONICAL
>
> Brad approved two changes late on 2026-08-04 that invalidate figures in the
> sub-sections below. **The spec triplet has them right; this section has them wrong.**
>
> 1. **Apple commission is modelled at 30 %, not 15 %.** Brad applied for the Small
>    Business Program and it was **NOT approved**. Decision: model everything at 30 %
>    so the numbers stay good if we never get in, or later fall out. ⇒ § "Apple takes
>    15 %, not 25 %" below is **superseded** — its net-revenue figures are ~21 % too
>    high, and every "% of net" derived from them is too low.
> 2. **Premium → £14.99/mo** (annual £124.99). ⇒ § "Premium: HOLD £12.99" below is
>    **reversed**. The reason it flipped is (1): £12.99 at 30 % nets $11.43, which is
>    less than that tier's own worst-case AI spend.
> 3. **Budget rule is `max(3.5 × typical, 33 % of net)` capped at 40 % of net**, over a
>    **rolling 30-day** window. ⇒ § "Pooled AI budget — VALIDATED at 33 % of net" is
>    superseded; recompute from `specs/29-subscription-restructure/design.md` § 2.
>
> **A finding I first OVERSTATED, corrected by Brad:** Start Up Coach is the one tier
> where the 40 % cap binds before the 3.5× usage floor is reached — but at **3.3×, a 6 %
> shortfall**, not the 2.9× I first reported. The 2.9× priced it with the endpoint set
> of the LIVE `individual_trainer` row, which has `loadout_access = true`; the PROPOSED
> Start Up Coach carries **no suite** — six endpoints, not nine. ⇒ **Accept 3.3× and
> record it; do not reprice the tier for this.** spec-29 AC 2.3a.
>
> ⚠ The real consequence of "no suite at the entry rung" is that it **REMOVES Loadout
> from `individual_trainer`**, which holds it today. Free (nothing is purchasable) but
> it is a takeaway, and `TIER_GRANTS_LOADOUT` in `useLoadoutGate` grants all three
> trainer tiers — the client mirror must move with the catalogue or the gate will
> disagree with the server.
>
> **⚠ 4. VAT — added 2026-08-04, and it is the LARGEST error the model has had.**
> Brad asked whether prices should be adjusted now so VAT can be baked in later. They
> should — but the reasoning is the reverse of the question. **Apple is the merchant of
> record on IAP: it deducts VAT before commission, whether or not we are VAT
> registered.** Being under the £90k threshold does not help, because the liability on
> that consumer sale is Apple's — nothing to defer, nothing to reclaim.
> `scripts/ai-cost-model.ts` had **no VAT term at all**, so every net figure it or this
> file ever produced was **~17 % too high**. Now fixed (`IAP_VAT_RATE`) with a test.
> Premium £14.99 nets **$10.99**, not $13.19. Premium+ £29.99 nets **$22.00**.
>
> ⇒ **RESOLVED by Brad, 2026-08-04: Premium → £16.99, Start Up Coach → £18.99.**
> Every tier now clears the 3.5× floor with nothing capped (3.50×–9.56×). ⚠ I had
> recommended HOLDING Premium at £14.99 on a MyFitnessPal-£9.99 comparison; **Brad
> corrected the premise** — MFP Premium offers no AI barcode/photo logging at all, so it
> is not like-for-like and the £9.99 anchor was not a real ceiling. Annuals: Premium
> £139.99, Start Up Coach £189.99 (⚠ its old £149.99 would have been 34 % off at the new
> monthly — deeper than the consumer discount, by accident).
>
> ⚠ **The one price change to make NOW: quote the WEB tiers "+ VAT".** That rail is the
> only place VAT genuinely is deferrable (we are MoR, below the threshold) — and quoting
> VAT-inclusive there turns registering later into a silent 16.7 % cut on every existing
> contract. B2B buyers expect ex-VAT and reclaim it, so the label is free.
>
> **The biggest lever is not a price at all** — spec-29 **C5**. `recipe_extract` on
> Opus is $0.0355/call: **55 % of Premium's entire worst case** and 44× the cheapest
> endpoint. On a cheaper vision model it is ~$0.007 and most of the margin problem,
> including AC 2.3a, dissolves. Run it in Phase 0 alongside C2.

**Supersedes the § below where they disagree.** Brad opened this to settle how the
adaptive suite (Loadout + Mealprint + the coming programme import and AI workout
generation) is priced across athlete and coach personas. Nothing is purchasable yet
— **no ASC products are live**, so every price and tier name below can still change
with zero grandfathering. That window closes at launch.

#### Decided by Brad

1. **Coaches get Mealprint access.** Structure coach tiers so they move with BOTH
   client count and features, not client count alone.
2. **Loadout + Mealprint stay Premium+-only on the CONSUMER track.** Metering them
   into Premium is rejected — it makes Premium+ feel lesser.
3. **⚠ A 3/day Mealprint allowance on Premium was proposed and REJECTED, and the
   reason generalises:** metering only converts if the median user hits the cap. At
   ~2/day typical use a 3/day allowance converts nobody and spends the feature's
   exclusivity for nothing. **Do not re-propose a small daily allowance as an
   upgrade lever.**
4. **AI ceilings are a BACKEND FAIL-SAFE, never an advertised product quota**, and
   should be a TOTAL per-user budget rather than a per-feature one — a user should
   not have to care what each feature costs. See the pooled-ceiling design below.
5. **Programme import belongs to athlete Premium+ as well as the coach tiers** — an
   imported programme is just a collection of workouts, so it is athlete-shaped too.
6. **`individual_trainer` → display name "Start Up Coach"**, plus a suite-bearing
   "Start Up Coach +". ⚠ See the rename hazard below — change `display_name`, NOT
   `tier_name`.
7. **AI workout generation is a FUTURE Premium+ addition** built on top of Loadout
   and Mealprint. It is not in scope now, and it is the justification for a future
   price rise rather than a current one.

#### ⚠ The pooled cost ceiling — the structural fix

**Per-feature ceilings make the worst case ADDITIVE**: it is the sum of 9 (soon 12)
independent daily caps, which is the entire reason every tier looks underwater at
saturation. A single **cost-weighted daily budget per tier** makes the worst case a
number you CHOOSE.

- Weight by COST, not call count. The endpoints differ ~44× ($0.0008 ingredient
  resolve vs $0.0355 recipe extract), so a pooled *call* count would let a user
  spend the whole budget on the dearest endpoint. `scripts/ai-cost-model.ts`'s
  `costPerCall` is already the function needed, and `ai_usage_log` already records
  per-inference rows to sum.
- **KEEP the per-feature ceilings as a secondary bug-guard**, raised so the pool is
  what normally binds. Defence in depth: the pool protects margin, the per-feature
  caps stop one runaway client loop draining a whole day's budget. Deleting them
  would make a single retry bug a full outage of every AI surface.
- Never advertised. Sized so a real user does not reach it.

Sizing is a dial with an explicit trade-off (Premium, net $13.88/mo, typical
$0.047/day):

| Pool as % of net | Premium $/day | × typical | worst-case gross margin |
| --- | --- | --- | --- |
| 20 % | $0.093 | 2.0× | 80 % |
| 25 % | $0.115 | 2.4× | 75 % |
| **33 %** | **$0.153** | **3.3×** | **67 %** |
| 50 % | $0.231 | 4.9× | 50 % |

**Recommended 33 %.** 3.3× typical daily spend is generous for a real user and
guarantees a 67 % gross margin against a determined abuser — against today's 91 %
worst case (9 % margin) or Premium's current 167 % (negative).

#### Coach brackets — the 2 → 30 gap is genuinely anomalous

Reviewed against ABC Trainerize (Aug 2026, USD, monthly): Basic free/1 client ·
Grow $9/2 · Pro 5 $23 · Pro 50 $120 · Pro 200 $199+ · Studio Plus $248/location for
500–1,000. **Their granularity is concentrated in the 5–50 client band** — exactly
where Persistence has nothing between 2 and 30.

⚠ **The finding that matters most: Trainerize charges $20–45/mo EXTRA for the
nutrition add-on** ($20 on Grow/lower Pro, $45 on Pro 30–200). Persistence bundles
AI nutrition. So like-for-like at 30 clients, Trainerize is ~$85 + $45 = ~$130
(~£102) against a proposed £89.99. **The coach ladder is UNDER-priced relative to
the market, not over-priced** — which is where the headroom is, and it is not on
Premium+ (see below).

#### ~~PROPOSED tiers~~ — TABLE REMOVED 2026-08-04, see `specs/29-subscription-restructure/design.md` § 1

> ⚠ The ladder that was here was an **earlier draft** and had already diverged from the
> spec on three rows (it had Studio at 30 clients in-app; the spec has Coach Pro £99.99
> at 30 as the top IAP rung, and Studio £179.99/75 as WEB-only). Two divergent ladders
> in one repo is precisely the drift that made the cost figures go stale twice, so the
> copy is deleted rather than corrected. **One ladder, in the spec.**
>
> What still holds from the reasoning that produced it: the middle rungs are where money
> was being left; Enterprise leaves the self-serve ladder; client counts mirror
> Trainerize's own rungs so a coach can compare; 30 clients is the top in-app rung.

⚠ **REVISED 2026-08-04 after Brad supplied the Trainerize add-on screenshots** (see
the competitive block below). Two changes from the first draft: the MIDDLE rungs went
up — that is where the most money was being left — and Enterprise left the self-serve
ladder. Client counts now mirror Trainerize's own 5/15/30/100 rungs so the comparison
is legible to a coach evaluating both.

The suite/no-suite split exists at **entry only** — that is the one price point where
it bites (a pure coach should not pay for AI they will not use), and above it a
professional coach will want the suite anyway.

⚠ **Premium+ should NOT be raised on the current feature set.** £29.99 = **$38.09**
at $1.27/£, against Ladder and Juggernaut AI at $29.99–34.99 — Premium+ is already
the most expensive in its comparable set in dollar terms. Raise it when AI workout
generation ships, not before.

#### ⚠ RENAME HAZARD — change `display_name`, never `tier_name`

`RC_ENTITLEMENT_IDS` in `revenuecat/entitlements.ts:16-22` **are the tier_names**,
and `user_subscriptions.tier_name` is an FK to `subscription_tiers.tier_name`. So
renaming the key is a cross-system change (DB rows + RC entitlement ids + ASC
product mapping) for **zero product benefit** — the user only ever sees
`display_name`. Keep `individual_trainer` as the key and display "Start Up Coach".
The last tier rename (`20260526120000_simplify_tier_model.sql`) needed a
copy → migrate-FKs → delete dance; do not repeat that voluntarily.

#### Every place a tier change has to land

1. `subscription_tiers` catalog row — migration.
2. **App Store Connect** — a subscription product per tier per billing cycle.
3. **RevenueCat** — entitlement id + offering/package mapping.
4. `revenuecat/entitlements.ts` — `RC_ENTITLEMENT_IDS` **and** `TIER_RANK` (rank
   decides which entitlement wins when RC reports several — insert correctly).
5. `packages/mobile/src/domain/services/purchaseOfferings.ts` —
   `tierFromProductId`'s substring ladder (⚠ order-sensitive: longer names first,
   as `premium_plus` must precede `premium`) and `MONTHLY_ONLY_TIERS`.
6. `IOSPurchaseFlowPresenter.tsx:200-249` — the trainer rail is a **hardcoded
   allow-list** `["individual_trainer","small_business","medium_enterprise"]`. New
   coach tiers are invisible until added here.
7. `assertEntitlement.ts` — `nextTrainerTierUp` upgrade ladder.
8. `useLoadoutGate.ts` / `useMealprintGate.ts` — hardcoded tier→boolean Records
   (they mirror the migrations because `/subscriptions/me` projects neither column).
9. Seed-guard tests: `subscriptionTierSeed.test.ts`, `premiumPlusTierMigration.test.ts`.

#### ⚠~~Apple takes 15 %, not 25 %~~ — SUPERSEDED 2026-08-04: model at **30 %**

> Small Business Program applied for and **NOT approved**. Every net figure in this
> sub-section is ~21 % too high. Canonical: `specs/29-subscription-restructure/`.

`net $/mo` in the cost model is already `gross × (1 − Apple) × (1 − RevenueCat)`, so
every margin figure here is AFTER the storefront cut. The rate is **15 %** (Small
Business Program, applied and confirmed 2026-07-25 —
`marketing/FUNDING_AVENUES.md:39-41`) plus RevenueCat 1 %.

Worked example, Start Up Coach at £14.99: gross $19.04 → net **$16.02** → AI budget
46 % = $7.37 → **$8.65 left = 54 % of net, 45 % of gross** at full saturation, and
~75 % of gross at typical use.

⚠ **Crossing $1M/yr in proceeds removes Small Business Program eligibility and Apple
reverts to 30 %** — ~18 % less net revenue on an unchanged price. Growth triggers it,
so it is a planning scenario, not a tail risk. Now modelled: `tierCost` takes an
injectable commission and the report prints IAP-now / IAP-past-$1M / web per tier.

**This is also the strongest argument for the split rail, and the single-commission
model was hiding it:** Stripe's ~3 % does not scale with revenue, so the web rail's
advantage over IAP roughly DOUBLES past the threshold — 13 points today, 27 after.

#### ~~Premium: HOLD £12.99 monthly~~ — REVERSED 2026-08-04: Premium → **£14.99**

> Flipped by the 30 % commission finding above. The ANNUAL conclusion in this
> sub-section still stands (~30 % off ⇒ £124.99); only the monthly reversed.

Brad asked whether £12.99 is too cheap. **It is not, and it should not move.**
MyFitnessPal Premium in the UK is **£9.99/mo** — so Premium is already ~30 % ABOVE
the category price anchor most users carry, while including AI photo/free-text food
logging that MFP puts in a higher tier. Raising it to £14.99 would put us 50 % over
MFP on the volume tier, which is the one place price sensitivity actually bites
(Free → paid conversion is far more elastic than Premium → Premium+).

⚠ **The real gap is annual.** MFP is **£49.99/yr** (58 % off their monthly); ours is
£129.99 (16.7 % off — the "2 months free" formula, 10× monthly, applied to every
tier). On annual we are **2.6× MFP**. Annual prepay is the strongest lever available
for cash flow and churn, and a 16.7 % discount is too shallow either to compete or to
drive the switch. **Proposed: deepen the consumer annual to ~30 % off** (Premium
≈ £109.99, Premium+ ≈ £249.99) and drop the universal 10× rule. Not MFP's 58 % —
that is an acquisition loss-leader — but competitive.

This supersedes the "£1 = every paid tier offers annual ≈ 2 months free" line in
`marketing/WEBSITE_PRICING_SPEC.md` § intro.

#### ~~Pooled AI budget — VALIDATED at 33 % of net~~ — RECOMPUTED 2026-08-04

> Rule is now `max(3.5 × typical, 33 % of net)` capped at **40 %**, over a **rolling
> 30-day** window. Table: `specs/29-subscription-restructure/design.md` § 2. Brad's
> headroom condition (D9) IS met on call count (~8/day typical vs ~27/day allowed on
> Premium) — but on COST MIX only because the window is monthly, not daily.

Brad's condition was that the budget beat typical usage with room for heavier users.
It does, at every tier. Typical is $0.047–0.066/day (cost-model median column):

| Tier | £/mo | net $/mo | budget $/mo | budget $/day | × typical |
| --- | --- | --- | --- | --- | --- |
| Premium | 12.99 | 13.88 | 4.58 | $0.153 | **3.3×** |
| Premium+ | 29.99 | 32.05 | 10.58 | $0.353 | **6.4×** |
| Start Up Coach | 14.99 | 16.02 | 5.29 | $0.176 | **2.9×** |
| Start Up Coach + | 34.99 | 37.39 | 12.34 | $0.411 | **6.7×** |
| Coach | 59.99 | 64.08 | 21.15 | $0.705 | **11×** |
| Studio (web) | 109.99 | 135.42 | 44.69 | $1.490 | **24×** |

What the TIGHTEST budget buys, per day, at Start Up Coach's $0.176: 4 recipe extracts
**or** 11 Snap photos **or** 88 free-text estimates **or** 29 coach summaries. A
5-client coach doing four recipe extractions *and* eleven food photos every day is not
a real usage pattern. Premium at $0.153/day: five photo-logged meals costs $0.078 —
51 % of budget, so a heavy legitimate day still has headroom.

⚠ **This whole sub-section is the 15 %-commission, £12.99-Premium draft — superseded.**
Canonical table: `specs/29-subscription-restructure/design.md` § 2. Two errors in it
worth naming so they are not re-derived: every net figure assumes Apple 15 % (now 30 %),
and Start Up Coach's 2.9× priced the LIVE `individual_trainer` endpoint set rather than
the proposed no-suite one (corrected to 3.3× — see AC 2.3a).

#### 🔴 DO NOT EXECUTE `specs/stripe-rail-removal/` — the rail is the coach-tier plan

**The Stripe rail is still live and it is now load-bearing again.** `/stripe/webhook`
is mounted at `microservices/core/src/api.ts:270`, and the handler, `reconcile`,
`stripeIdempotency`, `subscriptionState` and `alerts` are all intact. Only the
**mobile** PassKit / in-app-payments path was removed (PR #336, App Store Guideline
2.1) — the backend rail survived that and was subsequently parked for deletion.

Deleting it would destroy the enabler for the highest-margin part of the business,
and rebuilding a subscription rail with webhook idempotency and reconciliation is
months of work already paid for.

**The split-rail plan (Brad's question, 2026-08-04 — "am I cutting my nose off by
putting everything through RevenueCat"):**

- **Consumer tiers via Apple IAP.** At £12.99–29.99 these are impulse purchases and
  the ~16 % (Apple 15 % + RevenueCat 1 %) buys one-tap Face ID conversion.
- **Coach tiers via web/Stripe.** At £109.99/mo Apple takes £16.50/mo = **£198/yr
  per coach**; at 100 coaches, **£19,800/yr**.

⚠⚠ **CORRECTED 2026-08-04 — the split is NOT "consumer vs coach". Guideline
3.1.3(c) draws the line at ORGANISATION vs SINGLE USER, and a solo coach is a
single user.**

The three candidate carve-outs, read against the actual guideline text:

- **3.1.3(b) Multiplatform Services** — may allow access to items bought on your
  website *"provided those items are also available as in-app purchases within the
  app."* Parity required, so it saves nothing unless the user chooses web.
- **3.1.3(f) Free Stand-alone Apps** — companion to a paid web tool, *"provided there
  is no purchasing inside the app."* **Does not apply**: Persistence sells consumer
  tiers by IAP, so it is not a free stand-alone app.
- **3.1.3(c) Enterprise Services** — *"If your app is only sold directly by you to
  organisations or groups for their employees or students … you may allow enterprise
  users to access previously purchased content or subscriptions. **Consumer,
  single-user or family sales must use in-app purchase.**"*

⇒ **A solo PT buying for themselves and five clients is a single-user sale and must
use IAP.** The compliant line therefore sits partway UP the coach ladder, where the
buyer genuinely becomes an organisation:

| Rail | Tiers | Basis |
| --- | --- | --- |
| **Apple IAP** (15 % + 1 %) | Premium, Premium+, Start Up Coach, Start Up Coach +, Coach | single-user sales — 3.1.3(c) requires it |
| **Web / invoice** (~3 %) | Studio, Studio Pro, Enterprise | sold to gyms, studios, clinics, teams — organisations under 3.1.3(c) |

**This is exactly why merging the coach platform with B2B is the right call (Brad's
own suggestion): 3.1.3(c) tells us WHERE the merge line sits.** Studio and above are
positioned and sold as organisation products — multiple trainers, a business buyer,
invoice or web checkout — which is the same rail § 3's B2B plan already specifies
("manual invoice — no in-app purchase, no card entry in v1").

Also true, and separate: UK link-out is not permitted yet (the CMA gave Apple
Strategic Market Status; conduct requirements expected within ~12 months; the EU has
the External Purchase Link Entitlement at 17 %, or 15 % within 7 days of a tap). So
there must be **no purchase CTA and no link-out for the web tiers anywhere in the
app** — the in-app coach surface says "manage your plan on the web", nothing more.

⚠ **This is my reading of guideline text, not advice, and the downside is a 3.1.1
rejection on a product that has already been rejected twice (2.1 PassKit, 4.0 Apple
logo). VERIFY with App Review before building** — pre-submission questions are free,
and getting a written answer on "may a studio subscription be sold off-app while
consumer tiers use IAP" is worth the week it costs.

The arbitrage worth knowing: **web pricing can UNDERCUT and net the same.** £109.99
via IAP nets £93.49; to net that on Stripe at ~3 % you need charge only **£96.99** —
below Trainerize's ~£102 equivalent, same money retained.

#### Competitive data — ABC Trainerize, from Brad's screenshots 2026-08-04

Their ladder is **Pro 5 / 15 / 30 / 50 / 100 / 200** (confirmed by the add-on
tiering "Pro 5, 15" and "Pro 30 to Pro 200"), against our two rungs.

⚠ **Their "Advanced Nutrition Coaching" add-on IS Mealprint Phase 2/3** — 7-day meal
plans, shopping lists, 2,400 recipes, custom recipes — at **$20/mo (Grow, Pro 5/15)
and $45/mo (Pro 30–200)**, included only in Studio. **And it is not AI**: it is a
recipe-database template planner. Mealprint generates against actual remaining macros
from real product data, so we are building the strictly better thing and pricing it
below the lesser one. Other add-ons: Business $25/mo, Video Coaching $10/mo, Custom
Branded App $169 one-time.

All-in cost for a working coach (base + Advanced Nutrition only, at $1.27/£):
5 clients ≈ £34 · 15 ≈ £51 · 30 ≈ £102 · 50 ≈ £130 · 200 ≈ £192 · Studio Plus £195
for 500–1,000 with every add-on included.

⇒ **Enterprise should LEAVE the self-serve ladder.** At 500 clients Trainerize is
£195 all-in; £299.99 through Apple cannot win that. § 3's B2B plan is already manual
invoice — let anything above ~100 clients be invoiced and stop competing on that rung.

#### Still open

- **Coach entry £14.99 — SIGNED OFF (Brad 2026-08-04).** Pooled budget at 33 % —
  SIGNED OFF, conditional on beating typical usage, which it does (table above).
  Split rail — SIGNED OFF in principle, subject to the App Review verification above.
- Remaining: the deeper annual discount (~30 %); whether Start Up Coach needs a
  bespoke pooled percentage at 2.9×; programme-import ceiling (needs the ROADMAP § 5.3 Phase-0 eval first — it will be
  the most expensive endpoint in the app at an estimated $0.10–0.20/import).
- **`AI_RECIPE_DAILY_LIMIT` should become MONTHLY, not smaller.** Recipe extraction
  is bursty-then-dormant (digitise ten recipes one evening, none for a month); a
  daily cap either throttles the legitimate burst or permits the abuse. 60/month
  allows the burst and takes the worst case $12.78 → $2.13. Same shape for programme
  import. This supersedes action 3 in the § below ("12 → ~4").

### ⚠ Pricing vs AI cost — three tiers are theoretically underwater (2026-07-27)

**Run `bun run scripts/ai-cost-model.ts` for the live table. Do not quote figures
from here — quote the command.** The last time this was answered in prose
(2026-07-05, "~£7.30/mo worst case vs £12.99") it went stale twice without anyone
noticing, which is why it is now a tested script (`scripts/ai-cost-model.ts`, 34
tests) with the assumptions declared at the top.

At every reachable ceiling, every day, for 30 days — against net revenue (Apple
15 % Small Business + RevenueCat 1 %, £1 = $1.27):

- **`individual_trainer` (£14.99) is the MOST exposed tier at ~212 % of net.** Cause:
  `20260725194527_premium_plus_tier` granted `loadout_access` to all three trainer
  tiers, so a coach gets Loadout at £14.99 while an athlete pays £29.99 for it.
  **DECIDED by Brad 2026-07-27: LIVE WITH IT for now.** Loadout is a **Premium+**
  feature by intent; the trainer-tier grant is an accepted constraint, not the
  design. Coaches will eventually need *some* route to it (Phase 4 adapts a client's
  programme, which cannot work without one) but that is its own slice, and coaches
  are not expected to use the athlete flow normally. **Do not "fix" the migration**,
  and do not re-raise this as a cost finding — it is a known, accepted gap.
- **`premium` (£12.99) is ~167 %**, and **Loadout is not why** — it cannot reach
  either Loadout endpoint. **~55 % of its exposure is ONE endpoint: Recipes AI photo
  extraction** at 12/day × ~$0.0355, the most expensive call in the app. Nobody
  extracts 12 recipes from photos a day; that ceiling is the loosest thing we ship
  relative to its unit cost. Cutting it to ~4/day would halve the tier's worst case
  and cost no real user anything.
- **`premium_plus` (£29.99) is ~104 %** — i.e. the tier that adds the most AI is the
  *least* over-exposed of the three, because the price rises 2.3× while the added
  cost is ~$10. **The two Loadout surfaces total ~$10.03 and are the only MEASURED
  figures in the table.**
- `small_business` (50 %) and `medium_enterprise` (13 %) are comfortable.
- **TYPICAL use is 5–11 % of net on every paid tier (~$1.40–1.83/mo).** So none of
  this is a live margin problem — it needs a determined abuser hitting six or seven
  endpoints daily for a month while paying. It is a tail-risk and pricing-coherence
  finding, not an incident.
- **Infrastructure is negligible**: ~$185/mo fixed (Supabase/AWS/Expo/Sentry) plus
  ~$0.02/user marginal → **$1.87/user at 100 subscribers, $0.20 at 1,000, $0.04 at
  10,000.** Serving requests is not what this platform costs; AI inference is.

**⚠ SIX OF THE EIGHT UNIT COSTS ARE ESTIMATES.** Only the re-map ($0.0057) and the
scan ($0.0272) were measured against real Bedrock calls (Phase E). The nutrition and
Recipes AI figures are derived from declared token profiles, and **those surfaces are
the larger half of every exposed tier's total** — so the two headline percentages
above rest mostly on guesses. Also: the prices used are **Anthropic list, not
Bedrock partner prices**, which the eval itself flagged as unchecked.

Actions, in order of value:

1. **Measure the nutrition + Recipes AI unit costs** — from `ai_usage_log` (it
   already records per-inference byte sizes and duration; token counts would need
   adding) or off the AWS bill. Until then no tier's number is quotable.
2. **Decide the `individual_trainer` × `loadout_access` question** (Brad).
3. **Consider `AI_RECIPE_DAILY_LIMIT` 12 → ~4.**
4. **Register `AI_RECIPE_ESTIMATE_DAILY_LIMIT` in `infra/api.ts`** — it is currently
   unset and silently uses its code default of 30, so it is invisible to a cost
   audit of the env block where every other ceiling lives.
5. **Check Bedrock's actual prices** against the Anthropic list prices assumed.

### Brad's decisions — Loadout (spec-21), still open

- **Programme cap** — 120 workouts stands, but its rationale changed (it is now
  120 model calls, ~5 min, ~$0.69, not "nearly free").
- **Target transform** (`4×4-6 → 3×12-15` when the kit cannot load a strength
  row) — spec it as its own slice, or accept flag-only for v1 (AC-3.5b ships the
  flag either way).
- **Does the equipment scan still ship inside Phase 2**, or split so the re-map
  lands on measured ground first? (`requirements.md` § Open sequencing decision.)
- **~30 real gym photos** — to turn E1's provisional go into a real one; ideally
  with Brad-confirmed ground-truth labels rather than Claude's.
- ~~**A "Gym" tab inside Train**~~ — **RESOLVED 2026-08-02. It REPLACES the
  Profile · Account list; it does not complement it.** Brad: "i don't want it
  there." Built as a `Gyms` segment in the Train hub on **PR #346** (branch
  `feat/loadout-gyms-train-segment`, raised 2026-08-02, **NOT merged**), with
  AC-7.2 rewritten and AC-7.2a/7.2b added plus design § 10.1. The Profile row, its handler, the `Stack.Screen` and
  the route file are deleted, so there is exactly one way in.

### Next plan of action — the Premium+ launch bundle (2026-08-02)

⚠ **ORDER CHANGED 2026-08-03 (Brad): Mealprint goes NEXT, ahead of Loadout
Phase 4.** Phase 4 is coach-facing and gated on an open cap decision; Mealprint is
what the live paywall already advertises, so it is the delivery risk. Phase 4
slots in after it. Nothing about the dependency graph forces the old order — both
consume the same spine, which is now built.

**0. The shared async-job spine — ✅ SHIPPED 2026-08-03.**
PRs [#348](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/348)
(`c8624248`) + [#349](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/349)
(`6f756b82`). Spec triplet at `specs/_shared/async-jobs/` — the ONE place the
job-table design lives; the consuming specs defer there. `ai_jobs` table, SQS
queue + DLQ + 15-minute worker, claim/checkpoint/resume/poll, `GET /jobs/:id`,
nightly maintenance sweep, DLQ + worker-error alarms. Deployed to staging, green.

Consuming it is: register a `JobKind` (`registry.ts` ships EMPTY on purpose) and
call `enqueueJob()`. The spine owns claim, checkpoint, heartbeat, time-budget
yield, retries, failure taxonomy and staleness — a consumer reimplementing any of
those is a spine bug.

⚠ **Three things a consumer MUST know:**

- **`ai_jobs` migration `20260802120000` is NOT APPLIED** to staging or prod.
  Manual. Nothing runs until it is.
- **The two `ai_usage_log` endpoint keys must differ** — one row per JOB for the
  ceiling, one per MODEL CALL for telemetry. `registerJobKind` throws if they are
  equal, because a 120-inference job under one key trips its own ceiling on run
  one.
- **`maxInvocations` defaults to 20, sized on Loadout's ~20 s steps.** A kind with
  slower steps must raise it or it dies mid-progress.

⚠ **STAGING LAMBDA QUOTA IS 10, and it is now a blocker rather than trivia.** It
broke the first deploy of the spine (`reserved: 5` cannot leave 10 unreserved), it
makes any load test measure the quota rather than Supabase, and — critically —
before ANY kind is registered it must be resolved, or five 15-minute workers take
half the staging account and throttle the API into the same 503s that got build 39
rejected. Staging is a DIFFERENT AWS account from production; the 2026-08-01 raise
to 1000 covered prod only. Three routes, recorded in `infra/jobs.ts`: raise the
staging quota (also unblocks load testing — preferred), cap `maximumConcurrency`
at 2 on non-production, or give `coreRoute` a reservation.

Six local Inspector Brad passes found 30 findings on the spine, so the concurrency
semantics are subtle by nature — read `design.md` § 3.1 and § 3.4 before touching
anything near the claim. Also worth carrying forward: the break was in `infra/`,
which has NEITHER typecheck NOR tests, and CI gates say nothing about whether
`infra/` will apply.

**1. spec-26 Mealprint — BACKEND PHASES 0 + 1 SHIPPED 2026-08-03** (§ spec-26
Mealprint above). 9 of ~23 tasks built, all backend.

⚠ **The immediate next slice is Mealprint's MOBILE half (T-0.6, T-1.5)** — PR 2
on `feat/mealprint-phase-0-1`. Without it nothing calls either endpoint and the
feature does not exist for a user. Then Phase 2 (day plans), then Phase 3 (week
plans, which is where the async-job spine gets consumed — and where the staging
Lambda quota becomes a hard blocker, see § 0).

**2. Loadout Phase 4 — coach programme adaptation.** T-4.1…T-4.5. Needs the
programme-linkage migration (`parent_program_id`, `variation_kind`,
`source_gym_id`, `source_equipment_type_ids` on `workout_programs` — design
§ 2.4; none of these columns exist), a programme-level preview/create-variant
that assembles the candidate pool ONCE for the union of all muscles, the 120-cap
with a 413 rather than silent truncation, assign-from-variant behind
`assertTrainerCanActForClient`, coach UI, and an ex-coach-gets-403 test.
⚠ Brad checkpoint still open in design § 7.3: **confirm the 120 cap** — its
rationale changed (it is now 120 model calls, ~5 min, ~$0.69, not "nearly free").

**3. M21 B2B org layer.** ⚠ **It has no spec triplet.** `specs/23-organizations/`
and `specs/milestones/M21-b2b-orgs/` are both referenced by
`GTM-EXPANSION/BRIEF.md § 5` and **neither exists** — M21 is one brief section
plus design task D5. Writing the triplet is step one (Kiro discipline). The
load-bearing change is org-aware entitlement resolution; the rest (org tables,
invite codes mirroring `trainer_invite_codes`, the founder ops console,
aggregate-only dashboard with cohort suppression below 5) is comparatively
mechanical.

**4. Then and only then, T-P0.10** — flip `is_active`, attach and submit the two
ASC products. Brad's runbook, chat-only.

#### ⚠ Four traps that will bite this bundle

0. ⚠ **The staging Lambda quota (10) must be resolved before ANY job kind is
   registered.** See § 0 above — it is the same limit that broke the spine's first
   deploy, and with a kind registered it would throttle the API into 503s on the
   staging account.
1. **`assertEntitlement`'s catch-all silently allows everyone.**
   `assertEntitlement.ts:730-735` documents it: a feature name added to the
   `EntitlementFeature` union **without** its routing line falls through to
   `{ allowed: true }` — a paid gate becomes a no-op with no type error and no
   test failure. Mealprint's `meal_ai` and any Phase-4 programme feature each
   need that line. Note three keys are ALREADY stubs returning `allowed: true`:
   `ai_workout`, `gym_buddy`, `unlimited_exercise_library`.
2. **`useLoadoutGate` mirrors the tier→flag map CLIENT-SIDE by hand.**
   `/subscriptions/me` still does not project `loadout_access`, so
   `TIER_GRANTS_LOADOUT` is a hardcoded `Record` over the tier union. **B2B makes
   this actively wrong**, not just ugly: an org seat grants a tier the client
   cannot see. Retire it — project the flag on `subscriptionRepository.findForUser`
   + `MySubscription` + the mobile read. ~4 lines, and it should land with M21.
3. **The coach/athlete Loadout price hole becomes a product surface at Phase 4.**
   All three trainer tiers carry `loadout_access`, so a coach gets Loadout at
   £14.99 while an athlete pays £29.99. Brad's 2026-07-27 decision was "LIVE WITH
   IT for now" — Phase 4 is the point where that stops being invisible.
4. **Two briefs in the tree are stale and will mislead.**
   `TRAINER-CLIENT-CAPS-BRIEF.md` says `trainer_client_limit` is unenforced; it
   has since been **enforced** (`trainers/seats/trainerSeats.ts` is the surface,
   guarded at four call sites). And `GTM-EXPANSION/BRIEF.md`'s paywall table
   still prices Premium+ at £19.99 and specifies a free taster of 3 — the price
   is £29.99 and the taster was **killed** (spec-21 AC-9.3, spec-26 decision 2).

### Loadout — the Gyms segment slice (PR #346, MERGED 2026-08-02)

**MERGED as `5370abb8`.** Its sibling **PR #345 (`8fcfd5c7`) is MERGED too** —
the device-pass fix that found Loadout's whole Phase 3 scan path was a dead end
on device (gorhom fires `onClose` on a PROGRAMMATIC close, so each sheet CTA's
own `goToStep` was overwritten a beat later; neither exit ever reached an
adaptation). Both green on CI, Inspector Brad clean. `main` is at `8fcfd5c7`.

Saved-gym management moved from Profile · Account into a fourth **`Gyms` segment
in the Train hub**. Three things, not one:

1. **The segment**, alongside Training / Workouts / Exercises. `TrainSegment`
   gains `"Gyms"`, which widens `isTrainSegment` — the validator for the
   **device-global** key `persistence.train.segment`.
2. **⚠ Gym CREATION, which did not exist at all.** On `main`, `createSavedGym`
   had exactly two call sites and both were inside `LoadoutFlowContainer`
   (commit-time create + the save-time fallback). `SavedGymsContainer` was
   manage-only and its empty state told the user to go adapt a workout and tick
   "Save" — coherent for a footnote under Profile, a dead end for a hub tab on a
   new account. `useSavedGyms.create` already existed with no consumer.
   `editing.gymId === null` is the new-gym draft and shares the editor card, so
   the empty-kit block and the 409 name-taken field error hold on both paths.
3. **Shown-but-locked when unentitled.** ⚠ Locked is **not** a taster (design
   § 5.2): `GymsSegmentContainer` does not MOUNT `SavedGymsContainer` when the
   gate denies, and that non-mounting IS the enforcement, because `useSavedGyms`
   fetches on mount. There is a **third** body state — pending — because a TAB
   has no tap to swallow the way `WorkoutDetailContainer` does, so rendering the
   pitch during the cold-start `/subscriptions/me` round trip would show the
   paywall to a subscriber on every launch. And a **fourth**, stalled: that
   request has no client-side timeout, so a half-open socket never rejects and
   `isResolved` never flips.

**⚠ Two traps this slice hit, both worth carrying forward.**

- **`refetch()` does not reissue a hung FIRST fetch.** TanStack gates
  `cancelRefetch` on `state.data !== undefined`; with data undefined it returns
  the same pending promise and issues nothing — and undefined data is the only
  state a "Try again" is reachable from. `useLoadoutGate.refetch` has to
  `queryClient.cancelQueries(...)` first, for BOTH queries. A retry button that
  merely calls `refetch()` is decorative.
- **`Segmented`'s scroll gates were guesses about text metrics, twice.** First
  `width < 360`, then `options.length >= 4`; both left real devices clipping the
  trailing segment with no scroll path. It now always wraps
  (`flexGrow: 0` keeps a fitting track pixel-identical) — which put RN's
  **keyboard tap-capture on every consumer in the app**, so
  `keyboardShouldPersistTaps="handled"` is now load-bearing there. Note
  `MealPickerPresenter` was already a 4-option consumer inside three sheets.

Device-verified against staging: segment renders inset correctly, creating a gym
persists and appears in the collect step (the first `POST /saved-gyms` from
outside the adapt flow), the 3-option and 4-option tracks are unchanged. NOT
verified: the locked/pending/stalled states (the test account is entitled) and
the keyboard tap-through (the simulator has a hardware keyboard attached).

### Loadout (spec-21) — where the whole feature stands, 2026-08-02

**Merged: P0 (tier code), Phase 0, Phase E, Phase 1, Phase 2, Phase 3.** #339
was the last of those and closed the athlete flow. Nothing in Loadout is on an
unmerged branch any more.

**NOT built:** Phase 4 (coach programme adaptation, T-4.1…T-4.5) — not started,
zero code. Phase 5 (second engine) — judged unlikely on E2's evidence.

**NOT verified:** the athlete flow has never had a clean device pass. Every run
so far was a mobile build against a staging backend missing this PR's routes.
**#339's merge is what fixes that** — `deploy-staging.yml` fires on push to
`main`, so the deploy that follows the merge is the first time the client and
the API agree. Re-run the device pass after it lands, not before.

⚠ **`tasks.md` checkboxes lie in BOTH directions here.** T-P0.1…T-P0.11 and
T-E1.5…T-E1.7 are unticked but the code is present and merged
(`revenuecat/entitlements.ts`, `subscriptionsCreateHandler`,
`AI_EQUIPMENT_SCAN_MODEL_ID` in `infra/api.ts`, the `premium_plus` +
`loadout_access` migration). Verify against the tree, not the ticks.

**The one thing genuinely blocking consumer launch is ops, not code:**
`subscription_tiers.premium_plus` exists on staging at £29.99 with
`loadout_access = true` but **`is_active = false`**, so no athlete can buy it.
That is T-P0.10 — the ASC + RevenueCat product config, Brad's runbook, chat-only.

💡 **You do NOT need a RevenueCat promotional entitlement to device-test.**
`individual_trainer` (£14.99, active, purchasable) carries `loadout_access` and
is in `TIER_GRANTS_LOADOUT`, so a trainer account reaches the flow today. The
PR body's note about needing a promo entitlement applies only to testing the
consumer *paywall*.

T-2.2…T-2.9, T-3.4 and T-3.5's mobile half are all ticked, and `tasks.md`
§ "Landed in Phase 2's screens beyond the checklist" holds the architecture
decisions. Do not re-derive them; the short version:

- The flow is the **`/(app)/loadout` route** (`fullScreenModal`); the store is
  the STEP machine, not the navigation. The swap/scan sheets are siblings of the
  step inside that route so they layer above it. ⚠ Two earlier shapes were tried
  ON DEVICE and both broke — an absolute View sibling of the Stack rendered
  *behind* the workout detail (which is itself `presentation: "modal"`), and
  wrapping it in an RN `<Modal>` was worse: it froze the screen with an
  invisible presented modal eating touches. Do not "simplify" it back.
- `adapting` is bound to the request; the prototype's 1700 ms timer is absent.
- `others` is the incompatible list **only when a kit context was supplied**.
- The swap sheet's containment context is **`preview.equipmentTypeIds`** (the
  server-resolved kit), not the client's saved-gym row.
- **No taster meter** and **no price literal** — the upsell reads the catalog and
  renders correctly with no price, which is the state until `premium_plus` goes
  active.

**⚠ The one recorded follow-up: `/subscriptions/me` does not project
`loadout_access`,** so `useLoadoutGate` mirrors the migration's tier set
client-side (the 402 remains the real gate). Adding the column to
`subscriptionRepository.findForUser` + `MySubscription` + the mobile mirror is a
~4-line change and retires `TIER_GRANTS_LOADOUT`. Left out only because that
slice was mobile-only.

**⚠ BLOCKED ON PR #332, which is a separate branch.** Brad's device run hit a
500 behind "Couldn't adapt this workout": the `${array}::uuid[]` bug above, in
`ExerciseRepository.listAdaptationCandidates`. The fix was split out to
`claude/fix-uuid-array-predicates` (PR #332) at Brad's request so it can land
without waiting on this review — **this branch stays mobile-only.** Loadout
cannot work on device until #332 is merged AND staging is redeployed
(`deploy-staging.yml` accepts a `workflow_dispatch`).

**Also changed off the back of that run:** the "Save this gym for next time"
toggle now creates the gym when the user COMMITS the kit, not when the variation
saves. It used to be contingent on the adaptation succeeding, so a 503 / 429 /
dropped connection lost the named kit and every ticked chip. `save()` awaits the
in-flight create rather than racing it into a 409.

**Still to do on this branch:** device-verify on an EAS dev build against
staging using the PR checklist, then merge. Gates green
(prettier / typecheck 8/8 / lint 0-err / build 13/13 / test:unit 19/19),
2 IB passes clean — but the IB sweeps predate the backend fix and the
route conversion, so **one more sweep is owed before the PR**.

**⚠ The safe-area bug and the trap inside it — FIXED, and worth reading before
touching any inset in this app.** Brad's second screenshot showed the collect
step's header flush against the status bar, its title overlapping the clock — on
the same `LoadoutScaffold` that had rendered correctly inset one run earlier.

**`SafeAreaView` from `react-native-safe-area-context` is a purely NATIVE view
and never reads `SafeAreaInsetsContext`.** It measures its own window. That is
why every other screen in this app works despite there being **no
`SafeAreaProvider` mounted anywhere** — and why this route did not: it is a
`fullScreenModal`, which react-native-screens presents as its own view
controller, and the native measurement there came back zero. Intermittently,
which is the signature of a measurement race.

So adding a provider alone would have fixed NOTHING. The fix is both halves:
a `SafeAreaProvider initialMetrics={initialWindowMetrics}` on the route, and
`LoadoutScaffold` / `LoadoutSavedStep` switched to `useSafeAreaInsets()`, which
is the API that actually reads it. ~~`SavedGymsPresenter` deliberately keeps
`SafeAreaView` — it is an ordinary Stack screen, outside that provider, where the
native path works.~~ **No longer true from 2026-08-02:** the saved-gyms surface
moved into the Train hub as the `Gyms` segment, so `SavedGymsPresenter` is hub
BODY content and renders no `SafeAreaView` at all — `TrainHubContainer` owns the
chrome and has already applied `insets.top`.

**Still open, app-wide:** with no root provider, every `SafeAreaInsetsContext`
consumer OUTSIDE the Loadout route still reads zero — including `BottomSheet`
(`BottomSheet.tsx:96` documents the `?? 0` fallback), so sheet CTAs get no
home-indicator padding anywhere else in the app. One `SafeAreaProvider` at the
app root fixes it and changes the bottom inset of every sheet — a real
improvement, and not one to make inside a feature branch without a device pass.

### Data bugs — open, not blocking Phase 2's critical path

- **T-E.10: `Leg Press` and `Leg Curl` carry `equipment_required = '{}'`** because
  their seeded equipment names have no `equipment_types` row (`Leg Press Machine` /
  `Leg Curl Machine`) and `seedExercises.ts`'s `resolve()` drops unmapped names
  **silently**. Since `x @> '{}'` is always true, **a bands-only athlete keeps the
  leg press** — in the seeded "Lower Body" and "Full Body Starter" workouts, i.e.
  the first two a new account owns. Needs a data migration **and** a seeder guard
  that fails loudly. It is not an engine bug, and it makes Loadout look broken on
  the default workouts, so it wants doing before Phase 2 is device-demoed.
- **T-E.11: `movement_type` is NULL for all 2281 seeded rows.** Only worth a
  backfill if a deterministic-only engine is ever revisited (Phase 5); recorded so
  the absence is not rediscovered.

### Ops / launch

- **⚠ Triage the ~7 open Dependabot alerts (3 CRITICAL).** Needs Brad's browser
  session or a `gh` re-auth with `security_events` — the CLI cannot enumerate them
  (see § Dependabot above). Before the App Store submission; the repo is PUBLIC.
- ~~**Verify Haiku 4.5 + the Opus-class scan model in the PRODUCTION Bedrock
  account.**~~ **DONE — Brad confirmed 2026-07-27: both model ids are granted and
  complete in production.** That covers `AI_LOADOUT_REMAP_MODEL_ID`
  (`eu.anthropic.claude-haiku-4-5-20251001-v1:0`) and `AI_EQUIPMENT_SCAN_MODEL_ID`
  (`eu.anthropic.claude-opus-4-6-v1`), so Loadout has **no prod Bedrock grant
  blocker**. ⚠ The per-account lesson still stands for any FUTURE model id —
  `eu.anthropic.claude-opus-5` remains UNGRANTED in prod, and assuming otherwise is
  what caused the 30-day silent outage.
- **Merge release PR #319** — see Current state. It now ships Loadout Phase 0's
  four migrations **AND** Phase 1's engine + two endpoints, not just the
  migrations. Verify the prod Haiku 4.5 grant first (item above): after this
  release the Lambda serves a model-backed route.
- ~~**PR #321** (`claude/loadout-phase-e`)~~ — **MERGED** as `e2bc595`.
- ~~**PR #322** (`claude/loadout-phase-1`)~~ — **MERGED** as `1a7b956`.
- **Carried forward from the archived log, still open** (they lived in session
  entries rather than the head sections, so the trim would otherwise have buried
  them — all three also persist in `memory/MEMORY.md`): `POST /sessions/record` is
  **not idempotent** (duplicate sessions on retry) and stuck-`failed` sync mutations
  are silent (`project_sync_architecture_audit`); **`supportsTablet: true` with no
  tablet layout** plus a fixed 170 px carousel that clips
  (`project_responsive_layout_audit`); and invite-QR / expo-clipboard were never
  device-verified — they need a **fresh EAS dev build**.
- **`premium_plus` launch flip** — `UPDATE subscription_tiers SET is_active = true
  WHERE tier_name='premium_plus';` in its own migration, **plus** attaching and
  submitting the two ASC products, **only** at the Loadout launch build. The
  products exist but are deliberately unsubmitted (an IAP product shipped with a
  build that offers no way to buy it is its own rejection).
- **Confirm the Supabase Data API is explicitly off** — the staging check returned
  `PGRST002` (schema-cache) rather than a clean 404, consistent with disabled but
  not proof. Verify in the dashboard.
- **Marketing site branch was never PR'd or deployed** —
  `claude/persistence-marketing-landing-3987c2`. Gates + IB were clean at the
  time; the waitlist/founding-discount section is deliberately excluded.
- **PR #21** (14 April, AI PT spec pack) — open 3½ months. Close or merge.
- **spec-26 Mealprint** has its own 6 open checkpoints (see `specs/26-.../BRIEF`
  § 9): AnyMeal branding/trademark, suggestion-tier + taster, ceiling numbers,
  marketing-site Premium+ copy, allergen vocabulary + disclaimer sign-off, P3
  timing.

### Dependabot — ⚠ ~7 alerts OPEN incl. 3 CRITICAL, and the CLI cannot see them

**⚠ DO NOT trust `gh api .../dependabot/alerts` in this repo — it silently returns
an INCOMPLETE list.** The push banner (server-side, full visibility) reported
**8 vulnerabilities: 3 critical, 5 high**, while both the REST alerts endpoint and
the GraphQL `vulnerabilityAlerts` query returned exactly **one** alert of any
state, and an explicit `?severity=critical` filter returned **zero**.

**Cause: the `gh` token lacks the `security_events` scope**
(`X-Oauth-Scopes: admin:org, admin:public_key, gist, repo, workflow`), which is
what GitHub requires for Dependabot alert visibility. The banner is the reliable
number — proven live, not cached: dismissing the one visible HIGH moved it from
"3 critical, 5 high" to **"3 critical, 4 high"** on the very next push.

**So ~7 alerts remain open, 3 of them CRITICAL, and their identity is UNKNOWN
from the CLI.** Brad must open
`https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/security/dependabot`
— or re-auth `gh` with `security_events` — before any agent can triage them.
**Worth doing before the App Store submission**, and note the repo is PUBLIC.

The one alert that WAS visible: **`react-router` 7.13.0 in `packages/web`** (high
— "RSC Mode CSRF Bypass"), patched only in **8.3.0, a major bump**. **Dismissed as
`not_used`** on Brad's call, and that analysis is independent of the count
problem: the advisory needs React Router's RSC mode with server actions, and
`packages/web` imports react-router purely for client-side routing
(`BrowserRouter` / `Routes` / `Route` / `Link` / `useLocation` — no
`react-router/rsc`, `routeRSCServerRequest` or `createCallServer` anywhere) and
ships as an SST `StaticSite`, so there is no server to execute an action on. The
vulnerable path is unreachable. **Revisit if `packages/web` ever adopts RSC mode
or a server runtime.**

### Closed by Brad 2026-07-27 — do not re-raise

BRIEF-7 device-QA batch (all ~20 bugs, signed off) · the one-time
`UPDATE profiles SET is_profile_public = false` · ASC support email + web custom
domain · App Store 3.1.2 Terms-of-Use link in ASC metadata · legal sign-off on
consent copy, privacy section and governing law · the OFF re-seed backfilling
`serving_quantity` across the ~143k seeded rows.

## Last session

**2026-08-05 — GTM D9 subscription UI implemented in isolated worktree.** Branch
`codex/gtm-d9-subscription-ui`, worktree
`/private/tmp/persistence-gtm-d9-subscription`, based on the Phase-2 coach-ladder
commit `adf7111e`. Added `@persistence/subscription-catalog` as the UI source of
truth; rebuilt the iOS persona/plans/manage rail and AI fail-safe; rebuilt web
pricing for individuals, coaches and organisations; and added the aggregate-only
organisation-admin preview with sub-five cohort suppression. `appStore=false`
renders every paid IAP control as non-interactive `Coming soon`; organisation
plans remain web-only/read-only in-app. Premium+ and suite-bearing coach/org tiers
lead with Loadout + Mealprint; no surface names competitors, adds a VAT caveat, or
lists “AI Workout Suggestions”.

- **Release blocker:** read-only checks of both public production and staging
  `/subscription-tiers` endpoints still returned the OLD five-row catalog
  (`premium` £12.99/£129.99, `individual_trainer` £14.99/£149.99, plus retired
  business tiers). The UI deliberately follows the approved launch catalog in
  `20260805120000_coach_ladder_restructure.sql` and must not ship until the live
  catalog/RevenueCat/ASC activation is aligned.
- Gates: catalog typecheck + 4/4; web lint/typecheck/build + 32/32 with 85.61%
  statement coverage; mobile lint/typecheck + 5908/5908. The first full mobile
  run exposed an old rail contract: Restore Purchases must be visible on the
  initial screen. The persona screen now carries restore + legal footer; the
  targeted regression passed and the whole suite passed on the clean rerun.
  Desktop, 390 px, all audience tabs and the suppressed admin state were visually
  verified in the in-app browser with no horizontal overflow.

**2026-08-04 (later) — Mealprint MERGED, and the pricing model moved to a 30 % Apple
rate.** Sixth Inspector Brad sweep returned MERGE; its four residuals were fixed in
`0c1ce767` with revert-verified tests, and the branch landed on `main` as `fa0567fc`
(PR #352).

- **The sweep-5 monotonic latch holds.** Sweep 6 attacked it from every angle named in
  the brief (ref-mutation during render under StrictMode, the change-bus flush ordering,
  the `useCachedResource` user-change path) and could not break it. The cross-user latch
  leak is real in the abstract but unreachable, because sign-out tears down the `(app)`
  group and the ref dies with the container. **It becomes a 🔴 the day this screen is
  made to survive a session flip.**
- **The 🟡 was a timer, not a wipe.** The 900 ms post-confirm dismiss called `close()`
  unconditionally, so it closed whichever sheet happened to be open when it fired —
  and its uncancelled handle was the "jest did not exit" warning that had been masking
  real open handles.
- **⚠ A CI "flake" was a real bug, and my first fix for it was wrong.** Two consecutive
  runs failed on two DIFFERENT tests in one suite, both stuck at the same stage. I
  raised RTL's `waitFor` budget — treating a correctness bug as a timing budget, which
  only moved which test lost the race. The actual cause: `onGenerate` treated "gate not
  yet resolved" as "denied" and paywalled an entitled user. **A flake that moves between
  tests is a race with a wrong outcome, not slowness.** Fixed properly by making the
  harness await the query's own promise, plus the `isResolved` guard the hook had always
  exposed for this.
- **⚠ A third test passed against its own reverted fix.** The NaN-guard test asserted
  before the seed effect had run, and the fallback value equals the initial state, so it
  proved nothing. Third occurrence in one branch. **Revert and watch it fail — always.**
- **Apple Small Business was NOT approved**, so every model now assumes 30 %. That
  reversed the earlier "hold Premium at £12.99" call (→ £14.99), tightened the budget
  rule to `max(3.5 × typical, 33 % of net)` capped at 40 %, and exposed one tier the
  rule cannot satisfy (Start Up Coach — spec-29 AC 2.3a, left OPEN rather than papered
  over). Superseded STATE.md sub-sections are struck through in place, not deleted.
- **The real finding is not a price.** `recipe_extract` on Opus is 55 % of Premium's
  worst case on its own. A cheaper vision model is worth more than every pricing lever
  in spec-29 combined — filed as C5 and flagged to run first.
- **Answering "will a normal user hit the cap?": no.** ~8 AI calls/day typical against
  ~27 allowed on Premium. But the pool is spent in **money**, not calls, and one
  endpoint is 44× another — so the honest answer required making the pool a rolling
  30-day window (AC 2.3b). On a daily window, a Sunday recipe-digitising batch fires
  the fail-safe and D9's headroom condition is **not** met.

**2026-08-04 — spec-26 Mealprint: the design pass, and the first time any of it
ran.** Branch `claude/mealprint-mobile-ui-9347a0` @ `9ca501f8`, updated from `main`
@ `dcc9726a`. Full detail in § "spec-26 Mealprint" above. The
four things worth carrying forward:

- **The stale-bundle diagnosis was right.** A fresh `expo run:ios` fixed all three
  "misses" at once. The ungated half now demonstrably works end-to-end, including a
  real save round trip. The entitled half has still never executed.
- **A design pass found a defect static review didn't.** The draft stage's confirm
  button sat below the fold in an 86 % sheet — on the step that writes to a food log.
  Fixed structurally with a new `BottomSheet.footer` region rather than by hoping the
  body scrolls. The device pass then found a second one nobody had seen: a section
  sub-label clipped off the right edge of the preferences form.
- **⚠ Two structural tests PASSED against the reverted fix on their first draft.**
  One asserted the CTA sat in a node *named* footer (true either way); the other used
  `/left today/`, which also matches the generic fallback copy "…you have left
  today". Both were caught only by deliberately reverting the fix and watching. The
  third-sweep lesson generalises: **a first-draft assertion is a hypothesis about
  your test, not just about your code — revert and watch it fail, every time.**
- **The brief's RevenueCat instruction was wrong for staging and I could not do it
  anyway.** A plain DB row suffices (verified in the repo); the Supabase connector
  only exposes prod. And the `update_subscription_limits` trigger demotes not just a
  coach but an **admin** to `'user'` — a trap the brief half-flagged.
- **⚠ Brad found a 🔴 by asking a UX question.** "Why is there no cancel button, only
  a skip?" was the third route into the allergen wipe — reachable in normal use on any
  reinstall, and invisible to the two guards written for the earlier routes. A
  destructive default is not made safe by guarding the path you happened to notice.
- **Brad's standing instruction on the design pass:** the design source never saw our
  tokens, so differences from it are often our palette being RIGHT. Nothing outside
  Mealprint was restyled — the hero ring and the rest of Fuel are untouched, and
  should stay that way.

**2026-08-03 (cont.) — PR [#351](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/351)
follow-up: Brad's 3 decisions applied, and BOTH deferred items built rather than
parked. The policy no longer has any claim without a mechanism behind it.**

- **Age floor DROPPED to 13, App Store content rating stays 9+ (Brad's call).**
  My recommendation was to raise the store rating to 16+ instead; Brad chose 13
  (the DPA 2018 s.9 statutory age). **⚠ CONSEQUENCE, now owed as its own
  workstream: a 9+ content rating is evidence the service is "likely to be
  accessed by children", so the Children's Code / Age Appropriate Design Code
  applies** — DPIA addendum, age-appropriate privacy wording, and a decision on
  whether an adult coach may see a 13-year-old's body-composition data. The
  policy now carries an under-18 warning about coach visibility, which is a
  mitigation, NOT compliance with the Code.
- **The retention prune is now REAL** —
  `application/retention/dataRetentionSweep.ts` + `dataRetentionRepository.ts`,
  riding the nightly `accountPurgeCron` in its own try/catch after the
  compliance-critical purge (same isolation pattern as `aiJobMaintenanceSweep`).
  Deliberately implemented as **backend Drizzle deletes, NOT a call to
  `cleanup_old_health_data()`** — that function is admin-gated on `auth.uid()`,
  which is NULL on the pooler the cron uses, so wiring it up would have failed
  every night while looking correct. The SQL function stays as manual tooling.
  Policy wording tightened from "periodically" to a firm 12-month ceiling with
  nightly deletion, because it is now true.
  - **⚠ A real bug found by writing the test:** my first cutoff used
    `setUTCMonth(m - 12)`, which OVERFLOWS rather than clamping — 29 Feb 2028
    minus 12 months gave 1 Mar 2027, moving the cutoff FORWARD and deleting a day
    of data the policy promises to keep. Silent leap-year data loss, not a crash.
    Now clamps to the last valid day of the target month.
- **Coach AI summaries are now DELETED at teardown**, in the same transaction as
  the assignment deletes, scoped to `(client_id, trainer_id)` and counted in the
  `relationship_terminated` audit payload. Reason it had to be a delete and not a
  read gate: teardown is a soft end and reconnecting **revives the same
  relationship row**, so summaries keyed on the pair silently came back. The read
  guard was working as designed; the rows should not have survived.
- **Stripe is NOT dead after all — Brad may keep it for business deals via the
  website.** Supersedes the "historic subscriptions only" wording I shipped
  earlier today and the removal recon in `specs/stripe-rail-removal/RECON.md`.
  Policy now describes it as card processing for subscriptions paid directly
  rather than through the App Store.
- **⚠ THE STALE BASE WAS A CORRECTNESS PROBLEM, NOT HOUSEKEEPING — IB caught it.**
  Mealprint (#350, `6c77dfe3`) merged to `main` DURING this review and carries two
  things the policy is supposed to enumerate:
  - **`POST /nutrition/ai/meal-suggest` is a mounted, live Bedrock endpoint**
    (`nutritionRoutes.ts`), absent from the §5 AI list → the exact Art 13(1)(c)
    gap this PR was raised to close, reopened by a merge.
  - **`nutrition_preferences` holds a SECOND special-category type the policy had
    no basis for.** `dietary_patterns` permits `'halal'` and `'kosher'`, which
    reveal **religious belief** — a *separate* Art 9(1) category from health, so a
    9(2)(a) basis worded only around "health and body metrics" did not reach it.
    `avoid_allergens` is the FIC-14 list (health). Art 9(2)(a) is now rewritten to
    cover both, and §3 has a "Food preferences" bullet.
  - **LESSON: rebase BEFORE the final review pass on anything that enumerates the
    system.** A policy, a route inventory or an entitlement matrix can be made
    stale by someone else's merge, and both "discloses every AI path" tests passed
    against the incomplete list — a hardcoded enumeration cannot detect an
    ADDITION. Mitigated with a ⚠ pointer comment at the AI route mounts.
- **Verified and worth keeping: the allergen/religious data never reaches
  Bedrock.** `forbiddenAllergenTags` / `forbiddenPatternAllergenTags` filter the
  candidate shortlist server-side; `composeSuggestions` gets only shape,
  remaining macros, steer, candidates, likedFoods, effortLevel, locale — then
  `verifySuggestions` re-checks. The policy says so, which is a genuinely
  favourable and accurate claim.
- **A firm published promise needs an alarm, not just a log line.** The retention
  catch now calls `captureFatal` — without it the swallowed error left the
  Lambda's `Errors` metric at zero, so `cron-errors-account-purge-sweep` never
  fires and the dead-man's switch only sees non-INVOCATION. The sweep could have
  been broken from night one while looking wired up.
- **`daily_activity_data.activity_date` / `sleep_data.sleep_date` are Postgres
  `DATE`, and the Drizzle mirror's `text(...)` is STALE**
  (`001_initial_schema.sql:629,644`; `health/sleep/sleepDate.ts` already
  documents it with a real 22008 symptom). My first comment reasoned about
  lexicographic text ordering, which is not what executes. ⚠ PgDialect renders
  byte-identically for `text` vs `date`, so the mocked-DB blind spot is NOT
  closed by a rendered-SQL assertion — pin the PARAMS.
- Added `20260803180000_client_data_access_log_created_at_idx.sql`: neither
  existing index leads with `created_at`, so the prune was a seq scan on a
  high-volume table — worst on the first run, which faces the entire
  never-pruned backlog.
- Gates on the rebased base: prettier, typecheck 8/8, lint 0 errors, **full core
  suite 311 files / 3786 tests green with `application/retention` at 100%**, 27
  web page tests, 14 presenter tests.

**2026-08-03 — PRIVACY POLICY revision against Brad's legal brief. Branch
`claude/persistence-privacy-policy-1857c8`, PR #351. Every factual claim was
checked against the code; two of the brief's own assumptions turned out wrong.**

- **The in-app policy was a DIFFERENT DOCUMENT from the hosted one, and the brief
  didn't know it.** `PrivacyPolicyPresenter.tsx` still carried the legacy port —
  "Last Updated: January 2025", age floor **13**, "analytics providers" we don't
  use, no legal bases, no coach-sharing section, no transfer position. Two
  contradicting live policies is itself an Art 5(1)(a) accuracy breach, so Brad
  chose to replace the in-app body with the canonical copy. **Content parity beat
  port fidelity here** — layout/styles/props/testIDs untouched. Both files now
  carry a "change both together, or neither" header comment.
- **The brief's `[two] years` for the consent + access log was wrong both ways.**
  `data_sharing_consents` is `ON DELETE CASCADE` off `profiles` → deleted **with
  the account**, never pruned otherwise. `client_data_access_log` is **12 months**,
  not 24 (`20260721000000_client_data_access_log.sql`). The accurate position is
  more privacy-favourable than the draft, so the policy now says both are deleted
  with the account, access log on a 12-month rolling window.
- **⚠ The 12-month prune is ADMIN-GATED AND MANUAL — no pg_cron is wired up.**
  `cleanup_old_health_data()` raises unless `auth.uid()` is an admin, and nothing
  schedules it. The policy's "up to 12 months" is therefore a claim Brad cannot
  currently enforce. There IS already a nightly `sst.aws.Cron` (`accountPurgeCron`)
  to hang it off. **Same gap on the 6-year transaction claim:** `stripe_webhook_events`
  / `revenuecat_webhook_events` have no FK to `profiles` and are in NO deletion
  plan, so they persist **indefinitely** — retention is currently longer than the
  policy states, which is the direction that actually bites.
- **Meal photos are genuinely never stored — verified, and worth saying loudly.**
  `nutritionAiEstimateHandler` takes base64 in the request body, forwards to
  Bedrock, persists nothing; the only bucket in `infra/storage.ts` is `Avatars`;
  `ai_usage_log` stores sizes/ms only; `meals.photoUrl` exists but no code path
  ever sets it. AI runs on `eu.anthropic.*` inference profiles from eu-west-2, so
  the "UK and EU" claim is accurate too.
- **Transfers → the brief's Version B** (Stripe/RevenueCat/Sentry/Expo are all
  US-HQ). **Cookies → strictly-necessary only, verified:** zero analytics deps,
  zero external CDN/font hosts, the only `localStorage` is the theme toggle plus
  the Supabase auth session. No banner needed, and the policy says so.
- **Stripe is now described as historic-only.** Only `/stripe/webhook` is mounted;
  there is no checkout endpoint and mobile Stripe was stripped in #336. If prod
  has zero legacy Stripe subs, drop it from the provider list entirely (recon
  already parked at `specs/stripe-rail-removal/RECON.md`).
- **Also disclosed, because the code says so:** the `Avatars` bucket is
  `access: "public"`, so a profile photo is reachable by URL. The policy now says
  that plainly rather than implying strict scoping.
- **Left OUT deliberately, pending Brad:** the "we review our security
  arrangements periodically" bullet (unverifiable), and Supabase MFA — Brad
  confirmed **AWS only**, so the bullet says "our hosting console", not "all
  systems". Age floor set to **16**; this MUST be reconciled with the App Store /
  Play age rating, which is not in the repo.
- **⚠ INSPECTOR BRAD FOUND THE BIGGEST GAP, and it was the opposite of
  over-claiming: the policy disclosed AI on PHOTOS ONLY.** Five further Bedrock
  paths are live and were undisclosed — `/nutrition/ai/estimate-text`,
  `/resolve-ingredient`, `/estimate-recipe`, the Loadout remap, and worst,
  `POST /trainers/me/clients/:id/ai-summary`, which sends a client's first name,
  weight/goal weight, PRs and 28-day adherence to Bedrock **and persists the
  generated narrative** in `client_ai_summaries`. Art 13(1)(c)/(e) gap on
  special-category data. §5 is now "AI features and what they do with your data"
  with all five paths, and the coach summary is called out as the one output that
  IS stored.
  - **Sub-finding I nearly shipped:** I first wrote that the summary is deleted
    "when the coaching relationship ends". It isn't —
    `relationships/endCoachClientRelationship.ts` deletes ONLY
    `programAssignments` + `workoutAssignments`. The row survives teardown;
    access is cut by the relationship-status gate. Wording corrected.
- Other IB fixes: transaction retention is now "**at least** six years" with the
  real payload described (billing email, card type/last4 — the column is the whole
  webhook event, not just id + plan); the 12-month claims softened to periodic
  removal since nothing schedules the prune; geography unified on "UK or EEA
  regions"; the cookies section's sign-in clause dropped (**packages/web has no
  auth at all** — `Login.tsx` is a placeholder, the only browser storage is the
  theme key); "restore by signing back in" corrected to require the confirm that
  calls `POST /account/restore`; ⚠ pointer comments added on `photoUrl` in
  `mealsCreateHandler` / `recipesCreateHandler`, since the not-stored claim holds
  only because no client sets them.
- **⚠ IB's second-order trap on the obvious prune fix:** hanging
  `cleanup_old_health_data()` off `accountPurgeCron` will FAIL — that Lambda uses
  the RLS-bypassing pooler where `auth.uid()` is NULL, so the function's admin
  guard raises `Authentication required` every night. Needs a separate
  `SECURITY DEFINER` entry point or a service-role branch in the guard first.
- **Also flagged, not fixed:** `POST /subscriptions` is still mounted and still
  creates live Stripe subscriptions from a `payment_method_id`. No shipping client
  calls it, so "we never see or hold your card details" stays literally true (it
  takes a token), but the endpoint is warm — so "historic subscriptions" is a
  statement of intent, not of what the API can do.
- **⚠ MY OWN FIX FOR THAT INTRODUCED A NEW FALSE CLAIM, caught on the re-sweep:**
  I wrote "Recipes from a photo **or link**" into the AI section. The link path
  has **no AI at all** — `recipesImportHandler` is deterministic Schema.org
  `ld+json` scraping ("no AI fallback (Conflict C3)"), and `grep -ril
  "bedrock|anthropic" recipes/` is empty — AND `recipes.source_url` **is
  persisted**, so the blanket "not stored" sentence was false for it too. Wrong
  in both directions at once. Now a separate "Importing a recipe from a link"
  subsection: no AI, our servers fetch the page so the destination site sees a
  request from US not the user (an outbound-processing fact the policy had never
  mentioned), and the stored link is carved out of the not-stored sentence.
  **LESSON: broadening a disclosure is not automatically safer — a too-wide claim
  is as inaccurate as a too-narrow one.**
- Also from the re-sweep: coach↔client teardown is a SOFT end and re-accepting
  **revives the same relationship row**, so every `client_ai_summaries` row from
  the previous cycle becomes readable again (keyed `(trainer_id, client_id,
  covers_date)`, never deleted on teardown). Policy now says so. The alternative —
  deleting those rows in the teardown transaction, which already runs deletes —
  is a behaviour change and deliberately NOT in this PR.
- Added `packages/web/src/pages/__tests__/Privacy.test.tsx` — the hosted copy, the
  higher-exposure one, had NO tests while the in-app copy had nine. Review was the
  only parity control, and review is exactly what failed and produced the
  divergence. Two assertions mutation-checked (reverted, watched fail, restored).
  The suites are now symmetric — the loose-retention assertions exist on BOTH
  sides, because tightening "at least six years" or "periodically" is precisely
  the edit that re-creates the false claim. The heading inventory earned its keep
  immediately: it caught a stale web assertion left behind when the recipe bullet
  was renamed.
- Gates: prettier, typecheck (8/8), lint (0 errors), 11 presenter + 23 web page +
  90 meals/recipes handler tests green. Hosted page verified rendering in the
  browser. **The in-app screen was NOT device-verified** — the worktree can't boot
  the app (`.env` is gitignored and `EXPO_PUBLIC_SUPABASE_*` wouldn't inline even
  after a cache-clear). Residual risk is only "does a taller ScrollView scroll",
  with byte-identical styles on a screen that already scrolled.

**2026-08-03 — spec-26 Mealprint T-0.6 + T-1.5, the mobile half.** Branch
`claude/mealprint-mobile-ui-9347a0` @ `257ec1b1`, 5 commits, PR NOT raised. All
five gates green (476 suites / 5878 tests, ≥ 90 % coverage on every new file); NOT
device-verified, and the simulator attempt failed on a stale bundle rather than on
the code — details and the remaining checklist are in § "spec-26 Mealprint — MOBILE
HALF BUILT" above. THREE Inspector Brad sweeps found 9 issues including one 🔴 where
the wizard's Skip could silently delete a user's saved allergen list; all fixed. The
part worth remembering: sweep 2 found a bug that sweep 1's fix created, and sweep 3
found that sweep 2's fix had shipped with no test at all.


**2026-08-02 — PR [#339](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/339)
REBASED onto `main` @ `c7ad458`, given the Inspector Brad sweep it had never had,
Brad's two device-QA reports root-caused, and MERGED. IB clean @ `61698f8`, all
5 CI checks green. The device pass is deliberately AFTER the merge: the deploy
it triggers is what first puts this branch's API behind the mobile client.**

- **⚠ BOTH device-QA reports were the SAME thing, and neither was a defect in the
  branch: staging is running `main`, and this PR's backend is not deployed.**
  `workoutVariationsReplaceHandler` is the only backend file the PR ADDS, and
  `deploy-staging.yml` fires on `push: branches: [main]` only. So
  `PUT /workouts/:parentId/variations/:variationId` has never existed on the
  staging API, while the device build carried this branch's client.
  - *"Couldn't save this setup — Not found"* was **Elysia's ROUTER**, not either
    handler. The handlers' own 404 always carries `loadoutCode: "not_found"`; the
    bare string `"Not found"` is `coreErrorHandler`'s `codeToLabel("NOT_FOUND")`.
    That distinction is the whole diagnosis — worth remembering next time a
    Loadout call 404s.
  - The false *"your gym equipment has changed"* traces to the same gap.
    Verified in staging SQL, not inferred: `saved_gyms` `Mock Gym` (904cfa01)
    holds 3 ids with `updated_at == created_at` — **never modified** — while
    `Upper · Mock Gym` (f5bd83e2) has `source_equipment_type_ids = '{}'`.
    `main`'s create handler has ZERO occurrences of `EMPTY_EQUIPMENT_CONTEXT`,
    so the deployed backend still persists `[]` where this branch 400s and falls
    back to the resolved gym kit.
  - **LESSON: when device QA fails on a feature branch, check what the API
    actually has before reading client code.** Mobile ships through EAS
    independently of the backend; a client ahead of the deployed API is a real
    and recurring shape, not just a test artefact. Two reports, hours of client
    reasoning, one `git cat-file -e origin/main:<handler>` would have said it.
  - **⚠ That stale row is unrepairable** — the kit that produced the adaptation
    was never recorded. The banner no longer fires on it (fix below), but delete
    it if it gets confusing.
- **Three fixes came out of it that stand on their own.** `hasGymEquipmentChanged`
  treats an EMPTY frozen snapshot as *unrecorded* rather than *changed* (nothing
  the user can do makes 0 and 3 agree). Every save-failure code gets copy naming
  what to do — only 2 of 9 did, so seven codes plus 404/402/500 all read "Check
  your connection", which is why the report was undiagnosable from the screen —
  with a `never` assertion so a tenth code is a compile error, and tests derived
  from `LOADOUT_ERROR_CODES` rather than a hand-copied list. And a 404 carrying
  no `loadoutCode` reads "not available right now" instead of "your setup is
  gone".
- **⚠ `ess-dev` / `ess-prod` AWS SSO are EXPIRED** — no CloudWatch access this
  session, which is why the 404 was diagnosed from `git` and staging SQL instead
  of from logs. `aws sso login --profile ess-dev`. Prod Supabase via MCP also
  returns "no permission"; staging (nxkhlrvjxotyjulodxzk) works.

- **The rebase conflicted on exactly two files, and the conflict was the
  interesting part.** `SwapExercisePopover.tsx` + its test, against **#340** —
  the App Store hotfix that also fixed a bug Brad hit live (active workout →
  swap → Create exercise → back → not in the list) by re-running the picker's
  cache read on the exercise change bus. **This branch deletes that picker**:
  T-2.7 makes it a thin adapter over `<EquipmentAwareSwapSheet>`, whose list is
  `GET /exercises/substitutes`. Neither side was resolvable alone — keeping
  #340's three regression tests tests a component that no longer exists;
  dropping them reopens the bug, because `createExerciseCommand` is offline-first
  (`local-<uuid>` into `cached_exercises`, enqueue `POST /exercises`, no inline
  flush) so a server-backed list cannot return a just-created exercise, and the
  sheet's own header CTA is the route to creating one.
  - Restored where the list now lives: `localOnlyCandidates` feeds pending-sync
    rows into the sheet under "CREATED ON THIS DEVICE", invalidated by the same
    two signals #340 used. Keyed on the `local-` id prefix, NOT `isCustom` — a
    synced custom exercise has a server id and the endpoint ranks it, so
    `isCustom` would list every one of them twice.
  - `STATE.md` was the third conflict; both sides' session entries kept.
- **⚠ LESSON, and it generalises past this PR: a textual conflict is a signal,
  not the finding.** Two files conflicted; a third file (`EquipmentAwareSwapSheet`)
  auto-merged clean and was where the actual regression lived. Git also
  auto-merged #340's three appended tests into the branch's rewritten test file,
  where they would have failed — the only reason the loss was visible at all.
  When a rebase crosses a behavioural rewrite, diff the INTENT of both sides.
- **Inspector Brad: 5 sweeps, 19 findings, clean @ `f2879d5`.** No sweep had ever
  been recorded on this PR. The two that would have shipped real bugs:
  - 🟠 the in-session swap **422'd on an unsynced source** — `forExerciseId` is
    UUID-validated and a session row legitimately holds a `local-…` id after you
    swap in an exercise you just created, so the sheet blamed the network for a
    row the server had never heard of;
  - 🟡 **review decisions survived a re-collect** — `droppedRows`/`acceptedRows`/
    `pickedNames` are keyed by parent `sortOrder`, and `acceptedRows` now decides
    whether a row is SAVED, so an accepted `intensity_mismatch` could be written
    with no UI ever showing it. Fixed with a `collectRev` counter on the store:
    the same-gym re-collect needs the collect EVENT, not the context value,
    because stage 2 of the adaptation is an LLM.
  - Also: ~800 un-virtualised rows after `CANDIDATE_LIMIT` went to 400 (capped at
    50 rendered per group, sliced AFTER matching); a stale debounced search term
    across a clear-and-retype; and **five separate instances of the same
    close-animation bug** — `BottomSheet` keeps children painted through the
    slide-down, so clearing `isLoading` / `result` / `error` / `query` /
    `pendingOverride` on the close edge each gave the user a frame of the list
    they just tapped turning into an empty state. Reset on the OPEN edge, in the
    render phase.
- **Recurring shape worth remembering: `visible` is not a lifecycle.** #341/#343
  established that closing a sheet is not an unmount, for FETCHING. The same fact
  governs RENDERING — and the correct gate differs per concern: fetch on
  `visible`, reset on the open edge, and cache-read on a `hasOpened` latch (an
  ungated read put a full `cached_exercises` scan on the active-session first
  frame, which is the #341 shape exactly).
- Every fix carries a test verified by MUTATION, not assertion — reverted, watched
  fail, restored.
- **⚠ Untracked local files break the root gates and are not on any branch:**
  `microservices/core/probe-steps.ts` (4 × `no-explicit-any` + prettier) and
  `.agents/skills/sst-resource-change/SKILL.md` (prettier). Don't let
  `probe-steps.ts` get swept into a commit.

**2026-07-31 — APP STORE REJECTION (Guideline 4) + swap-picker refresh bug. PR
[#340](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/340)
OPEN off `main`, branch `claude/signin-apple-design-fix-78rvv9`. Full mobile
suite green: 459 suites / 5304 tests, typecheck clean, prettier clean, lint
clean (2 pre-existing `react/display-name` errors in `__tests__/setup.ts` are
baseline, not from this branch). NOT device-verified — the Apple button is a
native view that cannot render under Jest, so no test proves how it looks.
Check it on a real build, ideally on iPad (the review device was an iPad Air
11-inch M3).**

- **Rejection cause: we drew the Sign in with Apple button ourselves.** Both
  auth screens rendered a generic `<OAuthButton>` with `icon={""}` — the
  Apple logo private-use glyph in the app's own font. Apple's wording was "logo
  artwork that is not downloaded from Apple Design Resources". The whole control
  was app-drawn (our border, surface, typeface, copy), so it failed on every
  axis, not just the mark.
  - Fixed with `<AppleSignInButton>` (`src/ui/components/AppleSignInButton.tsx`),
    a thin wrapper around `expo-apple-authentication`'s
    `AppleAuthenticationButton`. **No assets were downloaded and none are
    needed** — Apple's component supplies artwork, label, typeface,
    localisation, and light/dark variants natively. The dependency and its
    config plugin were already in `app.json` for the auth flow itself.
  - `buttonType=CONTINUE` (copy unchanged from what shipped), `buttonStyle=WHITE`
    (dark-only app), `cornerRadius=14`, height 52 to match the Google button so
    SIWA is no less prominent (HIG).
  - **Do not re-skin this.** No image, icon font, or glyph; no `backgroundColor`
    / `borderRadius` via `style`; no overlay on the artwork. The loading state
    dims + blocks rather than swapping in a "Connecting..." label, because
    obscuring the button is itself a Guideline 4 failure.
- **Swap picker didn't show exercises created mid-flow** (Brad hit this live:
  active workout → swap → create exercise → not in list). `SwapExercisePopover`
  memoised its cache read on `[storage, cacheVersion]`; `cacheVersion` only bumps
  after a *stale 24h* refresh, and the popover stays mounted between opens. So a
  freshly created exercise landed in `cached_exercises` and the list never
  re-read. Added `useCacheRevision(EXERCISE_TABLES)` + `useExerciseLibrary`
  revision — **the exact wiring `AddExercisePopover` already had**; the swap
  picker was simply missed when that fix went in. 3 regression tests, verified
  failing without the fix.
- **⚠ #337's SQLSTATE 23514 fix is merged to `main` but in NO release tag.**
  `c8a0b6d` sits above `persistence-v1.10.0` (`1ad9caa`, 2026-07-29). Production
  therefore still has the session-rating bug. An Apple reviewer hit a production
  Sentry error at **2026-07-30 22:26 UTC** on iPad Air 11-inch (M3) — after #337
  merged (15:37 UTC) but while prod was still unpatched. **Not confirmed to be
  the same error** — the Sentry MCP connector was disconnected this session, so
  the issue (137728287) could not be read. If it is 23514, resubmitting the app
  alone will NOT fix it; it needs a release + deploy.
- **⚠ OPEN, deliberately deferred off PR #340: two more `cached_exercises`
  readers have no exercise-cache invalidation.** `WorkoutsListContainer` (memo
  deps `[saved, templates, storage]`) and `WorkoutDetailContainer` (`[workout,
  storage]`) both call `storage.getCachedExercises()` but are driven off
  `useCacheRevision(WORKOUT_TABLES)`, which does not move on an exercise write.
  Cold start renders Train before `refreshExerciseCache` lands → split badges /
  muscle pills / equipment eyebrow compute against an empty library and never
  recompute. Self-heals on the next focus `rereadCache`, so it is a first-paint
  degradation, not a stuck state — that plus PR #340 being an App Store release
  blocker is why it was left out. Fix is `useCacheRevision(EXERCISE_TABLES)`
  folded into each memo, same one-liner as the other five surfaces, **with a
  revert-checked regression test each** (see below).
- **Lesson from #340, worth keeping: do NOT blanket-propagate the exercise
  change bus.** It is correct for LIST-shaped reads (`getCachedExercises()`),
  which re-read and find a row under its new key. It is WRONG for
  `useExercise`, a single-id read: the sync drain rekeys `local-*` → server id
  via DELETE+INSERT, so the bus makes `initial` recompute to null, blanks a
  loaded row, and re-arms the one-shot fetch against the dead id → 404 (and on
  the editor, discards in-progress form input). This was actually shipped in a
  #340 commit and reverted after Inspector Brad demonstrated it. `useExercise`
  now carries a regression test that fails if someone re-adds the bus.
  - **Still open (pre-existing, also on `main`, NOT caused by #340): a detail
    screen already open when the drain fires keeps the dead `local-*` id in its
    route param**, so `ExerciseDetailContainer.onEdit` → `ExerciseEditorContainer`
    mounts on it, misses cache and 404s. Delete has the same shape. The list fix
    only closes *fresh* navigation. Real fix is the drain publishing the old→new
    mapping, or the route swapping its param — not a bus subscription.
- **Parked, not started: "Create & Add" CTA in the create-exercise flow.** Brad
  asked, gated on difficulty. It needs pending-intent plumbing (the picker must
  close for the full-screen creator, so `pickerMode` can't just persist), a
  route param, a presenter CTA, and a focus-time dispatch in
  `ActiveSessionContainer` — a real slice touching the active-session state
  machine. Deliberately kept out of a release-blocking hotfix branch.

**2026-07-28 — HOME TRAIN RING + WORKOUT DURATION bug fixes. PR
[#334](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/334)
OPEN off `main`, branch `claude/fix-train-ring-and-duration` (5 commits, head
`25189f22`). All gates green; 4 Inspector-Brad passes (8 + 6 + 4 findings fixed,
final pass clean). NOT device-verified — and that matters more than usual here,
see below.**

- **Both reported bugs were hardcoded constants, not broken maths.**
  - Workout duration was always 30: V2 dropped legacy's `calculateWorkoutDuration`
    at port time and kept only its fallback constant, the form seeded 30, and the
    backend's `?? 30` therefore never fired. Ported the heuristic to
    `application/workouts/estimateDuration.ts` and made it SERVER-side so all three
    authoring paths share it.
  - Train ring read 45% for a heavy session: it was weekly volume ÷ a hardcoded
    20,000 kg (8,960 ÷ 20,000 = 44.8%). Now daily HealthKit active energy. Weekly
    volume was already on the Home card + You VolumeStats, so nothing was lost.
- **Move's goal now reads the user's Steps habit target** (`habit_configs`), falling
  back to 10k. Active energy has no habit equivalent — `calories` there is nutrition
  INTAKE (`within_tolerance`, feeds Fuel) — so its goal is a **500 kcal stopgap**.
- **⚠ OPEN PRODUCT QUESTION for Brad, recorded as spec 06 AC 1.2b.** Move and Train
  now BOTH read HealthKit, so a user who declines Health permissions sees the hero
  dial at a permanent 0%, even right after logging a workout. Before this, Train came
  from server-side volume and moved without device permission. Options: gate
  Move/Train like Fuel, or rely on the connect prompt. Recommended gating; not decided.
- **⚠ TWO migrations need manual prod apply**: the duration backfill
  (`20260728121000_backfill_workout_estimated_duration.sql`) and SQLite migration 1
  (ships with the app, clears `cached_home`).
- **Latent bug this surfaced: HealthKit energy reads had no explicit unit.**
  `preferredUnits(for:)` returns kJ on AU/NZ devices and for anyone with the Health
  app set to kJ — 4.184× high. Both energy reads now pass `unit: "kcal"`. Pre-existing;
  the new ring is what would have made it visible.
- **The backfill nearly destroyed real data — twice.** First scoping assumed a stored
  30 could only be the V2 default; the still-live LEGACY app sends
  `max(15, 2n + totalSets)` EXPLICITLY, which is exactly 30 for 5 exercises × 4 sets.
  Then the same flip-flop reappeared via the edit path (the editor sent the full plan
  on every PATCH, so a rename re-derived). Both closed. **Backfill validated against
  STAGING read-only** — SELECT + EXPLAIN + case-by-case discriminator check.
- Unrelated pre-existing flake noted: `useAutoRetryOnUpgrade › flip-flop mid-flush`
  fails intermittently under full-suite parallelism, passes 7/7 in isolation.

**2026-07-28 — LOADOUT Phase 2's SCREENS + Phase 3's scan sheet. Branch
`claude/loadout-phase-2-screens` (3 commits off `dfeed666`), NOT merged, NOT
device-verified. The first user-reachable Loadout surface: before this, every
Loadout phase was contract, engine and step machine with nothing attached.**

- **Shipped T-2.2…T-2.9, T-3.4 and T-3.5's mobile half.** Entry card + locked
  upsell, collect (scan / picker / saved gym), manual checklist with name +
  save toggle, adapting skeleton, review with per-row reasons and swap, saved
  setups on the parent, save and save-and-start, success, and saved-gym
  management under Profile · Account. Recreated in the app's primitives and
  tokens from `~/Downloads/Any Gym/project/` — no lifted prototype JSX.
- **The load-bearing decisions are in `tasks.md`
  § "Landed in Phase 2's screens beyond the checklist"** and § Open items above.
  The two most likely to be undone by a well-meaning refactor: the flow is the
  **`/(app)/loadout` route** (`fullScreenModal`) — NOT a root-mounted overlay,
  which was tried twice and broke on device both times (see § Loadout Phase 2's
  screens) — and the swap sheet's containment context is
  **`preview.equipmentTypeIds`** — the kit the SERVER resolved — never the
  client's saved-gym row.
- **Fixed in passing, each found by building against it:** `SnapAISheetContainer`
  resized **width-only** under a comment promising a long edge, so every portrait
  photo shipped ~1/3 over the token budget and small ones were UPSCALED (now a
  shared `resizeToLongEdge`, used by the scan too, which matters more there —
  Opus-class at $0.0272 an inference); `SwapExercisePopover` listed the **local,
  not-visibility-aware** exercise cache and so could not enforce AC-3.6 (now
  `/exercises/substitutes`, with a refresh-and-retry guard because
  `applyPickerSelection` resolves the pick through that cache and returns
  **silently** on a miss); the in-memory adapter's saved-gym 409 carried no
  `loadoutCode`, making the rename-vs-fail branch untestable.
- **⚠ A REAL bug the mutation sweep surfaced, not the tests:** "Choose one" on an
  `unresolved` row opened an EMPTY picker. An unresolved row has
  `exerciseId: null` by definition, so ranking against it sent
  `forExerciseId: null` — on the one row that most needs replacing.
  `adaptWorkout` sets `substitutedFromExerciseId` to the source precisely so the
  original stays reachable; the container now falls back to it.
- **⚠ A literal U+0000 reached a commit and passed EVERY gate.** It was the array
  separator in `EquipmentAwareSwapSheet`. Prettier, ESLint, Babel and `tsc` all
  accepted it while git treated the file as BINARY — so the one component that
  derives `isUserOverride` rendered as "Binary file not shown" and could not be
  3-way merged. Only Inspector Brad caught it. `file <path>` saying "data" is the
  tell; § Active gotchas now records it.
- **IB: 1 sweep (10 findings: 1 🔴 / 2 🟠 / 5 🟡 / 2 🟢, all addressed) + 1 CLOSED
  verification pass (7 of 8 confirmed closed, 4 residuals + 1 🔵, all addressed).**
  The 🔴 was a permanent hang: the preview request's dedup key was never cleared,
  so re-adapting the same (workout, gym) pair after a close issued no request and
  left the skeleton forever — with no retry affordance, because that only renders
  on an error. The closed pass then found the SAME hang by a second route (a fresh
  `context` object with identical contents cancelled the in-flight request and
  declined to replace it). Two 🟠: the flow's saved-gym list was fetched once per
  app *session*, feeding a stale kit to the swap sheet's containment context; and a
  throw in the scan's image pipeline stranded the sheet on a spinner with no exit.
  **CI action NOT fired** — 1 sweep + 1 closed pass, per the two-sweep cap.
- **LESSON — a surviving mutant has three causes and only one is a test gap.**
  Missing test (write it), dead branch (delete it), or two layers guarding
  different channels (annotate it). This slice hit all three: a real gap in the
  drop filter, a genuinely unreachable un-drop-on-pick branch that was deleted,
  and the touch-vs-a11y `disabled` pair that must stay. Guessing wrong either way
  costs quality — a test that cannot fail, or a deleted safety net.
- **Gates:** prettier (whole tree) · typecheck 8/8 · lint 0-err · build 13/13 ·
  test:unit 19/19 (mobile **460 suites / 5409 tests**; core 285 files / 3123;
  scripts 3 / 112). Mobile coverage 96.55 / 91.01 / 96.63 / 98.01; every new
  Loadout presenter at or near **100 %**. ~60 mutations applied across the new
  guards; all caught bar three annotated redundant-by-design pairs.
- **PR #328 raised; TWO red CI runs before green, both my own doing, and the
  pattern is the lesson.** Run 1 failed on the saved-gym delete test — which I had
  already seen fail locally once and dismissed as the known parallel-load flake.
  It was not: confirming a delete cleared `pendingDeleteId`, which swapped the
  confirm card back for the ROW, and `remove()` takes TWO sequential round trips
  before the list re-reads — so the row the user just deleted **reappeared** for
  that whole window, reading as "the delete didn't work". Fixed with an optimistic
  hide (restored on failure; both directions mutation-verified), and the assertion
  now waits for the cause before the effect. Run 2 failed on a different test with
  a 5000 ms **per-test timeout** in a suite CI took **50.76 s** to run: the six new
  suites were missing the `jest.setTimeout` every other heavy container suite here
  already sets. Green on run 3.
- **⚠ NEXT: device-verify on an EAS dev build against staging (the checklist is in
  the PR body), then merge.** Nothing else is outstanding on the branch.

**2026-07-28 (cont.) — Brad's device run, and the three things it found. All on
the same branch; the flow is STILL not verified working end-to-end by me.**

- **The screens were unreachable, twice, for two different presentation
  reasons.** Attempt 1 mounted the flow as an absolute-fill sibling of the Stack;
  the entry point is `workouts/[id]/index`, which is `presentation: "modal"`, so
  the whole flow rendered *behind* the workout sheet and tapping the card did
  nothing. Attempt 2 wrapped that in an RN `<Modal>` and was **worse** — a
  root-mounted modal cannot present over an already-presented route, so it froze
  the screen with an invisible modal swallowing touches. Brad's detail
  ("if i swipe away the workout, the rest of the screen freezes") is what
  identified it. Now the `/(app)/loadout` route. **The lesson is that I reached
  for fix 2 without re-examining fix 1's premise.**
- **⚠ A BACKEND 500 was the real blocker behind "Couldn't adapt this workout",
  now SPLIT OUT to PR #332 at Brad's request — I could not have found it from
  the mobile side** — the client only sees a
  generic error. Brad pasted the stack trace and it was immediate:
  ``sql`${array}::uuid[]` `` renders a ROW constructor. Four predicates in
  `exerciseRepository`; two of them three months old and never executed, because
  the exercise library filters locally from its SQLite cache. See § Active
  gotchas. **#332 must merge AND staging must be redeployed
  (`deploy-staging.yml` takes a `workflow_dispatch`) before the flow can work on
  device.**
- **⚠ A render test that PINNED the bug.** `exerciseRepositoryLoadout.test.ts`
  already rendered the predicate through `PgDialect` — exactly the guard the
  previous SQL incident prescribed — and asserted `($1)::uuid[]`, the invalid
  shape, as correct. Rendering closes the mocked-`getDb` gap only for defects the
  author knows to look for; it says nothing about whether Postgres can execute
  the result. The replacement bans the bad form mechanically and runs both
  arities, because one id and several fail with *different* errors.
- **"Save this gym for next time" was contingent on the adaptation succeeding.**
  The gym was created inside `save()`, so Brad's 500 lost the named kit and every
  ticked chip — the toggle's label promises something about the KIT, not about
  the variation. It now fires when the user commits the kit, alongside the
  preview rather than before it (that request already spends 2.6 s p50 in
  Bedrock), and `save()` awaits the in-flight create instead of racing it into a
  duplicate-name 409.
- **⚠ The safe-area bug was NOT what it looked like.** `SafeAreaView` from
  `react-native-safe-area-context` is a purely native view that never reads
  `SafeAreaInsetsContext` — so the missing root `SafeAreaProvider` I had flagged
  was a real finding but the WRONG fix, and adding one alone would have changed
  nothing. Inside the `fullScreenModal` route the native measurement returned
  zero, intermittently. Fixed with both halves: a route-scoped provider seeded
  from `initialWindowMetrics`, and the two Loadout presenters moved to
  `useSafeAreaInsets()`. The tests assert the actual numbers (44 / 34), because
  a truthy check passes on `paddingTop: 0` — which is the bug.
- **NOT done, deliberately:** the Gym-tab-in-Train idea (Brad: "worth keeping an
  eye on") — logged under § Open items. And the app-wide root `SafeAreaProvider`,
  which would give every other sheet in the app its home-indicator padding back.


**2026-07-27 (cont.) — LOADOUT Phase 3 backend + Phase 2 FOUNDATION. MERGED as
PR [#326](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/326)
(squash `f0e8929`), branch deleted; all 5 CI checks green. The scan endpoint is complete;
the mobile flow has its contract, its pure logic and its step machine, and **ZERO
screens** — nothing is user-visible or device-verified.**

- **`POST /ai/equipment-scan` SHIPPED** (T-3.1…T-3.3, `46b19d9`). Guard order cloned
  from `nutritionAiEstimateHandler` verbatim because that order IS the cost-safety
  contract and this endpoint is 5× the unit cost. Mounted in `loadoutRoutes`;
  `/ai/equipment-scan` is fully literal so no matcher can capture it, and it did NOT
  tip `packages/web`'s Eden treaty (typecheck 8/8).
- **⚠ SCAN CEILING DECIDED: 6/day, not design § 8.1's 10** (Brad: "go with your
  recommendation… calculated against all costs from one user compared to their
  subscription"). **The 10's reasoning was the flaw** — it was analogised from
  Mealprint's suggest/day-plan/swap ceilings, which are daily-use surfaces, whereas
  **a scan is a once-per-GYM action** because `saved_gyms` persists the result. At
  $0.0272/scan, 6/day = ~$4.90/user/mo worst case, i.e. PARITY with the re-map's
  $5.13, so both Premium+ AI surfaces together are ~$10/mo against ~$32 net (£29.99
  less Apple's 15 %). 10/day would have been $8.16 for one endpoint. Swept through
  `infra/api.ts`, design § 8.1, tasks.md T-3.1 and § Open items.
- **⚠ THE AGGREGATE PER-USER AI CEILING HAS NEVER BEEN COMPUTED, AND IT IS THE
  NUMBER WORTH WATCHING.** The 2026-07-05 bar (£7.30 worst case vs £12.99) was
  per-surface-pair and predates recipes AI *and* Loadout. A `premium_plus` user can
  consume EVERY ceiling: nutrition photo+text (~$9.27) + recipes extract/estimate/
  resolve (UNMEASURED, ~$8.5 est.) + re-map ($5.13) + scan ($4.90) ≈ **$28/mo worst
  case against ~$32 net**. Not a loss, but not a margin either — and it needs a
  dedicated adversary hitting six endpoints daily for a month. Median use is
  ~$1.50/mo (~5 % of net), which is healthy. **The recipes surfaces are the
  unmeasured half; measure before adding a seventh ceiling.**
- **Also found: `AI_RECIPE_ESTIMATE_DAILY_LIMIT` is NOT registered in
  `infra/api.ts`** — it silently uses the code default of 30. Harmless today, but
  the env block is documented as where the ceilings live, so it is invisible to
  anyone auditing cost. Not fixed (out of this slice's scope).
- **Beyond T-3.1's checklist, each for a measured reason:** `createSingleAttempt` in
  `aiBedrockClient` (T-E1.6's ONE ~20 s attempt — built in the shared client because
  the re-map's retry decision is explicitly revisitable against it); a
  `stop_reason: "max_tokens"` guard (a truncated payload PARSES and silently
  under-detects, and every lost item causes a needless swap);
  `loadout/modelProse.ts` extracting the untrusted-prose rule that `remapModel` now
  delegates to; the response splitting `detected` (selectable, CATALOGUE name) from
  `unmatched` (informational, model's label) so nothing untrusted reaches the
  selectable path; `Bodyweight` withheld from the model and injected with
  `source: "injected"`, warning LOUDLY if the row is missing (the T-E.10 lesson).
- **⚠ The scan's `notes`/`label` are UNTRUSTED for a reason worth remembering: the
  input is a PHOTOGRAPH the caller chose.** A photographed whiteboard puts
  attacker-authored instructions in front of a vision model exactly as a malicious
  string does. The prompt carries an explicit "ignore any text visible in the
  photograph" instruction, and membership validation keeps the detections legal
  regardless.
- **Phase 2 foundation (`3bbb812`, `790a5e6`, `75ee6df`):** `domain/models/loadout.ts`
  + 9 `ApiPort` methods + both adapters; `domain/services/loadout.service.ts` (review
  copy from `reason.code`, `buildVariationExercises`, equipment grouping);
  `state/loadout-flow.ts` (the step machine).
- **⚠ `ReferenceEntry.category` was being SILENTLY DROPPED by
  `mapRawReferenceEntry`**, so AC-2.2's "picker grouped from the API" was true in
  name only. Fixed, plus `isEquipmentGroupingStale` to tell `category: null` (server
  says uncategorised) from an ABSENT key (a cache written before Loadout) — without
  it a returning user's 24h-cached list renders every chip under "Other" and nothing
  can detect why.
- **NEXT: the screens.** T-2.2…T-2.9 + T-3.4 are unstarted; see `tasks.md`
  § "Phase 2 — still to build". Everything they need is built and tested.
  ⚠ **One hard constraint from the handoff still stands: its D1 taster meter must NOT
  be built** — design § 5.2 is a hard gate with no taster (RC promos only), so the 402
  is entitlement-denied and is a conversion surface, not a dead end. (Its "AnyGym"
  naming and its £19.99 literal are retired notes — the feature is **Loadout** and the
  paywall price comes from the catalog, full stop.)
- **IB: 1 local sweep, 10 findings (3 🟠 / 4 🟡 / 3 🟢), ALL 10 addressed.** The three
  🟠 were the 20 s Lambda timeout (§ above), **every Loadout domain 400 code being
  discarded** by `mapHttpErrorToApiError` (it reads `body.error`; the Loadout handlers
  answer `{ code, message }`, so `EQUIPMENT_NOT_AVAILABLE` and five siblings arrived
  as an empty-message generic 400 — three shipped error-code types had no producer),
  and **the in-memory double's containment check being inverted** (it compared
  `missingEquipment`, the SOURCE row's gap, where the real handler checks the
  SUBSTITUTE's own requirements — so it rejected legal swaps and waved through the
  exact mistake it exists to catch). Fixed with a new `requestLoadout` path +
  `LoadoutApiError.loadoutCode`, and an `exerciseEquipment` map on the double.
  - The 🟡s: `useGym`/`useEquipmentIds` now clear the previous adaptation (a
    re-collect mid-flow reapplied stale picks by `sortOrder`); `intensity_mismatch` is
    DROPPED on a manual pick (it describes the substitute being replaced, so keeping
    it persisted misinformation into the provenance jsonb); `rowsNeedingAttention`
    now takes `manualPicks` (else a flagged row could never be resolved and a
    Save gate would deadlock); a server-INJECTED `Bodyweight` detection can no longer
    be deselected. The concurrency finding is recorded above rather than fixed.
  - The 🟢s: blank unmatched labels dropped, `deriveVariationName` cuts on a code
    POINT via a new `shared/utils/text.ts` (twin of the backend's `modelProse` —
    mobile shares no package with core), and `describeLoadoutRow` gained a `default`
    branch because `substitution_reason` is untyped jsonb read back for AC-3.3.
  - **Then 1 CLOSED verification pass, which found 5 more (1 🟠 / 4 🟢) — including a
    real bug in my own fix.** The `loadoutCode` union named
    `duplicate_name`/`unknown_equipment`, which are `SavedGymCreateResult` **repository
    statuses** the handlers translate and never serialise; the wire codes are
    `SAVED_GYM_NAME_TAKEN` / `UNKNOWN_EQUIPMENT_TYPE`, and
    `UNKNOWN_SUBSTITUTED_FROM_EXERCISE` was missing entirely. **And the test I wrote
    asserted a hand-invented body the server never sends, so it passed while the
    contract was wrong** — the same "test that cannot fail" class this file already
    has a lesson about. Now a `const LOADOUT_ERROR_CODES` array transcribed from the
    handlers, with the regenerating grep in its docstring
    (`grep -rn 'code: "' microservices/core/src/application/loadout`), a real runtime
    membership check replacing an `as` cast that let `ENTITLEMENT_DENIED` in, and the
    three dead per-endpoint code unions DELETED rather than corrected.
  - **LESSON — a union transcribed from a repository result type is not a wire
    contract.** Read the handler, not the repository, and grep for `code: "` rather
    than inferring. Two of ten members were wrong and two were missing.
  - **CI action NOT fired** — 1 sweep + 1 closed pass locally, per the standing rule
    and the two-sweep cap. The last round of fixes was verified by grepping the
    handlers directly (the authoritative source for a wire contract) plus mutation
    tests, rather than by spending a third pass.
- **Gates:** prettier (whole tree) · typecheck 8/8 · lint 0-err · build 13/13 ·
  test:unit 19/19 (core 285 files / **3123 tests**; mobile 452 suites / **5193
  tests**; scripts 3 files / 112). Changed files ≥ 90 % on all four axes — the three
  new mobile files are **100 %** across the board; scan handler 100/98/100/100, scan
  model 100/95.34/100/100, `modelProse` 100 %. **38 mutations applied across the new
  guards, all 43 caught** — including the exact inverted-containment regression IB
  found and the wrong saved-gym wire code the closed pass caught.



**2026-07-27 — LOADOUT Phase 1 (adaptation engine + preview) — MERGED.
PR [#322](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/322)
squashed to `1a7b956`; branch `claude/loadout-phase-1` deleted. Backend only: no
migration, no mobile, no scan endpoint. All of T-1.1…T-1.11 ticked in
`tasks.md`.**

- **The engine is the HYBRID D7 selected by measurement** (design § 6.0):
  deterministic § 6.2 shortlist (top 25/row) → model selection over that
  shortlist → model reasons. Stages 1, 3 and 4 stayed deterministic, so the model
  changes *which* exercise is picked, never *whether* the pick is legal.
  New `microservices/core/src/application/loadout/engine/` —
  `rankSubstitutes.ts` (pure § 6.2 weights), `adaptWorkout.ts` (partition /
  shortlist / stage-3 assembly), `remapModel.ts` (the forced-tool Bedrock
  adapter), `reasons.ts`, `intensityMismatch.ts`, `types.ts`. Plus
  `loadout/preview/workoutLoadoutPreviewHandler.ts` and
  `exercises/substitutes/exercisesSubstitutesHandler.ts`. New env in
  `infra/api.ts`: `AI_LOADOUT_REMAP_MODEL_ID` (Haiku-class) and
  `AI_LOADOUT_REMAP_DAILY_LIMIT` (shipped as a placeholder 30, **promoted to a
  decision later the same day** — see § Open items → § DECIDED). No IAM change
  needed — the existing Bedrock wildcards cover the model id.

  **The contract Phase 2 consumes** (so it need not be re-derived from code):
  `POST /workouts/:id/loadout/preview` takes EXACTLY ONE of `savedGymId` or
  `equipmentTypeIds` (both, or neither → 400 `EQUIPMENT_CONTEXT_REQUIRED`; both
  keys with the unused one `null` is fine). It returns rows carrying
  `status: kept|swapped|unresolved`, the parent's targets UNCHANGED, an
  `exercise` display block, and `reason = { code, missingEquipment, matchedOn,
  flags, note, selectedBy }`. **`code` drives the copy — the backend emits no UI
  strings.** ⚠ **`reason.note` is UNTRUSTED model prose** (capped at 300 chars,
  unpaired surrogates stripped): a stranger's PUBLIC workout is adaptable
  (AC-1.2) and neither `workouts.name` nor `exercises.name` is length-bounded, so
  **Phase 2 must render it as plain text — never markup, a link, or anything
  actionable.** On the save path, the "doesn't fit your kit" acknowledgement MUST
  set `isUserOverride: true` or the deliberate pick is rejected 400
  `EQUIPMENT_NOT_AVAILABLE`.
- **⚠ `GET /exercises/substitutes` tipped `packages/web`'s Eden treaty into
  TS2589, and it CANNOT be nested out of trouble.** It must precede the
  `/exercises/:id` matcher, so a late-mounting sub-app cannot hold it. TWO nesting
  variants were measured — pairing it with `exercisesSearchHandler`, and
  collapsing all ten exercise routes into one sub-app — and **both moved the same
  error into `microservices/core`'s own `api.ts`**, i.e. from an unused client into
  the build everything depends on. Annotating the handler's response type
  explicitly did not help either: the cost is the extra ROUTE, not its shape. So
  `packages/web/src/lib/eden.ts`'s `@ts-expect-error TS2589` is back — which is the
  remedy that file itself prescribes for this case, and the client has 0
  call-sites. **Don't re-attempt the nesting; it is measured and worse.**
- **⚠ `sort_order` IS NOT A ROW IDENTITY.** No unique constraint
  (`001_initial_schema.sql:699-702` indexes only workout_id / exercise_id /
  superset_group) and `toWorkoutExerciseInsert` writes the client's value verbatim,
  so two rows can share one. Keying the shortlist map on it collapsed one row's
  candidates into another's and produced a **cross-muscle substitution (a squat for
  a bench press) through the guards rather than around them** — reachable via a
  stranger's PUBLIC workout, which AC-1.2 makes adaptable. Fixed with
  `PlanRow.rowKey` (position in the ordered plan). The tool field the model sees is
  still named `sortOrder`, deliberately, so the prompt stays byte-identical to the
  arm E2 measured.
- **Brad's three Phase-1 checkpoints were DECIDED later the same day** — ceiling
  30/day, keep `createWithRetry`, keep the 503 (see § Open items → § DECIDED).
  They shipped as flagged placeholders/recommendations and were promoted to
  decisions in a follow-up, with every doc that assumed "open" swept.
- ~~**Bedrock grant NOT re-verified this session**~~ (**since RESOLVED — Brad
  confirmed both ids in prod, 2026-07-27**) — both SSO tokens were expired and
  refreshing needs an interactive login. The ledger's evidence stands (Brad granted
  Haiku 4.5 in prod 2026-07-26); the check is queued in § Open items rather than
  claimed as done.
- **A model failure is a 503, never a silent downgrade to the § 6.2 ranker.**
  Shipping ranker output under a Premium+ badge is exactly what the bake-off
  rejected (it lost 4-50 and produced Atlas Stones in a hotel room). Raised for
  Brad rather than treated as settled.
- **IB: 2 local sweeps (9 findings, then 3) + 1 closed verification pass (which
  REFUTED one of my own fixes).** 12 defects fixed across 3 commits.
  **The `@inspector-brad` CI action WAS fired this time — at Brad's explicit
  request, not pre-emptively — and came back CLEAN @ `e2ebbbb` with zero
  findings** (`claude-opus-4-7` / `high`). The standing rule still holds by
  default: it bills Brad's subscription and is his to trigger. Worth knowing the
  two gates agreed. The refutation is
  worth remembering: reserving the model's picks to stop a repair cascade
  **traded a filled row for a hole** and then reported `no_candidate` for a row
  that had a candidate. A closed pass asked to verify "(c) no row can now be
  starved" is what caught it — the question was worth asking explicitly.
- **LESSON — a mutation that survives is not always a test gap.** Three surviving
  mutants were EQUIVALENT: the reservation loop's legality / membership /
  prior-use screens change no behaviour, because the repair re-filters all three
  itself. The right response was deleting the dead conditions, not writing tests
  that pretend to pin them. A fourth survivor was a real gap (a KEPT row's
  selection must reserve nothing) and got a test.
- **LESSON re-confirmed — `bun run test:unit` is NOT a typecheck.** `res.json()`
  returns `unknown`; the whole new handler-test suite was green while `tsc` had 19
  errors.
- **LESSON re-confirmed — the shell cwd drifts.** Three commands failed on
  relative paths after an earlier `cd` into `microservices/core` persisted. Prefix
  every path with the repo root.
- **Gates:** prettier · typecheck 8/8 · lint 0-err · build 13/13 · test:unit 19/19
  (core 281 files / **3027 tests** / 98.37 % overall). Every changed file ≥ 90 % on
  lines, branches AND functions; the engine is 100 % lines / ≥ 97 % branches.
  **48 mutations applied to the new guards, all caught.** All 5 CI checks green on
  #322 before merge; the staging deploy fired on merge (Lambda-only — Phase 1 has
  no migration).


**2026-07-26 (cont. 3) — LOADOUT Phase E eval spike. D7 DECIDED BY EVIDENCE:
the HYBRID wins. Branch `claude/loadout-phase-e` (HEAD `d4139d4`, 2 commits),
PR not yet raised. NO product code — script + dataset + verdict + spec updates.**

- **E2 bake-off ran: 3 arms × 80 fixtures (20 workouts × 4 equipment contexts,
  58 of them swap-bearing, 171 swap rows), identical candidate sets, blind
  judge (Opus 4.6) on plans anonymised in hash-determined order.**
  | | legal | muscle fid | pattern/coherence/reason (blind 1–5) | cost/adaptation |
  |---|---|---|---|---|
  | A ranker only | 80/80 | 0.968 | 3.07 / 3.21 / 2.62 | $0 |
  | B model, full pool | 80/80 | 0.822 | 4.43 / 4.10 / 4.02 | $0.0199 |
  | **C hybrid (SHIPS)** | 80/80 | 0.930 | 4.07 / 3.93 / 3.81 | **$0.0057** |
  Head-to-head: **B beat A 52–5, C beat A 50–4, C vs B 25–25 with 8 ties.** So
  the hybrid is judged-equivalent to the full-pool model arm at **28.7 % of its
  cost**, and the § 6.2 ranker survives **as the shortlister** (top 25/row) —
  T-1.2 stays in Phase 1's scope.
- **⚠ ARM A DID NOT LOSE NARROWLY, AND THE REASON IS STRUCTURAL.** § 6.2's
  scoring is dominated by primary-muscle overlap and its `movement_type` signal
  has **no data** — NULL for all 2281 seeded rows (only
  `exercisesCreateHandler`/`exercisesUpdateHandler` ever write it, for
  user-created exercises), so it degrades to `category`, which is `strength` for
  1976/2281. Result: equipment-legal but unshippable swaps — **Barbell Deadlift →
  Atlas Stones** in a bands-only context, **Machine Bicep Curl → Floor Rope
  Climb**, rear-delt fly for a lateral raise. A deterministic-only engine would
  need `movement_type` backfilled across the catalogue FIRST (T-E.11).
- **E1 RAN (Brad supplied 7 photos, 6 stock + 1 real phone photo, "this can do
  for now"). VERDICT: PROVISIONAL GO — and it overturned two design choices.**
  Opus 4.6: **recall 0.966** (28/29), 3 FPs, **0 hallucinated ids**, 23 items
  correctly returned `null`+label; **1.000 on the one real phone photo** (n=1).
  Haiku 4.5: 0.759 recall, 7 FPs, **2 hallucinated ids**, only 3 null-labelled,
  **0.500 on the real photo**, and it missed **`Squat Rack` in 3 of 7 photos**.
  - **⚠ Stock photos are EASY MODE, so 0.966 is a CEILING, not a real-world rate.**
    Scan is a provisional go **as a confirmed draft (AC-2.3)**, NOT established as
    the only collect path. The real ~30-photo set is still wanted (phone, in the
    room, not stepped back, commercial floor with equipment behind equipment).
  - **⚠ design § 8's "Haiku-class first (the task is far simpler than food
    estimation)" is WRONG — it's HARDER. Use the Opus-class id.** Haiku fell for
    both planted look-alikes in the real photo (road bike → `Exercise Bike`, rubber
    floor tiles → `Yoga Mat`) and barely used the `null` escape hatch, i.e. it
    **forces real kit onto the nearest catalogue row** — worse than a miss.
  - **⚠ `createWithRetry` is NOT usable as-is for the scan.** Measured Opus **mean
    10.1 s / max 12.3 s**, and the max already exceeds its own 12 s per-attempt
    timeout → realistic worst case is timeout-then-retry ≈22 s + overhead against a
    hard 30 s. Needs ONE attempt at ~20 s (what GTM § 3 P2 asked for) or a smaller
    image — E1 ran 1568 px/~3000 tokens where prod food photos run 640 px.
  - Scan costs **$0.0272** — ~5× the re-map. At 10/day that's $8.16/user/month
    worst case, which is material against £29.99; first real argument that the scan
    ceiling needs to be low. Also: **exclude `Bodyweight` from scan output** (true
    of every gym; inject server-side).
- **⚠ BRAD'S CRITIQUE WAS RIGHT, AND IT'S A GAP NEITHER ARM CLOSES.** He said
  equipment+muscle matching misses whether the muscle is worked "in the same
  manner", and that a swap may not be able to do it. Measured on the winning arm:
  **10 of 171 swaps put a strength-range row (reps ≤ 6) onto kit that cannot load
  it** — `Barbell Deadlift 4×4-6 → Band Good Morning 4×4-6`, `Barbell Back Squat
  5×5 → Band Front Squat 5×5`, clustered in `bands_only` + strength templates.
  **The exercise choice in those rows is CORRECT (hinge→hinge) and the prescription
  is still unusable** — so no ranker or model improvement fixes it. Cause is § 1
  rule 2 (targets copied from the parent, never model-authored).
  - **My E2 rubric never scored this** — the judge was asked about pattern
    fidelity/coherence/reason quality, never "is this viable at the stated
    intensity". Second time in this eval the instrument was the weak point.
  - **Phase 1 ships DETECTION only** (new **AC-3.5b** + **T-1.11**, design § 7.1b):
    a deterministic check (strength-range parent AND replacement lost every
    loadable equipment type) → `intensity_mismatch` flag through the existing
    AC-3.4 machinery. No model, no cost, no ceiling.
  - **Changing the target to suit the kit (4×4-6 → 3×12-15) is a BRAD DECISION
    with its own slice** — it relaxes § 1 rule 2. Explicitly NOT for the ranker to
    do implicitly.
- **⚠ SPEC CONSEQUENCES ALREADY FOLDED IN — a model is now on the re-map path.**
  `AC-10.2`'s old text ("the deterministic re-map has no ceiling and writes no
  usage rows — it costs nothing to run") is **VOID** and rewritten; new
  **AC-10.3**: programme-level MUST be an async job (120 workouts = 120 model
  calls ≈ 5 min ≈ $0.69, far past the 30 s API Gateway ceiling that § 7.3
  previously said "does not bind"). **That job infrastructure is shared with
  spec-26 Mealprint — build it once.** design § 1 (the canonical section spec-26
  mirrors) also updated; it had still described stage 2 as an open bake-off.
- **⚠ LIVE DATA BUG FOUND (T-E.10, not an engine bug):** `Leg Press` and
  `Leg Curl` resolve to `equipment_required = '{}'` because their seeded
  equipment names have no `equipment_types` row (`Leg Press Machine` /
  `Leg Curl Machine`) and `seedExercises.ts`'s `resolve()` **drops unmapped names
  silently**. `x @> '{}'` is always true, so **a bands-only athlete keeps the leg
  press** — in the seeded "Lower Body" and "Full Body Starter" workouts, i.e. the
  first two a new account owns. Needs a data migration + a seeder guard that
  fails loudly. The blind judge flagged it unprompted on both arms.
- **⚠ OPEN BRAD CHECKPOINTS (see § Open items above for the live list):** the **re-map** daily ceiling
  (deliberately NO number proposed — hitting a cap mid-gym is the bad failure),
  the equipment-scan ceiling (10/day) and the programme cap (120 workouts, whose
  rationale changed even though the number survives).
- **Bedrock:** Haiku 4.5 and Opus 4.6 both re-verified callable in `ess-dev`
  eu-west-2 before the run. Haiku 4.5 is granted in **both** accounts so the
  re-map has no prod grant blocker — but re-verify per account before shipping
  (the 2026-07-26 outage lesson). `assertDevEnvironment()` now refuses to run the
  harness unless `AWS_PROFILE=ess-dev` and the model id starts `eu.`.
- **LESSON — two eval metrics COULD NOT FAIL, and both changed published
  numbers.** `muscleFidelity` returned a fiat `1` on the 22 zero-swap fixtures
  and was averaged over all 80, compressing every arm's gap (real figures are
  0.968/0.822/0.930, not 0.977/0.871/0.949); `nearDuplicatePairs` used an
  asymmetric `i ⊆ j` subset test so detection depended on which row a pick landed
  on (arm B was 13, not 11). Same class as PR #317's three tests that couldn't
  fail. **A default that stands in for "not applicable" is a value that cannot
  fail — use `null`.**
- **LESSON — hand-derived numbers in a document drift from the data.** The first
  verdict's cost/latency/token table was arithmetic in prose on a divisor of 60
  when only 58 fixtures bear a swap. Fixed by making the figures a command
  (`src/resummarise.ts`, free and offline, recomputes from the committed dataset)
  rather than re-spending ~$1.50 on Bedrock. **If a doc quotes a measurement,
  ship the command that regenerates it.**
- **LESSON — deciding a spec question means sweeping every doc that assumed the
  old answer.** Flipping D7 left five surviving contradictions, the worst being
  design § 1 — explicitly "the canonical statement… spec-26 mirrors it" — still
  offering three arms as live options. IB found all five; grep for the old
  premise, don't just add the new section.
- **IB: 1 sweep (18 findings: 2 🟠, 6 🟡, 7 🟢, 3 🔵) + 1 closed verification
  pass.** Both 🟠 were the metric/arithmetic defects above. CI action NOT fired.
- **Gates:** prettier · typecheck 8/8 · lint 0-err · build 13/13 · test:unit
  19/19 (`TURBO_FORCE` on typecheck + test:unit). No coverage claim — the eval
  harness is throwaway scratchpad code and deliberately untested; nothing under
  any package `src/` changed.

**2026-07-26 (cont. 2) — LOADOUT Phase 0 MERGED + production AI outage diagnosed.
`origin/main` HEAD = `86a03a7` (squash of PR #317). Next up: spec-21 Phase E.**

- **PR #317 MERGED** (squash `86a03a7`) — all 5 CI checks green, IB clean @
  `6652a29`. Branch deleted. The four migrations auto-applied to STAGING on merge.
- **⚠ CORRECTION TO A LONG-STANDING LEDGER CLAIM: "PROD MIGRATION APPLY IS
  MANUAL" IS WRONG.** Repeated across many earlier entries in this file, and it is
  stale. `production-deploy.yml` runs `supabase db push --linked` (with a
  `--dry-run` first) as part of the **Deploy Production** job, which fires on
  `release: published` — i.e. when the release-please chore PR is merged and its
  release is published. That workflow has run successfully 8+ times, most recently
  `persistence: v1.8.0` on 2026-07-26. **Production migrations are automatic on
  the release deploy. Do not hand-apply them** (Brad confirmed 2026-07-26).
  - **And the ordering is already correct**: the workflow migrates BEFORE
    `sst deploy`, so the database is always ahead of the code. That is the safe
    direction for the additive Loadout columns — `workoutRepository`'s full-row
    `select().from(workouts)` reads and `GET /exercises/equipment`'s `category`
    projection would 42703 only on the reverse order (new Lambda, old schema),
    which this workflow cannot produce. **The deploy-order hazard flagged on #317
    is handled by CI; no manual sequencing needed.**
  - Residual caveat for a FUTURE change: migrate-then-deploy is only safe for
    ADDITIVE migrations. A destructive one (drop/rename) leaves the old Lambda
    running against the new schema for the length of the deploy — that needs
    expand/contract across two releases, not a workflow change.
- **⚠ PRODUCTION AI OUTAGE — ROOT-CAUSED AND FIXED (by Brad, in the AWS console).
  Claude Haiku 4.5 was never granted in the PRODUCTION Bedrock account**
  (`465891279888`), though it was granted in Development (`111315405717`).
  `POST /nutrition/ai/estimate-text` (5/5 requests) and
  `POST /trainers/me/clients/:id/ai-summary` (8/9; the one 200 was a
  `client_ai_summaries` cache hit) **returned 503 to every production user for 30
  days** while passing every test and working perfectly in staging. Photo
  estimation was fine — different model (`eu.anthropic.claude-opus-4-6-v1`).
  Brad granted Haiku 4.5; production now verifies OK on both ids.
  - **LESSON — BEDROCK MODEL ACCESS IS PER-ACCOUNT AND PER-MODEL.** Staging green
    says NOTHING about production. `eu.` ids are cross-region inference profiles;
    `eu.anthropic.claude-opus-4-6-v1` looks malformed (no `:0`) but is valid —
    don't chase that. `eu.anthropic.claude-opus-5` is still UNGRANTED in prod.
  - **LESSON — the failure was invisible by construction, and this is unfixed.**
    Bedrock's `AccessDeniedException` is a 403 → `isRetryable` declines a 4xx →
    `AiUnavailableError` → the handler **RETURNS** a 503 body → `coreErrorHandler`
    only logs uncaught throws → **not one log line existed for any failure**. The
    provider's explicit "AWS Marketplace subscription cannot be completed" text
    was captured into an error string and discarded. Mobile then relabelled the
    503 as "try rephrasing", advice that could never work.
  - **How to diagnose this class of bug fast:** the API Gateway access log
    (`/aws/vendedlogs/apis/persistence-api-production-apicore-rmbczern`) has
    per-route status + latency. A ~380ms 503 means the provider rejected us
    outright (a 4xx isn't retried); a ~24s 503 means timeouts. Then
    `aws bedrock-runtime invoke-model --model-id <id>` per account for the exact
    exception. AWS profiles: `ess-dev` (dev/staging), `ess-prod` (production —
    Brad added it this session), both via the `ess-dev` SSO session.
- **⚠ PR #318 (deploy-time Bedrock model preflight + failure logging + mobile
  status-aware error copy) was CLOSED UNMERGED at Brad's instruction** — the grant
  is fixed so he doesn't want the gate. **Branch `claude/ai-model-preflight`
  (HEAD `844fd01`) is left in place, NOT deleted.** It contains a working
  `scripts/check-bedrock-access.ts`, `infra/aiModels.ts` (model ids as a single
  source of truth), the `createWithRetry` logging and a shared
  `aiEstimateErrorMessage`. **Do NOT rebuild it from scratch** — cherry-pick if
  the class of failure recurs. Brad's call; don't re-litigate unless asked.
- **STILL TRUE AND UNFIXED (deliberately, per Brad):** a Bedrock failure is
  logged nowhere, and both AI surfaces collapse every non-429 error into
  "Couldn't estimate that — try rephrasing" (`QuickAddSheetContainer.tsx:267`,
  `SnapAISheetContainer.tsx:100`). If AI ever "mysteriously stops working" again,
  that is why, and the fix is on the closed branch.
- **Security audit (Brad asked): server-side entitlement enforcement is REAL, not
  frontend-only.** All six AI endpoints assert `ai_access` before the model call;
  `create_workout` on `POST /workouts` + the fresh-workout branch of
  `POST /sessions/record`; `trainer_clients` on the roster; `loadout` on the new
  variation create. Guard order correct everywhere (entitlement before the model,
  ceilings count actual inferences only, so a 402 never burns quota). The one
  systemic risk: `assertEntitlement`'s catch-all
  `if (feature !== "create_workout") return { allowed: true }` — any new feature
  name added without an explicit routing line **silently allows everyone**, with
  no type error. The three current stubs are deliberately open and nothing on the
  paywall sells them, so there's no live leak.
- Incidental: the prod access log is full of bots probing `/.env`,
  `/.aws/credentials`, `/.git/config` — **all 404, nothing exposed.** Noise.

**2026-07-26 (LOADOUT Phase 0 — backend data model). PR [#317](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/317) MERGED (squash `86a03a7`); was branch `claude/loadout-phase-0`, HEAD `6652a29`.**

- **Scope:** spec-21 Phase 0 = T-0.1…T-0.11, backend only. 4 migrations
  (`saved_gyms`; `workouts` parent linkage; `workout_exercises` provenance;
  `equipment_types.category`), `schema.ts` mirror, `SavedGymRepository` +
  service + 4 CRUD handlers, `GET`/`POST /workouts/:id/variations`, the
  `loadout` EntitlementFeature + `assertLoadout`, feature-aware
  `pickUpgradeTier`, `isNull(parentWorkoutId)` on BOTH `mine` paths, new
  `loadoutRoutes.ts` sub-app.
- **⚠ MANUAL PROD MIGRATION ×4 + DEPLOY ORDER.** Migrations must land BEFORE
  the Lambda: `workoutRepository`'s four full-row `select().from(workouts)`
  reads now emit the new columns and `GET /exercises/equipment` projects
  `category`, so a Lambda ahead of the migrations 42703s **every workout read
  and the shipped mobile equipment picker** — features older than Loadout.
  Accepted, not fixed (explicit projections would restate ~13 columns 4×).
  ~~**`20260725194527_premium_plus_tier.sql` is STILL PENDING on prod and must
  land first**~~ — **STALE, corrected 2026-07-26 (cont. 3): verified present at
  tag `persistence-v1.8.0`** (`git cat-file -e persistence-v1.8.0:supabase/...`),
  and that release deployed, so `loadout_access` IS on prod. What is NOT yet on
  prod is Phase 0's four migrations + the spec-28 consent migration — they sit on
  `main` behind **open release PR #319 (v1.9.0)**; merging it publishes the release
  and the prod deploy applies them.
- **`loadout_access` is deliberately NOT in the shared `loadTier` projection** —
  it's on the hot path of `create_workout` + `ai_access`, so a young
  hand-applied column would break features older than itself.
  `loadFreeTierLoadoutAccess` confines the blast radius to Loadout.
- **A root `.use(loadoutRoutes)` HELD** — no TS2589, including packages/web's
  Eden treaty. The nutritionRoutes comment's "any new leaf route MUST join an
  existing sub-app" is over-cautious for ONE grouped sub-app. Verified with a
  full-workspace `TURBO_FORCE=true typecheck`.
- **SIX equipment categories, not design § 2.3b's five** (Brad's steer). The
  five left bands/ropes/sled/foam roller/yoga mat/box homeless, and "bands only"
  is one of E2's four canonical contexts. `accessories` is the sixth; bench +
  squat rack sit with free weights. design § 2.3b + AC-2.2 updated to match.
- **Two Phase-1 guards PULLED FORWARD** (recorded in tasks.md § "Landed in
  Phase 0 beyond the checklist"): exercise read-visibility on every submitted
  row (new `ExerciseRepository.findUnreadableExerciseIds`), and saved-gym
  ownership when `sourceGymId` is claimed. T-1.6 keeps only the containment half.
- **`GET /workouts/:id/variations` has NO parent read gate, deliberately.** It
  was redundant (response only contains `created_by = caller`) and harmful:
  parent read access is REVOCABLE, so a spec-25 offboarding would have made the
  athlete's own variations unreachable from every surface at once (hidden by
  `parent_workout_id IS NULL` + 404 here).
- **Housekeeping:** `specs/26-coach-data-sharing-consent` → **`specs/28-`**
  (26 was used twice; 45 inbound refs fixed). The applied `20260720230030`
  migration's `COMMENT` still says "(spec 26)" — deliberately unedited.
  **tasks.md T-P0.10 amended**: create the Premium+ ASC products but leave them
  UNSUBMITTED/UNATTACHED until the Loadout launch build.
- **Gates:** prettier · typecheck 8/8 · lint 0-err · build 13/13 · test:unit
  19/19 (core 270 files / **2791 tests**, mobile 449 suites / 5046). Every
  changed file ≥90% (new handlers + savedGymService 100%).
- ~~**⚠ OPEN Brad checkpoints, NOT decided:** equipment-scan ceiling (proposed
  10/day) and programme cap (proposed 120 workouts) are still Claude proposals.~~
  **The scan ceiling was DECIDED 2026-07-27 at 6/day, not 10** (§ Open items →
  § DECIDED). The programme cap is still open. § Open items is the live list.
  **Phase E blocked on ~30 real gym photos from Brad** (E1's dataset).
- **IB: clean @ `6652a29`** — 2 sweeps (7 findings, then 5) + 1 closed
  verification pass. CI action NOT fired. The sweep-2 🟠 was a genuine
  production bug: **`isSavedGymNameConflict` read `code` off the thrown error,
  but Drizzle puts the SQLSTATE on `.cause`** — so every duplicate gym name
  500'd instead of 409'ing, and the test fixture used a flat error shape the
  driver never produces. `stripe/pgErrors.ts` already documented the cause-chain
  walk. **LESSON: when catching a Postgres error by SQLSTATE, walk `.cause` —
  and model the fixture on what the driver actually throws, or the test proves
  nothing.**
- **LESSON — three tests I wrote could not fail.** One asserted a property of
  its own mock fixture (`expect(tx).not.toHaveProperty("update")`); one asserted
  the mock's return value instead of the SQL projection (so dropping a column
  from a `select()` stayed green — the mocked-getDb blind spot in a new
  disguise); one used the wrong driver-error shape. All found by mutation
  testing, all now sensitive. **Mutation-test every new guard — it is the only
  thing that catches a test that cannot fail.**
- **LESSON re-confirmed — `git add -A` swept in Brad's pre-existing untracked
  `docs/app-store/` + `marketing/*.md`.** Caught before committing (the #159
  lesson). Stage with explicit pathspecs and inspect `git diff --cached
  --name-only` first.
- **LESSON re-confirmed — the shell cwd drifts.** Running vitest from the repo
  root instead of `microservices/core` produced 20/20 phantom failures (wrong
  config resolution) that vanished from the package dir. Always `cd` with an
  absolute path before a test run.

**2026-07-25/26 (LOADOUT kickoff + App Store 3.1.2 rejection fix). THREE PRs ALL MERGED to `main` at Brad's instruction: #312 spec triplet (`e7d9556`), #314 marketing copy (`2ae43ad`), #313 M19-P0 + paywall truth pass + Apple compliance (`fe28bd8`). `origin/main` HEAD = `fe28bd8`.**

- **A — spec-21 triplet authored** (`requirements.md` / `design.md` / `tasks.md`), superseding `BRIEF.md`. Loadout = ADAPT an existing workout/programme to available kit, saved as a variation under the parent; original never mutated. Phased P0 → 0 (data model) → 1 (ranker + adaptation) → 2 (mobile) → 3 (scan) → 4 (coach programmes), one phase per PR. Twinned with spec-26 Mealprint § 1 (design § 1 is the canonical statement of the candidate-constrained contract).
- **⚠ TWO PREMISE CORRECTIONS — do not re-inherit the old ones.** (1) **There is NO deterministic substitute ranker to reuse.** `BRIEF.md` § Reuse and the GTM brief both say there is; what exists is the orphaned Postgres fn `get_alternative_exercises` (`002_functions_and_triggers.sql:432`, 50/20/15/±15 weights, **zero TS callers, no route, no tests**) plus `SwapExercisePopover`'s unranked muscle filter. The ranker is net-new Phase-1 work; formula inherited, implementation not. (2) **`equipmentAny` is array OVERLAP (`&&`); Loadout needs CONTAINMENT (`@>`)** — new `equipmentSubsetOf` axis, and `COALESCE(equipment_required,'{}')` is load-bearing (legacy NULL rows). Also `profiles.available_equipment` is write-only/unvalidated — `saved_gyms` supersedes it.
- **⚠ The GTM brief's "mobile paywall is catalog-driven, verify it degrades gracefully" is FALSE.** Both presenters — including the LIVE iOS rail — did `find(t => t.tierName === "premium")`. A new catalog row rendered **no card at all**. P0 rewrote both to iterate non-trainer catalog rows.
- **B — M19-P0 shipped on `claude/m19-p0-premium-plus`** (shared prerequisite with spec-26 — built once, do NOT build twice). Migration adds the `premium_plus` row (£29.99/£299.99) + `subscription_tiers.loadout_access` (true for premium_plus + 3 trainer tiers). No enum — `tier_name` is text+unique, so a new tier is just a row. Registered in `SubscriptionTierName`, `coerceTierName`, `nextTrainerTierUp`, `RC_ENTITLEMENT_IDS`, `rcEntitlementToTier`, `TIER_RANK` (renumbered, premium_plus above premium), `resolveTrial` (shares `has_used_user_trial` with premium), and the mobile maps.
- **⚠ THE ROW IS SEEDED `is_active = false` ON PURPOSE.** `listActive()` filters on it and the new paywall renders every active non-trainer row — an active row publishes a buyable £29.99 card selling a tier whose differentiator doesn't exist. **Launch = a one-line `UPDATE subscription_tiers SET is_active = true WHERE tier_name='premium_plus';` in its own migration, once Phase 2 is device-verified.** The row still exists so the `user_subscriptions` FK resolves and RC promotional entitlements can be granted pre-launch.
- **⚠ `listActive()` now projects explicitly** (omitting `loadout_access`). A bare `select()` emitted every `schema.ts` column, so a Lambda deployed before the hand-applied prod migration would 42703 the PUBLIC `GET /subscription-tiers` and show every user "Failed to Load Subscription Options". **Deploy-order hazard both ways:** the reverse (RC `premium_plus` entitlement arriving before the catalog row is on prod) FK-fails the webhook into a retry loop.
- **⚠ MANUAL PROD MIGRATION** `20260725194527_premium_plus_tier.sql` (staging auto-applies on merge). **ASC/RC ops runbook handed to Brad in chat, NOT committed** — products at £29.99/£299.99, RC entitlement **lookup_key literally `premium_plus`** (`revenueCatClient.ts:107` reads `lookup_key`, not product id), both attached to the `default` offering. Product ids must contain the literal `premium_plus` — `tierFromProductId` is a substring ladder and `premiumplus`/`premium.plus` would silently grant Premium.
- **Deliberately NOT built in P0:** the `loadout` EntitlementFeature + `assertLoadout` (Phase 0), and feature-aware `pickUpgradeTier` — `loadout` doesn't exist as a feature yet, so that branch was unreachable and only passed coverage behind a `v8 ignore`. Reverted and moved to Phase 0. **No taster code anywhere** — hard gate, RC promos only.
- **Gates (P0):** prettier · typecheck 8/8 · lint 0-err · build 13/13 · test:unit 19/19 (core 268 files/2700 tests/98.47% cov, mobile 448 suites/5032 tests).
- **LESSON re-confirmed (twice):** `bun run test:unit` is NOT a typecheck. After reverting the `pickUpgradeTier` signature the suite was green while `tsc` failed on the stale two-arg test calls. Run `TURBO_FORCE=true bun run typecheck` separately, always.
- **LESSON:** three DIFFERENT suites flaked under parallel load this session (`ClientDetailContainer`, `trainersMeGenerateClientAiSummaryHandler`, `useMySubscription` — the last has a pre-existing "Jest did not exit" open handle). All passed in isolation. Don't chase a single-suite failure before re-running it alone.
- **LESSON:** local `main` was **stale by one merge** (#311 Loadout rename + £29.99 reprice + spec-26 Mealprint). I flagged three "drift" items to Brad that were pure stale-checkout artefacts. **`git fetch` before trusting the working tree at session start.**
- **B is PR [#313](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/313); marketing companion is [#314](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/314).** Five IB sweeps on #313.
- **⚠ UNBUILT-FEATURE SWEEP (Brad, 2026-07-25): "the only scope we have are the two — Loadout and Mealprint".** Analytics, data export, **Gym Buddy** and **"N AI-generated workouts per month"** were all sold across the paywall and NONE exist (no analytics screen, no export path, `gym_buddy` is an `assertEntitlement` stub with no backend surface or UI, no workout-generation path in `application/workouts`). Took FOUR passes to find them all because the same string lives in three kinds of place: (1) `getFeaturesList`'s `isTrainer` branch — **UNREACHABLE at runtime** (coach tiers render via `TrainerSubscriptionCard`, which doesn't take it); (2) hardcoded JSX in `TrainerSubscriptionCard` — what coaches actually saw; (3) **`subscription_tiers.description`**, seeded in 004, rendered verbatim in the Profile Drawer for EVERY user (free users too, via the synthesised free row) — TypeScript cannot reach it, needs a data migration. **LESSON: when de-claiming a feature, trace every channel it reaches the user through, not just the string you found first.**
- Replacement copy: the consumer card now shows **AI nutrition logging (Snap AI, shipped)** where the AI-workout count was — without it Premium's card read identically to Free's. KEPT because real: "AI supported reporting" on the coach card (`POST /trainers/me/clients/:clientId/ai-summary`, rendered in coach Client Detail) — one IB sweep wrongly flagged it as unbuilt; an earlier sweep had verified it. **Don't take a single sweep at face value on a "this doesn't exist" claim — grep for the endpoint.**
- **STILL OPEN (Brad's):** "(Save 20%)" on the yearly toggle — every seeded annual price is 16.7% off. Pre-existing, on an App Store review surface.
- **LESSON — turbo caches `test:unit` too.** `supabase/migrations/**` is NOT an input to `@persistence/core#test:unit`, so editing a migration doesn't invalidate the cache and a stale green hides a real failure (cost a red CI run on #313). **Run `TURBO_FORCE=true bun run test:unit` before pushing**, same as typecheck.
- **LESSON — the shell cwd silently reverted from the worktree to the main checkout mid-session** and a fix landed on the wrong branch; a later `git checkout --` (cleaning up after mutation testing) then reverted an uncommitted edit in the worktree. **Prefix EVERY tool path with the worktree path, and never `git checkout --` a file with uncommitted work in it.**
- **Mutation-test every new guard.** Three tests I wrote could not fail (one asserted `toBeLessThanOrEqual(1)` where both branches gave ≤1; two asserted substrings that the migration's own comment prose satisfied). All found by IB, all now verified by breaking the implementation and watching them fail.
- Restored the 2026-07-23 BRIEF-7 ledger entry, which was written but never committed (it was sitting uncommitted in the working tree and #311 landed a 07-24 entry on top of it).

### 2026-07-26 additions (same workstream)

- **⚠ APP STORE REJECTION (2026-07-26), Guideline 3.1.2** — no functional Terms
  of Use (EULA) link in metadata. Decision: **Apple's STANDARD EULA**, no custom
  agreement uploaded. Runbook is Brad's `docs/app-store/`. Code side landed in
  #313: `domain/models/legal.ts` (single source of truth for
  `TERMS_OF_USE_URL` / `PRIVACY_POLICY_URL` / `SERVICE_TERMS_URL`; `consent.ts`
  re-exports), `SubscriptionLegalFooter` rendered on BOTH paywall rails.
- **⚠ 3.1.1 FIXED, and it was the bigger risk.** The annual Small Business /
  Medium-Enterprise tiles rendered a **"Contact Sales" mailto** — selling a
  subscription that unlocks in-app coach functionality OUTSIDE IAP, from the
  paywall. Annual IAP isn't possible for both anyway (**£3,000/yr is above
  Apple's standard price points**). Those tiers are now hidden on the yearly
  cycle (`MONTHLY_ONLY_TIERS`) + an explanatory note; `handleContactSales`,
  `SALES_CONTACT_EMAIL` and `contactSalesMode` all deleted. **Do not
  reintroduce a sales mailto on a purchase surface.**
- **⚠ `NSHealthUpdateUsageDescription` was FALSE** — claimed "We do not write or
  modify your health data" while `writeSleep`/`writeBodyWeight` are live and
  write scopes are requested. Rewritten. Purpose strings must match behaviour.
- **Disclosure copy is STORE-AWARE** — `rail="store"` resolves Apple vs Google
  Play by `Platform.OS`, so a future Play submission needs no call-site change.
  `rail="card"` for the Stripe rail.
- **PAYWALL TRUTH PASS (Brad, 2026-07-25): only unshipped features we advertise
  are Loadout and Mealprint.** Analytics, data export, **Gym Buddy** and
  **"N AI-generated workouts per month"** were all sold and NONE exist
  (`gym_buddy` = entitlement stub, no workout-generation path anywhere).
  Stripped from `getFeaturesList`, `TrainerSubscriptionCard`,
  `SubscriptionSuccessContainer`, the tier `description` column (migration step
  4 — the Profile Drawer renders it verbatim, TypeScript can't reach it) and
  the marketing site (#314). Replaced on the consumer card with the row
  `ai_access` really unlocks: **AI nutrition logging** (Snap AI, shipped).
  "AI supported reporting" on the coach card KEPT — the AI weekly client
  summary is real.
- **"(Save 20%)" → "(2 months free)"** — every annual price is exactly 10x
  monthly, i.e. 16.7%, so the old copy overstated on a review surface.
- **⚠ SPEC RE-SEQUENCED (Brad, 2026-07-26): new Phase E eval spike.** The scan
  was sequenced LAST despite being the highest-value AND highest-risk piece.
  **E1** measures whether a vision model can actually read a gym (needs ~30
  real gym photos — **Brad's input, currently blocking**); the scan endpoint
  then ships INSIDE the Phase 2 slice. **E2 is a bake-off**: deterministic
  ranker vs candidate-constrained AI composition, scored blind — **D7 is now
  decided by evidence, not asserted.** Hallucination is NOT a reason to prefer
  deterministic: under D6 the model picks ids from a server-built list.
- **⚠ DO NOT submit the `premium_plus` ASC products with the next build** —
  the tier ships `is_active = false`, so a reviewer can't reach it and an
  unreachable IAP product is its own rejection. Create, leave unsubmitted,
  attach at the Loadout launch build.
- **Design handoff stays at `~/Downloads/Any Gym/project/`** — Brad confirmed
  2026-07-26 it's a stable path and won't move, so it is deliberately NOT
  committed. The old readiness-brief action to commit it is CLOSED.
- **LESSON (cost):** five Inspector Brad sweeps on one PR, each with an
  open-ended "find anything new" prompt, burned a large share of the context
  window. Cap at two sweeps + one CLOSED verification pass ("confirm these N
  items, findings only"), and ask recon agents for conclusions with file:line
  pointers rather than quoted code.
- **LESSON (worktrees, again):** the shell cwd silently reverted from the
  worktree to the main checkout mid-session and an edit landed on the wrong
  branch. **Always pass absolute paths inside a worktree; re-check `pwd`.**
