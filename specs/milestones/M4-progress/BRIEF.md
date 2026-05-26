# M4 — Progress

## Why this milestone

The `Progress` tab still renders `<ComingSoon />` ([`packages/mobile/app/(app)/(tabs)/progress.tsx`](<../../../packages/mobile/app/(app)/(tabs)/progress.tsx>)). Every other surface that hands off to it — Home's "PR of the week" card, Recent Activity row, the dashboard's `progress.personalRecordsCount` tile — implies an actual destination. M4 builds that destination.

Concretely: PR carousel, last-30-days activity tile, measurement trend chart, measurement editor modal, goal list with progress bars, personal-records list grouped by exercise. Backend is mostly wired (`GET /progress/stats`, `GET /progress/records`, `GET /progress/history`, `GET /personal-records`, `GET/POST /measurements`, full `/goals` CRUD) — M4 verifies the wire shapes, fills the small gaps the mobile UI needs (PATCH/DELETE on measurements; time-range presets; goal status enum reconciliation), and ports the legacy Progress screens onto the SST + SQLite stack.

This is also the second-to-last user-facing build before App Store launch — get the wire shapes right, the offline behaviour right, and the PR-detection display rule right. The detection rule is the foot-gun: **no Epley estimates anywhere on the achievements / progress screen.** PR cards render only exact-rep-match records (`1rm` / `3rm` / `5rm` / `10rm` on exact reps + `max_weight` + `max_volume`). That rule is already enforced server-side in [`personalRecordsRepository.ts`](../../../microservices/core/src/application/repositories/personalRecordsRepository.ts) (per Brad's M3 device-review call) — M4 must not bypass it on the client.

## Parent spec

[`../../06-progress-goals/`](../../06-progress-goals/) — requirements + design + tasks.

The spec covers Home dashboard (closed in M1) and the Progress surface (still open). Read it BEFORE either brief — it's the contract; the briefs are scoped cuts of it. Some sections still need updates before implementation can start (see § Spec alignment + gaps below).

## Scope summary

### Backend (one PR)

Mostly verification + small additive endpoints. The 7 progress / measurement / record / goal handlers all exist and are tested.

- **Verify** the wire shapes of `GET /progress/stats`, `GET /progress/records`, `GET /progress/history`, `GET /personal-records`, `GET /measurements`, `GET /goals/:id`, `GET /goals` against what the mobile presenters consume (legacy reference + the M4 frontend brief's view-models). Add the M4 spec deltas where shapes differ from what M4 needs.
- **Add `PATCH /measurements/:id`** — edit a logged measurement (typo fixes, post-hoc body-fat correction). Currently only POST + GET list exist.
- **Add `DELETE /measurements/:id`** — remove an erroneous measurement. Ownership check folded into the mutation WHERE per M2 learning #14.
- **Add `PATCH /goals/:id/status`** dedicated endpoint OR rely on the existing `PATCH /goals/:id` body field (decide in the backend brief). Required to mark goals `completed` / `abandoned` (Story-003 AC).
- **Verify** `/progress/history` carries enough data for the per-exercise strength chart. If not, decide between extending the response or adding a `GET /progress/strength?exerciseId=…` endpoint (see § Spec alignment + gaps).
- **No schema changes** — `personal_records`, `body_measurements`, `user_goals`, `workout_sessions`, `exercise_sets` are all already there. Schema may need a clarification commit if M4 introduces `user_goals.status` (see § Spec alignment + gaps).
- **No PR-detection changes.** [`personalRecordsRepository.recordPRsForSession`](../../../microservices/core/src/application/repositories/personalRecordsRepository.ts) is final — exact-rep-match only, V2 + `max_volume`, surfaces only beaten PRs. M4 reads what M3 writes.

### Frontend (one PR)

Bulk of the work. Replaces `<ComingSoon />` with a real `ProgressContainer`, ports the legacy Progress screens 1:1, wires `/measurements` editor flow, adds 5-min cache + offline-first per the established M1 / M2 / M3 patterns.

- **`ProgressContainer` + `ProgressPresenter`** — the main Progress tab. PR carousel (legacy `MyProgress` / `PROfTheWeekCard`-style), last-30-days activity tile, measurement trend chart, "Personal Records" list section, "Goals" list section, "Recent Activity" list section.
- **`AddMeasurementContainer` + `AddMeasurementPresenter`** — modal form to log a measurement (weight, body fat %, chest, waist, hips, arms L/R, thighs L/R, notes). Offline-queued via the existing sync worker.
- **`EditMeasurementContainer`** — same form, pre-filled, fires PATCH on save / DELETE on remove.
- **`RecordsListContainer` + `RecordsListPresenter`** — full PR list grouped by exercise, record-type badges (`1rm` / `3rm` / `5rm` / `10rm` / `max_weight` / `max_volume`), filterable. **No Epley-estimated 1RMs.**
- **`GoalListContainer` + `GoalListPresenter`** — list with filter tabs (active / completed / all). Goal progress bars rendered from `user_goals` + (deferred) per-goal progress derivation — M4 surfaces what the schema supports today.
- **`MeasurementsListContainer` + `MeasurementsListPresenter`** — measurement history list with the trend chart at the top.
- **`ProgressChart` component** — SVG line chart, time-range selector (`1w / 1m / 3m / 6m / 1y / all`). Pure presenter; takes data points.
- **SQLite cache**: `cached_progress` (5-min TTL keyed by `(userId, timeRange)`), `cached_measurements` (per-user, write-through), `cached_personal_records` (already exists from M3 — verify shape), `cached_goals` (per-user, write-through).
- **Offline-first**: list reads serve cache; create/update/delete enqueue via sync worker; conflict resolution = server-wins (matches established M2 / M3 pattern).
- **Replace `(tabs)/progress.tsx` stub** with `<ProgressContainer />`.

## Success criteria (review gate)

Done when all of these pass against `bun run dev` + staging:

1. Progress tab renders the PR carousel, last-30-days activity tile, measurement trend chart, Records list, Goals list. No `<ComingSoon />` anywhere.
2. PR carousel cards show only exact-rep-match records (`1rm` / `3rm` / `5rm` / `10rm` / `max_weight` / `max_volume`). No card labelled "Estimated 1RM" or similar. (Spot-check: a 55kg × 7-rep set must NOT produce a 1RM PR.)
3. Tap "Add Measurement" → modal opens → log a body-fat % entry → confirm → measurement appears in the list with the new entry, trend chart updates with the new data point.
4. Edit an existing measurement → save → list refreshes with the new value. Delete a measurement → list refreshes without it.
5. Goals list filters work (`active` / `completed` / `all`). Mark a goal as `completed` → it moves to the completed tab.
6. Time-range selector on the trend chart toggles between `1w / 1m / 3m / 6m / 1y / all`; chart redraws each time without a stuck-spinner.
7. Offline path: airplane mode → open Progress tab → cached data renders instantly (5-min TTL slot). Add a measurement offline → it appears optimistically in the list. Re-enable network → sync worker flushes → measurement reconciles with server-assigned id.
8. Pull-to-refresh bypasses the TTL, refetches all four progress endpoints, repaints.
9. Per-PR quality gates: prettier / typecheck / lint / build / test, ≥90% coverage on changed files (backend) / global aggregate (mobile).

## Agent briefs

Two parallel agent tracks. Each reads its own brief plus the parent spec and the referenced legacy / code files.

- **Backend:** [`BACKEND_BRIEF.md`](./BACKEND_BRIEF.md)
- **Frontend:** [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md)
- **Smoke test:** [`SMOKE_TEST.md`](./SMOKE_TEST.md)

Each PR lives on its own branch off fresh `main`:

- Backend: `feat/m4-backend-progress-gaps`
- Frontend: `feat/m4-mobile-progress-screen`

The frontend depends on `PATCH/DELETE /measurements/:id` and the goal-status endpoint landing first. The backend PR can ship its small additive surface ahead of frontend rebase. Until the backend is on main, the frontend uses `InMemoryApiAdapter` test fixtures mirroring the agreed wire shapes — see "Cross-cutting" below.

## Spec alignment + gaps — READ BEFORE STARTING

The parent spec `specs/06-progress-goals/` has dashboard mobile architecture done (M1) and the Progress UI structure listed at a high level. Several deltas the M4 implementation PRs MUST close as spec-update commits BEFORE any implementation commit:

### Spec gap 1 — Record-type ladder alignment

`design.md` lines 33–41 list `RecordType` as `'1rm' | '3rm' | '5rm' | '10rm' | 'max_reps' | 'max_weight' | 'best_time' | 'longest_distance'`. The shipped `personalRecordsRepository.recordPRsForSession` computes `'1rm' | '3rm' | '5rm' | '10rm' | 'max_weight' | 'max_volume'` — `max_volume` is a V2 addition Brad green-lit, and `max_reps` / `best_time` / `longest_distance` are reserved for later. M4's first commit on each branch must edit `design.md` to:

- Add `'max_volume'` to the `RecordType` union (server already emits it; mobile must render it).
- Note that `'max_reps' | 'best_time' | 'longest_distance'` are enum-eligible but NOT currently computed; M4 mobile presenters MUST handle them gracefully (skip / hide) if they show up but are not expected.
- Add an explicit "PR detection: exact-rep-match only — no Epley estimates" rule under the new "Progress mobile architecture (M4)" section. Cite [`personalRecordsRepository.ts`](../../../microservices/core/src/application/repositories/personalRecordsRepository.ts) as the canonical implementation reference.

### Spec gap 2 — No "Progress mobile architecture (M4)" section yet

`design.md` has a thorough "Dashboard mobile architecture (M1)" section. There is no parallel "Progress mobile architecture (M4)" section. The first frontend commit must add one covering:

- SQLite cache shape (`cached_progress`, `cached_measurements`, `cached_goals` — `cached_personal_records` already exists from M3).
- 5-minute TTL (matches dashboard cache, per the scope sketch).
- `StoragePort` extensions (`getCachedProgress(userId, timeRange)`, `cacheProgress(userId, timeRange, payload)`, etc.).
- Query layer mirror (`getProgressQuery`, `refreshProgress`).
- Time-range → `from` / `to` ISO mapping rule (mobile derives concrete dates from the range preset client-side; backend stays time-range-agnostic).
- Container/presenter file list (mirrors the M1 dashboard breakdown).

### Spec gap 3 — Goal status enum vs schema

`design.md` lines 65–66 declare `GoalStatus = "active" | "completed" | "abandoned"`. The live `user_goals` Drizzle schema ([`packages/db/src/schema.ts:672`](../../../packages/db/src/schema.ts)) has only `isActive: boolean`. There is no `status` column. Two paths:

- **Option A — Mobile-derived status.** `isActive: true` → `'active'`; `isActive: false + completed_at present` → `'completed'`; `isActive: false + no completed_at` → `'abandoned'`. Requires adding a `completed_at` column to `user_goals` (schema migration). Spec already implies completion tracking but is fuzzy.
- **Option B — Spec-down to schema.** Drop `'abandoned'` from M4. UI shows two tabs (`active` / `completed`); `isActive = false` is "completed".

Brad's call required. Default to **Option B** in the brief unless the agent picks up explicit direction otherwise. The backend brief's first commit edits `design.md` to lock in the choice + `requirements.md` AC 3.x accordingly.

### Spec gap 4 — `current_value` / `target_value` / `unit` on goals

`design.md` `Goal` interface lines 48–53 include `targetValue: number | null`, `currentValue: number | null`. The live `user_goals` schema has none of these (per M1 dashboard derivation notes already in `design.md` lines 211–219: "M1 ships with defensive zeros so the mobile progress-bar presenter renders 0 / 0 gracefully"). The spec already calls out the follow-up:

> Spec follow-up — if / when M4 adds goal-progress tracking, extend `user_goals` with `target_value` / `current_value` / `unit` and update this derivation accordingly.

M4's first commit must DECIDE: extend the schema OR keep zeros / display goals as plain title-only with progress disabled. The brief defaults to **deferring schema changes** — goals render as title + (optional) target date only; `GoalProgressBar` ships as a presenter but is mounted only on goals with non-zero target. This keeps M4 a no-schema-change milestone.

### Spec gap 5 — Time-range presets

`requirements.md` STORY-004 AC mentions `1 week, 1 month, 3 months, 6 months, 1 year, all time`. The backend `/progress/stats` takes `from` and `to` strings. The mapping rule must land in the new mobile-architecture section: mobile derives `from = now - rangePreset`, `to = now`, both ISO. `all time` translates to `from = 1970-01-01T00:00:00Z` (or the user's profile `createdAt`, the brief picks one). Cite this explicitly so the agent doesn't guess.

### Spec gap 6 — `/progress/history` shape vs per-exercise strength chart

[`progressRepository.getHistory`](../../../microservices/core/src/application/repositories/progressRepository.ts) returns flat session metadata (id, name, startedAt, completedAt, status, totalDurationSeconds). The spec's `prepareStrengthChart(sessions, exerciseId, range)` needs sessions with their sets joined. Two options:

- **Option A — Extend `/progress/history`** to optionally include sets when `?include=sets` is passed.
- **Option B — New `/progress/strength` endpoint** keyed by `exerciseId`.

The brief defaults to **Option B** (cleaner separation, doesn't bloat the history list which Recent Activity also consumes). The backend brief locks the decision in its spec-update commit.

### Spec gap 7 — Measurement PATCH / DELETE

`requirements.md` STORY-001 doesn't explicitly say "edit / delete a measurement", just "log" + "view history". The brief enumerates the user need (correcting typos / wrong values) and adds AC entries. Backend brief's first commit edits `requirements.md` to append AC 1.6 (edit) + AC 1.7 (delete) under STORY-001.

### Summary: spec-update commits

Both PRs' first commits MUST be spec updates. The backend agent's spec-update commit edits `design.md` + `requirements.md` + `tasks.md` Phase 5 to reflect the seven gaps above. The frontend agent rebases onto that. After the spec-update commit lands, implementation commits cite the new sections in their footers (`Implements: specs/06-progress-goals/design.md § Progress mobile architecture (M4) > SQLite cache shape`).

If either agent finds the brief and the (updated) spec disagree mid-implementation, **the spec wins** — open a follow-up spec-update commit on the same branch and proceed.

## Explicit non-goals for M4

- **No Epley-estimated 1RM display on the Progress / achievements screen.** Reserved for a future per-exercise-detail page surfaced under M5 (Exercise Detail). Even there, mark it clearly as "estimated 1RM", not "1RM".
- **No goal schema extension** (`target_value`, `current_value`, `unit`, `status`). Defer to a post-M11 polish or wait until a real product need surfaces. M4 renders what the schema supports.
- **No charting library swap.** SVG line charts via `react-native-svg` (already a dep) — keep bundle small. No Victory / Recharts / etc.
- **No social-progress feed.** "User-X just hit a 100kg squat PR" is M9-and-beyond territory.
- **No body-composition photo upload.** Just measurements. Photo logging is post-launch.
- **No data-export.** CSV export of measurements / history is M11 polish if it ships at all.
- **No HealthKit / Google Fit weight import.** Health surface is M1 / M11 — Progress doesn't read it.
- **No achievements / badges system.** The `achievements` table exists in schema but isn't surfaced in M4.
- **No PR notifications.** "New PR!" toast / push happens at session-complete (M3 already emits via session summary). The Progress tab is a passive viewer, not a notification hub.
- **No frontend-design / aesthetic revamp.** Port-1:1 from legacy presenters. The `/frontend-design` polish pass is M11. See § "Port-1:1 discipline" in [`FRONTEND_BRIEF.md`](./FRONTEND_BRIEF.md).

## Cross-cutting (carry into both briefs)

- **Port-1:1 discipline.** The legacy Progress screens (`persistence-mobile/app/(tabs)/progress.tsx` + `components/progress/*` + `components/home/PROfTheWeekCard.tsx` for carousel layout reference) are the visual + behavioural source of truth. Match copy, layout, interaction. The `/frontend-design` skill is M11, NOT M4. If a legacy pattern looks dated, surface it as an M11 candidate in the PR body — do not refactor it now.
- **Exact-rep-match PR rule.** Restated in the frontend brief because it is the foot-gun that motivated this milestone's discipline section. No `weight * (1 + reps / 30)` math anywhere on the Progress screen client-side. PRs render only what the server's `personal_records` table holds for `recordType ∈ { '1rm', '3rm', '5rm', '10rm', 'max_weight', 'max_volume' }`. If a record_type the server emits later (e.g. `'max_reps'`) shows up, the presenter must handle it gracefully — but M4 doesn't render Epley.
- **Wire-format contract.** The new endpoints' (`PATCH /measurements/:id`, `DELETE /measurements/:id`, goal-status path, `/progress/strength` or `?include=sets` extension) request + response shapes are the load-bearing contract. The frontend's `InMemoryApiAdapter` fixtures mirror them exactly. If shapes need to drift mid-implementation, surface a spec update FIRST.
- **No raw cross-user queries.** Every read filters by `userId` from JWT. PR detection is owned by M3's repo + server. M4 backend reads are JWT-scoped — see `personalRecordsRepository.list` for the reference pattern.
- **5-minute TTL** on progress data caches — matches the dashboard's TTL. Measurements / goals lists use cache-first + background refresh (same pattern as `getDashboardQuery`).
- **Sync queue mutations** go through the existing worker. Add new intent kinds for `createMeasurement`, `updateMeasurement`, `deleteMeasurement`, `updateGoalStatus`. No new transport.
- **Repo is PUBLIC** (since 2026-05-14). No secrets in commits. Backend uses SST Secret bindings (`STRIPE_SECRET_KEY`, `SUPABASE_*` etc.); mobile uses `EXPO_PUBLIC_*` for public-by-design values. Never file-commit a key.
- **Coverage**: backend 90% on changed files (non-negotiable); mobile 90% global aggregate. Same patterns as M2 / M3 — no fake tests, `afterEach(jest.restoreAllMocks)`, `mock`-prefixed factories.
- **Spec-first.** Both agents' first commits are spec updates covering gaps 1–7 above. Implementation commits follow, each citing the spec sections they implement.

## Inheritance from prior milestones

- **M0** — Exercise reference data + global error handler. M4 reads `exerciseName` on PR cards via the same patterns Home uses.
- **M1** — Dashboard cache shape + 5-minute TTL pattern. M4 mobile architecture mirrors `getDashboardQuery` / `refreshDashboard` directly. Reuse the `useStaggeredEntry` mount animation.
- **M2** — Sync queue worker + intent shapes + 14 M2 learnings (sync-drain-on-refresh, falsy-zero in JSX, snake_case-at-form-camelCase-at-boundary, `useCallback([])` for `generateId`, etc.). All apply.
- **M3** — `personal_records` schema, `personalRecordsRepository.recordPRsForSession` (exact-rep-match), mobile `PersonalRecord` domain model + `StoragePort.cachePersonalRecords` / `getPersonalRecords` already in place. M4 reads these — does not rewrite them.
- **M6** — `ProfilePageData` cache pattern (single-envelope, 5-min). M4 cache mirrors this.
- **M10 / M10.5** — Subscription badge / feature-gate primitives. M4 does NOT gate any progress feature in this milestone (Wave 2 of M10.5 handles per-screen gates including Progress) — but if `useFeatureGate` is needed for advanced analytics later, the primitive already exists.

## When this milestone kicks off

1. **Re-read this brief + the parent spec** [`../../06-progress-goals/`](../../06-progress-goals/) end-to-end. The seven spec gaps in § Spec alignment + gaps above are NOT pre-resolved — the first commit on each branch must edit `design.md` + `requirements.md` to close them, in the spec-first discipline. Do NOT start implementation until those commits land.
2. **Branch off fresh `main`** — two branches (one backend, one frontend), per the M3 / M10 pattern. Backend branch lands first because frontend depends on the new endpoints.
3. **Author your branch's spec-update commit FIRST.** This is the only way the briefs and the spec stay aligned. The backend agent owns the gap-1 / gap-3 / gap-5 / gap-6 / gap-7 edits; the frontend agent owns gap-2 / gap-5 (mobile-side) and re-reads the backend's spec edits before writing UI commits.
4. **Post a planned commit shape** (4–8 commits per PR) in each PR description before pushing implementation commits — same discipline as M3 PR #46.
5. **E2E smoke test against `bun run dev`** before merge. [`SMOKE_TEST.md`](./SMOKE_TEST.md) steps map 1:1 to acceptance criteria in `requirements.md`.

Do not start code on this milestone without the spec updates landed on each branch as the first commit(s).
