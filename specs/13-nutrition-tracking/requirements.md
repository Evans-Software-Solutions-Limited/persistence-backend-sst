# 13 — Nutrition Tracking: Requirements

## Overview

Persistence ships a nutrition log as a net-new full-stack feature. There is **no legacy counterpart** — the legacy mobile app does not track nutrition at all. The schema is greenfield (zero nutrition tables exist in `packages/db/src/schema.ts` as of 2026-05-26 audit), the mobile screens are net-new, and the backend handlers are net-new.

The feature is split into two tiers shipping in two milestones, **both authored here, only Tier A scheduled for shipping with M9**:

- **[M9] Tier A — manual + barcode + macros + water.** Users log meals manually or by scanning a barcode (Open Food Facts as the food database); see daily calorie + macro (P/C/F) totals against a target; tap a water tile to increment a daily ml total; save and replay meal templates. Trainers can set daily nutrition targets for their clients (cross-cut with `10-trainer-features`, per `specs/_shared/cross-cuts.md § 2.1`). Logs write back to Apple Health (`HKDietaryEnergyConsumed`, `HKDietaryProtein`, …) where available.
- **[M9.5] Tier B — AI photo recognition + LLM free-text + adaptive TDEE (optional).** Users snap a photo of a meal and the AI proposes a list of foods + estimated portions; user confirms each item with an adjustable portion control before the entry lands. Free-text entry path ("two slices of pepperoni pizza") routed through the same confirm-portion UX. Both endpoints are gated behind the `aiAccess` entitlement boolean per `specs/_shared/cross-cuts.md § 4.1`. Optional MacroFactor-style adaptive TDEE — weekly reverse-calc from intake × weight trend with a "suggested target update" prompt the user accepts or dismisses — captured as STORY-019, flagged for in-milestone judgement.

The two tiers share one spec directory; sections and stories are tagged `[M9]` or `[M9.5]` so M9 agents can ignore Tier B content without re-reading the spec at M9.5 kickoff.

Hybrid approach is deliberate. Open Food Facts gives us a 4M+ barcode catalogue with verified data-quality tags for free, but coverage of US restaurant chains and home-cooked meals is weak. AI photo recognition is the path for everything OFF misses. LLM free-text is a low-friction fallback when neither barcode nor photo applies ("describe what you ate" — also serves as the screen-reader-accessible alternative to photo capture, per § Accessibility in `design.md`).

**Tier C is explicitly deferred** — micronutrients, recipe builder, restaurant-chain databases, social meal sharing. See § Out of scope.

---

## User Stories

> Each STORY has a tier tag (`[M9]` or `[M9.5]`). Tier B stories are authored now but explicitly out-of-scope for M9 shipping.

### [M9] STORY-001: Manual food log entry

**As a user, I want to add a food to my log by typing the name and portion so I can track meals not in the barcode catalogue.**

**Acceptance Criteria:**

- [ ] AC 1: User opens the Add Food modal from the Nutrition tab; sees four input methods (search, barcode, photo [Tier B placeholder in M9], free-text [Tier B placeholder in M9]) on one screen per Lifesum-inspired quad input pattern.
- [ ] AC 2: User types in the search input → matches against `foods` table (source `manual` first, then `off`) → tapping a row opens a portion-confirm card.
- [ ] AC 3: Portion-confirm card collects: amount + unit (g, ml, oz, cups, "1 serving"), meal slot enum (`breakfast`, `lunch`, `dinner`, `snack`), optional notes. Calories + macros recompute live as the amount changes.
- [ ] AC 4: On save, an `nutrition_entries` row writes with `logged_by_user_id = NULL` (self-log per `specs/_shared/cross-cuts.md § 1.1`), denormalised `calories_snapshot`, `protein_g_snapshot`, `carbs_g_snapshot`, `fat_g_snapshot` taken at log time so subsequent edits to the underlying `foods` row don't retroactively change the log.
- [ ] AC 5: New entry appears in the Today list within 200ms (optimistic UI) with a "synced" / "pending sync" indicator per the M3 sync-queue pattern.

### [M9] STORY-002: Barcode scan → Open Food Facts lookup → log entry

**As a user, I want to scan a barcode on packaged food and have the macros looked up automatically.**

**Acceptance Criteria:**

- [ ] AC 1: From the Add Food modal, "Scan barcode" opens a full-screen camera scanner (Expo `BarCodeScanner`); successful scan fires a success haptic.
- [ ] AC 2: Scanned EAN/UPC is sent to `GET /foods/barcode/:code`; backend checks `food_cache` first (24h TTL) then proxies to Open Food Facts.
- [ ] AC 3: On hit, the response populates a portion-confirm card with the food name, brand, default serving size, and macros per 100 g. User adjusts portion then saves.
- [ ] AC 4: On miss (OFF returns no match), user sees a "Not found in catalogue — log manually?" affordance that pre-fills the Add Food search with the barcode for reference and lets the user enter the macros by hand. The manual entry creates a `foods` row with `source='manual'`, scoped to the user.
- [ ] AC 5: A "Verified by Open Food Facts" badge renders next to OFF-sourced foods, drawn from the OFF `data_quality_tags` field — Cronometer-inspired restraint. Manual-entry foods show "You added this"; AI-recognised foods show "AI estimate".
- [ ] AC 6: Offline behaviour: scan still works (camera is local), but the lookup is queued for sync and the modal shows "Will save when online — you can still enter portion now". On reconnect, the barcode lookup fires and the entry is hydrated.

### [M9] STORY-003: Daily calorie target with ring chart

**As a user, I want to see my daily calorie total against my target as a ring chart so I can glance at where I am.**

**Acceptance Criteria:**

- [ ] AC 1: The Nutrition tab home shows a primary ring chart with: centre — `consumed_kcal / target_kcal`, ring fill — percent of target consumed.
- [ ] AC 2: Ring is colour-coded with a contrast-safe palette (per § Accessibility in `design.md`) — accent-on-track, warning when ≥ 110%, neutral grey when ≤ 50%. **Colour is never the only signal** — a label "1,450 / 2,200 kcal" sits inside the ring, percent text below.
- [ ] AC 3: Ring fill animates with spring physics on entry and on each log (≤ 350ms, no jank).
- [ ] AC 4: When `consumed_kcal` crosses 100% of target, the engine emits a `daily_nutrition_target_hit` notification (default opt-in `off` per `specs/_shared/cross-cuts.md § 5`) and renders a one-shot in-app haptic + visual flourish.
- [ ] AC 5: With no target set, the ring shows "Set a daily target" with a CTA to STORY-010's flow.

### [M9] STORY-004: Daily macro targets (P/C/F) with bars

**As a user, I want to see my protein, carbs, and fat totals against targets as bars so I can balance macros.**

**Acceptance Criteria:**

- [ ] AC 1: Below the calorie ring, three horizontal macro bars render — Protein (g), Carbs (g), Fat (g). Each shows: numeric `consumed_g / target_g`, percent fill, colour-coded label.
- [ ] AC 2: A user can have a calorie target without macro targets (macros optional); bars hide cleanly when macro targets are `NULL`.
- [ ] AC 3: Tapping a macro bar opens a 1-week tile showing per-day protein/carbs/fat for the last 7 days as a simple bar chart, with a "Average this week" callout.
- [ ] AC 4: Macro maths is exact and consistent — calories displayed on the ring equal `entries.sum(calories_snapshot)`. Protein/carb/fat bar values equal `entries.sum(<macro>_g_snapshot)`. No fractional discrepancies between the ring centre, the entries list, and the macro bars.

### [M9] STORY-005: Water tracker

**As a user, I want to track my daily water intake with simple +/- buttons because I drink in roughly-fixed amounts.**

**Acceptance Criteria:**

- [ ] AC 1: A water tile on the Nutrition tab home shows current daily water (ml), target (ml), and two big buttons: `+250 ml` (one cup) and `+500 ml` (bottle). A long-press on either reveals fine controls and a custom amount.
- [ ] AC 2: Tap fires a spring-physics animation on the tile (water level rises), success haptic on tap. Writes a `water_entries` row.
- [ ] AC 3: A `-` button removes the last `water_entries` row (LIFO), with confirm haptic. Cannot go negative.
- [ ] AC 4: User can set / update daily water target (default 2,000 ml) from the Targets screen.
- [ ] AC 5: Water target hit emits an internal event but does NOT fire a push notification (only calorie target hit notifies — water hitting is too noisy daily and would breach the conservative-on default).

### [M9] STORY-006: Quick-log / "log this again"

**As a user, I want a one-tap way to re-log something I've eaten recently so common meals are fast.**

**Acceptance Criteria:**

- [ ] AC 1: The Add Food modal's search tab opens with a "Recent" section listing the user's most-logged foods over the last 14 days (top 12, sorted by frequency × recency).
- [ ] AC 2: Tapping a recent food opens the portion-confirm card pre-filled with the user's most recent portion for that food.
- [ ] AC 3: An entry list row has a long-press menu with "Log again" — duplicates the entry with `logged_at = now()` and the same portion + macros; no modal, single haptic confirm.

### [M9] STORY-007: Meal templates

**As a user, I want to save a meal (set of foods + portions) as a template and replay it so weekly-repeated meals are one tap.**

**Acceptance Criteria:**

- [ ] AC 1: From the Today entries list, user can multi-select entries and "Save as template"; prompted for a name (e.g. "Tuesday breakfast"). Writes a `meal_templates` row with `entries_json` capturing food_ids + portions.
- [ ] AC 2: Templates are listed on the Add Food modal's "Templates" tab; tap to replay → all entries write at `logged_at = now()`, slot inherited from the user's currently-active meal-slot context.
- [ ] AC 3: Templates can be renamed and deleted from a "Manage templates" entry under the Targets screen.
- [ ] AC 4: A user has ≤ 50 templates (hard cap, returns 422 with `code='templates_full'` past the cap).

### [M9] STORY-008: Daily summary view

**As a user, I want to see today's nutrition (ring + bars + entries) in one place so I can scan my day at a glance.**

**Acceptance Criteria:**

- [ ] AC 1: The Nutrition tab home is the daily summary: calorie ring, macro bars, water tile, today's entries list grouped by meal slot. Floating "+" CTA opens the Add Food modal.
- [ ] AC 2: Entries list shows per-row: food name, source badge (OFF / manual / AI), portion + unit, meal slot icon, kcal. Tap to edit (STORY-009), long-press for "Log again" / "Delete".
- [ ] AC 3: Empty state for a new day: "Log your first meal of the day" CTA with a personality copy line. Not a stock illustration.
- [ ] AC 4: A horizontal date picker (last 30 days swipeable) lets the user view past days; past-day view is read-only (cannot edit historical entries from the swiped-day view; user must use the date-edit affordance in STORY-009).
- [ ] AC 5: Pull-to-refresh re-fetches the day's entries from the API; offline-first cache served immediately so the UI never blanks.

### [M9] STORY-009: Edit / delete a logged entry

**As a user, I want to fix a wrong portion or delete an accidental entry so my log is accurate.**

**Acceptance Criteria:**

- [ ] AC 1: Tapping an entry opens the same portion-confirm card pre-filled with the entry's current state; saving updates the row and re-snapshots `calories_snapshot` + macro snapshots.
- [ ] AC 2: Long-press → "Delete" → confirm sheet → row is removed. Optimistic UI: entry vanishes from list ≤ 100ms; rollback animation if backend rejects (≤ 1% case).
- [ ] AC 3: Editing an `nutrition_entries` row where `logged_by_user_id IS NOT NULL` (trainer-logged on behalf) is **blocked** for the client — read-only attribution badge ("Logged by Coach Bradley") per `specs/_shared/cross-cuts.md § 1.5`. The client can only request removal out-of-band.
- [ ] AC 4: Edits preserve `logged_at`; `created_at` stays the same; `updated_at` advances.

### [M9] STORY-010: Set / update daily nutrition target (self-set)

**As a user, I want to set my own daily targets (kcal + macros + water) so the ring and bars are meaningful.**

**Acceptance Criteria:**

- [ ] AC 1: From the Targets screen, a "Set target" CTA opens a modal: kcal (required), protein g (optional), carbs g (optional), fat g (optional), water ml (default 2,000). Validates sum-of-macros vs kcal (4·P + 4·C + 9·F should be within 15% of kcal; warning chip if not, not blocking).
- [ ] AC 2: Save writes a `nutrition_targets` row with `set_by_user_id = NULL` per `specs/_shared/cross-cuts.md § 2.1` (`NULL` = self-set), `effective_from = today`, `effective_until = NULL` (current). Previous active target's `effective_until` advances to today − 1.
- [ ] AC 3: Targets history shows the last 6 active targets with a small timeline ("Current — 2,200 kcal · Previously 1,800 kcal until 12 Apr"). Trainer-set targets in history are labelled "Set by Coach Bradley".
- [ ] AC 4: Updating only some fields preserves the others from the previous active target (delta-style PATCH semantics, not full overwrite).

### [M9] STORY-011: Trainer-set nutrition target

**As a trainer with an active client, I want to set or update my client's daily nutrition target so they have a coach-led plan.**

**Acceptance Criteria:**

- [ ] AC 1: Trainer calls `PUT /trainers/me/clients/:clientId/nutrition/target` per the trainer-scoped endpoint convention in `specs/_shared/cross-cuts.md § 1.2`. Authorization layered: role check (`personal_trainer` or `physiotherapist`) then `assertTrainerCanActForClient(trainerId, clientId)` per § 1.3.
- [ ] AC 2: Writes a `nutrition_targets` row with `set_by_user_id = trainerId`. Inside the same transaction, writes a `trainer_actions_audit` row with `action_type='nutrition_target_set'` per § 1.4.
- [ ] AC 3: Client UI on the Targets screen shows the trainer-set target with attribution badge ("Set by Coach Bradley") per § 1.5. Client cannot edit the trainer-set target; can only self-set a new one (which writes a new row with `set_by_user_id = NULL`, leaving the trainer row intact as historical record).
- [ ] AC 4: Trainer-set target emits a `nutrition_target_set_by_trainer` notification to the client (default opt-in `on` per § 5, deep link to `/nutrition/targets`); event-emit responsibility lives in `10-trainer-features` design but the enum value is owned by M7's notification migration.
- [ ] AC 5: Cross-spec note — the canonical owner of this endpoint is **`10-trainer-features` § Trainer-set nutrition** per the cross-cuts table; the M9 nutrition handlers expose only the table + the helper. M8 wires the endpoint when it ships.

### [M9] STORY-012: Offline log entry

**As a user logging during a workout without signal, I want my entries to save locally and sync when I reconnect.**

**Acceptance Criteria:**

- [ ] AC 1: All `POST /nutrition/entries` writes flow through the existing M3 sync-queue pattern — saved to SQLite first, queued for sync, optimistic UI immediate.
- [ ] AC 2: Offline-while-logging: entries appear in the Today list with a "Pending sync" indicator. The calorie ring + macro bars + water tile update from local cache; no spinner.
- [ ] AC 3: On reconnect, sync engine flushes the queue; entries flip to "Synced" indicator. On 4xx (e.g. duplicate, missing food_id), the entry surfaces in the existing sync-error surface (banner + review screen) so the user can fix.
- [ ] AC 4: OFF barcode lookups are network-required; if offline, the barcode flow falls back to STORY-002 AC 6 (queue-then-hydrate).
- [ ] AC 5: AI photo upload (Tier B) is network-required; explicit error when offline ("Try again when connected").

### [M9] STORY-013: Apple Health write-back

**As an Apple Watch / iPhone user, I want my nutrition logs to flow into Apple Health so my Health app aggregates everything.**

**Acceptance Criteria:**

- [ ] AC 1: Every successful `nutrition_entries` write triggers a write to the platform health adapter via `HealthPort` (`packages/mobile/src/domain/ports/health.port.ts`), with `HKDietaryEnergyConsumed`, `HKDietaryProtein`, `HKDietaryCarbohydrates`, `HKDietaryFatTotal` samples timestamped at `logged_at`.
- [ ] AC 2: Water entries (`water_entries`) write `HKDietaryWater` samples.
- [ ] AC 3: Write-back is best-effort — a failed Health write does NOT roll back the entry. Failures log to the existing M3 sync-error surface as "Health write skipped".
- [ ] AC 4: Health write-back permission is requested as part of the first nutrition-log flow (additive to the M1 permission request); if denied, the feature degrades gracefully (entries still save to backend).
- [ ] AC 5: Android: write-back is a no-op (Health Connect nutrition surface is read-only via existing adapter); explicit comment in the adapter.

### [M9] STORY-014: Trainer-visible client nutrition log (read-only)

**As a trainer with an active client, I want to view my client's recent nutrition log read-only so I can coach without intruding.**

**Acceptance Criteria:**

- [ ] AC 1: Trainer calls `GET /trainers/me/clients/:clientId/nutrition/daily?date=YYYY-MM-DD` per the trainer-scoped endpoint convention (doubled GET routes locked 2026-05-25 in cross-cuts § 1.2).
- [ ] AC 2: Response shape matches the user's own `GET /nutrition/daily?date=...` exactly — same handler logic, parameter is whose `userId` is filtered.
- [ ] AC 3: Authorization: role check + `assertTrainerCanActForClient` (§ 1.3). Trainer who has no active relationship gets 403.
- [ ] AC 4: Trainer's mobile UI on the existing client-detail screen renders a "Nutrition" tab that shows the same daily summary the client sees, read-only. No edit / delete affordances.
- [ ] AC 5: Cross-spec note — the canonical owner of this endpoint is **`10-trainer-features`**; M9 owns only the underlying daily-summary handler and an authorization helper. M8 wires the route.

---

### [M9.5] STORY-015: AI photo recognition

**As a user with the AI Access entitlement, I want to snap a photo of my meal and have the AI identify foods + estimate portions so I don't have to type every meal.**

**Acceptance Criteria:**

- [ ] AC 1: From the Add Food modal, the "Photo" tab opens a minimal-chrome camera (Cal AI-inspired); capture button is the primary CTA. A short pre-capture caption hints "Frame the whole plate".
- [ ] AC 2: On capture, the photo uploads to S3 via a presigned URL flow (mobile gets URL from `POST /nutrition/photos/presign`, PUTs the file, then `POST /nutrition/recognize-photo` with `{ s3_key }`).
- [ ] AC 3: Endpoint guards: `assertEntitlement(userId, 'aiAccess')` first per `specs/_shared/cross-cuts.md § 4.1`. On denial → HTTP 402 with `{ code: 'ENTITLEMENT_DENIED', entitlement: 'aiAccess', message, upgradeUrl }` — mobile sync queue recognises this shape automatically per M10.6.
- [ ] AC 4: Backend calls Anthropic Claude Vision (Anthropic API key as SST Secret `AnthropicApiKey`), parses response into `[{ food_name, estimated_grams, confidence }]`, writes a `nutrition_photos` row + `ai_usage_log` row per § 4.2, returns the candidate list to the client.
- [ ] AC 5: Client renders a list of "AI proposed" portion-confirm cards, **one per recognised item** (per "AI proposed, user confirms" principle in research findings). User adjusts each portion individually then taps "Log all" to write `nutrition_entries` rows with `foods.source='ai'` for any net-new foods.
- [ ] AC 6: Latency target ≤ 2s p50 from upload-complete to candidates-rendered. Loading state: "AI is analysing…" with a contextual progress hint, not a generic spinner.
- [ ] AC 7: Source attribution: each AI-entered row shows "AI estimate" badge; the photo is retained for 30 days in S3 (lifecycle rule) so the user can re-open the captured image from the entry detail.

### [M9.5] STORY-016: LLM free-text estimation

**As a user with the AI Access entitlement, I want to type "two slices of pepperoni pizza" and have the AI estimate macros so I can log restaurant or home-cooked meals without a barcode.**

**Acceptance Criteria:**

- [ ] AC 1: The Add Food modal's "Free-text" tab is a text input with placeholder ("e.g. two slices of pepperoni pizza"). Submit fires `POST /nutrition/estimate-text` with `{ description }`.
- [ ] AC 2: Entitlement guard identical to STORY-015 AC 3.
- [ ] AC 3: Backend calls Claude in text-only mode (same SST Secret), parses response into the same `[{ food_name, estimated_grams, calories, protein_g, carbs_g, fat_g, confidence }]` shape. Writes a `recognition_cache` row keyed on `input_hash` (SHA-256 of normalised description) so identical re-queries don't re-bill.
- [ ] AC 4: Cache hit → returns instantly; cache miss → `ai_usage_log` row written.
- [ ] AC 5: Client renders portion-confirm cards identical to STORY-015 AC 5; user confirms then "Log all".
- [ ] AC 6: This path doubles as the **screen-reader-accessible alternative to photo capture** (see `design.md § Accessibility`) — a user who cannot capture a photo can describe the meal instead. Not labelled as "accessibility fallback" in UI — it's a first-class input method.

### [M9.5] STORY-017: Verify-portion UX

**As any user, I want to see and adjust portion estimates before they land in my log so AI errors are correctable.**

**Acceptance Criteria:**

- [ ] AC 1: Every AI-sourced candidate (photo or free-text) renders in a portion-confirm card with: food name, AI-proposed grams, confidence chip (low / medium / high derived from model confidence bucketed at 0.5 / 0.75), live-recomputing kcal + macros as the user adjusts.
- [ ] AC 2: A "Reject" affordance per-item lets the user drop a candidate before logging. A "Reject all" at the bottom dismisses the entire batch and returns to the Add Food modal.
- [ ] AC 3: Per the 14-25% MAPE research finding, the UX makes adjustment frictionless — slider + numeric input, both keep snap-to-common-portions (50g, 100g, 150g, 200g…).
- [ ] AC 4: User-adjusted portions are what land in `nutrition_entries`; the original AI-proposed values are persisted in `nutrition_photos.recognized_items` (jsonb) for billing / analytics audit but not surfaced in the daily-log UI.

### [M9.5] STORY-018: Entitlement gate

**As a free-tier user, when I tap an AI feature, I want a clear upgrade prompt so I understand what I'm being asked to pay for.**

**Acceptance Criteria:**

- [ ] AC 1: The Add Food modal's "Photo" and "Free-text" tabs are visible to all users but tap-through behaviour gates on `aiAccess` via the M10.5 mobile primitive `useFeatureGate('aiAccess')`.
- [ ] AC 2: When entitlement is `false`, tapping the tab opens `FeatureGatePrompt` (M10.5 component) with copy specific to nutrition AI ("Snap a meal, log it in seconds — with Premium.").
- [ ] AC 3: Server-side, even if the mobile gate is bypassed (e.g. modified app, replay attack), the endpoint guard from STORY-015 AC 3 returns 402 — defence in depth.
- [ ] AC 4: When a user upgrades, previously-blocked `nutrition_entries` writes that the M10.6 sync engine parked as `blocked_entitlement` auto-retry on subscription activation — no extra wiring needed in M9.5 since the M10.6 retry path already covers this.

### [M9.5] STORY-019 (optional): Adaptive TDEE

**As a user, I want my daily calorie target to auto-adjust based on what I've eaten and how my weight is trending so my target stays accurate without me re-calculating.**

> **Scope flag:** in-milestone judgement call. If M9.5 is on critical path to App Store launch, this story can be deferred to a v2 release without blocking AI photo + free-text. The reverse-calc formula is well-understood (MacroFactor pattern); the UX challenge is the trust-building copy around an auto-adjusting target.

**Acceptance Criteria:**

- [ ] AC 1: A nightly cron computes `weekly_tdee_kcal = (sum_intake_kcal_7d − 7700 × weight_delta_kg_7d) / 7` for each user with ≥ 7 days of logged intake AND ≥ 2 weight samples in the period.
- [ ] AC 2: When the computed weekly TDEE differs from the current target's kcal by ≥ 10%, a "Suggested target update" card surfaces on the Nutrition tab home: "Based on your last 7 days, your maintenance is closer to 2,350 kcal. Update target?" with Accept / Dismiss.
- [ ] AC 3: Accept writes a new `nutrition_targets` row (same flow as STORY-010) with the suggested kcal; macros default to the previous active target's ratios applied to the new kcal.
- [ ] AC 4: Dismiss snoozes the suggestion for 14 days (writes a `nutrition_suggestion_dismissals` row — table added in M9.5 follow-up if pursued).
- [ ] AC 5: Users with trainer-set targets do NOT see suggestions — the trainer owns the target; suggestions would conflict. The condition is `current_target.set_by_user_id IS NULL`.

---

## Out of scope (explicit)

- **Micronutrient tracking** (vitamins, minerals, fibre, sodium, …) — Tier C. Cronometer's depth is a real differentiator; we defer it until Tiers A + B prove product-market fit. Schema is forward-compatible (we add columns later, no breaking changes).
- **Recipe builder** (compose a recipe from foods, save with per-serving macros, log a serving) — Tier C. Most users get 80% of the way there with meal templates (STORY-007); the remaining 20% wait.
- **Restaurant-chain databases** (Chipotle, Starbucks, McDonald's macros from chain-published data) — Tier C. AI photo recognition (STORY-015) is the v1 path for restaurant meals.
- **Food photo editing / cropping** — capture and submit; no in-app crop. Crop tools dilute the "snap and confirm" simplicity.
- **Social meal sharing** (share what I ate to friends, see friends' meals, like / comment) — Tier C and possibly never. We're a fitness-tracking app, not a calorie social network.
- **Nutrition coaching content / recipes / meal plans** — out of scope; this is a logging tool, not a content product. Regulatory drag (dietitian credentials) is real and we won't carry it.
- **Per-call AI rate limiting** (e.g. "10 photo recognitions per day") — `aiAccess` is binary in M9.5 per `specs/_shared/cross-cuts.md § 4.3`. Quota tiers post-M9.5 follow-up.
- **Free-tier trial of AI features** (e.g. "5 free recognitions") — same.
- **Public food contributions to OFF** — we read from Open Food Facts; we do NOT submit user-entered foods back to OFF (license / data-quality reasons). User-entered `foods` rows are scoped to the user.
- **Cross-device meal-template sync conflicts** — meal templates are last-write-wins per M3 sync pattern; no special conflict UI.

---

## Open questions (locked / open status as of 2026-05-26)

| #   | Question                                                                                            | Status                | Resolution                                                                                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Q1  | Offline strategy for a large food database — ship a cut-down DB in-app, or require connectivity?    | Locked 2026-05-26     | **Connectivity-required for OFF lookups.** No bundled food DB. SQLite cache holds last-30-days of the user's own logged foods + meal templates; the user's most-frequented foods are effectively available offline. Avoids 100 MB+ app-bundle bloat and OFF licensing complexity for redistributed data. |
| Q2  | Apple Health / Health Connect integration depth                                                     | Locked 2026-05-26     | **iOS: write-back only** for `HKDietary*` per STORY-013. Android Health Connect: nutrition surface is partial; treat as no-op for write-back. No read-back of Health-entered nutrition (would conflict with our own log).                                                                                |
| Q3  | Does nutrition appear as its own tab, or live under Progress?                                       | Locked 2026-05-26     | **Own tab.** The legacy mobile app has no Nutrition; the V2 has space for a 5th main tab. Profile becomes a header avatar tap (consistent with M6). Nav redesign details deferred to M11 per `specs/README.md` non-goals; M9 ships the tab as additive.                                                  |
| Q4  | Anthropic SDK vs raw HTTP for the AI calls                                                          | Locked 2026-05-26     | **Anthropic Node SDK** (`@anthropic-ai/sdk`). Same SDK pattern as our future workout-coach AI features. SST Secret binding `AnthropicApiKey`.                                                                                                                                                            |
| Q5  | AI cost budget per active AI-tier user per month                                                    | **Open**              | Need a working assumption from Brad before the M9.5 brief is cut. Rough sketch: 30 photo recognitions/month × $0.015/call ≈ $0.45/user. The `ai_usage_log` per `specs/_shared/cross-cuts.md § 4.2` is what we measure against once live; we'll bias toward "ship and measure" rather than over-engineer. |
| Q6  | STORY-019 adaptive TDEE — ship in M9.5 or defer to v2?                                              | **Open** (Brad input) | Worth a 30-min spike to validate the weight-trend smoothing math before committing M9.5 scope. Default lean: defer if M9.5 is on critical path; ship if there's slack.                                                                                                                                   |
| Q7  | OFF cache TTL — 24h enough or longer?                                                               | Locked 2026-05-26     | **24h.** Mainstream products change rarely; reformulations happen. Cache layer absorbs the freq-of-access without overfetching OFF. Daily cron purges entries older than 30 days from `food_cache`.                                                                                                      |
| Q8  | S3 photo retention                                                                                  | Locked 2026-05-26     | **30 days.** Long enough for users to re-open a logged meal and review the photo; short enough that we're not storing user food data indefinitely (privacy posture). Lifecycle rule on the bucket; manual export available if a user requests their data.                                                |
| Q9  | Trainer-set macro targets — only kcal, or full P/C/F?                                               | Locked 2026-05-26     | **Full P/C/F + water.** Trainers should be able to prescribe a full plan, not just calorie ceiling. Endpoint accepts all fields; client UI shows them.                                                                                                                                                   |
| Q10 | If a user has an active trainer-set target and self-sets a new one, which is "current"?             | Locked 2026-05-26     | **Self-set wins for the user's own UI** — the self-set row's `effective_from = today`, older trainer row's `effective_until = today − 1`. Trainer-visible client view shows the new self-set target with no attribution (it's the client's choice). Audit log still preserves the trainer's prior set.   |
| Q11 | Branded foods (e.g. "Tesco Finest Hummus") — show brand in food list?                               | Locked 2026-05-26     | **Yes** — brand shows as subtitle under food name when present (OFF provides `brands`). Helps disambiguation.                                                                                                                                                                                            |
| Q12 | Verified-by-OFF badge — explicit threshold on `data_quality_tags` or show whenever the food is OFF? | Locked 2026-05-26     | **Threshold:** show "Verified" only when `data_quality_tags` includes a "high" or "good" quality indicator. Other OFF rows render as "Open Food Facts" without the verified badge. Mirrors Cronometer's restraint.                                                                                       |

---

**Spec trace:** every section in `design.md` references one or more of the STORYs above; every task in `tasks.md` cites one STORY + AC pair and one `design.md` section.
