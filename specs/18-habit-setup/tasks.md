# 18 — Habit Setup: Tasks

> Net-new, authored 2026-06-21; reconciled 2026-06-23 to the landed prototype + coach/sync decisions. Every item traces to a `requirements.md` AC + a `design.md` section. The FE phase (18.7) is **unblocked** — the hi-fi prototype is at `~/Downloads/habit_design/`.

---

## Phase 18.0 — Spec-update commit (cross-cuts)

- [ ] **T-18.0.1** Confirm the "Revised 2026-06-23" block on `specs/_shared/cross-cuts.md § 3` (collection streak, days/week, freeze=week-off, holiday-on-Home, coach authorship, DB-source-of-truth sync). (`design.md § 4, § 5, § 7`)
- [ ] **T-18.0.2** Add the "Revised 2026-06-23" two-way-sync note to `specs/07-health-integration/design.md` (Water r/w, Sleep r, permission-scope deltas, device-bridge + echo de-dup). (`design.md § 7.4`)

## Phase 18.1 — Database migrations (1 PR)

- [x] **T-18.1.1** `habit_category_enum` (water/gym/steps/sleep/calories), `habit_completion_rule_enum`. (`design.md § 2.1`)
- [x] **T-18.1.2** `habit_configs` table (incl. `days_per_week`, `tolerance_pct`, `effective_from`, `pending_config`, `pending_from`; **no** cheat-days column). (`design.md § 2.2`; STORY-002)
- [x] **T-18.1.3** `streak_holidays` table. (`design.md § 2.3`; STORY-008)
- [x] **T-18.1.4** ~~`user_streaks` column~~ — none needed; the collection streak reuses the existing weekly `user_streaks` row (1 token/missed week = a week off). (`design.md § 2.4`)
- [x] **T-18.1.5** Idempotent seed of 5 `goal_types`. (`design.md § 2.5`)
- [x] **T-18.1.6** Mirror in `schema.ts` (enums, tables, types) — `bun run typecheck` green.
- [x] **T-18.1.7** Idempotent by construction (DO-block enums, IF NOT EXISTS, ON CONFLICT seed); forward/back-safe (all additive). _Forward/back run against a live DB still to do at PR time._

## Phase 18.2 — Self config handlers (1 PR)

- [ ] **T-18.2.1** `GET /users/me/habits/config` — 5 categories, enabled/config + `locked`/`assignedByCoach`. (STORY-001 AC 1.2; `design.md § 3.1`)
- [ ] **T-18.2.2** `PUT /users/me/habits/:category/config` — upsert goal + config + ensure collection streak; server-set period/rule; bounds; **403 on coach-locked**; **deferred-edit timing** (first-enable → `effective_from = next Mon`; edit → `pending_config`/`pending_from`, live row untouched); response echoes live + pending. (STORY-002/006; `design.md § 3.1, § 4.4, § 5`)
- [ ] **T-18.2.3** `DELETE /users/me/habits/:category` — soft-disable; 403 on coach-locked. (STORY-002)
- [ ] **T-18.2.4** `GET/POST/DELETE /users/me/habits/holidays` — 24 h-advance 422 / end-early truncate / cancel / 409 past. (STORY-008; `design.md § 3.1, § 6`)
- [ ] **T-18.2.5** Repositories (configs + holidays, owner-scoped) + tests incl. anti-gaming rejections.

## Phase 18.3 — Trainer (coach) routes (1 PR)

- [ ] **T-18.3.1** `GET/PUT/DELETE /trainers/me/clients/:clientId/habits[/config|/:category]` via `assertTrainerCanActForClient`; stamp `assigned_by_user_id` + `goal_assigned` audit. (STORY-006; `design.md § 3.2`)
- [ ] **T-18.3.2** `GET /trainers/me/clients/:clientId/habit-completions` for the trainer dashboard. (STORY-006 AC 6.5)
- [ ] **T-18.3.3** Edit-lock predicate = assigned + active relationship; verify it lifts when relationship inactive (transfer). (STORY-006 AC 6.3/6.4; `design.md § 5`)
- [ ] **T-18.3.4** Tests: trainer auth (wrong role / no relationship → 403), coach-edits-only-own, relationship-end unlock.

## Phase 18.4 — Completion handler extension (1 PR)

- [ ] **T-18.4.1** Extend `createHabitCompletionHandler` — `value` required for `value_gte`/`within_tolerance`; per-category range; future-day + prior-week rejection; keep #117 `local_completed_date`. (STORY-004/008; `design.md § 3.3`)
- [ ] **T-18.4.2** Tests for value-required, bounds, future-day, prior-week.

## Phase 18.5 — Streak engine (collection model) (1 PR)

- [ ] **T-18.5.1** Per-habit `weekMet` dispatch (`value_gte` days/week, `count` weekly, `within_tolerance` M9-skip). (STORY-004; `design.md § 4.1`)
- [ ] **T-18.5.2** Collection weekly streak: `isPeriodSatisfied` for the collection `habit_streak` row = "all enabled habits' `weekMet`"; reuses the M4 advance/earn-token/break path (holiday → satisfied → missed-week token spend → break); mid-week at-risk emission. (STORY-003; `design.md § 4.2`)
- [ ] **T-18.5.3** **Promote pending configs at weekly rollover** in `cron.ts` (`pending_from <= today` → live; set `user_goals.is_active` for enable/disable). Score the open week against the week-start config (`effective_from` gate). (STORY-002 AC 2.7, STORY-008 AC 8.2; `design.md § 4.3/4.4`)
- [ ] **T-18.5.4** Extend manual spend (`POST /users/me/streaks/:id/use-token`) with a proactive "skip this week": spend 1 token, advance `last_period_end` over the current week, no count increment. (STORY-003 AC 3.4)
- [ ] **T-18.5.5** Engine tests — render real SQL via `PgDialect`; exhaustive rules/forgiveness/no-stack/resume/closed-week immutability; **deferred-edit timing**: mid-week lower/disable/enable can't change the current week's outcome (rescue/ratchet/disable-to-dodge all fail), and pending promotes correctly at rollover. (STORY-008 AC 8.2, STORY-002 AC 2.7)

## Phase 18.6 — Health two-way sync (07 + bridge) (1 PR)

- [ ] **T-18.6.1** `HealthPort` + `ExpoHealthKitAdapter`: `getDietaryWaterToday`, `writeDietaryWater`, `getSleepLastNight`; add `DietaryWater` r/w + `SleepAnalysis` r to permission scopes. (STORY-005; `design.md § 7.4`)
- [ ] **T-18.6.2** Device bridge: in-app Water log → DB (queue) + HK mirror; HK external samples → DB; **source-tag de-dup** (no echo). (STORY-005 AC 5.1–5.3; `design.md § 7.1/7.2`)
- [ ] **T-18.6.3** Persistence mapping: Water/Sleep/Steps → `habit_completions.value`; Weight → `body_measurements`; Calories → `nutrition_entries` (M9). (STORY-005 AC 5.5)
- [ ] **T-18.6.4** Tests: adapter r/w, echo de-dup, offline read/write.

## Phase 18.7 — Mobile domain/hooks + FE screen (1 PR)

- [ ] **T-18.7.1** Domain: `HabitConfig`, `HabitCategory`; `cached_habit_configs` cache + `StoragePort` methods. (`design.md § 8`)
- [ ] **T-18.7.2** `api.port.ts` + SST adapter: self + trainer config/completion routes.
- [ ] **T-18.7.3** Commands: `configureHabitCommand`, `disableHabitCommand` (optimistic + enqueue + `invalidateHome`, `local-` reconcile). (STORY-009)
- [ ] **T-18.7.4** Rework `deriveStreak` → `deriveCollectionStreak` (per-habit `weekMet` + all-enabled-met + holiday/freeze neutrality; preserve `localCompletedDate`). (STORY-004 AC 4.5, STORY-009 AC 9.4; `design.md § 8`)
- [ ] **T-18.7.5** Hooks: `useGetHabitConfig`, `useConfigureHabit`, `useDisableHabit` (cache-first + background refresh); reuse `useFreezeToken` (06).
- [ ] **T-18.7.6** Wire Habit row label/tone from category (replace `label: goalId` placeholder in `useGetHabits.buildHabitGrid`). (STORY-002 AC 2.5)
- [ ] **T-18.7.7** Recreate the screen in RN/Tamagui from `~/Downloads/habit_design/`: `HabitSetupContainer` + `HabitSetupPresenter` + `StreakSectionPresenter` + `HabitCardPresenter` + `Switch`/`Stepper`/`WeekFreq`/`Row`; coach-locked + at-risk + Calories deep-link states; new icons. (STORY-001/002/003/006; `design.md § 9`)
- [ ] **T-18.7.8** Navigation: Home empty-state CTA + "Manage habits". (STORY-007)
- [ ] **T-18.7.9** Tests — commands, hooks, `deriveCollectionStreak`, presenters; `/frontend-design` polish per `feedback_port_then_revamp`.

## Phase 18.8 — Verification

- [ ] **T-18.8.1** Backend: `prettier:check && typecheck && lint && build && test:unit` green, ≥90% touched.
- [ ] **T-18.8.2** Mobile: `tsc --noEmit`, `jest --coverage` ≥90%, eslint 0 warnings (from `packages/mobile/`).
- [ ] **T-18.8.3** Manual e2e: enable all 5 → log values → collection streak advances when all weekly targets met; miss one habit's days/week → at-risk warning; spend freeze → week skipped, streak holds; coach sets a habit → client sees "Set by Coach X" + can't edit → end relationship → habit unlocks, streak unbroken; log water in-app → appears in Apple Health; Watch sleep → appears in app + DB; trainer dashboard reads the values; offline cold-start renders cached config + edits reconcile.

---

## Acceptance gate

- [ ] cross-cuts § 3 + 07 § sync "Revised 2026-06-23" blocks present + cited.
- [ ] Migrations forward/back-safe + idempotent; seed idempotent.
- [ ] Collection streak (all-enabled-met) + forgiveness + freeze no-stack/resume unit-tested ≥90%.
- [ ] Coach edit-lock + relationship-end transfer tested; trainer routes auth-gated.
- [ ] Server (`engine.ts`) ↔ client (`deriveCollectionStreak`) agree.
- [ ] Two-way HK sync: DB canonical, echo de-duped, trainer reads from DB.
- [ ] Screen recreated to prototype fidelity; renders + writes offline.

---

_End of `18-habit-setup/tasks.md` · reconciled 2026-06-23_
