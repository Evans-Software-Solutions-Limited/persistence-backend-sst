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
> **T-1.9** the re-map ceiling (AC-10.2 — **30/day, decided 2026-07-27**) and
> **T-1.10** returning the structured reason code _and_ the model's sentence
> (design § 7.2 alone is not sufficient once the model writes the copy).

- [x] **T-1.1 [B]** Add `equipmentSubsetOf` to `ListExercisesFilters` +
      `buildNonSearchFilterConditions`, rendering
      `@> COALESCE(equipment_required, '{}')`. Do not touch `equipmentAny`
      (design § 6.1).
- [x] **T-1.2 [B]** Pure `rankSubstitutes(source, candidates, context)` with
      the § 6.2 weights and the `name ASC` tiebreak. The orphaned
      `get_alternative_exercises` SQL function is **not** called.
- [x] **T-1.3 [B]** Candidate assembly: one query, muscle union + containment +
      `buildVisibilityCondition`, `LIMIT 400`, log on truncation (design § 6.3).
- [x] **T-1.4 [B]** `POST /workouts/:id/loadout/preview` — `canRead` on the
      parent (not owner-only, AC-1.2), empty context → 400, no duplicate picks
      within a plan, unresolved rows returned flagged (AC-3.4), nothing
      persisted.
- [x] **T-1.5 [B]** Structured reason codes (design § 7) — no UI copy in the
      backend.
- [x] **T-1.6 [B]** `POST /workouts/:id/variations` re-verifies **visibility on
      every** submitted row but **containment only on rows not flagged
      `is_user_override`** — AC-4.2/4.3 permit a deliberate incompatible pick,
      and verifying containment everywhere would reject exactly that case
      (design § 7.1). Also `canRead` on the parent.
- [x] **T-1.7 [B]** `GET /exercises/substitutes` → `{ best, others }`, shipped
      as its own handler next to `exercisesSearchHandler` and registered
      **before** `exercisesGetHandler` (`api.ts:122`) — a late-mounting sub-app
      cannot satisfy that ordering (design § 3, § 6.4). Add it to a
      route-ordering test.
- [x] **T-1.8 [B]** Tests — ranker unit cases incl. NULL `secondary_muscles` /
      NULL `equipment_required`; a `PgDialect` test that fails against an
      `&&` implementation; targets preserved byte-for-byte; parent untouched
      (AC-1.3). Add the AC-3.6 visibility render the eval could **not** cover:
      every seeded row is public, so `buildVisibilityCondition` was a no-op
      across the eval corpus (VERDICT-E2 § Limitations).
- [x] **T-1.9 [B]** Model-selection stage: forced-tool adapter over
      `aiBedrockClient`, ids validated for membership in TypeScript → 422 on a
      non-member (design § 1), shortlist of **top 25 ranked candidates per row**,
      plus the re-map daily ceiling on the #156 pattern (`429 ai_daily_limit`,
      usage rows for actual inferences only, fail-safe env parse) and
      `AI_LOADOUT_REMAP_MODEL_ID` (Haiku-class — sufficient in E2) registered in
      `infra/api.ts`. **Ceiling = 30/day (AC-10.2, decided by Brad 2026-07-27).**
      ~~**Verify the model id is granted in the PRODUCTION Bedrock account before
      shipping**~~ — **DONE, Brad confirmed 2026-07-27** — grants are per-account (STATE.md 2026-07-26); Haiku 4.5 is
      currently granted in both.
- [x] **T-1.11 [B]** `intensity_mismatch` flag (AC-3.5b, design § 7.1b): a
      deterministic check — parent target is a strength range (reps ≤ 6) AND the
      chosen alternative lost every loadable equipment type — surfaced via the
      AC-3.4 flag machinery. No model, no cost, no ceiling. E2 measured this on
      **10 of 171 swaps**, where the exercise choice was correct and the
      prescription was still unusable (`Barbell Deadlift 4×4-6 → Band Good Morning
4×4-6`). **Do NOT change the target to suit the kit** — that relaxes § 1's
      rule 2 and is a Brad decision with its own slice.
- [x] **T-1.10 [B]** Return the structured reason code **and** the model's
      sentence per row. Design § 7.2's codes alone are no longer sufficient now
      the model writes the copy; Phase 2 owns the copy treatment (E2's reason
      text scored well but reads formulaically).

### Landed in Phase 1 beyond the checklist

- **`PlanRow.rowKey`, not `sort_order`, keys every internal map.**
  `workout_exercises.sort_order` has no unique constraint and is written verbatim
  from the client, so two rows can share one — and keying the shortlist map on it
  collapsed one row's candidates into another's, producing a cross-muscle
  substitution (a squat for a bench press) _through_ the guards. Reachable via a
  stranger's public workout, which AC-1.2 makes adaptable.
- **Stage 3 reserves the model's honoured picks before assembling**, then falls
  back to a claimed id rather than emitting an unresolved row. Without the
  reservation one omitted row cascaded into two ranker rows; without the fallback
  the reservation traded a filled row for a hole and reported `no_candidate` for a
  row that had one.
- **`stop_reason: "max_tokens"` is a 422.** A truncated tool payload parses
  cleanly, so the dropped rows would have silently degraded to ranker picks —
  the fallback design § 1 forbids. `max_tokens` also scales with the swap-row
  count (floored at the 4096 it replaced, capped at 16384), because nothing bounds
  how many rows a workout may have and a permanent truncation 422 burns a daily
  adaptation per retry.
- **The model's sentence is capped at 300 chars and unpaired surrogates are
  stripped.** `note` is the one field that reaches the user as prose, and the
  prompt necessarily carries strings the caller does not control (a public
  workout's name, its owner's custom exercise names, neither length-bounded). An
  unpaired surrogate would also fail the `substitution_reason` jsonb insert on
  save, losing the reviewed adaptation to an opaque 500. **Phase 2 must render
  `note` as plain text** — never markup, a link, or anything actionable.
- **`GET /exercises/substitutes` excludes every compatible id from `others`**, not
  just the ones that fit `best`'s page. Otherwise a performable exercise ranked
  past the limit renders as "doesn't fit your kit", and accepting it stores the row
  as `isUserOverride` — corrupting the provenance the save path reads.
- **`packages/web`'s Eden treaty needed its `@ts-expect-error TS2589` back.**
  `GET /exercises/substitutes` is the route that tipped it, and it cannot be nested
  to buy the depth back (it must precede the `/exercises/:id` matcher). Two nesting
  variants were measured and both moved the SAME error into `microservices/core`'s
  own `api.ts`. That file prescribes the suppression for exactly this case and the
  client has 0 call-sites.

## Phase 2 — Mobile athlete flow (needs the design handoff)

- [x] **T-2.1 [M]** Ports + adapter for saved gyms, preview, create-variation,
      substitutes (+ the scan). `domain/models/loadout.ts`,
      `ApiPort` × 9 methods, `SSTApiAdapter`, `InMemoryApiAdapter`.
- [x] **T-2.2 [M]** Loadout entry card on workout detail + locked/upsell state
      (price from the catalog, never a literal).
- [x] **T-2.3 [M]** `collect` (saved gym / manual / scan), equipment groups
      from the API.
- [x] **T-2.4 [M]** `manual` picker + name field + save-as-gym toggle.
- [x] **T-2.5 [M]** `adapting` skeleton bound to the real request.
- [x] **T-2.6 [M]** `review` — KEPT/SWAPPED pills, reason lines, per-row swap.
- [x] **T-2.7 [M]** Shared `EquipmentAwareSwapSheet` replacing the ad-hoc
      filter in `SwapExercisePopover.tsx:131-142`; used by both surfaces
      (AC-4.4). Persistence stays `substitute-exercise.command.ts`.
- [x] **T-2.8 [M]** "Saved setups" list on the parent + `saved` success screen.
- [x] **T-2.8b [M]** "Save & start" — persist the variation and start a session
      against it in one action (AC-5.3), reusing the existing start-session path.
- [x] **T-2.9 [M]** Saved-gym management list — shipped under Settings/Profile, MOVED to the Train hub's `Gyms` segment 2026-08-02 (AC-7.2).
- [x] **T-2.10 [M]** Tests + a device-verify checklist in the PR body.
- [x] **T-2.11 [B+M]** Re-adapt an existing saved setup in place; preserve its
      id/history, freeze the newly resolved kit, and surface linked-gym changes.
- [x] **T-2.12 [M]** Exercise detail drill-in from review and normal pushed-page
      presentation for workout detail.

### Landed in Phase 2 so far — the FOUNDATION, not the screens

Committed and gated on `claude/loadout-phase-2`; **no screen exists yet**, so
nothing is user-visible and nothing is device-verified.

- **T-2.1 complete** — the full client contract, camelCase passthrough (no mapper:
  the backend was written camelCase-out so a preview row round-trips into the save
  call byte-for-byte). All nine calls are ONLINE-DIRECT.
- **`domain/services/loadout.service.ts` — the pure logic the screens consume.**
  `describeLoadoutRow` (review copy derived from `reason.code`, with the model's
  sentence kept in its OWN field so `explanation` is never contaminated),
  `buildVariationExercises` (the faithful round-trip, incl. the `isUserOverride`
  rule), `groupEquipmentForPicker`, `deriveVariationName`,
  `scanDraftToEquipmentIds`, `rowsNeedingAttention`.
- **`ReferenceEntry.category` now survives the adapter.** `mapRawReferenceEntry`
  was silently dropping it, so AC-2.2's "grouped from the API" was true in name
  only. `isEquipmentGroupingStale` distinguishes `null` (server: uncategorised)
  from an ABSENT key (pre-Loadout cache) — without it a returning user's 24h cache
  renders every chip under "Other" with nothing able to detect why.
- **`state/loadout-flow.ts` — the step machine.** `adapting` is bound to the
  REQUEST, never the prototype's 1700 ms timer; the equipment context is a
  discriminated union so "exactly one source" cannot be violated from the client;
  `open()` clears a prior run (else workout B inherits A's picks by `sortOrder`);
  `rev` survives `reset()` because it signals a different screen.
- **113 new mobile tests; 17 mutations applied across the service and the store,
  all 17 caught.**

### Landed in Phase 2's screens beyond the checklist

T-2.2 … T-2.9 and T-3.4 are **DONE** (branch `claude/loadout-phase-2-screens`).
Recreated in the app's primitives and tokens from the handoff at
`~/Downloads/Any Gym/project/` — no lifted prototype JSX. Not yet
device-verified: that needs an EAS dev build against staging, and it is the
review Brad explicitly asked for.

**Architecture decisions worth not re-deriving:**

- **The flow is one `fullScreenModal` route, not five routes.**
  `useLoadoutFlow` remains the single source of truth for the internal step,
  while the navigator owns presentation. Swap and scan sheets stay beside the
  step inside that route. Workout and exercise detail are ordinary pushed pages.
- **`adapting` is bound to the request.** The prototype's 1700 ms auto-advance
  is not implemented and must not be.
- **`others` only MEANS "incompatible" when a kit context was supplied.** With
  none, the server skips containment entirely, so the sheet dims nothing and
  demands no acknowledgement. An EMPTY array is treated as no context, matching
  `exercisesSubstitutesHandler`.
- **The swap sheet's containment context is `preview.equipmentTypeIds`**, not the
  client's saved-gym row. A gym context sends only `savedGymId`; the server
  resolves the kit and echoes it, so the preview's copy is authoritative and the
  cross-device-edit race disappears rather than narrowing.
- **The scan's confirmed draft never saves a gym** (AC-2.3). "Use these" adapts
  with `saveAsGym: false`; "Edit the full equipment list" routes to the manual
  step with the detections pre-selected, which is where naming and saving live.
- **`useLoadoutGate` mirrors `subscription_tiers.loadout_access` client-side**,
  because `/subscriptions/me` does not project that column and this slice is
  mobile-only. The 402 is the real gate. ⚠ **When `loadoutAccess` is added to
  that endpoint, delete `TIER_GRANTS_LOADOUT` and read the flag** — it is a
  four-line backend change and the right follow-up.
- **The entry card has THREE states, not two.** The verdict denies an unresolved
  subscription by design, so a `pending` state was needed or every paying
  Premium+ user met a padlock on cold start.

**Fixed in passing, each found by building against it:**

- `SnapAISheetContainer` resized **width-only** under a comment promising a long
  edge, so every portrait photo shipped ~1/3 over the token budget and anything
  under 1080 px wide was upscaled. Now `shared/utils/image.ts`'s
  `resizeToLongEdge`, shared with the scan.
- `SwapExercisePopover` listed the **local exercise cache**, which is not
  visibility-aware, so it could not enforce AC-3.6. Now `/exercises/substitutes`.
  ⚠ Its caller `applyPickerSelection` resolves the pick through that cache and
  returns SILENTLY on a miss, so the rewrite needed a refresh-and-retry guard.
- The in-memory adapter's saved-gym 409 carried **no `loadoutCode`**, so the
  rename-vs-fail branch it exists to enable was untestable.
- `useGym` / `useEquipmentIds` on the store trip `react-hooks/rules-of-hooks` at
  every call site; renamed `selectGym` / `selectEquipmentIds`.

**⚠ A literal U+0000 in a source file passes every gate and breaks git.** One
crept into `EquipmentAwareSwapSheet`'s array separator. Prettier, ESLint and
Babel all accepted it while git's binary heuristic rendered the whole
file — the one that derives `isUserOverride` — as "Binary file not shown", with
no 3-way merge. Use a comma; UUIDs contain none.

## Phase 3 — Equipment scan (ships INSIDE the Phase 2 slice)

> Kept as its own task block for reviewability, but it lands in the **same PR
> as the mobile flow** so the first user-visible Loadout has the scan rather
> than a checklist. It depends only on Phase 0's `equipment_types` work, not on
> the ranker. Gated on E1's verdict — if scan is not viable as the primary
> path, the picklist leads and this becomes an accelerator.

- [x] **T-3.1 [B]** `POST /ai/equipment-scan` cloning
      `nutritionAiEstimateHandler`'s guard order exactly; `reachedModel` +
      `finally` usage log; `AI_EQUIPMENT_SCAN_DAILY_LIMIT` fail-safe parse
      (~~default 10 — **Brad checkpoint**~~ **6/day, decided 2026-07-27** —
      rationale in design § 8.1).
- [x] **T-3.2 [B]** Register `AI_EQUIPMENT_SCAN_DAILY_LIMIT` and
      `AI_EQUIPMENT_SCAN_MODEL_ID` in `infra/api.ts`. No IAM change needed.
- [x] **T-3.3 [B]** Forced-tool adapter; full `equipment_types` catalogue in
      the prompt; **TypeScript membership validation** of returned ids → 422 on
      a hallucinated uuid (design § 1).
- [x] **T-3.4 [M]** Scan sheet (design D1) reusing the `SnapAISheetContainer`
      transport; draft-confirm; 402/422/429 states are conversion/retry
      surfaces, not dead ends.
- [x] **T-3.5 [B/M]** Tests — fake Bedrock client, ceiling behaviour, no usage
      row on pre-model rejections. **Backend half DONE** (91 tests across
      `modelProse` / `equipmentScanModel` / `aiEquipmentScanHandler` /
      `aiBedrockClient`, 11 mutations applied to the new guards and all caught);
      the mobile half waits on T-3.4.

### Landed in Phase 3's backend beyond the checklist

- **`createSingleAttempt` lives in `aiBedrockClient`, not in the scan module.**
  T-E1.6 needed it and STATE.md asked for it to be built once, because the
  re-map's retry decision is explicitly revisitable against it. Any failure is a
  503 — with no second attempt there is no retryable/non-retryable split worth
  making.
- **A `stop_reason: "max_tokens"` truncation guard**, which T-3.1 did not ask for.
  Same reasoning as the re-map's: a truncated tool payload PARSES, and the
  dropped detections look exactly like kit that was not in the room. Every lost
  item then causes a needless swap, and the user cannot tell the draft is short.
- **`modelProse.ts` — the untrusted-prose rule extracted and shared.** The scan's
  `notes`/`label` have the same exposure as the re-map's per-row note, and the
  scan's channel is arguably worse: **the input is a photograph the caller chose,
  so a photographed whiteboard is an injection vector.** `remapModel.capReason`
  now delegates to it. This is NOT the shared "Loadout AI service" § 1b forbids —
  it is a string sanitiser with no model, prompt, client or ceiling in it.
- **The response splits `detected` from `unmatched`** rather than returning
  § 8.1's single nullable-id list. `detected` is selectable and renders the
  **catalogue's** name; `unmatched` is informational and carries the model's own
  label. That means nothing untrusted reaches the selectable path at all, and a
  correctly-nulled item (E1 had 6) reads as "seen but unavailable" instead of as a
  miss.
- **`Bodyweight` carries `source: "injected"`** so the client can avoid implying
  the camera saw it, and a missing catalogue row **warns loudly** — T-E.10 shipped
  precisely because a silent name-resolution miss went unnoticed.
- **Detections are deduplicated by id, keeping the most confident reading**, and
  ties break on name so two scans of the same room produce the same draft order.
  Unmatched rows are deliberately NOT deduplicated: their labels are free text,
  not a key.

## Phase 4 — Coach programme adaptation → **MOVED to spec-22** (2026-08-05)

⚠ **These tasks now live in `specs/22-program-import-and-adaptation/` (Phase 4,
T-4.1…T-4.5)** so programme adaptation shares a home with programme import — import
ingests an external programme, adaptation reshapes it, and both share the athlete/
coach entry point and the premium gate (spec-22 D1/D2). **spec-21 remains the
single-workout adaptation ENGINE** (§ 6 ranker, § 7 save-path, § 6.1 containment) and
owns the shared programme-linkage columns (§ 2.4); spec-22 orchestrates the
programme-level flow on top of it. Do not implement Phase 4 from this file — it is
kept here only as a pointer.

⚠ **The cap is 10 distinct cycle-workouts, not 120.** The 120 figure elsewhere in
older revisions double-counted weeks×sessions; a programme is a repeating cycle
(spec-19), so adaptation is linear in DISTINCT workouts. See design § 7.3 (corrected
2026-08-04) and spec-22 AC-4.3.

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
