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
- [ ] Tap the Home header bell → notifications list opens over the tab bar.
- [ ] (tz) Set device to US-Pacific evening / Auckland morning → the highlighted "today" column + a toggle record the device-local day, not the UTC day.
- [ ] Home + You clear the notch (SafeAreaView); ring legend swatches are square + glow; TodayHero card shows the corner glow.
- [ ] Home shows the "TODAY" workouts carousel (tap a card → workout detail); Recent-PRs shows an empty state when there are no PRs.
- [ ] (HealthKit, on device) Open weigh-in → weight + body-fat prefill from Apple Health; Save → both write back to Apple Health (check the Health app) AND the body-trend updates.
- [ ] Weigh-in: enter body-fat only on a day that already has a weight → the weight is preserved (not wiped).

## Flags raised during the build (decisions/conflicts for review)

1. **`profiles.timezone`** didn't exist though tasks.md/cross-cuts assumed it — added (nullable-safe default `Europe/London`).
2. **`notification_type` +3** (`streak_milestone`/`streak_at_risk`/`freeze_token_applied`) — enum owned by 09-notifications; M4 sequenced the `ADD VALUE`. **@M7: converge on the `NotificationRepository.create` writer added here.**
3. **PR detection** kept inline (no SQS) per your call; streak engine emits notifications via the new writer.
4. **Train ring** = weekly volume per spec decision #2 (prototype labels it "min") — reconcile the RingLegend label on device.
5. **HabitsGrid** uses `<HabitTile>` (design.md) vs the prototype's denser 18px grid — verify cell density on device.
6. **Sheets-at-root** (`feedback_sheets_mount_at_root`): WeighInSheet mounts in HomeContainer per design.md T-06.9.3 — verify it overlays the tab bar; else move to a root-mounted zustand store.
7. **`streak_at_risk`** emission deferred (needs an end-of-day trigger); enum value in place.
8. Defaulted pending data sources: ring step/volume/workout targets (10k / 20t / 5), VolumeStats adherence (4/wk), lifetime workout count, per-PR delta, muscle display labels, workout-carousel data (`useGetMyWorkouts`), user display name, coach-peek content (spec 10).

## Post-merge reconciliation (PR #117 finalize — 2026-06-16)

Replayed onto the merged M4 backend (PR #116, 17 review sweeps) and reconciled against the final contracts:

1. **Habit toggle wire = date-only.** `toggle-habit.command` now POSTs/DELETEs the date-only `day` (`YYYY-MM-DD`), not a noon-UTC ISO instant. The backend treats date-only as the authoritative user-local day (sweep 11); an instant would drift a day for tz ≥ +12 and defeat the local-day logic.
2. **User-local "today" anchors.** Added `shared/utils/localDayISO` (device-local date) and applied it to the Home week grid, `buildHabitGrid` (today + `since`), `useLogMeasurement` default day, and the WeighInSheet default day — they previously used the UTC date, which records the wrong local day near midnight (now load-bearing because of #1).
3. **Same-day weigh-in merge.** A body-fat-only (or weight-only) same-day weigh-in no longer nulls the sibling field in the optimistic body-trend cache.
4. **Home notification bell restored** (design `home.jsx` HomeHeader + spec 09.5 intent) → pushes `/(app)/notifications`. Mirrors the You-screen header convention. (Notification access was always reachable via the profile drawer; this is the design-intended direct entry.)
5. **Deferred:** `TodayHeroPresenter` recomputes the centre `todayPct` instead of using the server's authoritative value — zero impact today (identical formula until M9 Fuel ships); revisit in the M9 Fuel slice.

Contracts re-verified as already-correct (no change): sync-queue 404 → failed-not-retry-forever (`retry_count < max_retries`); freeze-token 400 race → soft refresh-and-retry (no error toast); `freezeTokensRemaining` rendered as-is (no client recompute); weekly-volume renders generically from `days[]` (Mon–Sun); `workouts.target` = 5; `deriveStreak` models no token economics; empty `user_streaks` renders gracefully.

## On-device feedback round (2026-06-17 — Brad)

Prototype is the first source of truth (see `feedback_prototype_first_source_of_truth`). Fixes:

1. **Fidelity (compose signed-off components, don't rebuild):** square RingLegend swatch + glow (was a circular dot; corrected the contradictory `01-design-system/design.md § 4` "circle dot" line); TodayHero corner glow via `expo-linear-gradient` (cyan TR + gold BL, matching `home.jsx:87`); `SafeAreaView` on Home + You; the missing "TODAY" workouts carousel wired via `useWorkouts` → the signed-off `<WorkoutCarouselCard>`; Recent-PRs now shows an empty state instead of hiding.
2. **Apple Health (07-health):** HealthKit was read-only with a `writeBodyWeight` stub. Implemented weight + body-fat read/write on the existing write scope; the weigh-in prefills from Health on open and writes weight + body fat back on save (best-effort, iOS-only). **HealthKit writes verify on device only** — unit tests assert the `saveQuantitySample` call shape, not the OS write.
3. **Body fat:** added an optional body-fat field to the weigh-in (a product-approved deviation from the weight-only prototype). Logged to the measurements API (`bodyFatPercentage`) + written to Apple Health.

Still open (not this PR): water/strain/sleep micro-pill data (backend returns null — needs water-log + HealthKit strain/sleep wiring); habit labels show goalId until the goals slice seeds names; a "set up your streak" flow + richer streak empty state; Mood→Sleep quick-log question; the check-in banner.

_End — 06-progress-goals/PHASE_06_VERIFICATION.md_
