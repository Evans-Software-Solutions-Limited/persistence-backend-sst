# 06 — Progress/Home: Phase verification (06.11)

Closes the Progress/Home stream. Automated gates are green across all 11 phases;
the on-device manual e2e (06.11.4) is the reviewer's step.

## PR stack (merge bottom-up)

| PR   | Phase | Scope                                                                                                                 |
| ---- | ----- | --------------------------------------------------------------------------------------------------------------------- |
| #102 | 06.1  | DB migrations — streaks/habits/goal-ext/volume tables, `profiles.timezone`, `notification_type` +3, achievements seed |
| #103 | 06.2  | Streak engine + 02:00 cron (freeze tokens, milestones, notify dispatcher)                                             |
| #105 | 06.3  | Streak-engine wiring into write paths + habit-completions endpoints + PR-detection reconcile                          |
| #106 | 06.4  | Volume aggregation (weekly + by-muscle) + 03:00 cron + on-complete recompute                                          |
| #107 | 06.5  | Home aggregate + rings/PRs/body-trend/achievements + use-token                                                        |
| #108 | 06.6  | Frontend domain/ports/adapters + SQLite cache slots + habit/weigh-in sync commands                                    |
| #109 | 06.7  | `deriveStreak` offline helper                                                                                         |
| #111 | 06.7  | 12 cache-first Progress/Home hooks (`useCachedResource` factory)                                                      |
| #112 | 06.8  | Home re-skin — TodayHero rings, habits grid, quick-log, weekly volume, PR carousel, coach peek                        |
| #113 | 06.9  | WeighInSheet (offline weigh-in log + sparkline preview)                                                               |
| #114 | 06.10 | You/Progress — StreakHero, Milestones, BodyTrend, VolumeStats, PRHistory + `GET /users/me/streaks`                    |

## Automated gate (06.11.1–06.11.3) — all green

- Backend: `typecheck` · `lint` (0 errors) · `build` · `test:unit` — **1154 tests, 98.79% lines / 91.93% branches**. Streak engine/cron/milestones/notifier 100%.
- Mobile: `tsc` · `eslint` (0 warnings on changed files; `no-raw-hex` codemod-rule passes) · `prettier` · `jest --coverage` — **2499 tests, 96.44% lines / 90.82% branches**.
- Migrations idempotent (`IF NOT EXISTS` / DO-block guard / jsonb-equality seed) + additive.

## Manual e2e checklist (06.11.4 — on device)

- [ ] Cold-start offline → Home renders cached rings + habits + weekly volume + PR carousel.
- [ ] Toggle a habit → optimistic flip → streak micro-pill refreshes.
- [ ] Weigh-in offline → sparkline reflects on next You open; syncs on reconnect.
- [ ] Complete a session → return to Home → PR appears in carousel; streak advances.
- [ ] Force eligibility loss (mock downgrade) → trainer-mode streaks paused if any.

## Flags raised during the build (decisions/conflicts for review)

1. **`profiles.timezone`** didn't exist though tasks.md/cross-cuts assumed it — added (nullable-safe default `Europe/London`).
2. **`notification_type` +3** (`streak_milestone`/`streak_at_risk`/`freeze_token_applied`) — enum owned by 09-notifications; M4 sequenced the `ADD VALUE`. **@M7: converge on the `NotificationRepository.create` writer added here.**
3. **PR detection** kept inline (no SQS) per your call; streak engine emits notifications via the new writer.
4. **Train ring** = weekly volume per spec decision #2 (prototype labels it "min") — reconcile the RingLegend label on device.
5. **HabitsGrid** uses `<HabitTile>` (design.md) vs the prototype's denser 18px grid — verify cell density on device.
6. **Sheets-at-root** (`feedback_sheets_mount_at_root`): WeighInSheet mounts in HomeContainer per design.md T-06.9.3 — verify it overlays the tab bar; else move to a root-mounted zustand store.
7. **`streak_at_risk`** emission deferred (needs an end-of-day trigger); enum value in place.
8. Defaulted pending data sources: ring step/volume/workout targets (10k / 20t / 5), VolumeStats adherence (4/wk), lifetime workout count, per-PR delta, muscle display labels, workout-carousel data (`useGetMyWorkouts`), user display name, coach-peek content (spec 10).

_End — 06-progress-goals/PHASE_06_VERIFICATION.md_
