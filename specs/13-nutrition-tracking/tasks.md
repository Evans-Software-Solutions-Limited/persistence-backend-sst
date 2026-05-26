# 13 — Nutrition Tracking: Tasks

## Current state (2026-05-26)

**Spec authored** — requirements.md + design.md replace stubs as net-new full pass. Two milestones share this folder:

- **M9 (Tier A)** — manual + barcode + macros + water + trainer cross-cut. Tasks below in § M9.
- **M9.5 (Tier B)** — AI photo + LLM free-text + entitlement gate (+ optional adaptive TDEE). Tasks below in § M9.5.

No implementation code has shipped. Schema migrations have not been run. The 2026-05-26 audit of `packages/db/src/schema.ts` confirms zero nutrition tables exist — everything is greenfield.

Two open decisions need Brad input before M9 brief is cut:

- **D2** — OFF User-Agent contact email (placeholder `support@persistence.app` until confirmed).
- **D3** — STORY-019 adaptive TDEE — ship in M9.5 or defer to v2?

---

## § M9 — Tier A task list

Tasks sized ≤ 1 day each. Every task cites one `requirements.md` STORY + AC pair AND one `design.md` section.

### Phase 1: Schema & infrastructure (M9 backend)

- [ ] **M9-T01** Create migration `NN_nutrition_foods.sql` with `foods` table + `pg_trgm` GIN index + check constraints. Verify `pg_trgm` extension is available on Neon; fall back to `tsvector` index if not. _(impl: STORY-001 AC 2; design § 3.1)_
- [ ] **M9-T02** Create migration `NN_nutrition_entries.sql` with `nutrition_entries` table including `logged_by_user_id` column built-in from day 1 per cross-cuts § 1.1. _(impl: STORY-001 AC 4 + STORY-011 AC 2; design § 3.2)_
- [ ] **M9-T03** Create migration `NN_meal_templates.sql` with `meal_templates` + JSONB schema validation in service layer. _(impl: STORY-007 AC 1; design § 3.3)_
- [ ] **M9-T04** Create migration `NN_nutrition_targets.sql` with `nutrition_targets` table including `set_by_user_id` column built-in per cross-cuts § 2.1 + partial unique index `nutrition_targets_one_active_uq`. _(impl: STORY-010 AC 2 + STORY-011 AC 2; design § 3.4)_
- [ ] **M9-T05** Create migration `NN_water_entries.sql` with `water_entries` table + composite index `(user_id, logged_at desc)`. _(impl: STORY-005 AC 2; design § 3.5)_
- [ ] **M9-T06** Create migration `NN_food_cache.sql` with `food_cache` + daily cron Lambda that purges entries older than 30 days. _(impl: STORY-002 AC 6 (cache fallback context); design § 3.6 + § 5.4)_
- [ ] **M9-T07** Update Drizzle `packages/db/src/schema.ts` with all six table definitions + enums (`food_source`, `meal_slot`, `portion_unit`). Generate types. _(impl: all M9 STORYs; design § 2 + § 3)_

### Phase 2: Open Food Facts proxy + foods endpoints (M9 backend)

- [ ] **M9-T08** Implement `OpenFoodFactsClient` in `microservices/core/src/application/nutrition/integrations/openFoodFacts.ts` — HTTP client with required User-Agent header, 3s timeout, ODbL-compliant. _(impl: STORY-002 AC 2; design § 5.3)_
- [ ] **M9-T09** Implement `GET /foods/barcode/:code` handler — cache-check → OFF call → upsert + return path. _(impl: STORY-002 AC 2-4; design § 5.2)_
- [ ] **M9-T10** Implement `GET /foods/search?q=` handler — query local `foods` table with `pg_trgm` similarity + paginate. _(impl: STORY-001 AC 2 + STORY-006 AC 1; design § 10.1)_
- [ ] **M9-T11** Implement `GET /foods/:id` and `POST /foods` (manual food creation, owner-scoped). _(impl: STORY-002 AC 4 (manual fallback); design § 10.1)_
- [ ] **M9-T12** Tests for OFF integration: mocked OFF responses (200, 404, 5xx, timeout) all exercised. Cache hit/miss paths. _(impl: STORY-002 AC 2-6; design § 5.2)_

### Phase 3: Entries + targets + water + templates endpoints (M9 backend)

- [ ] **M9-T13** Implement `NutritionEntriesRepository` with `create`, `getByUserAndDate`, `update`, `delete`, `listRecentByUser` (for STORY-006). Every method takes `userId` first per `CLAUDE.md § User Data Isolation`. _(impl: STORY-001 AC 4 + STORY-008 AC 1; design § 11)_
- [ ] **M9-T14** Implement `POST /nutrition/entries` handler — snapshot macros at log time, default `logged_by_user_id = NULL`. _(impl: STORY-001 AC 4; design § 10.1)_
- [ ] **M9-T15** Implement `PATCH /nutrition/entries/:id` handler — ownership check, re-snapshot macros, advance `updated_at`. Reject edit if `logged_by_user_id IS NOT NULL` and caller is the row's `user_id` per cross-cuts § 1.5. _(impl: STORY-009 AC 1-4; design § 10.1)_
- [ ] **M9-T16** Implement `DELETE /nutrition/entries/:id` handler — ownership check + soft-delete or hard-delete (decision: hard-delete for v1, retain audit via `trainer_actions_audit` if relevant). _(impl: STORY-009 AC 2; design § 10.1)_
- [ ] **M9-T17** Implement `GET /nutrition/daily?date=YYYY-MM-DD` handler — composes `DailySummary` from entries + target + water entries. User-local date boundary using `profiles.timezone` per cross-cuts § 3.4. _(impl: STORY-008 AC 1; design § 2 + § 10.1)_
- [ ] **M9-T18** Implement `GET /nutrition/targets` + `PUT /nutrition/targets` handlers — write new row, advance previous `effective_until`. Self-set means `set_by_user_id = NULL`. _(impl: STORY-010 AC 2-4; design § 10.1)_
- [ ] **M9-T19** Implement `POST /nutrition/water` and `DELETE /nutrition/water/:id` (LIFO undo). _(impl: STORY-005 AC 2-3; design § 10.1)_
- [ ] **M9-T20** Implement meal-template CRUD: `GET /meal-templates`, `POST /meal-templates`, `PATCH /meal-templates/:id`, `DELETE /meal-templates/:id` + 50-template hard cap. _(impl: STORY-007 AC 1-4; design § 11)_
- [ ] **M9-T21** Implement "replay template" service method — writes N `nutrition_entries` rows in one txn with `logged_at = now()` + inherited meal slot. _(impl: STORY-007 AC 2; design § 11.5)_
- [ ] **M9-T22** Tests to ≥ 90% coverage across services + repositories with two-user isolation tests per `CLAUDE.md § Dangerous Areas`. _(impl: all M9 STORYs; design § 18.1)_

### Phase 4: Trainer cross-cut endpoints (M9 backend — owned by M9, route-wired by M8)

- [ ] **M9-T23** Implement `setTargetOnBehalf(trainerId, clientId, input)` service method — role check → `assertTrainerCanActForClient` (existing helper) → txn-write target row + `trainer_actions_audit` row per cross-cuts § 1.4. _(impl: STORY-011 AC 1-2; design § 10.2)_
- [ ] **M9-T24** Implement `getDailySummaryForClient(trainerId, clientId, date)` service method — same auth chain, returns same shape as self-read. _(impl: STORY-014 AC 1-3; design § 10.3)_
- [ ] **M9-T25** Add `nutrition_target_set` value to `action_type_enum` migration (owned by M8; M9 flags the enum addition here so M8 sequences correctly per cross-cuts § 1.4.1). _(impl: STORY-011 AC 4; design § 15)_
- [ ] **M9-T26** Emit `nutrition_target_set_by_trainer` notification when target is set on behalf — flag enum addition to M7 owner; emit-call shape is what M8 wires. _(impl: STORY-011 AC 4; design § 15)_
- [ ] **M9-T27** Cross-spec note in `10-trainer-features/design.md` referencing this section as the canonical owner of the helper. (Coordinate via PR cross-link; do NOT modify that spec from this branch.) _(impl: STORY-011 AC 5 + STORY-014 AC 5; design § 10.4)_
- [ ] **M9-T28** Tests: trainer-set target writes audit row, fails for non-trainer role (403), fails for unrelated trainer (403), happy path emits notification event. _(impl: STORY-011 AC 1-4; design § 18.1)_

### Phase 5: Mobile port + adapter (M9 mobile)

- [ ] **M9-T29** Define `packages/mobile/src/domain/ports/nutrition.port.ts` — full interface per design § 11.1 (Tier A methods only; Tier B methods marked with `// [M9.5]` comment, not implemented). _(impl: all M9 STORYs; design § 11.1)_
- [ ] **M9-T30** Define `packages/mobile/src/domain/models/nutrition.ts` with all Tier A types. _(impl: all M9 STORYs; design § 2)_
- [ ] **M9-T31** Implement `SSTNutritionAdapter` against the existing `ApiPort` infrastructure — wire types ↔ domain types. _(impl: all M9 STORYs; design § 11.2)_
- [ ] **M9-T32** Implement `InMemoryNutritionAdapter` for tests. _(impl: testing; design § 11.2 + § 18.2)_
- [ ] **M9-T33** Add nutrition tables to mobile SQLite migration: `local_nutrition_entries`, `local_nutrition_targets`, `local_water_entries`, `local_foods`, `local_meal_templates`. Denormalised `food_name` etc. for offline-render. _(impl: STORY-008 AC 5 + STORY-012 AC 2; design § 11.3)_
- [ ] **M9-T34** Wire nutrition mutations into existing M3 sync queue — optimistic UI + retry + backoff. _(impl: STORY-012 AC 1-3; design § 12)_

### Phase 6: Application layer (M9 mobile)

- [ ] **M9-T35** Queries: `getDailySummaryQuery(date)`, `searchFoodsQuery(query)`, `getMealTemplatesQuery()`, `getTargetHistoryQuery()`. _(impl: STORY-008 + STORY-001 AC 2 + STORY-007 AC 2 + STORY-010 AC 3; design § 11.4)_
- [ ] **M9-T36** Commands: `logFoodCommand`, `editEntryCommand`, `deleteEntryCommand`, `logWaterCommand`, `removeLastWaterCommand`, `setTargetCommand`, `saveMealTemplateCommand`, `replayTemplateCommand`. _(impl: STORY-001 + STORY-005 + STORY-007 + STORY-009 + STORY-010; design § 11.5)_
- [ ] **M9-T37** Tests for application layer using `InMemoryNutritionAdapter` — happy paths + offline-write + entity-rejection paths. _(impl: STORY-012; design § 18.2)_

### Phase 7: UI components (M9 mobile)

- [ ] **M9-T38** Build `CalorieRingPresenter` — Reanimated spring animation, contrast-tested colours, label + percent + over/under text. Reduced-motion fallback. _(impl: STORY-003 AC 1-4; design § 13.2 + § 14.1 + § 14.3)_
- [ ] **M9-T39** Build `MacroBarsPresenter` — three bars with macro-specific colours, contrast 4.5:1, optional macro targets handled. _(impl: STORY-004 AC 1-4; design § 13.2)_
- [ ] **M9-T40** Build `WaterTilePresenter` — water-level spring animation, +250/+500 big buttons, long-press for custom, undo button, haptics. _(impl: STORY-005 AC 1-3; design § 13.2 + § 14.1)_
- [ ] **M9-T41** Build `EntriesListPresenter` — meal-slot grouping, source badges (OFF / manual / AI placeholder), 56pt rows, attribution badge for `logged_by_user_id`. _(impl: STORY-008 AC 2 + STORY-009 AC 3; design § 13.2)_
- [ ] **M9-T42** Build `NutritionDailyContainer` + `NutritionDailyPresenter` — top-level day view. Date strip, pull-to-refresh, offline indicator, empty/error/loading states with personality copy. _(impl: STORY-008 AC 1-5; design § 13.2)_
- [ ] **M9-T43** Build `AddFoodModalContainer` + `AddFoodModalPresenter` — bottom sheet with four tabs (Search / Barcode / Photo [gated] / Free-text [gated]). Photo + Free-text tabs render placeholder gates in M9 (`useFeatureGate('aiAccess')` already shipped in M10.5). _(impl: STORY-001 AC 1 + STORY-018 AC 1-2; design § 13.3)_
- [ ] **M9-T44** Build `FoodSearchPresenter` — Recent foods + search results + source-disambiguation badges + Cronometer-restraint (no ads, no sponsored). _(impl: STORY-002 AC 5 + STORY-006 AC 1-2 + Q11 + Q12; design § 13.4)_
- [ ] **M9-T45** Build `BarcodeScannerContainer` + `BarcodeScannerPresenter` — Expo BarCodeScanner, success haptic, immediate portion-confirm sheet. _(impl: STORY-002 AC 1; design § 13.5)_
- [ ] **M9-T46** Build `PortionConfirmContainer` + `PortionConfirmPresenter` — numeric stepper + custom input + live macro readout + meal-slot picker + notes. accessibility-live-region for macro updates. _(impl: STORY-001 AC 3 + STORY-009 AC 1; design § 13.6 + § 14.1)_
- [ ] **M9-T47** Build `MealTemplatesContainer` + `MealTemplatesPresenter` — list + manage (rename / delete). _(impl: STORY-007 AC 3; design § 11)_
- [ ] **M9-T48** Build `NutritionTargetsContainer` + `NutritionTargetsPresenter` — current target card + history + update modal + macro-vs-kcal warning chip. _(impl: STORY-010 AC 1-4 + STORY-011 AC 3; design § 13.9)_
- [ ] **M9-T49** Implement past-day view variant of `NutritionDailyPresenter` — read-only, no `+` CTA, weekly rollup tile. _(impl: STORY-008 AC 4; design § 13.8)_
- [ ] **M9-T50** Build `TrainerClientNutritionPresenter` — read-only mirror of `NutritionDailyPresenter`. Wired by M8; component shipped by M9. _(impl: STORY-014 AC 4; design § 13.10)_
- [ ] **M9-T51** Floating "+" CTA + bottom-sheet wiring across `NutritionDailyContainer`. _(impl: STORY-008 AC 1; design § 13.2)_
- [ ] **M9-T52** Add Nutrition tab to bottom-tab nav — 5th tab additive per Q3; profile becomes header-avatar tap. _(impl: Q3 resolution; design § 13)_
- [ ] **M9-T53** Tests for all presenters with RTL (`render(<Presenter ... />)`) covering empty / loading / error / populated states + accessibility-label assertions per § 14. _(impl: all M9 STORYs; design § 18.2)_
- [ ] **M9-T54** Integration test for `NutritionDailyContainer` using `InMemoryNutritionAdapter` — assert ring updates after a log, optimistic UI, sync indicator transitions. _(impl: STORY-001 AC 5 + STORY-012 AC 1-2; design § 18.2)_

### Phase 8: Apple Health write-back (M9 mobile)

- [ ] **M9-T55** Extend `HealthPort` with `writeNutritionSample` + `writeWaterSample` (iOS implementation, Android no-op). _(impl: STORY-013 AC 1-2 + STORY-013 AC 5; design § 9.1)_
- [ ] **M9-T56** Implement HealthKit sample writes in `ExpoHealthKitAdapter`. Map our `MealSlot` enum to HealthKit meal-type metadata. _(impl: STORY-013 AC 1-2; design § 9.1)_
- [ ] **M9-T57** Wire `writeNutritionSample` + `writeWaterSample` into the sync-flush hook — fire on successful commit, log failure to sync-error surface as "Health write skipped". _(impl: STORY-013 AC 3; design § 9.2)_
- [ ] **M9-T58** Permission-prompt UX on first nutrition log — additive to existing M1 HealthKit permission flow. If denied, feature degrades gracefully. _(impl: STORY-013 AC 4; design § 9.3)_
- [ ] **M9-T59** Tests with mock HealthPort — verify write-back fires + verify failure is non-blocking. _(impl: STORY-013 AC 3; design § 18.2)_

### Phase 9: Quality + smoke (M9)

- [ ] **M9-T60** `bun run prettier:check`, `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit` all green. _(impl: `CLAUDE.md § PR Checklist`)_
- [ ] **M9-T61** Coverage ≥ 90% on changed files (backend services / repos + mobile application layer + presenters). _(impl: `CLAUDE.md § Testing Rules`)_
- [ ] **M9-T62** E2E smoke per `specs/milestones/M9-nutrition/SMOKE_TEST.md` (authored at milestone-brief time) — every STORY's primary AC covered. _(impl: § 18.3)_
- [ ] **M9-T63** Repo-public secret audit — verify no SST Secret values in tests / fixtures / migration files. _(impl: `CLAUDE.md § Dangerous Areas`)_
- [ ] **M9-T64** Update `specs/13-nutrition-tracking/tasks.md` with shipping state notes (per `_agent.md § Spec-first discipline rule 7` — append-only).

---

## § M9.5 — Tier B task list

### Phase 1: Infrastructure (M9.5 backend)

- [ ] **M9.5-T01** Extend `infra/secrets.ts` with `anthropicApiKey = new sst.Secret("AnthropicApiKey")`. Set per-stage via `bunx sst secret set AnthropicApiKey "<value>" --stage <stage>`. Never file-commit. _(impl: STORY-015 AC 3 + STORY-016 AC 2; design § 16.1)_
- [ ] **M9.5-T02** Extend `infra/storage.ts` with private `nutrition-photos` S3 bucket (no public access; 30-day lifecycle rule on objects). CORS for presigned PUT from mobile origins. _(impl: STORY-015 AC 2 + Q8; design § 6.3 + § 16.3)_
- [ ] **M9.5-T03** Wire `AnthropicApiKey` into the Core service bindings (`infra/domains/...`). _(impl: STORY-015 AC 4; design § 16.1)_

### Phase 2: Schema (M9.5)

- [ ] **M9.5-T04** Create migration `NN_nutrition_photos.sql` — `nutrition_photos` table per design § 4.1. _(impl: STORY-015 AC 4; design § 4.1)_
- [ ] **M9.5-T05** Create migration `NN_recognition_cache.sql` — `recognition_cache` table per design § 4.2 + daily-cron purge ≥ 90 days. _(impl: STORY-016 AC 3; design § 4.2)_
- [ ] **M9.5-T06** Create migration `NN_ai_usage_log.sql` — `ai_usage_log` shared per cross-cuts § 4.2 / design § 4.3. _(impl: STORY-015 AC 4 + STORY-016 AC 4; design § 4.3)_
- [ ] **M9.5-T07** (Conditional on STORY-019 shipping) Create migration `NN_nutrition_suggestion_dismissals.sql`. _(impl: STORY-019 AC 4; design § 8.3)_
- [ ] **M9.5-T08** Drizzle schema update for Tier B tables. _(impl: all M9.5 STORYs; design § 4)_

### Phase 3: AI integration (M9.5 backend)

- [ ] **M9.5-T09** Implement `AnthropicClient` wrapper at `microservices/core/src/application/nutrition/integrations/anthropic.ts` — Claude Vision (image input) + Claude text-mode, structured-output prompt per design § 6.4, 10s timeout, retries on 429. _(impl: STORY-015 AC 4 + STORY-016 AC 3; design § 6.4 + § 7.1)_
- [ ] **M9.5-T10** Implement `POST /nutrition/photos/presign` handler — generate per-user S3 PUT URL with 5-min TTL, path prefix `nutrition-photos/<userId>/`. _(impl: STORY-015 AC 2; design § 6.3)_
- [ ] **M9.5-T11** Implement `POST /nutrition/recognize-photo` handler — entitlement-guard first (`assertEntitlement(userId, 'aiAccess')` per cross-cuts § 4.1), S3 key validation, Claude Vision call, parse response, write `nutrition_photos` + `ai_usage_log` in same txn, return `{ items, photoId, latencyMs }`. _(impl: STORY-015 AC 3-7; design § 6.2)_
- [ ] **M9.5-T12** Implement `POST /nutrition/estimate-text` handler — entitlement-guard, SHA-256 normalised-input hash check against `recognition_cache`, Claude text-mode call on miss, write `recognition_cache` + `ai_usage_log` in same txn, return result. _(impl: STORY-016 AC 2-5; design § 7.1)_
- [ ] **M9.5-T13** Verify the 402 response shape matches the M10.5 contract exactly — same `{ code, entitlement, message, upgradeUrl }` shape so the M10.6 sync queue auto-handles it. _(impl: STORY-015 AC 3 + STORY-018 AC 3-4; design § 6.2)_
- [ ] **M9.5-T14** Tests: Claude responses (success + parse-failure + 429 + timeout) exercised. Cache hit vs miss verified. Entitlement-denied (free tier) returns 402 with the correct shape. _(impl: STORY-015 + STORY-016 + STORY-018; design § 18.1)_

### Phase 4: Adaptive TDEE [conditional — STORY-019] (M9.5 backend)

> **Conditional on D3 resolution.** Skip the entire Phase 4 if STORY-019 is deferred.

- [ ] **M9.5-T15** Implement `computeWeeklyTdee(userId, asOf)` service method per design § 8.1 — pull `nutrition_entries` sum + `body_measurements` linear-regression slope. _(impl: STORY-019 AC 1; design § 8.1)_
- [ ] **M9.5-T16** Nightly cron Lambda at 04:00 UTC — sweep all users meeting the data-availability conditions per § 8.2, compute TDEE, write suggestion when divergence ≥ 10% AND target is self-set. _(impl: STORY-019 AC 2 + AC 5; design § 8.2)_
- [ ] **M9.5-T17** `POST /nutrition/suggestions/:id/accept` and `POST /nutrition/suggestions/:id/dismiss` handlers (accept = write new target row; dismiss = 14-day snooze). _(impl: STORY-019 AC 3-4; design § 8.3)_

### Phase 5: Mobile AI flow (M9.5)

- [ ] **M9.5-T18** Extend `NutritionPort` with `recognizePhoto`, `estimateText`, `presignPhotoUpload` (uncomment the M9-T29 placeholders). _(impl: STORY-015 + STORY-016; design § 11.1)_
- [ ] **M9.5-T19** Extend `SSTNutritionAdapter` with the three new methods. Wire types ↔ domain. _(impl: STORY-015 + STORY-016; design § 11.2)_
- [ ] **M9.5-T20** Build `PhotoCaptureContainer` + `PhotoCapturePresenter` — Expo Camera, single capture button (80×80pt, fully accessible-labelled per § 14.1), close button, post-capture "AI is analysing…" loading state with two-stage copy. _(impl: STORY-015 AC 1 + STORY-015 AC 6; design § 13.7 + § 14.1)_
- [ ] **M9.5-T21** Implement photo upload flow in container: presign → PUT to S3 → call `recognizePhoto` → render results. Surface errors (entitlement, network, AI). _(impl: STORY-015 AC 2-4; design § 6.3)_
- [ ] **M9.5-T22** Build `AiCandidatesContainer` + `AiCandidatesPresenter` — list of per-item `PortionConfirmPresenter` instances, confidence chip per item, per-card reject, "Log all" + "Reject all" CTAs. _(impl: STORY-015 AC 5 + STORY-017 AC 1-4; design § 13.6 (AI variant))_
- [ ] **M9.5-T23** Build free-text input view (within Add Food modal's Free-text tab) — text input + submit → `estimateText` → reuse `AiCandidatesContainer`. _(impl: STORY-016 AC 1 + STORY-016 AC 5; design § 13.3)_
- [ ] **M9.5-T24** Wire `useFeatureGate('aiAccess')` into the Add Food modal's Photo and Free-text tabs — gated tap opens M10.5's `FeatureGatePrompt` rather than navigating. _(impl: STORY-018 AC 1-2; design § 13.3)_
- [ ] **M9.5-T25** Verify offline behaviour — AI endpoints surface "Try again when connected" explicit error per STORY-012 AC 5. _(impl: STORY-012 AC 5; design § 12.1)_
- [ ] **M9.5-T26** Tests: Photo + free-text flows with InMemory adapter. Confidence chip rendering for high / medium / low. Reject-single + reject-all. Entitlement-denied path. _(impl: STORY-015 + STORY-016 + STORY-017 + STORY-018; design § 18.2)_

### Phase 6: Adaptive TDEE mobile [conditional] (M9.5)

> **Conditional on D3 resolution.**

- [ ] **M9.5-T27** "Suggested target update" card on the Nutrition tab home when an active suggestion exists for the user. _(impl: STORY-019 AC 2; design § 8.3)_
- [ ] **M9.5-T28** Accept / Dismiss tap handlers wire to backend endpoints. _(impl: STORY-019 AC 3-4; design § 8.3)_
- [ ] **M9.5-T29** Edge-case copy on Targets screen for users without enough data ("Need 2 weeks of logs…"). _(impl: STORY-019 AC 1 edge case; design § 8.4)_

### Phase 7: Quality + smoke (M9.5)

- [ ] **M9.5-T30** All quality gates green per `CLAUDE.md § PR Checklist`.
- [ ] **M9.5-T31** Coverage ≥ 90% on changed files.
- [ ] **M9.5-T32** Repo-public secret audit — verify `AnthropicApiKey` value is never file-committed; all references are by name.
- [ ] **M9.5-T33** E2E smoke per `specs/milestones/M9-5-nutrition-ai/SMOKE_TEST.md` (authored at milestone-brief time): photo → portion-confirm cards → log; free-text → cards → log; free-tier user sees entitlement gate (in-app and on server 402 response); offline path surfaces explicit error.
- [ ] **M9.5-T34** Post-launch — set up `ai_usage_log` dashboard query per design § 16.2 to monitor cost-per-user trends.
- [ ] **M9.5-T35** Update `tasks.md` with shipping state notes (append-only).

---

## Spec-trace summary

- **34 tasks (M9)** + **35 tasks (M9.5)** = 69 total.
- Every task cites one `requirements.md` STORY + AC pair and one `design.md` section.
- Conditional Phase 4 + Phase 6 of M9.5 (Adaptive TDEE) is gated on the D3 decision (ship-or-defer STORY-019).
- M9 is shippable independently of M9.5; M9.5 cleanly layers on top.
