# RESUBMISSION BRIEF — clearing the App Store rejections

**Written 2026-08-04; revised the same day after TASK 0 ran.** Scope: get build 1.0 back
in front of App Review and approved. **Not** the paid launch — that is
[`PLAN.md`](./PLAN.md) Stages 1–4.

⚠ **Read [`STATE.md`](../../../STATE.md) § "▶ START HERE" first, then § "🔴 THE PREMISE
ABOVE IS OUT OF DATE" below — the two rejections this brief was written for are cleared,
and a third is open.**

---

## The distinction this brief exists to protect

**Resubmission ≠ launch.** Nothing about pricing, tiers, Mealprint or the OFF re-seed is
needed to clear App Review, because `premium_plus` ships `is_active = false` and a
reviewer cannot reach any of it.

Conflating the two is how this slips a fortnight. Ship the approval first.

---

## 🔴 THE PREMISE ABOVE IS OUT OF DATE — a THIRD rejection landed 2026-08-04

**Read this before acting on anything below.** TASK 0 was executed on 2026-08-04 (Brad
signed in to ASC; read via the browser connector). It found a **live, currently-open
rejection that this brief did not know about**:

| Field         | Value                                                                                   |
| ------------- | --------------------------------------------------------------------------------------- |
| Submission ID | `9b3438b9-0ed2-4a46-9ebb-78faa0e495b5` — status **Unresolved Issues**                   |
| Review date   | **August 04, 2026** (today)                                                             |
| Version       | **1.0 (40)** — _not_ build 38 or 39                                                     |
| Devices       | iPhone 17 Pro Max **and** iPad Air 11-inch (M3)                                         |
| Apple's words | "Thank you for your resubmission. Upon further review, we identified additional issues" |

**The two rejections this brief was written to clear appear already cleared** — build 40
carried both fixes and Apple did not re-cite PassKit or the Apple logo. The blocker is now
two different things, and **neither is a code defect**:

**1 · Guideline 2.1(a) — Information Needed**

> "We need a demo QR code or AR marker (image) to fully assess the app features.
> — coach's code"

Apple cannot test the coach↔client flow without a **coach invite code**. This is an
App Review Information / Review Notes item. **Brad's.**

**2 · Guideline 2.1(b) — Performance · App Completeness**

> "In-app purchase products associated with the app version submitted for review, such as
> Auto Renewable Subscription, could not be found in the submitted binary."

All six subscriptions plus the subscription group carry an "App Review Notice" in the
message. Apple's offered remedies are: make the products active and StoreKit-reachable,
**or remove them from ASC before resubmitting**.

⚠ **The app-side code is CORRECT and was verified, so do not go looking for a bug here.**
`revenuecat.adapter.ts:101-104` reads `Purchases.getOfferings()` and takes
`offerings.all["default"] ?? offerings.current`; the product ids the app maps
(`purchaseOfferings.ts:22-26`) are byte-identical to the six in ASC. The paywall even has
a graceful empty state (`IOSPurchaseFlowPresenter.tsx:475`), which is exactly what a
reviewer would have seen. **That points at RevenueCat/ASC configuration — the `default`
offering (`ofrng79adc3c998`) not exposing these products, or the RC↔App Store product
mapping not synced — not at the binary.** There is prior form: the ASC free-trial product
sat in `MISSING_METADATA` once before.

---

## Ground truth (verified 2026-08-04, `main` = `b4a8ba3e`)

| Fact                                                                                   | Evidence                            |
| -------------------------------------------------------------------------------------- | ----------------------------------- |
| Rejection **2.1** (PassKit / Stripe) — fixed, merged, **not re-cited on build 40**     | PR #336                             |
| Rejection **4.0** (app-drawn Apple logo) — fixed, merged, **not re-cited on build 40** | PR #340, `bb99f26b`                 |
| 🔴 **NEW: 2.1(a) + 2.1(b) open on build 1.0 (40)**, reviewed 2026-08-04                | submission `9b3438b9`               |
| Six IAP subscriptions exist, all **Ready for Review**, all attached to `9b3438b9`      | ASC group `21879538`                |
| **No `premium_plus` product exists in ASC**                                            | ASC, verified 2026-08-04            |
| Latest release tag `persistence-v1.11.0`; **`main` is 13 commits ahead**               | `git log persistence-v1.11.0..main` |
| **5 migrations unapplied to prod** — prod's last is `20260728121000`                   | verified vs `opcvjypsoivaxerahbal`  |
| Release PR **#344 (v1.12.0) already open**, current, mergeable, 5/5 green              | release-please; see Task 1          |
| Prod migrations deploy **automatically** on `release: published`                       | `production-deploy.yml:78-88,174`   |
| The mobile build's `release` trigger is **disabled** — dispatch by hand                | `mobile-build-production.yml:8-10`  |
| A **stale local `ios/` prebuild still carries the PassKit entitlement**                | dated Jul 22; see Task 2            |
| Mealprint mobile merged, **entitled path has never executed on a device**              | `fa0567fc`, PR #352                 |
| No agent has touched prod or staging data                                              | —                                   |

---

## TASK 0 — ✅ DONE 2026-08-04. The ASC product state, answered.

App **Persistence: Coach & Train**, `ascAppId` 6755091280, team `U9S9BFTM4V`.
iOS App **1.0 — Rejected**.

**1 · Which IAP products exist, and in what state?** Six auto-renewable subscriptions, all
in one group, **"Personal Trainer Subscriptions"** (`21879538`). **Every one is
"Ready for Review"** — i.e. metadata complete, none in Missing Metadata, none rejected
individually:

| Reference name             | Product ID                                   | Duration |
| -------------------------- | -------------------------------------------- | -------- |
| Premium Monthly            | `app.persistence.premium.monthly`            | 1 month  |
| Premium Annual             | `app.persistence.premium.annual`             | 1 year   |
| Individual Trainer Monthly | `app.persistence.trainer.individual.monthly` | 1 month  |
| Individual Trainer Annual  | `app.persistence.trainer.individual.annual`  | 1 year   |
| Small Business Monthly     | `app.persistence.small_business.monthly`     | 1 month  |
| Medium Enterprise Monthly  | `app.persistence.medium_enterprise.monthly`  | 1 month  |

**2 · Is any product attached to the build?** **Yes — all of them.** Submission
`9b3438b9` carries **8 items**: the app version (build 1.0 (40)), the subscription group,
and all six subscriptions. So the feared "paywall with no reviewable IAP product" 3.1.1
problem is **not** the situation. The opposite is: the products are attached, and Apple
could not find them **in the binary** (§ 2.1(b) above).

**3 · Are the `premium_plus` products still UNSUBMITTED?** **They do not exist.** There is
no `premium_plus` product in ASC at all, so there is nothing to accidentally submit and
the hazard below is moot for this submission. ⚠ **It becomes a launch task** — the tier
cannot be sold until the products are created, and `purchaseOfferings.ts:23` already
reserves `app.persistence.premium_plus.{monthly,annual}` for them.

---

## Who owns what — read this before assigning anything to an agent

This brief originally read as a to-do list for an agent. It is not. **Almost all of the
remaining work is operational and sits with Brad**, because it lives in App Store Connect,
RevenueCat, the release/deploy pipeline and on a physical device — none of which an agent
should be driving.

| #   | Work                                              | Owner    |
| --- | ------------------------------------------------- | -------- |
| 0   | Read the ASC product state                        | ✅ done  |
| 1   | Merge release PR #344, deploy prod                | **Brad** |
| 2   | Dispatch the EAS build                            | **Brad** |
| 3   | Review Notes + coach demo code + device recording | **Brad** |
| —   | Fix the RevenueCat `default` offering (2.1(b))    | **Brad** |
| —   | Code changes arising from this rejection          | **none** |

⚠ **There is currently NO outstanding code work for this resubmission.** Both live
rejection reasons are configuration/process, and the app-side code behind 2.1(b) was
verified correct. If a future session finds itself "implementing" something here, it
should stop and re-read § 2.1(b) — the risk is inventing a code fix for a dashboard
problem.

---

## TASK 1 (Brad) — Release and deploy to production. This is the step people skip.

**A resubmitted BUILD does not fix a PRODUCTION backend.** This has already bitten: an
Apple reviewer tripped a production Sentry error on 2026-07-30 22:26 UTC while prod was
running an unpatched backend, on an iPad Air 11-inch (M3).

`main` is **13 commits** ahead of `persistence-v1.11.0`, including the whole async-job
spine, the Mealprint backend, and the revised privacy policy. Five migrations are
unapplied:

```
supabase/migrations/20260802120000_ai_jobs.sql
supabase/migrations/20260803120000_foods_mealprint_tags.sql
supabase/migrations/20260803120100_nutrition_preferences.sql
supabase/migrations/20260803120200_mealprint_access.sql
supabase/migrations/20260803180000_client_data_access_log_created_at_idx.sql
```

1. ~~Cut a release PR~~ **The release PR already exists: [#344](https://github.com/Evans-Software-Solutions-Limited/persistence-backend-sst/pull/344)
   `chore(main): release persistence 1.12.0`.** release-please maintains it (that is how
   every tag back to v1.8.0 was cut — `persistence-v1.11.0` is commit `c7ad4587`,
   "chore(main): release persistence 1.11.0 (#338)"). Verified 2026-08-04: current
   through `b4a8ba3e`, `MERGEABLE`/`CLEAN`, all 5 checks green, and its changelog covers
   all 13 commits. **It needs merging, not cutting.**
2. ~~Apply the five migrations to prod MANUALLY~~ **DO NOT hand-apply. Production
   migrations are AUTOMATIC and hand-applying them is the mistake here.**
   `production-deploy.yml` fires on `release: published` and runs
   `supabase db push --linked --dry-run` then `supabase db push --linked` (lines 78–88)
   **before** `bunx sst deploy` (line 174). This matches `STATE.md` § Verified facts
   ("Do not hand-apply") — the earlier claim that application "has always been manual"
   was wrong, and acting on it skips the dry-run gate. All five migrations already
   applied cleanly to staging on the `b4a8ba3e` Deploy Staging run.
3. Merging #344 publishes the release, which triggers the prod deploy. Then confirm the
   API answers and no new Sentry issues appear.

⚠ **The deploy re-runs the full gate suite on the tag (typecheck, lint, prettier, build,
test:unit) BEFORE it migrates** — so a gate failure aborts the release with prod
untouched. `main` is currently green on all five.

⚠ **Prod's last applied migration is `20260728121000` — independently verified against
`opcvjypsoivaxerahbal` on 2026-08-04.** The five listed above are genuinely absent.

⚠ **Do NOT flip `is_active` on any tier in this release.** That is PLAN Stage 4.

---

## TASK 2 (Brad) — A new mobile build. Both fixes are compiled artifacts.

Neither rejection can be cleared by the current binary:

- **PassKit** — the `in-app-payments` entitlement was **compiled into build 38**.
  Removing the dependency only takes effect in a fresh build.
- **Sign in with Apple** — `AppleSignInButton` wraps `expo-apple-authentication`'s
  native `AppleAuthenticationButton`. It cannot render under Jest, so **no test proves
  how it looks.** It must be seen.

⚠ **Merging the release does NOT produce a build.** `mobile-build-production.yml`'s
`release: published` trigger is **commented out** to conserve EAS minutes (see the
header comment). The build must be started by hand:
`gh workflow run mobile-build-production.yml -f platform=ios -f submit=true`.
Waiting for a build that never comes is the silent failure mode here.
Build numbering is handled — `appVersionSource: remote` + `autoIncrement: true`, prod
`ascAppId` 6755091280.

⚠ **A LOCAL build would still ship the PassKit entitlement. Verified 2026-08-04.**
`packages/mobile/ios/` is gitignored, so EAS regenerates it from `app.json` +
`app.config.ts` — and the tracked `app.json` entitlements block is **clean** (HealthKit
and `aps-environment` only), which is why a fresh **EAS** build genuinely does clear 2.1.
But the `ios/` directory sitting in Brad's checkout is a **stale prebuild dated Jul 22**,
before the Stripe removal, and it still contains:

```
com.apple.developer.in-app-payments → merchant.com.bradleyevans96.persistence
```

So `expo run:ios` / `eas build --local` from this checkout reuses it and reproduces the
exact rejection cause. Two consequences: **(a)** never submit a locally-built binary, and
**(b)** if the "grep the built app for the entitlement" check below is run against a local
build it will find PassKit and read as "the fix didn't land" — a false alarm. Clear it
first: `rm -rf packages/mobile/ios` (or `expo prebuild --clean`).

Verify on the build, ideally on **iPad** (the review device was an iPad Air 11-inch M3).

**Source-verified 2026-08-04 — three of the four now need only confirming, not
investigating.** Source review is not device proof, but it does mean a failure here would
be a surprise rather than a likely outcome:

- [ ] The SIWA button is Apple's own control — light and dark. **Not re-skinned**: no
      image, icon font or glyph; no `backgroundColor`/`borderRadius` via `style`; no
      overlay. The loading state dims and blocks rather than swapping in a
      "Connecting…" label — obscuring the button is itself a Guideline 4 failure.
      ✅ **Source-clean:** `AppleSignInButton.tsx` is a thin wrapper over
      `AppleAuthentication.AppleAuthenticationButton`; customisation is confined to
      `buttonStyle` + `cornerRadius` (the two Apple permits), `style` sets width/height
      only, and the blocked state dims the **wrapper** (`opacity` + `pointerEvents` +
      a `handlePress` guard) with nothing overlaid. ⚠ It is hard-pinned to
      `ButtonStyle.WHITE` for a dark-only V2 — **white-on-white is its own Guideline 4
      failure**, so if a light theme ever ships this must become `BLACK`.
- [ ] **No Apple Pay / PassKit sheet is reachable anywhere.** Grep the built app for the
      entitlement if in doubt — **against an EAS build, not a local one** (see above).
      ✅ **Source-clean:** no `@stripe/*` dependency in `packages/mobile/package.json`,
      no PassKit/Apple-Pay entitlement in `app.json` or `app.config.ts`. The remaining
      `grep` hits for "Stripe"/"PassKit" in `useCreateSubscription.ts`,
      `SubscriptionSelectionContainer.tsx` and `adapters.ts` are **comments documenting
      the removal**, not code.
- [ ] The named **"Delete account"** row is present in the profile drawer, and survives a
      failed profile fetch (that was the 5.1.1(v) fix).
      ✅ **Source-clean:** `ProfileDrawerPresenter.tsx` renders `DeleteAccountSection`
      inside the `if (!profile)` early-return branch as well as the loaded one, so it is
      reachable when the profile fetch has failed outright.
- [ ] The profile drawer **scrolls** on a small device. ⚠ **Not source-verifiable** —
      the presenter has no `ScrollView` of its own; scrolling comes from the
      `BottomSheet` container, and Jest mocks gorhom. This one genuinely needs the
      device.

---

## TASK 3 (Brad) — Review Notes, the coach demo code, and the recording

The 5.1.1(v) response needs a **physical-device recording** of the account-deletion flow
end to end. Simulator capture is not what was asked for.

Review Notes should state, plainly: Apple Pay / PassKit removed in full; account
deletion reachable from the profile drawer and demonstrated in the attached recording;
test-account credentials.

⚠ **Add the coach invite code — this is now an explicit Apple request, not a nicety.**
Guideline 2.1(a) on submission `9b3438b9` asks in as many words for "a demo QR code or AR
marker (image) … coach's code". Without it the coach↔client half of the app is
unassessable and 2.1(a) will simply re-fire. Put a working, non-expiring coach invite code
in **App Review Information → Notes** (and/or reply on the submission), alongside an
account that is already a coach so the reviewer can see the roster surfaces.

⚠ **And settle the 2.1(b) question before resubmitting**, because Apple offers two valid
answers and they lead to different submissions:

- **(a) Make them work** — fix the RevenueCat `default` offering (`ofrng79adc3c998`) so all
  six products resolve, verify in the StoreKit **sandbox** with a Sandbox Apple Account,
  then resubmit the same six.
- **(b) Narrow the submission** — Apple explicitly says "if these In-App Purchase products
  are not intended to be available at this time, remove them from App Store Connect before
  resubmitting."

**Recommended: (b), narrowed to FOUR products — and the reason is spec-29, not Apple.**
Brad asked (2026-08-04) whether the tier restructure and Premium+ need doing first. They do
not gate an approval, but they do decide **which products are worth getting approved now**,
and cross-referencing `specs/29-subscription-restructure/design.md` § 1 splits the six
cleanly:

| Currently submitted                          | Survives spec-29?                                                                                    | Submit now? |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------- |
| `app.persistence.premium.monthly`            | ✅ `premium` keeps its `tier_name`                                                                   | **yes**     |
| `app.persistence.premium.annual`             | ✅ same                                                                                              | **yes**     |
| `app.persistence.trainer.individual.monthly` | ✅ `individual_trainer` keeps it (design § 1 line 50) — only `display_name` becomes "Start Up Coach" | **yes**     |
| `app.persistence.trainer.individual.annual`  | ✅ same                                                                                              | **yes**     |
| `app.persistence.small_business.monthly`     | ❓ **absent from spec-29 entirely**                                                                  | **no**      |
| `app.persistence.medium_enterprise.monthly`  | ❓ **absent from spec-29 entirely**                                                                  | **no**      |

**Why the first four are not throwaway work:** their `tier_name`s are unchanged by the
restructure, so the ASC products survive it. Only their **prices** move
(`premium` £12.99 → £16.99, `individual_trainer` → £18.99), and **a price change on an
already-approved IAP product does not require re-review**. Getting them approved now is
work done once.

🔴 **Why the last two should come out — and a spec gap Brad needs to close.**
`grep -rn 'small_business\|medium_enterprise' specs/29-subscription-restructure/` returns
**nothing**. Both are live tiers in the catalog and both are attached to submission
`9b3438b9` right now, yet spec-29's target table does not list them — it has `coach`
(15 clients) and `coach_pro` (30 clients) occupying those rungs instead. So either:

- they are being **retired/replaced** by `coach`/`coach_pro` — in which case getting them
  approved now is pure throwaway, and spec-29 must say what happens to the ASC products
  (the 2026-08-04 prod+staging data reset means there is no grandfathering problem); or
- spec-29 has a **hole**, and two live tiers were simply overlooked.

⚠ Note the tension either way: replacing `small_business`/`medium_enterprise` with
`coach`/`coach_pro` **is a `tier_name` change in substance**, which runs straight into the
standing "never rename a `tier_name`" hazard (RevenueCat entitlement ids _are_ the
tier_names; `user_subscriptions.tier_name` is an FK). **This is Brad's decision and it is
not recorded anywhere yet.**

---

## TASK 4 — Explicitly NOT resubmission-blocking

State this back to Brad if anyone proposes pulling it forward:

**Brad asked on 2026-08-04 whether the subscription restructure, Premium+ and the Mealprint
setup need doing first. They don't — and this table is the answer.** All of it is real, all
of it is `PLAN.md` Stages 1–4, and none of it stands between build 40 and an approval. The
one place they touch is _which products to submit_ — see TASK 3.

| Work                                | Why it can wait                                                                                                                                                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Premium+ / `premium_plus`**       | `is_active = false`, and **no ASC product exists**, so a reviewer cannot see or buy it. Per the 2026-08-02 bundle decision it cannot flip until Loadout Phase 4 + Mealprint + M21 all ship — holding the approval for that would cost weeks for nothing. |
| **spec-29 tiers / £16.99 / £18.99** | Prices on already-approved IAP products can change **without re-review**, so approving `premium` + `individual_trainer` now is not throwaway. PLAN Stage 3.                                                                                              |
| Mealprint feature setup             | **Already built and merged** — backend PR #350, mobile PR #352. What's outstanding is the entitled-path device test and the OFF re-seed, and both only matter before `premium_plus` flips (PLAN Stage 1/4). A reviewer cannot reach any of it.           |
| Mealprint entitled-path device test | `premium_plus` is `is_active = false`; a reviewer cannot reach it                                                                                                                                                                                        |
| The OFF re-seed                     | Only affects Mealprint results, which are unreachable                                                                                                                                                                                                    |
| Loadout Phase 4                     | PLAN Stage 1                                                                                                                                                                                                                                             |
| Organisations / B2B rail            | PLAN Stage 5, blocked on an App Review answer                                                                                                                                                                                                            |

They are all real, and they are all **launch** blockers. `PLAN.md` orders them.

---

## Hazards — every one of these has already cost something

- ⚠ **Do NOT submit the `premium_plus` ASC products with this build.** The tier is
  `is_active = false`, so a reviewer cannot reach it, and an unreachable IAP product is
  its own rejection. Create, leave unsubmitted, attach at the launch build.
- ⚠ **Never `git add -A <dir>`.** On 2026-08-04 that published nine of Brad's private
  commercial drafts — a cash plan with real burn figures among them — to this **PUBLIC**
  repo. Untracked in PR #355; the history is not scrubbed. **Stage named paths only.**
- ⚠ **`specs/stripe-rail-removal/` must NOT be executed.** That rail is the
  organisation-tier plan.
- ⚠ **Never rename a `tier_name`.** RevenueCat entitlement ids _are_ the tier_names and
  `user_subscriptions.tier_name` is an FK.
- ⚠ **Do not fire the `@inspector-brad` CI action.** Brad triggers it. Run the
  `inspector-brad` subagent locally before any PR.
- ⚠ **`eu.anthropic.claude-opus-5` is UNGRANTED in production.** Assuming otherwise
  caused a 30-day silent outage. Check Bedrock model access before changing any model id.
- ⚠ **Use a workspace's own test command** (`bun run test:unit`), never `bunx vitest` —
  there is no root `vitest`, so `bunx` resolves the latest from the registry against a
  repo pinned to 2.1.9 and invents failures.
- ⚠ **`bun run prettier:check` fails at repo root** on untracked files outside your diff.
  Scope it: `bunx prettier --check $(git diff --name-only HEAD)`.
- ⚠ **The staging entitlement trigger demotes a coach or admin to `role = 'user'`.** Use
  a second test account if you touch `user_subscriptions`.

---

## Gates before any PR

```bash
bun run typecheck && bun run lint && bun run build && bun run test:unit
```

Mobile coverage threshold is 90 %. No fake tests — **and when you add a test for a fix,
revert the fix and watch it fail.** Three tests on the Mealprint branch passed against
their own reverted fix before being caught; reading a test is not evidence.

## Done when

An App Review decision on a build whose two rejection causes are demonstrably absent,
running against a production backend at `persistence-v1.12.0` or later.
