# M1 — Backend Agent Brief

You are implementing the backend track of Milestone 1 — Home / Dashboard. Read the parent [`BRIEF.md`](./BRIEF.md) first.

You are working on the SST / Elysia backend at `/Users/bradleysimms-evans/Documents/projects/personal/persistence-backend-sst/microservices/core/`. You are NOT touching the mobile app — that is the frontend agent's responsibility. You may read mobile code for contract context but must not modify it.

## Authority

- Parent spec: [`../../06-progress-goals/`](../../06-progress-goals/) — STORY-005 + STORY-007 and the `design.md` § Dashboard backend contract (M1) are authoritative.
- Backend architectural rules: [`../../../CLAUDE.md`](../../../CLAUDE.md) at repo root (SST v3 + Elysia + Neon / Supabase + Drizzle + JWT + explicit ownership).
- Workflow discipline: [`../../_agent.md`](../../_agent.md) — spec-first, always.
- If the brief is silent, the parent spec wins. If the parent spec is silent on something the brief describes, that's a spec gap — close it FIRST via a spec update commit, then implement.

## Spec alignment — READ FIRST

The parent spec commits on this `docs/m1-briefs` branch already landed the `DashboardPayload` contract, the STORY-007 acceptance criteria, and the Phase 4a task list. You are implementing against that contract, not extending it.

Every implementation commit must cite the spec section it's implementing in the commit message footer — see [`../M0-integration-baseline/HANDOVER.md`](../M0-integration-baseline/HANDOVER.md) § Concrete commit trace for the template.

If you find a gap while implementing — a field the parent spec left under-specified, a derivation rule that's ambiguous — **update the spec first** as a dedicated commit on your branch. Do not silently make a design decision that belongs in the spec.

## Scope

### 1. Extend `DashboardData` to match `DashboardPayload`

Today `microservices/core/src/application/repositories/dashboardRepository.ts` emits:

```ts
interface DashboardData {
  recentWorkouts: Array<{ id, name, status, startedAt, completedAt, totalDurationSeconds }>;
  activeGoals: Array<{ id, priority, isActive, targetDate }>;
  latestMeasurements: { id, weightKg, bodyFatPercentage, measuredAt } | null;
  personalRecordsCount: number;
  streak: number;
  steps: null;
  energy: null;
}
```

Replace with the full `DashboardPayload` per `06-progress-goals/design.md` § Dashboard backend contract. In summary — new fields:

- `profile: { id, fullName, firstName, preferredUnits }` — derived from the `profiles` row.
- `subscription: { tierName, isFreeTier, isTrainerTier, status }` — `user_subscriptions` joined to `subscription_tiers`, with the legacy `isFreeTier` rule.
- Expand `recentWorkouts` to the template-aware shape (own + assigned + default, limit 10, ordered as legacy `getMyWorkouts`). Reshape each row to `{ id, name, description, estimatedDurationMinutes, createdBy, isAssigned, assignedByType }`.
- New `recentActivity: Array<{ workoutSessionId, workoutId, workoutName, completedAt, durationSeconds }>` — completed sessions in the last 7 days, joined to `workouts` for fallback name.
- Expand `activeGoals` to include `title`, `current`, `target`, `unit` via a `goal_types` join. Preserve priority ordering.
- New `progress: { workoutsThisMonth, workoutsLastMonth, streak, personalRecordsCount }`. `streak` and `personalRecordsCount` are moved from the flat root into this sub-object.
- New `prOfTheWeek` — highest-ranked PR in last 7 days or `null`; use the `recordType` weighting in design § to tie-break deterministically.
- Preserve `latestMeasurement` (singular, rename from `latestMeasurements`), emit numeric fields as `number` (not Drizzle string).

Remove `steps: null` / `energy: null` from the payload — health telemetry is client-side only.

### 2. Split the repository into testable sub-queries

Each sub-query gets its own private method so the repo test can seed data, invoke each method in isolation, and verify its slice of the payload.

- `getProfileSlice(userId)`
- `getSubscriptionSlice(userId)`
- `getRecentWorkouts(userId, limit = 10)`
- `getRecentActivity(userId, windowDays = 7)`
- `getActiveGoalsWithProgress(userId)`
- `getPROfTheWeek(userId, windowDays = 7)`
- `getProgressStats(userId)` (workoutsThisMonth / workoutsLastMonth / streak / personalRecordsCount)
- `getLatestMeasurement(userId)`

`getDashboard(userId)` composes them inside a single `Promise.all` so Lambda cold-start latency stays bounded (AC 7.8).

### 3. Subscription `isFreeTier` rule

From the legacy `persistence-mobile/lib/utils/subscriptionUtils.ts` (read it for the exact conditions). In summary:

- No `user_subscriptions` row for user → `isFreeTier: true`
- `subscription_tiers.tierName = 'free'` → `isFreeTier: true`
- `status = 'cancelled'` AND billing period already ended → `isFreeTier: true`
- Everything else (active, trialing, past_due within grace) → `isFreeTier: false`

Write a `computeIsFreeTier(subscriptionRow)` helper in the repo so the test can verify each branch. Do not inline the logic in the Drizzle query.

### 4. PR-of-the-week tie-breaking

Algorithm:

1. Fetch `personal_records` for `userId` where `achievedAt >= now - 7d`.
2. Sort by `achievedAt DESC`, then by `recordType` rank: `1rm` (8) > `3rm` (7) > `5rm` (6) > `10rm` (5) > `max_weight` (4) > `max_reps` (3) > `best_time` (2) > `longest_distance` (1).
3. Take the first row. Return `null` when the window is empty.
4. Join to `exercises` for `exerciseName`.

Extract this as `rankPersonalRecord(row)` so the test can assert the ranking is deterministic.

### 5. Numeric field emission

The Drizzle `numeric` column type returns strings by default. `weightKg`, `bodyFatPercentage`, and `value` (on `prOfTheWeek`) must arrive as `number` over the wire. Coerce at the repository layer — don't push that responsibility to the mobile adapter.

### 6. Handler extension

`microservices/core/src/application/dashboard/dashboardHandler.ts` stays a thin wrapper — `.derive(auth)`, `.onBeforeHandle(requireAuth)`, `.use(DashboardService)`, `.get("/dashboard", ...)`. No route param changes. No query-string additions.

### 7. Tests

For the handler, add coverage for:

- Happy path: seeded user with workouts + goals + PRs + measurement + subscription → full payload.
- 401 on missing / invalid JWT.
- Empty-state user (zero workouts / goals / records / subscription / measurement) — every collection is `[]`, every nullable object is `null`, no crashes.
- PR-of-the-week tie-breaking — insert two PRs at the same `achievedAt`, different `recordType`; verify the higher-ranked wins.
- Subscription `isFreeTier` branches — each branch in §3 hit by a seeded row.
- `numeric` fields emitted as `number`.
- Parallel sub-query execution (snapshot the time ordering under a fake clock — optional but recommended).

For each new sub-query method, unit test against a seeded Postgres (use the existing test infra under `microservices/core/src/application/dashboard/__tests__/dashboardHandler.test.ts` as the template).

### 8. Files you will touch

- `microservices/core/src/application/dashboard/dashboardHandler.ts` — no wire change, but re-export the extended types.
- `microservices/core/src/application/repositories/dashboardRepository.ts` — major extension.
- `microservices/core/src/application/repositories/dashboardService.ts` — ensure service decoration is still coherent; usually no change.
- `microservices/core/src/application/dashboard/__tests__/dashboardHandler.test.ts` — new test cases.
- `microservices/core/src/application/repositories/__tests__/dashboardRepository.test.ts` — sub-query-level tests.

## Files you must NOT touch

- Anything under `packages/mobile/` — frontend agent territory.
- Other backend feature handlers (workouts, sessions, progress/stats, goals, measurements). If you discover a gap — e.g. the `user_subscriptions` schema doesn't actually have what §3 needs — flag in PR review rather than editing sibling modules.
- `packages/db/src/schema.ts` unless a schema change is strictly required. `firstName` is a server-side derivation, not a new column. If a new column turns out to be unavoidable, propose the migration in the PR body; do not ship the schema change silently.
- `infra/api.ts` — no new routes.

## Quality gates (must pass before PR opens)

- `bun run prettier:check`
- `bun run typecheck`
- `bun run lint`
- `bun run build`
- `bun run test:unit` — 90% coverage on `dashboardRepository.ts` + `dashboardHandler.ts`

## Output expected

- A PR on branch `feat/m1-backend-dashboard` (branched from fresh `main`)
- PR title: `feat(core): dashboard payload expansion (M1)`
- Spec-alignment block at the top of the PR body listing every design.md §, requirements.md AC, and tasks.md Phase 4a item closed.
- PR body ends with a `### How to smoke test` block: curl examples for the new fields, plus a `SELECT` against the seed DB showing the data that backs each sub-query.
- Mark relevant Phase 4a items in `specs/06-progress-goals/tasks.md` as complete.

## Blocking questions (answer before shipping)

1. **Where does `firstName` come from?** Parent spec says "first whitespace-delimited token of `fullName`". Confirm this against real seed data — some legacy `full_name` rows may have non-ASCII whitespace or be `null`. Handle both.
2. **Does the live Supabase `user_subscriptions` schema actually expose `tier_name` as a FK to `subscription_tiers`?** Verify against the schema; M0 re-aligned the exercise repo after similar drift. Read [`M0-integration-baseline/project_current_state`](../M0-integration-baseline/HANDOVER.md) (re: schema alignment) and spot-check before building the join.
3. **Does `assigned_by_type` live on `workout_assignments` or `workouts`?** The legacy response implies the former. Read the schema first; if the table doesn't exist yet, scope that field as `null` for every row and flag in PR review as a spec follow-up (not a blocker).
4. **Streak algorithm** — the existing `calculateStreak` is unchanged. Do not rewrite it; just move it into the new `getProgressStats` method. If tests reveal an edge case (timezone, completed-status filtering), fix in place with a regression test, not a rewrite.

## Non-goals

- No pagination on `/dashboard`. It's a single-object response; `recentActivity` and `recentWorkouts` are capped (last 7 days / 10 items) and embedded.
- No double-envelope wrap. Response is `{ data: DashboardPayload }`, single envelope. Do not wrap the list fields in `{ data, meta }` sub-envelopes — they are nested arrays, not paginated list endpoints.
- No new secret (SUPABASE_URL migration flagged in M0 remains a cleanup, not this milestone's work).
- No HealthKit / Health Connect backend integration. Telemetry stays client-side.
- No response-shape changes to existing `/progress/*`, `/goals/*`, `/measurements/*` endpoints — the dashboard reads directly from DB, not through those handlers.
- No global audit-log / telemetry layer.

## Success criteria

Your PR is mergeable when:

1. `GET /dashboard` against `bun run dev` returns the full `DashboardPayload` for a seeded user.
2. Handler + repository tests are green with ≥ 90% coverage on changed files.
3. All listed quality gates pass.
4. The frontend agent can open an integration PR against your branch and have their smoke test pass steps 1–5 and 11 (the payload-shape steps) without manual data massaging.
