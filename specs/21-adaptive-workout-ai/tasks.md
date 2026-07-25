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
      `workout_limit` NULL) with `ON CONFLICT (tier_name) DO NOTHING`; add
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
- [ ] **T-P0.10 [O]** Hand Brad the ASC/RC runbook **in chat, not committed**:
      two ASC products at £29.99 / £299.99, an RC entitlement whose
      **lookup_key is literally `premium_plus`**, both products attached to the
      `default` offering. Note the ordering constraint: the catalog row must be
      on **production** before the first purchase, or the webhook FK-fails into
      an RC retry loop.
- [ ] **T-P0.11 [B]** Tests: catalog row present and priced; `coerceTierName`
      round-trips `premium_plus`; `TIER_RANK` precedence beats `premium` in
      `pickDesiredSubscription`; a `premium_plus` RC entitlement syncs to the
      right tier.

## Phase 0 — Data model + saved gyms + variations (backend)

- [ ] **T-0.1 [B]** Migration: `saved_gyms` table + named unique index on
      `(user_id, lower(btrim(name)))` + `(user_id, created_at DESC)` index +
      RLS-on-zero-policies (design § 2.1; template
      `20260708130000_client_ai_summaries.sql`).
- [ ] **T-0.2 [B]** Migration: `workouts.parent_workout_id` (FK → workouts,
      **ON DELETE SET NULL**), `variation_kind` (+ idempotent CHECK),
      `source_gym_id` (FK → saved_gyms, SET NULL), `source_equipment_type_ids`;
      partial index on `parent_workout_id` (design § 2.2).
- [ ] **T-0.3 [B]** Migration: `workout_exercises.substituted_from_exercise_id`,
      `substitution_reason` (**jsonb**, not text — § 7.2) and
      `is_user_override`. **Add no new index** — `001_initial_schema.sql:699-702`
      already creates two `workout_id` indexes plus a composite, and
      `CREATE INDEX IF NOT EXISTS` matches on name, so a differently-named one
      would silently become a third duplicate (design § 2.3). Mirror the
      existing indexes into `schema.ts` instead.
- [ ] **T-0.3b [B]** Migration: `equipment_types.category` + idempotent backfill
      of the 28 seeded rows into the five design groups; project it from
      `GET /exercises/equipment` (design § 2.3b). Phase 0, not Phase 2 —
      deferring forces an out-of-phase migration (AC-2.2).
- [ ] **T-0.4 [B]** `schema.ts` mirror for T-0.1…T-0.3 + `SavedGym` /
      `NewSavedGym` exports. Explicit projections only (the
      `equipment_types.description` live-DB drift, design § 2.5).
- [ ] **T-0.5 [B]** `SavedGymRepository` + `SavedGymService` decorator
      (mirroring `workoutService.ts`). Ownership folded into the mutating
      `WHERE`; zero rows → 404. Validate every `equipment_type_id` against
      `equipment_types` → 400.
- [ ] **T-0.6 [B]** Saved-gym handlers: `GET`/`POST /saved-gyms`,
      `PATCH`/`DELETE /saved-gyms/:id`. 409 on duplicate name (AC-7.4).
- [ ] **T-0.7 [B]** `GET /workouts/:id/variations` (caller-owned only) and
      `POST /workouts/:id/variations` (persist a reviewed plan in one
      transaction, with provenance), the latter behind the `loadout`
      entitlement.
- [ ] **T-0.8 [B]** `EntitlementFeature` gains `"loadout"`; add `assertLoadout`
      reading `subscription_tiers.loadout_access`; **route it explicitly** —
      `assertEntitlement.ts:249` allows any unrouted feature (design § 5.1).
- [ ] **T-0.9 [B]** Add `isNull(workouts.parentWorkoutId)` to **both** `mine`
      paths in `buildListWhereClause` — the `ownerLibraryOnly` branch too, or
      trainers still see every variation (design § 4). Variations are created
      `visibility = 'private'` (design § 2.2).
- [ ] **T-0.10 [B]** New `loadoutRoutes.ts` sub-app; mount it in `api.ts` —
      **not** a root `.use()` chain extension (TS2589 ceiling, design § 3).
      `GET /exercises/substitutes` is the one route that does NOT go in it
      (T-1.7).
- [ ] **T-0.11 [B]** Tests — `PgDialect` renders (mine-branch `parent IS NULL`,
      saved-gym `user_id`, variations `parent_workout_id` + `created_by`),
      two-user isolation, 402 on the guarded create, 409/400/404 paths.

## Phase 1 — Ranker + adaptation preview (backend)

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
      (AC-1.3).

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

## Phase 3 — Equipment scan

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
      muscles across the programme; cap at **50 workouts** → 413 beyond, no
      silent truncation (design § 7.3).
- [ ] **T-4.3 [B]** Assign from the variant via the existing programme-assignment
      path; `assertTrainerCanActForClient` on every entry point (AC-8.4).
- [ ] **T-4.4 [M]** Coach programme detail entry, per-workout entry, review,
      assign.
- [ ] **T-4.5** Tests incl. an ex-coach (terminated relationship, spec-25)
      getting 403.

## Phase 5 — Model-assisted re-map (optional)

Only if the deterministic ranker underwhelms on device. Requires a no-retry
variant of `createWithRetry` (ONE attempt, ~20s) to stay under the 30s API
Gateway ceiling, and keeps every § 1 rule.

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
