# M4 — Progress — FRONTEND_BRIEF

Mobile-only implementation. Backend handlers exist; verify response shapes before assuming a gap.

## Read first

1. [`BRIEF.md`](./BRIEF.md) — scope + dependencies
2. [`../../06-progress-goals/requirements.md`](../../06-progress-goals/requirements.md) — user stories STORY-001 through STORY-004 (+ STORY-006 offline) are M4 scope; STORY-005 + 007 are M1 (already shipped)
3. [`../../06-progress-goals/design.md`](../../06-progress-goals/design.md) — domain models, services, UI architecture
4. [`../../06-progress-goals/tasks.md`](../../06-progress-goals/tasks.md) — Phases 1, 2, 3 (incomplete bits — only Phase 4a/4b were shipped in M1), Phases 5, 6, 7
5. [`../../_agent.md`](../../_agent.md) — execution model + spec-first discipline (Kiro)
6. **Memory files** at `/Users/bradleysimms-evans/.claude/projects/-Users-bradleysimms-evans-Documents-projects-personal-persistence-backend-sst/memory/` — especially `feedback_port_then_revamp.md`, `feedback_design_quality.md`, `feedback_pr_detection_legacy_parity.md`
7. **Legacy reference** — Brad has the legacy app at `persistence-mobile/` (may not be in this repo; if missing, surface in `AGENT_QUESTIONS_m4.md` and proceed from V2 specs + memory)

## Scope

### Phase 1: Domain (extend what exists)

Per parent spec § Domain Models. Most are not yet shipped.

- [ ] `BodyMeasurement`, `PersonalRecord`, `Goal` models in `packages/mobile/src/domain/models/`
- [ ] `RecordType` enum — schema-derived (`(typeof recordTypeEnum.enumValues)[number]` pattern from M3, see [[project-current-state]] memory point #6)
- [ ] `GoalType`, `GoalStatus` enums — schema-derived
- [ ] Domain services in `packages/mobile/src/domain/services/progressService.ts`:
  - `calculateGoalProgress(goal: Goal): number` — % toward target
  - `calculateWeeklyStats(sessions, startDate): WeeklyStats` — sessions / volume / duration this week
  - `calculateStreak(sessions): number` — consecutive days/weeks with sessions
  - `prepareMeasurementChart(measurements, field, range): ChartData`
  - `prepareStrengthChart(sessions, exerciseId, range): ChartData`
- [ ] Do NOT reimplement `detectNewRecords` — M3 shipped this server-side via the augmented `POST /sessions/record` response. Local prediction lives in `packages/mobile/src/domain/services/sessionService.ts`.

### Phase 2: Ports & Adapters

- [ ] Extend `ApiPort` with `getMeasurements`, `createMeasurement`, `getRecords`, `getProgressStats`, `getProgressHistory`, plus full goal CRUD
- [ ] Implement all in `SSTApiAdapter` AND `InMemoryApiAdapter`
- [ ] Extend `StoragePort` with cache methods for measurements, records, goals, progress stats (cache-first read pattern, mirror dashboard cache from M1)
- [ ] Implement in `SQLiteStorageAdapter` AND in-memory stub
- [ ] Add SQLite migration: `cached_measurements`, `cached_records`, `cached_goals`, `cached_progress_stats` (user_id + payload JSON + synced_at, mirror `cached_dashboard`)
- [ ] Adapter tests with ≥ 90% coverage

### Phase 3: Application Layer

- [ ] `packages/mobile/src/application/queries/measurements.query.ts` — `getMeasurementsQuery` (cache-first) + `refreshMeasurements`
- [ ] `packages/mobile/src/application/queries/records.query.ts` — same pattern
- [ ] `packages/mobile/src/application/queries/progressStats.query.ts` — same pattern
- [ ] `packages/mobile/src/application/queries/goals.query.ts` — same pattern
- [ ] `packages/mobile/src/application/commands/measurement.command.ts` — `createMeasurementCommand` (offline-queue via sync engine, mirror `createWorkoutCommand`)
- [ ] `packages/mobile/src/application/commands/goal.command.ts` — `createGoalCommand`, `updateGoalCommand`, `deleteGoalCommand`
- [ ] Hooks: `useMeasurements`, `useRecords`, `useProgressStats`, `useGoals` (mirror `useDashboard` shape from M1)
- [ ] Query / command tests with ≥ 90% coverage

### Phase 5: UI — Progress tab content (replaces placeholder in Wave 2 `ProgressContainer`)

Brad's port-then-revamp memory: 1:1 from legacy first.

- [ ] `PRCarouselPresenter` — horizontally-scrolling cards of recent PRs, one per exercise, with record type badge + value
- [ ] `StatTilePresenter` — single tile (icon, value, label). Used for "Sessions this month", "Total volume", "Workout streak", etc.
- [ ] `StatTileGridPresenter` — 2×2 grid of stat tiles
- [ ] `ProgressChart` component — SVG line chart with time-range selector (1M / 3M / 6M / 1Y / All). Library decision: try `react-native-svg-charts` first (legacy chose it); if not Expo 55 compatible, fall back to `victory-native`. Document the choice in a `docs(M4):` commit on the spec.
- [ ] `RecentActivityListPresenter` — recent sessions list (overlap with Home — confirm legacy showed this twice or only on Home; if only Home, omit here)
- [ ] Update `ProgressContainer` + `ProgressPresenter` (created by Wave 2) to compose the above. Keep the existing feature gate at the container boundary unchanged.

### Phase 5: UI — Measurements (separate screens)

- [ ] `MeasurementEditorPresenter` — form: date picker, weight, body fat %, chest, waist, hips, arm, thigh, notes
- [ ] `MeasurementEditorContainer` — form state via `useMeasurementForm` (mirror `useWorkoutForm` pattern from M2), validation, save via `createMeasurementCommand`, navigate back on success
- [ ] `MeasurementListPresenter` — chart at top, history list below; tap a row to edit (or read-only if legacy was read-only — confirm)
- [ ] `MeasurementListContainer` — fetches measurements via `useMeasurements`, manages chart range
- [ ] Screens: `packages/mobile/app/(app)/progress/measurements.tsx` (list), `packages/mobile/app/(app)/progress/measurements/new.tsx` (editor)
- [ ] Wire entry point from Progress tab

### Phase 6: UI — Goals

- [ ] `GoalListPresenter` — tabbed: Active / Completed / Abandoned. Each item shows name, type, progress bar, target date
- [ ] `GoalEditorPresenter` — form: name, goal type picker, target value, target date, notes
- [ ] `GoalListContainer` + `GoalEditorContainer`
- [ ] Screens: `packages/mobile/app/(app)/goals/index.tsx`, `packages/mobile/app/(app)/goals/[id]/edit.tsx`, `packages/mobile/app/(app)/goals/new.tsx`
- [ ] Wire entry point from Progress tab

### Phase 7: UI — Personal Records list

- [ ] `RecordListPresenter` — records grouped by exercise (collapsed by default), record type badge (1rm/3rm/5rm/10rm/max_weight/max_volume — note: max_volume was added in M3, see [[feedback-pr-detection-legacy-parity]])
- [ ] `RecordListContainer` — fetches via `useRecords`, manages expand/collapse state
- [ ] Screen: `packages/mobile/app/(app)/progress/records.tsx`
- [ ] Wire entry point from Progress tab (likely a "View all PRs" link below the carousel)

### Phase 8: Quality gates

- [ ] All M4 tests pass with ≥ 90% coverage on changed files
- [ ] Full gate green: `bun run prettier:check && bun run typecheck && bun run lint && bun run build && bun run test:unit && bun --filter @persistence/web test:unit`

## Working rules (mandatory)

- **Bun, not npm.**
- **Port-then-revamp** ([[feedback-port-then-revamp]]): port legacy presenters 1:1, with V2 tokens. No design revamp in this milestone.
- **Premium aesthetic bar** ([[feedback-design-quality]]): the Progress tab is one of the surfaces Brad reviews on device for the launch feel. Don't ship anything Brad would describe as "generic".
- **PR detection mirrors M3 legacy parity** ([[feedback-pr-detection-legacy-parity]]): records list shows 1rm/3rm/5rm/10rm + max_weight + max_volume — NO Epley estimates. Skip first-occurrence records.
- **TRACE before patching**: read the actual code, repro the path, write the test, then patch.
- **Spec-first**: if you discover a needed behaviour not in `requirements.md` or architecture not in `design.md`, your FIRST commit extends the parent spec. Cite the new section in subsequent implementation commits.

## Sync-queue interaction

M10.6 (just merged) introduced `blocked_entitlement` status on the sync queue. Goals and measurements are mutations that will flow through the sync engine. If a free-tier user creates measurements over their tier's allowance (verify whether measurements are tier-gated — probably not, but check), the sync engine catches the 402. The `SyncBlockedBanner` on Home + the Sync Blocked review screen are already wired. M4 should NOT add a parallel surface.

## Branch + commit protocol

- Isolated worktree. Your own branch (the worktree creates one).
- Conventional-commit prefixes: `feat(M4):`, `test(M4):`, `docs(M4):`.
- Reference spec sections in commit messages: `Implements: specs/06-progress-goals/design.md § Domain Models`.
- DO NOT push. Orchestrator merges into `feat/m4-progress`.

## Verification

Run the full local gate in order before claiming done:

```bash
bun install
bun run prettier:check
bun run typecheck
bun run lint
bun run build
bun run test:unit
bun --filter @persistence/web test:unit
```

Report test count deltas.

## When to stop and ask

If you discover an ambiguity in the brief that materially changes scope (e.g., a presenter that doesn't exist in legacy or whose layout isn't reconstructible), STOP. Write your question + recommended answer to `AGENT_QUESTIONS_m4.md` at the repo root, commit, return early. Do NOT make silent ambiguity-resolving decisions.

If the backend handler response shapes have material gaps (e.g., `progressHistory` returns a shape that can't drive the trend chart), write the backend amendment as your first commit (with handler-level tests + spec amendment), then continue with mobile work.

## Final output

Report under 500 words:

1. Branch name + final SHA
2. Gate results (counts + pass/fail per gate)
3. Files touched (high-level — directories, screen counts, presenter / container counts)
4. Library decisions (chart lib, anything else load-bearing)
5. Backend amendments made (if any), with SHAs
6. Spec amendments made, with SHAs
7. Open questions / things the orchestrator needs to know

Keep it tight. Orchestrator merges based on this report + a diff scan.
