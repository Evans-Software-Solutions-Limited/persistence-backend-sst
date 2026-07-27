# 21 — Loadout: Tasks

> Execution checklist. `[B]` = backend (`microservices/core`, `packages/db`,
> `supabase/migrations`), `[M]` = mobile (`packages/mobile`), `[O]` = ops
> (Brad, chat-copy). See `design.md` for the how; ACs reference
> `requirements.md`.
>
> **One phase = one branch = one PR.** Every PR: full gates, an
> `inspector-brad` local sweep noted as `clean @ <sha>` in the body, and — when
> it carries a migration — an explicit **MANUAL PROD APPLY** flag.

## Phase P0 — `premium_plus` tier restructure (shared prerequisite with spec-26)

Acceptance criteria: `requirements.md` US-11.

- [ ] **T-P0.1 [B]** Migration `<ts>_premium_plus_tier.sql`: insert the
      `premium_plus` catalog row (£29.99 / £299.99, GBP, `ai_access` true,
      `workout_limit` NULL, **`is_active` FALSE** — design § 9.1; an active
      row publishes a buyable card for a feature that doesn't exist) with
      `ON CONFLICT (tier_name) DO NOTHING`; add
      `subscription_tiers.loadout_access boolean NOT NULL DEFAULT false`; set it
      true for `premium_plus` + the three trainer tiers. Template =
      `20260526120000_simplify_tier_model.sql` step 1. **No enum ALTER** —
      `tier_name` is text + unique (design § 9.1).
- [ ] **T-P0.2 [B]** Mirror both changes in `packages/db/src/schema.ts`
      (`subscriptionTiers`, L402).
- [ ] **T-P0.3 [B]** `assertEntitlement.ts`: add `premium_plus` to
      `SubscriptionTierName` (L89) — then fix every resulting compile error —
      and to `coerceTierName` (L596, **critical**: unlisted → `"free"`) and
      `nextTrainerTierUp` (L900). Make `pickUpgradeTier` (L642)
      feature-aware so a `loadout` denial points at `premium_plus` while
      `create_workout` still points at `premium` (design § 9.2).
- [ ] **T-P0.4 [B]** `revenuecat/entitlements.ts`: add `premium_plus` to
      `RC_ENTITLEMENT_IDS` (L16) and `rcEntitlementToTier` (L28); renumber
      `TIER_RANK` (L47) so `premium_plus` sits above `premium`.
- [ ] **T-P0.5 [B]** `subscriptionsCreateHandler.ts:440` — extend
      `isUserTier` so Premium+ buyers get the user trial.
- [ ] **T-P0.6 [M]** `domain/models/subscription.ts:20` — add `premium_plus`
      to the mobile union; fix the resulting compile errors
      (`useFeatureGate.ts:254` `TRAINER_TIER_LADDER` is the forcing function).
- [ ] **T-P0.7 [M]** `purchaseOfferings.ts:48-65` — add the `premium_plus`
      branch to `tierFromProductId` **above** the `premium` branch (substring
      ladder: `premium_plus` contains `premium`). Regression test with a real
      product id.
- [ ] **T-P0.8 [M]** Make the consumer paywall genuinely catalog-driven:
      `IOSPurchaseFlowPresenter.tsx:120-142` (**live rail**) and
      `SubscriptionSelectionPresenter.tsx:142` iterate non-trainer catalog rows
      in tier-rank order instead of `find(t => t.tierName === "premium")`
      (design § 9.3). Verify a new catalog row renders without further code.
- [ ] **T-P0.9 [M]** Register `premium_plus` in the silent-failure maps:
      `subscriptionService.ts:144` `USER_TRACK_RANK` (`Partial` → no compile
      error; unranked breaks `useAutoRetryOnUpgrade`), `:123`
      `shouldShowTrialBanner`, `useFeatureGate.ts:109` `USER_UPGRADE_CHAIN`,
      `SubscriptionSuccessContainer.tsx:74,94`, and the display/tone maps
      (`SubscriptionBadge`, `ProfileDrawerPresenter`, `GreetingSection`,
      `FeatureGatePrompt`, `SyncBlockedPresenter`, `SyncBlockedBannerMount`).
- [ ] **T-P0.9b [B]** Give `SubscriptionTiersRepository.listActive()` an
      explicit column projection omitting `loadout_access`, so the public
      catalog endpoint stays readable on a database that hasn't had the
      migration hand-applied yet (design § 9.1).
- [ ] **T-P0.9c [B]** Add a migration-value test (price, `is_active`, flags,
      features JSONB) — CI never executes SQL, and `ai_workout_limit` is
      rendered straight into paywall copy. Precedent:
      `subscriptionTierSeed.test.ts`.
- [ ] **T-P0.10 [O]** Hand Brad the ASC/RC runbook **in chat, not committed**:
      two ASC products at £29.99 / £299.99, an RC entitlement whose
      **lookup_key is literally `premium_plus`**, both products attached to the
      `default` offering. Note the ordering constraint: the catalog row must be
      on **production** before the first purchase, or the webhook FK-fails into
      an RC retry loop.
      **⚠ AMENDED (Brad, 2026-07-26): CREATE the products, but leave them
      UNSUBMITTED and UNATTACHED to any build until the Loadout LAUNCH build.**
      The tier ships `is_active = false`, so an App Store reviewer cannot reach
      a Premium+ purchase surface at all — and an IAP product submitted with a
      build that offers no way to buy it is its own rejection reason. Creating
      them early is still right (RC needs the product ids to exist to configure
      the entitlement, and promotional entitlements can then be granted
      pre-launch); submitting them early is not. Attach + submit in the same
      release that flips `is_active = true`.
- [ ] **T-P0.11 [B]** Tests: catalog row present and priced; `coerceTierName`
      round-trips `premium_plus`; `TIER_RANK` precedence beats `premium` in
      `pickDesiredSubscription`; a `premium_plus` RC entitlement syncs to the
      right tier.

## Phase 0 — Data model + saved gyms + variations (backend)

- [x] **T-0.1 [B]** Migration: `saved_gyms` table + named unique index on
      `(user_id, lower(btrim(name)))` + `(user_id, created_at DESC)` index +
      RLS-on-zero-policies (design § 2.1; template
      `20260708130000_client_ai_summaries.sql`).
- [x] **T-0.2 [B]** Migration: `workouts.parent_workout_id` (FK → workouts,
      **ON DELETE SET NULL**), `variation_kind` (+ idempotent CHECK),
      `source_gym_id` (FK → saved_gyms, SET NULL), `source_equipment_type_ids`;
      partial index on `parent_workout_id` (design § 2.2).
- [x] **T-0.3 [B]** Migration: `workout_exercises.substituted_from_exercise_id`,
      `substitution_reason` (**jsonb**, not text — § 7.2) and
      `is_user_override`. **Add no new index** — `001_initial_schema.sql:699-702`
      already creates two `workout_id` indexes plus a composite, and
      `CREATE INDEX IF NOT EXISTS` matches on name, so a differently-named one
      would silently become a third duplicate (design § 2.3). Mirror the
      existing indexes into `schema.ts` instead.
- [x] **T-0.3b [B]** Migration: `equipment_types.category` + idempotent backfill
      of the 28 seeded rows into the **six** design groups (amended from five —
      design § 2.3b); project it from `GET /exercises/equipment`
      (design § 2.3b). Phase 0, not Phase 2 — deferring forces an out-of-phase
      migration (AC-2.2).
- [x] **T-0.4 [B]** `schema.ts` mirror for T-0.1…T-0.3 + `SavedGym` /
      `NewSavedGym` exports. Explicit projections only (the
      `equipment_types.description` live-DB drift, design § 2.5).
- [x] **T-0.5 [B]** `SavedGymRepository` + `SavedGymService` decorator
      (mirroring `workoutService.ts`). Ownership folded into the mutating
      `WHERE`; zero rows → 404. Validate every `equipment_type_id` against
      `equipment_types` → 400.
- [x] **T-0.6 [B]** Saved-gym handlers: `GET`/`POST /saved-gyms`,
      `PATCH`/`DELETE /saved-gyms/:id`. 409 on duplicate name (AC-7.4).
- [x] **T-0.7 [B]** `GET /workouts/:id/variations` (caller-owned only) and
      `POST /workouts/:id/variations` (persist a reviewed plan in one
      transaction, with provenance), the latter behind the `loadout`
      entitlement **and `canRead` on the parent** (AC-1.2 — the guard ships in
      this phase, not Phase 1, or the endpoint spends a phase able to persist a
      variation of a workout the caller may not read).
- [x] **T-0.8 [B]** `EntitlementFeature` gains `"loadout"`; add `assertLoadout`
      reading `subscription_tiers.loadout_access`; **route it explicitly** —
      `assertEntitlement.ts:249` allows any unrouted feature (design § 5.1).
- [x] **T-0.9 [B]** Add `isNull(workouts.parentWorkoutId)` to **both** `mine`
      paths in `buildListWhereClause` — the `ownerLibraryOnly` branch too, or
      trainers still see every variation (design § 4). Variations are created
      `visibility = 'private'` (design § 2.2).
- [x] **T-0.10 [B]** New `loadoutRoutes.ts` sub-app; mount it in `api.ts` —
      **not** a root `.use()` chain extension (TS2589 ceiling, design § 3).
      `GET /exercises/substitutes` is the one route that does NOT go in it
      (T-1.7).
- [x] **T-0.11 [B]** Tests — `PgDialect` renders (mine-branch `parent IS NULL`,
      saved-gym `user_id`, variations `parent_workout_id` + `created_by`),
      two-user isolation, 402 on the guarded create, 409/400/404 paths.

### Landed in Phase 0 beyond the checklist

Two guards were pulled forward. Both are on `POST /workouts/:id/variations` and
both close a cross-user read that would otherwise have stayed open for a whole
phase — worth recording so Phase 1 doesn't rebuild them:

- **Exercise read-visibility on every submitted row.** Design § 7.1 sequences
  this with T-1.6, but the create path exists NOW, and `workout_exercises` reads
  embed exercise fields WITHOUT the visibility predicate
  (`exerciseRepository.ts` documents that as intentional for assigned workouts),
  so an unchecked create would let a caller plant an arbitrary exercise id and
  read its name/category/thumbnail back off workout detail. New public
  `ExerciseRepository.findUnreadableExerciseIds(userId, ids)` reusing
  `buildVisibilityCondition`. T-1.6 keeps the **containment** half (the
  asymmetric, override-aware check) — only the visibility half is done.
- **Saved-gym ownership when `sourceGymId` is supplied.** Not cosmetic:
  `listVariations` LEFT JOINs `saved_gyms` for `sourceGymName`, so an
  unvalidated gym id would echo another user's gym NAME back to the caller. The
  FK only proves the row exists, not whose it is.

## Phase E — Eval spike (NO product code)

Runs straight after Phase 0. Ships a script, a dataset and a written verdict —
**no endpoints, no migrations, no UI.** Two independent questions; both gate
Phase 1/2 design. Rationale: `requirements.md` § Eval spike.

### E1 — can a vision model read a gym? · **RAN, verdict PROVISIONAL**

> **Verdict: `scratchpad/loadout-phase-e/VERDICT-E1.md`**, summary in `design.md`
> § 8.0. Provisional go for scan-as-confirmed-draft; **not** established as the
> only collect path, because the dataset was 7 photos (6 stock) rather than the
> ~30 real ones this section asks for.

- [x] **T-E1.1 ⚠ PARTIAL** Assemble ~30 real gym photos across contexts
      (commercial floor, hotel gym, home garage, bands-only). **Brad supplied 7 on
      2026-07-26 — 6 stock/web images plus 1 genuine phone photo — with "this can
      do for now".** Kept out of the repo; ground truth committed in
      `src/e1Fixtures.ts` (labelled by Claude before any model ran, not
      Brad-confirmed). **Stock photography is easy mode, so every E1 figure is a
      ceiling.** Still wanted: ~30 photos taken the way users will take them —
      phone, in the room, not stepped back, including a busy commercial floor with
      equipment behind equipment.
- [x] **T-E1.2** Throwaway script: photo + the seeded `equipment_types` catalogue
      as the candidate list → forced-tool response, ids validated for membership.
      Reuse `aiBedrockClient`; do NOT add a route. **Landed:** `src/e1Scan.ts`.
- [x] **T-E1.3** Score per photo: hits, misses, false positives, by equipment
      category. **Landed** with a three-bucket ground truth (`present` /
      `ambiguous` / `traps` / `notInCatalogue`) so a judgement call the labeller
      could not make is scored as neither hit nor false positive, and planted
      look-alikes (a road bike, rubber floor tiles) are scored as the interesting
      kind of false positive. The prediction that "plate-loaded and cable stacks
      are hardest" is **untested** — those landed in `ambiguous` because they were
      unlabellable from stock photos, which is itself a sign the dataset is too
      easy.
- [x] **T-E1.4** Verdict: **provisional go as a confirmed draft.** 0.966 recall /
      3 FPs / 0 hallucinated ids at Opus-class; 1.000 on the one real photo (n=1).
      **Two design corrections fell out:** the model must be Opus-class not
      Haiku-class (T-3.3), and `createWithRetry` is not usable as-is (T-3.1).

### Found by E1, to fold into Phase 3

- [ ] **T-E1.5 [B]** `AI_EQUIPMENT_SCAN_MODEL_ID` = the **Opus-class** id
      (`eu.anthropic.claude-opus-4-6-v1`), not Haiku-class. Haiku 4.5 scored 0.759
      recall vs 0.966, missed `Squat Rack` in 3 of 7 photos, tripped the road-bike
      look-alike in the real photo, returned 2 non-member ids, and identified only 1
      of the 6 non-catalogue items where Opus identified 5 — so it does not use the
      `null` + label escape hatch. Amend design § 8.1 (done) and `infra/api.ts` when T-3.2 lands.
- [ ] **T-E1.6 [B]** The scan needs **one attempt at a raised (~20 s) budget**, not
      `createWithRetry`'s 12 s × 2 — measured max is 12.27 s end-to-end against a
      12 s per-attempt budget, i.e. ~0 % margin on 7 easy photos. (Precisely: no
      attempt breached it — all 7 returned — but a harder photo or a cold Lambda
      tips it into a ~22 s retry against a hard 30 s.) Same no-retry harness variant as T-1.9; build once. Alternatively
      measure 640 px vs 1568 px input on the real photo set first — it would cut
      latency and the $0.0272/scan cost, at unmeasured accuracy cost.
- [ ] **T-E1.7 [B]** Exclude `Bodyweight` from what the scan may return — it is
      true of every gym, so inject it server-side rather than treating it as
      detectable (Opus returned it as a detection). Two sibling prompt fixes from
      the same run: push harder on "if it IS in the list, use the id" (both models
      sometimes describe a catalogue row in prose as `null` + label, costing the user
      real kit), and do not surface non-equipment null entries as suggestions — Opus
      returned 15 (wall clock, mirror, gym bag, plants).

### E2 — deterministic ranker vs AI composition (bake-off) · **COMPLETE**

> **Verdict: the HYBRID wins.** `scratchpad/loadout-phase-e/VERDICT-E2.md`, with
> the dataset in that directory's `results/`. Summary in `design.md` § 6.0.

- [x] **T-E2.1** Fixture set: ~20 real workouts × 4 equipment contexts (full
      gym, dumbbells+bench, bands only, hotel gym). Same candidate sets fed to
      both arms — stage 1 is shared and deterministic (design § 1).
      **Landed:** 80 fixtures, of which **58 bear a swap** (171 rows); the 3
      seeded workouts verbatim + 17 authored from catalogue-resolved names,
      hard-failing on an unknown name. `full_gym` produced **zero** swaps across
      all 20 of its fixtures — a pure control; those 20 plus two `hotel_gym`
      fixtures were byte-identical across arms and excluded from judging.
- [x] **T-E2.2** Arm A: prototype the ranker's scoring (design § 6.2) as a pure
      function. Throwaway quality — Phase 1 builds the real one.
- [x] **T-E2.3** Arm B: candidate-constrained model composition — forced tool
      selecting `exerciseId`s from the candidate list, whole plan in one call.
      **Zero non-member ids across 116 model runs and 341 selected ids.**
- [x] **T-E2.4** Blind scoring rubric per adapted plan: equipment-legal
      (hard pass/fail — any illegal row fails the plan), muscle/pattern
      fidelity, whole-plan coherence (no five-dumbbell-press plans, no dropped
      movement pattern), reason quality. Record arm B's latency and per-run
      cost. **All three arms passed the hard gate 80/80**; position bias in the
      blind judge was checked and is absent.
- [x] **T-E2.5** Verdict → **sets D7**: the hybrid (arm C) is Phase 1's engine —
      it tied the full-pool model arm 25–25 on blind preference at 29 % of its
      cost, and beat the deterministic ranker 50–4. Phase 1's inherited items
      are stated in the verdict and folded into the spec: a ceiling
      (**AC-10.2, rewritten — its old premise is void**), a cost line
      ($0.0057/adaptation), and programme-level async (**AC-10.3**, sharing
      spec-26's job infrastructure — build once).

- [x] **T-E.9** Write both verdicts into `design.md` (§ 6 and § 8) and update
      D7 in `requirements.md`. Commit the eval script under `scratchpad/` or
      delete it — it is not production code and must not land in `src/`.
      **Landed:** `design.md` § 1 (stage 2 resolved — the canonical section
      spec-26 mirrors), § 6.0 (E2 verdict), § 6.2 note, § 7.3 revision, § 8's
      no-retry question, § 8.0 (E1 blocked — no verdict to write yet, and why);
      `requirements.md` D7, § Phase E status, the phase table, AC-10.2/AC-10.3,
      and the now-void non-goal. Script committed under
      `scratchpad/loadout-phase-e/`, nothing in `src/`.

### Found by the eval, not in either arm's scope

- [ ] **T-E.10 [B]** `Leg Press` and `Leg Curl` carry
      `equipment_required = '{}'` because their seeded equipment names have no
      `equipment_types` row (`Leg Press Machine` / `Leg Curl Machine`) and
      `seedExercises.ts`'s `resolve()` drops unmapped names **silently**. With
      `x @> '{}'` always true (design § 6.1), a bands-only athlete keeps the leg
      press — in the seeded "Lower Body" and "Full Body Starter" workouts, the
      first two a new account owns. Needs a data migration **and** a seeder guard
      that fails loudly on an unmapped name. Not Phase 1's critical path, but it
      makes Loadout look broken on the default workouts.
- [ ] **T-E.11** `movement_type` is NULL for all 2281 seeded rows, so design
      § 6.2's pattern signal has no data (see § 6.0). Only worth a backfill if a
      deterministic-only engine is ever revisited (Phase 5) — recorded so the
      absence is not rediscovered.

## Phase 1 — Adaptation engine + preview (backend)

> **E2 selected the HYBRID** (design § 6.0), so this phase is BOTH halves:
> T-1.1–T-1.3 build the shortlister (the § 6.2 ranker is still needed — as the
> shortlister, top 25 per row), **plus** a model-selection stage with the
> adapter + ceiling + usage-log tasks patterned on T-3.1–T-3.3. Stages 1, 3 and 4
> stay deterministic (design § 1). Two additions the verdict forces:
> **T-1.9** the re-map ceiling (AC-10.2 — ⚠ number is a Brad checkpoint) and
> **T-1.10** returning the structured reason code _and_ the model's sentence
> (design § 7.2 alone is not sufficient once the model writes the copy).

- [ ] **T-1.1 [B]** Add `equipmentSubsetOf` to `ListExercisesFilters` +
      `buildNonSearchFilterConditions`, rendering
      `@> COALESCE(equipment_required, '{}')`. Do not touch `equipmentAny`
      (design § 6.1).
- [ ] **T-1.2 [B]** Pure `rankSubstitutes(source, candidates, context)` with
      the § 6.2 weights and the `name ASC` tiebreak. The orphaned
      `get_alternative_exercises` SQL function is **not** called.
- [ ] **T-1.3 [B]** Candidate assembly: one query, muscle union + containment +
      `buildVisibilityCondition`, `LIMIT 400`, log on truncation (design § 6.3).
- [ ] **T-1.4 [B]** `POST /workouts/:id/loadout/preview` — `canRead` on the
      parent (not owner-only, AC-1.2), empty context → 400, no duplicate picks
      within a plan, unresolved rows returned flagged (AC-3.4), nothing
      persisted.
- [ ] **T-1.5 [B]** Structured reason codes (design § 7) — no UI copy in the
      backend.
- [ ] **T-1.6 [B]** `POST /workouts/:id/variations` re-verifies **visibility on
      every** submitted row but **containment only on rows not flagged
      `is_user_override`** — AC-4.2/4.3 permit a deliberate incompatible pick,
      and verifying containment everywhere would reject exactly that case
      (design § 7.1). Also `canRead` on the parent.
- [ ] **T-1.7 [B]** `GET /exercises/substitutes` → `{ best, others }`, shipped
      as its own handler next to `exercisesSearchHandler` and registered
      **before** `exercisesGetHandler` (`api.ts:122`) — a late-mounting sub-app
      cannot satisfy that ordering (design § 3, § 6.4). Add it to a
      route-ordering test.
- [ ] **T-1.8 [B]** Tests — ranker unit cases incl. NULL `secondary_muscles` /
      NULL `equipment_required`; a `PgDialect` test that fails against an
      `&&` implementation; targets preserved byte-for-byte; parent untouched
      (AC-1.3). Add the AC-3.6 visibility render the eval could **not** cover:
      every seeded row is public, so `buildVisibilityCondition` was a no-op
      across the eval corpus (VERDICT-E2 § Limitations).
- [ ] **T-1.9 [B]** Model-selection stage: forced-tool adapter over
      `aiBedrockClient`, ids validated for membership in TypeScript → 422 on a
      non-member (design § 1), shortlist of **top 25 ranked candidates per row**,
      plus the re-map daily ceiling on the #156 pattern (`429 ai_daily_limit`,
      usage rows for actual inferences only, fail-safe env parse) and
      `AI_LOADOUT_REMAP_MODEL_ID` (Haiku-class — sufficient in E2) registered in
      `infra/api.ts`. ⚠ **Ceiling number is a Brad checkpoint (AC-10.2)**.
      **Verify the model id is granted in the PRODUCTION Bedrock account before
      shipping** — grants are per-account (STATE.md 2026-07-26); Haiku 4.5 is
      currently granted in both.
- [ ] **T-1.11 [B]** `intensity_mismatch` flag (AC-3.5b, design § 7.1b): a
      deterministic check — parent target is a strength range (reps ≤ 6) AND the
      chosen alternative lost every loadable equipment type — surfaced via the
      AC-3.4 flag machinery. No model, no cost, no ceiling. E2 measured this on
      **10 of 171 swaps**, where the exercise choice was correct and the
      prescription was still unusable (`Barbell Deadlift 4×4-6 → Band Good Morning
4×4-6`). **Do NOT change the target to suit the kit** — that relaxes § 1's
      rule 2 and is a Brad decision with its own slice.
- [ ] **T-1.10 [B]** Return the structured reason code **and** the model's
      sentence per row. Design § 7.2's codes alone are no longer sufficient now
      the model writes the copy; Phase 2 owns the copy treatment (E2's reason
      text scored well but reads formulaically).

## Phase 2 — Mobile athlete flow (needs the design handoff)

- [ ] **T-2.1 [M]** Ports + adapter for saved gyms, preview, create-variation,
      substitutes.
- [ ] **T-2.2 [M]** Loadout entry card on workout detail + locked/upsell state
      (price from the catalog, never a literal).
- [ ] **T-2.3 [M]** `collect` (saved gym / manual / scan), equipment groups
      from the API.
- [ ] **T-2.4 [M]** `manual` picker + name field + save-as-gym toggle.
- [ ] **T-2.5 [M]** `adapting` skeleton bound to the real request.
- [ ] **T-2.6 [M]** `review` — KEPT/SWAPPED pills, reason lines, per-row swap.
- [ ] **T-2.7 [M]** Shared `EquipmentAwareSwapSheet` replacing the ad-hoc
      filter in `SwapExercisePopover.tsx:131-142`; used by both surfaces
      (AC-4.4). Persistence stays `substitute-exercise.command.ts`.
- [ ] **T-2.8 [M]** "Saved setups" list on the parent + `saved` success screen.
- [ ] **T-2.8b [M]** "Save & start" — persist the variation and start a session
      against it in one action (AC-5.3), reusing the existing start-session path.
- [ ] **T-2.9 [M]** Saved-gym management list in Settings/Profile (AC-7.2).
- [ ] **T-2.10 [M]** Tests + a device-verify checklist in the PR body.

## Phase 3 — Equipment scan (ships INSIDE the Phase 2 slice)

> Kept as its own task block for reviewability, but it lands in the **same PR
> as the mobile flow** so the first user-visible Loadout has the scan rather
> than a checklist. It depends only on Phase 0's `equipment_types` work, not on
> the ranker. Gated on E1's verdict — if scan is not viable as the primary
> path, the picklist leads and this becomes an accelerator.

- [ ] **T-3.1 [B]** `POST /ai/equipment-scan` cloning
      `nutritionAiEstimateHandler`'s guard order exactly; `reachedModel` +
      `finally` usage log; `AI_EQUIPMENT_SCAN_DAILY_LIMIT` fail-safe parse
      (default 10 — **Brad checkpoint**).
- [ ] **T-3.2 [B]** Register `AI_EQUIPMENT_SCAN_DAILY_LIMIT` and
      `AI_EQUIPMENT_SCAN_MODEL_ID` in `infra/api.ts`. No IAM change needed.
- [ ] **T-3.3 [B]** Forced-tool adapter; full `equipment_types` catalogue in
      the prompt; **TypeScript membership validation** of returned ids → 422 on
      a hallucinated uuid (design § 1).
- [ ] **T-3.4 [M]** Scan sheet (design D1) reusing the `SnapAISheetContainer`
      transport; draft-confirm; 402/422/429 states are conversion/retry
      surfaces, not dead ends.
- [ ] **T-3.5 [B/M]** Tests — fake Bedrock client, ceiling behaviour, no usage
      row on pre-model rejections.

## Phase 4 — Coach programme adaptation

- [ ] **T-4.1 [B]** Programme linkage migration + `schema.ts` mirror
      (design § 2.4).
- [ ] **T-4.2 [B]** Programme-level preview + create-variant; each adapted
      workout is itself a workout variation; `program_workouts.position`
      preserved. Assemble the candidate pool **once** for the union of all
      muscles across the programme; cap at **120 workouts** → 413 beyond, no
      silent truncation (design § 7.3).
- [ ] **T-4.3 [B]** Assign from the variant via the existing programme-assignment
      path; `assertTrainerCanActForClient` on every entry point (AC-8.4).
- [ ] **T-4.4 [M]** Coach programme detail entry, per-workout entry, review,
      assign.
- [ ] **T-4.5** Tests incl. an ex-coach (terminated relationship, spec-25)
      getting 403.

## Phase 5 — Second-engine follow-up (optional) · **unlikely, on E2's evidence**

Two different questions, and E2 answered them differently:

- **The deterministic ranker — not close, do not revisit as-is.** It lost 4–50 on
  blind preference and produced unshippable swaps (design § 6.0). Worth revisiting
  only if `movement_type` is backfilled across the catalogue first (T-E.11);
  without that it has no pattern signal to rank on.
- **The full-pool model arm — genuinely close, and rejected on cost alone**
  (25–25 with 8 ties, within ±0.1 on two of three axes). This phase's original
  gate ("only if E2 was close") therefore _is_ satisfied for that arm. Still not
  recommended: 3.4× the hybrid's cost for no measured quality gain. Revisit only
  if device use shows the shortlist excluding a pick users wanted — and then the
  cheaper fix is raising `perRow`, not removing the shortlist.

**The no-retry question is NOT closed by E2** and moves to T-1.9 (design § 8). E2
measured only the happy path (2.60 s p50 / 3.79 s max); 12 s × 2 on the retry path
plus auth/SQL/usage-log overhead is exactly what GTM § 3 P2 was worried about.
Every § 1 rule holds.

## Gates (every phase)

- [ ] **T-G.1** From the repo root: `bun run prettier:check`,
      `TURBO_FORCE=true bun run typecheck`, `bun run lint`, `bun run build`,
      `bun run test:unit`. ≥ 90 % coverage on changed files. Turbo caches
      typecheck — force it, or a cold CI checkout will catch what local missed.
- [ ] **T-G.2** `inspector-brad` on the branch diff; fix 🔴/🟠/🟡 or justify;
      re-run until clean; note `clean @ <sha>` in the PR body. Do **not** fire
      the CI action.
- [ ] **T-G.3** Prettier-format any committed `.md` — the staging deploy runs
      `prettier --check .` over the whole tree.
- [ ] **T-G.4** Flag **MANUAL PROD MIGRATION** in the PR body for every phase
      that carries one (staging auto-applies on merge; production does not).
- [ ] **T-G.5** Update `STATE.md`.

## Notes / risks

- **Data isolation** (CLAUDE.md § Dangerous Areas): saved gyms and variations
  are per-user; the swap picker must not leak coach-private exercises. The
  `PgDialect` renders + two-user tests are the guard — there is no
  integration-DB harness in this repo.
- **P0 is shared with spec-26 Mealprint.** Whichever lands first builds it;
  the other consumes it. Do not build it twice.
- The async-job infrastructure that Mealprint's week plans and programme import
  need is **not** required here — every Loadout call is synchronous.
- Design assets say "AnyGym"; all code and copy say **Loadout**.
