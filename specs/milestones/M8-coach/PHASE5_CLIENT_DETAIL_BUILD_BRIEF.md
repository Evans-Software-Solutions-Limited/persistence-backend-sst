# M8 Coach — Phase 5: Client Detail FULL build (modules a–f)

> **Supersedes `CLIENT_DETAIL_BRIEF.md`** (the pre-mandate "read-only v1" brief — written
> before Phases 1–4 + 9 merged; most of its "doesn't exist yet" claims are now false).
> Authoritative spec: **`specs/10-trainer-features/design.md` § "Client Detail — functional
> contract"** (Phase-4 output, PR #164) + `requirements.md` STORY-003. This brief only scopes
> execution; where it disagrees with the functional contract, the contract wins.
>
> Vertical slice, backend-then-frontend, one PR (two agents) — same shape as #123/#125/#166.
> Read `STATE.md` + `COACH_MODE_PHASE_INDEX.md` standing rules first.

## Context — what exists now (verified against main @ 143f2df)

Unlike the old brief's world, ALL of this is merged:

- **Gate + audit** (Phase 1, #160): `assertTrainerCanActForClient` (discriminated verdict,
  role-first, `application/relationships/assertTrainerCanActForClient.ts:65`) +
  `auditTrainerAction` (in-tx, `auditTrainerAction.ts:35`).
- **On-behalf endpoints** (Phases 2–3, #161/#165), all under `/trainers/me/clients/:clientId/`:
  POST+GET `sessions`, POST+GET `measurements`, POST+GET `goals` + PUT `goals/:id`
  (403 `not_assigner` if caller ≠ assigner), PUT `nutrition/target`, POST+DELETE
  `workout-assignments`. All writes = gate → row+audit in one tx → best-effort notification.
- **Programmes** (spec-19, #148/#149/#152/#166): `getActiveProgrammeForClient`,
  `GET /trainers/me/clients/:clientId/active-programme`, program CRUD/assign/unassign,
  mobile `ProgrammeCard` composite, dual-mode `AssignProgramSheet` (`openForClient`),
  `AssignWorkoutSheet` + zustand stores — already rendered on the interim Client Detail.
- **Body trend** (#145/#146): `GET /clients/:clientId/body-trend`, `useGetClientBodyTrend`,
  `BodyTrendPresenter` on the interim screen, plus the Log-weight bottom CTA (on-behalf
  measurement write, Phase 2).
- **Interim mobile screen**: `app/(app)/clients/[id]/index.tsx` →
  `ClientDetailContainer`/`Presenter` rendering Body-trend section, programme card /
  assign CTAs, Log-weight CTA. **This slice replaces that layout with the full
  single-scroll prototype port, keeping every already-wired capability.**

**Still NOT built** (this slice's job unless marked otherwise): the aggregate
`GET /trainers/me/clients/:clientId`; nutrition week-rollup read for module d; habits
weekly-satisfaction compute (cross-cuts § 3.7); per-client PR read wiring; notes endpoints
(Phase 12); `client_ai_summaries` + AI generation (Phase 6); Coach Home (Phase 10).

**Authoritative sources**

- Functional contract: `specs/10-trainer-features/design.md` § Client Detail — functional
  contract (modules a–g, `ClientDetail` interface, per-module rules ~design.md:428–773).
- Stories: `requirements.md` STORY-003 (AC 3.3–3.11), STORY-014 (module g — **Phase 6**),
  STORY-011 (notes — **Phase 12**).
- Prototype (port 1:1): `~/Downloads/handoff/design-source/screens/client-detail.jsx` —
  `ClientDetailScreen` section order: `ClientHeader` → `LiveSessionCTA` → `QuickActionsRow`
  → `AISummaryCard` → `GoalCard` → `TargetsCard` → `ThisWeekCard` → `AdherenceBreakdown`
  → `ProgrammeCard` → `CoachNotesCard`.
- Cross-cuts: `specs/_shared/cross-cuts.md` § 1.3 (gate), § 2.2 (goal edit rules), § 3.7
  (habit satisfaction). ⚠ § 1.5 is STALE on the name column — it says
  `profiles.display_name`, but no such column exists; attribution reads
  `profiles.full_name` per design.md's Phase-4 key-corrections (~481–486) + schema.ts.

---

## Backend slice (agent 1 — lands first)

### `GET /trainers/me/clients/:clientId` → `{ data: ClientDetail }`

One aggregate for the whole screen. **Gate order per the contract:** JWT → role ∈
{personal_trainer, physiotherapist, admin} → `assertTrainerCanActForClient` (map the
verdict to its 403 body, same as every Phase-3 handler). Compose modules by calling
existing repos with the **client's** userId — never a global query. **No migrations.**

Use the contract's `ClientDetail` interface verbatim (design.md ~498–535). Per-module
execution notes:

| Module         | Source                                                                                                                                                                                                                                                                                                                            | Net-new?                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| client header  | `profiles` (name/avatar/DOB→ageYears/heightCm) + relationship status                                                                                                                                                                                                                                                              | no                             |
| a. adherence   | reuse `trainerRepository` 28-day % + `clientRosterBand` 5-band classifier                                                                                                                                                                                                                                                         | no (see categories note)       |
| b. PRs         | `HomeReadRepository.getRecentPRs(clientId, limit)` (`repositories/homeReadRepository.ts:191`) — exact-rep parity only, **no Epley** (locked rule)                                                                                                                                                                                 | wiring only                    |
| c. volume      | `VolumeRepository.dailyVolume` / `totalVolume` with client tz (`profiles.timezone`, default Europe/London). **Preserve the 42803 ordinal-GROUP-BY guard** — do not re-render `dayExpr`; keep/extend the PgDialect render test (`reference_drizzle_groupby_param_bug`)                                                             | wiring only                    |
| d. calorie hit | `NutritionTargetRepository.get(clientId)` + a **new week-rollup read**: per-day kcal totals for the client's current week → `daysHit` (within target ±10%, same tolerance as `nutrition_streak`), `daysLogged`, `todayKcal`, `todayRemainingKcal`. **Return totals ONLY — never food-entry rows** (privacy line, Brad 2026-07-05) | **yes** — week-rollup query    |
| e. goal        | most recent active `user_goals` (title via `goal_types` FK — there is NO title column; active via `is_active` — no status enum) + weight axis from `body_measurements` (start=earliest in window, now=latest, target=goal target), `pct` clamped 0..1 else null. `assignedByCoach = assigned_by_user_id === trainerId`            | wiring only                    |
| f. habits      | client's enabled `habit_configs` + **new weekly-satisfaction compute** per cross-cuts § 3.7 (`count` / `value_gte` / `within_tolerance` × `days_per_week`) + weekly collection streak. `buildHabitsGrid()` exists but only returns the 7-day boolean grid — the satisfaction % is net-new                                         | **yes** — satisfaction compute |
| g. aiSummary   | **shape stub only**: `{ summary: null, coversDate: null, generatedAt: null, canManualRefresh: false }`. The `client_ai_summaries` table does not exist until Phase 6 — do NOT reference it. Phase 6 swaps the stub for the cached-row read (reads never infer)                                                                    | stub                           |
| thisWeek       | sessions/volume/PR counts (existing repos); `workoutsPlanned` from `getActiveProgrammeForClient` weekly schedule when an active programme exists, else null; `checkIns` null                                                                                                                                                      | wiring + planned-count         |
| recentSessions | client's completed `workout_sessions`, newest first, ~10                                                                                                                                                                                                                                                                          | wiring only                    |
| notes          | direct repo read of `trainer_client_notes` **WHERE trainer_id = me AND client_id = :clientId**, newest first. Read-only; CRUD endpoints + the UNIQUE-drop migration are **Phase 12**                                                                                                                                              | small read                     |

**Adherence categories (deliberate reading of design.md ~551–553):** the contract marks
categories unavailable "until module d is ready" — module d ships in this same PR, so
light **Workouts completed** AND **Calorie target** (`pct` from `daysHit/daysLogged`);
protein / check-in / sleep stay `available:false, pct:null` (need HealthKit / habits
maturity). Empty-data rule: brand-new client → `overall: null, band: null` ("Not enough
data yet"), never 0%/crisis.

**Do NOT fold the active programme into the aggregate** — mobile already consumes
`GET …/active-programme` (#166); avoid churn. The aggregate only uses it server-side for
`workoutsPlanned`.

**Handler wiring:** add to the `trainersOnBehalfRoutes` sub-app or a sibling — beware the
TS2589 deep-instantiation trip on long flat `.use()` chains (see `nutritionRoutes` /
Phase-3 notes).

**Tests (trainers dir is at 100% coverage — don't regress):** 403 wrong-role +
no-active-relationship (all relationship states); populated aggregate shape; every
null/empty fallback (no goal, no sessions, no target, no habits, no notes); notes never
leak across trainers; calorie module returns totals only (assert no entry rows in the
payload); ±10% hit boundary; satisfaction compute per rule type; PgDialect render guard
for the volume query; aiSummary stub shape. Mock `getDb` per existing trainer repo tests.

---

## Frontend slice (agent 2 — depends on backend)

### 1. Data layer (mirror #123/#125/#166)

- Domain model `src/domain/models/clientDetail.ts` = the `ClientDetail` contract shape.
- `ApiPort.getClientDetail(clientId)` + SST adapter + in-memory double (+ port-contract
  enumeration tests).
- `StoragePort` cache keyed `userId:clientId` + both adapters.
- `useGetClientDetail(clientId)` via `useCachedResource` (cache-first, render stale while
  refreshing).

### 2. Full single-scroll rebuild — port `client-detail.jsx` 1:1

Rebuild `ClientDetailPresenter` to the prototype section order. Container keeps the
existing `useGetClientBodyTrend` + `getClientActiveProgramme` fetches alongside the new
aggregate. Section-by-section:

| Prototype section    | Phase-5 state                                                                                                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClientHeader`       | **Real** — name/avatar/status/age·height (hide nulls); programme label + WK pill from active programme; MISSED pill from adherence. Message/more = no-ops.                                                                                                                                                    |
| `LiveSessionCTA`     | **Real display, read-only actions** — shows today's due workout from the active programme ("No active programme" empty state otherwise). Start / Log-past on-behalf **session-logging UI is OUT** (endpoint exists; UI is its own later slice — open decision ① below).                                       |
| `QuickActionsRow`    | **Wired**: Assign → `AssignWorkoutSheet` (exists); Macros → **new `EditNutritionTargetsSheet`** → `PUT …/nutrition/target`; Goals → **new `AssignGoalSheet`** → `POST …/goals`; Schedule **hidden** (scheduling domain parked, design.md ~765). Sheets mount at root layout, zustand open-state (house rule). |
| `AISummaryCard`      | **STORY-014 stub state** — aggregate's null aiSummary renders "AI insights arrive soon", Regenerate locked. Build the card so Phase 6 only swaps data in.                                                                                                                                                     |
| `GoalCard`           | **Real** — goal module + weight axis + pct; "Goal set by Coach {full_name}" when `assignedByCoach`; hidden when null. Edit pencil → `AssignGoalSheet` in edit mode **only if caller is assigner** (server 403s `not_assigner` anyway — surface it gracefully).                                                |
| `TargetsCard`        | **Real** — calorie/macro targets from module d (+ workouts/volume targets if the prototype fields map; "—" otherwise). Edit → `EditNutritionTargetsSheet`.                                                                                                                                                    |
| `ThisWeekCard`       | **Real** — thisWeek mini-stats ("—" for nulls) + daily-activity bars from module c `daily`.                                                                                                                                                                                                                   |
| `AdherenceBreakdown` | **Real** — overall + band + categories; unavailable rows muted "—" with hint, driven by `category.available`.                                                                                                                                                                                                 |
| `ProgrammeCard`      | **Keep the shipped #166 block as-is** (ProgrammeCard → editor, assign CTAs when none).                                                                                                                                                                                                                        |
| `CoachNotesCard`     | **Read-only list** from aggregate notes; `+` disabled (Phase 12).                                                                                                                                                                                                                                             |
| _(not in prototype)_ | **Keep** the #146 Body-trend section + Log-weight bottom CTA — shipped, Brad-approved capability; slot Body-trend after `GoalCard`. Open decision ② below.                                                                                                                                                    |

Trainer accent throughout; pull-to-refresh; loader/error/empty per `CoachYouPresenter`;
reuse primitives (`Card`, `Pill`, `Section`, `Avatar`, `relativeTime`); coach-mode gate:
`useUserMode().mode !== "coach"` → redirect home (existing pattern).

### 3. Tests (90%)

Every sub-presenter: real + empty/null states; container hook-integration with the
in-memory adapter; mode-gate redirect; both new sheets (open → submit → adapter call
captured → success/error states); adherence with partial availability; notes list/empty;
aiSummary stub rendering.

---

## Open decisions for Brad (flag in PR body; don't block the build)

1. **On-behalf session logging UI** (LiveSessionCTA Start/Log-past): proposed OUT of
   Phase 5 — `POST …/sessions` exists but the logging flow is its own slice. CTA is
   display-only this slice.
2. **Body-trend section + Log-weight CTA placement**: not in the prototype (shipped via
   #146/Phase 2) — proposed KEEP, slotted after GoalCard. Say the word if you'd rather
   fold weight into GoalCard's axis only.
3. **Calorie adherence category lit in v1** (reading of design.md ~551–553, since module d
   ships in the same PR) — proposed YES.

## Verification

- Backend gates + the aggregate exercised for: trainer+active client (populated), 403
  wrong-role / no-relationship, cross-trainer notes isolation.
- Mobile gates (root `tsc -p packages/mobile/tsconfig.json`, jest from `packages/mobile`,
  `expo lint`) + repo-level `bun run prettier:check`.
- Expo: coach mode → Clients → row → full single-scroll screen; quick-action sheets
  submit; athlete-mode flip bounces home.
- Inspector-brad local sweep, clean, noted in the PR body. Slack ping at the boundary.

## Out of scope → later phases

- **Phase 6:** `client_ai_summaries` migration + `POST …/ai-summary` + Bedrock generation
  (swap the aiSummary stub). **Phase 7:** habit setup + coach authorship. **Phase 12:**
  notes CRUD endpoints (incl. UNIQUE-drop migration) + add-note UI. **Phase 10:** Coach
  Home. **Parked:** scheduling/appointments; on-behalf session-logging UI (decision ①).
