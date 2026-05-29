# 06 — Progress, Goals & Home: Tasks

> **Spec rewritten from scratch on 2026-05-27.** Prior tasks preserved in git history.

---

## Phase 06.1 — Database migrations (1 PR)

- [ ] **T-06.1.1** Migration: `user_goals.assigned_by_user_id` (nullable) per cross-cuts § 2. Implements STORY-007 + cross-cuts integration.
- [ ] **T-06.1.2** Migration: `user_goals.target_value`, `current_value`, `unit` extensions.
- [ ] **T-06.1.3** Migration: `streak_type_enum` + `user_streaks` table per cross-cuts § 3.2.
- [ ] **T-06.1.4** Migration: `habit_completions` table per cross-cuts § 3.3.
- [ ] **T-06.1.5** Migration: `workout_sessions.logged_by_user_id` + `body_measurements.logged_by_user_id` (nullable; populated by M8 later).
- [ ] **T-06.1.6** Migration: `personal_records` table (audit existing first; only create if not shipped).
- [ ] **T-06.1.7** Migration: `user_achievements` table.
- [ ] **T-06.1.8** Verify all migrations idempotent + forward/back safe.

## Phase 06.2 — Streak engine + cron (1 PR)

- [ ] **T-06.2.1** Author `microservices/core/src/application/streaks/engine.ts` per `design.md § Engine entrypoint`. Implements STORY-006 + 007 + 008 ACs.
- [ ] **T-06.2.2** Author `microservices/core/src/application/streaks/cron.ts` (02:00 UTC nightly sweep).
- [ ] **T-06.2.3** SST scheduled cron resource definition in `infra/`.
- [ ] **T-06.2.4** Unit tests for engine + cron covering every period type, milestone, freeze-token spend, broken streak.
- [ ] **T-06.2.5** User-local TZ handling — profile timezone column read; default `Europe/London` per cross-cuts § 3.4.

## Phase 06.3 — PR detection + recording (1 PR)

- [ ] **T-06.3.1** Server-side PR detection on `PUT /sessions/:id { endedAt }` per STORY-009 AC 9.1. Exact-rep-match per legacy parity.
- [ ] **T-06.3.2** Persist to `personal_records` per AC 9.2.
- [ ] **T-06.3.3** Notification emission `streak_milestone` for streak; reuse same dispatcher for PR-related notifications.
- [ ] **T-06.3.4** Async via SST queue worker — session response returns before PR computation completes.
- [ ] **T-06.3.5** Unit + integration tests.

## Phase 06.4 — Volume aggregation (1 PR)

- [ ] **T-06.4.1** Implement weekly-volume + by-muscle aggregation in `microservices/core/src/application/progress/`.
- [ ] **T-06.4.2** Materialised tables `weekly_volume_per_user` + `volume_by_muscle_per_user` for fast reads.
- [ ] **T-06.4.3** Daily 03:00 UTC cron + on-session-complete recomputation as backup.
- [ ] **T-06.4.4** Endpoint `GET /users/me/weekly-volume?window=7d`.
- [ ] **T-06.4.5** Endpoint `GET /users/me/volume-stats?window=month` (includes by-muscle breakdown).

## Phase 06.5 — Home aggregate endpoint + ring data (1 PR)

- [ ] **T-06.5.1** Endpoint `GET /users/me/home` per `design.md § Backend audit`. Returns `{ rings, todayWorkout[], habits[], weeklyVolume, recentPRs }`.
- [ ] **T-06.5.2** Endpoint `GET /users/me/today-rings` (standalone version).
- [ ] **T-06.5.3** Endpoint `GET /users/me/prs?limit=N&order=achieved_at desc`.
- [ ] **T-06.5.4** Endpoint `GET /users/me/body-trend?window=30d`.
- [ ] **T-06.5.5** Endpoint `GET /users/me/achievements`.
- [ ] **T-06.5.6** Endpoint `POST /users/me/streaks/:id/use-token` (manual freeze-token spend).

## Phase 06.6 — Frontend domain + adapters (1 PR)

- [ ] **T-06.6.1** Domain models: `Streak`, `HabitCompletion`, `Achievement`, `PersonalRecord` under `packages/mobile/src/domain/models/`.
- [ ] **T-06.6.2** Port extensions in `domain/ports/api.port.ts` for the new endpoints.
- [ ] **T-06.6.3** API adapter implementations for each endpoint.
- [ ] **T-06.6.4** SQLite cache table + read repository for `personal_records`, `user_achievements`, `habit_completions`, `user_streaks`.
- [ ] **T-06.6.5** Sync queue handlers for habit toggle + measurement log (idempotent).

## Phase 06.7 — Frontend hooks (1 PR)

- [ ] **T-06.7.1** `useGetHome`, `useGetTodayRings`, `useGetWeeklyVolume`, `useGetRecentPRs`, `useGetVolumeStats`, `useGetBodyMeasurements`, `useGetPRHistory`, `useGetAchievements`, `useGetHabits`, `useToggleHabitDay`, `useLogMeasurement`, `useUseFreezeToken`.
- [ ] **T-06.7.2** Each hook reads cache first + background-refreshes per `_agent.md § Offline-First`.
- [ ] **T-06.7.3** Client-side streak derivation helper `deriveStreak(completions, today, period): number` per `design.md § Offline behaviour`.
- [ ] **T-06.7.4** Tests.

## Phase 06.8 — HomePresenter + sub-presenters (1 PR)

- [ ] **T-06.8.1** Author `<HomePresenter>` orchestrating sections per `home.jsx:21–63`. Implements STORY-001 + 002 ACs.
- [ ] **T-06.8.2** Author `<TodayHeroPresenter>` per `home.jsx:83–120`. Composes `<MultiRing>` + `<RingLegend>` × 3 + `<MicroPill>` × 4.
- [ ] **T-06.8.3** Author `<HabitsGridContainer>` + `<HabitsGridPresenter>` per `home.jsx:227–268` using `<HabitTile>`. Implements STORY-004 ACs.
- [ ] **T-06.8.4** Author `<QuickLogStripPresenter>` per `home.jsx:271–294`.
- [ ] **T-06.8.5** Author `<WeeklyVolumePresenter>` per `home.jsx:297–338`.
- [ ] **T-06.8.6** Author `<PRCarouselPresenter>` per `home.jsx:341–372` (uses `<PRCard>`).
- [ ] **T-06.8.7** Author `<CoachQuickPeekPresenter>` per `home.jsx:374–393` — only renders when `useUserMode().mode === 'coach'`.
- [ ] **T-06.8.8** Author `<HomeContainer>` wiring all hooks.

## Phase 06.9 — WeighInSheet (1 PR)

- [ ] **T-06.9.1** Author `<WeighInSheetPresenter>` per STORY-005 ACs.
- [ ] **T-06.9.2** Author `<WeighInSheetContainer>` wiring `useLogMeasurement()`.
- [ ] **T-06.9.3** Mount the sheet inside `<HomeContainer>`, opened from QuickLogStrip "Weigh in" button.
- [ ] **T-06.9.4** Offline behaviour preserved.

## Phase 06.10 — YouPresenter + sub-presenters (1 PR)

- [ ] **T-06.10.1** Author `<YouPresenter>` orchestrating sections per `progress.jsx:16–58`. Implements STORY-003 ACs.
- [ ] **T-06.10.2** Author `<StreakHeroPresenter>` per `progress.jsx:73–110`.
- [ ] **T-06.10.3** Author `<MilestonesRowPresenter>` per `progress.jsx:112–139`.
- [ ] **T-06.10.4** Author `<BodyTrendPresenter>` per `progress.jsx:141–194` — SVG sparkline + bar chart with `computePath(series, dims)` helper.
- [ ] **T-06.10.5** Author `<VolumeStatsPresenter>` per `progress.jsx:196–225` with `<Stat>` grid + `<Bar>` rows per muscle.
- [ ] **T-06.10.6** Author `<PRHistoryPresenter>` per `progress.jsx:227–259`.
- [ ] **T-06.10.7** Author `<YouContainer>` wiring all hooks.

## Phase 06.11 — Cleanup + verification

- [ ] **T-06.11.1** Run `01-design-system § Codemod` against new files.
- [ ] **T-06.11.2** `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit` — all green.
- [ ] **T-06.11.3** 90% coverage on touched files. Streak engine + cron especially.
- [ ] **T-06.11.4** Manual e2e:
  - Cold-start app offline → Home renders with cached rings + carousel + habits + volume + PRs.
  - Toggle a habit → optimistic flip → streak count refreshes.
  - Weigh-in offline → sparkline reflects on next You/Progress open.
  - Complete a session → land on Summary → return to Home → PR appears in carousel; streak advances.
  - Force eligibility loss (mock subscription downgrade) → trainer-mode streaks paused if any.

---

## Acceptance gate (progress + home phase complete)

- [ ] All 11 phases above shipped as PRs.
- [ ] Database migrations are forward + back safe + idempotent.
- [ ] Streak engine + nightly cron unit-tested to 90%.
- [ ] PR detection + volume aggregation triggers fire automatically on session completion.
- [ ] Home + You both render from cache offline; mutations queue + sync on reconnect.
- [ ] All notification events from this spec (`streak_milestone`, `streak_at_risk`, `freeze_token_applied`, `goal_milestone`) emit through M7's dispatcher.

---

_End of `06-progress-goals/tasks.md` · 2026-05-27 (rewritten from scratch)_
