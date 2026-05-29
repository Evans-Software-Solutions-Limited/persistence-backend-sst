# 05 — Active Session: Tasks

> **Spec rewritten from scratch on 2026-05-27.** Prior tasks preserved in git history.

---

## Phase 05.1 — useActiveWorkout state machine (1 PR)

- [ ] **T-05.1.1** Author `packages/mobile/src/state/active-workout.ts` per `design.md § useActiveWorkout Zustand slice`. Implements `requirements.md` STORY-006 + STORY-007 ACs.
- [ ] **T-05.1.2** AsyncStorage persistence: every 10s tick + every set-log change + every state transition. Closes STORY-007 AC 7.1.
- [ ] **T-05.1.3** `rehydrate()` handles fresh / stale > 24h / corrupt / no-key paths. Closes STORY-007 AC 7.2 + 7.3.
- [ ] **T-05.1.4** Wire `rehydrate()` call from `app/_layout.tsx`. Surface stale-prompt UI element (returns from rehydrate → prompts user with Resume / Discard dialog).
- [ ] **T-05.1.5** Unit tests cover every action method + persistence + rehydrate variants.

## Phase 05.2 — ActiveWorkoutOverlay + Bar (1 PR)

- [ ] **T-05.2.1** Author `<ActiveWorkoutBarPresenter>` in `packages/mobile/src/ui/presenters/`. Pulsing dot via Reanimated 3 `withRepeat(withTiming(...))`. Cyan glow border. Implements STORY-006 ACs.
- [ ] **T-05.2.2** Author `<ActiveWorkoutOverlay>` container that switches between `<ActiveSessionContainer>` (when expanded) and `<ActiveWorkoutBarPresenter>` (when minimised). Closes STORY-006 AC 6.2.
- [ ] **T-05.2.3** Mount `<ActiveWorkoutOverlay>` in `app/(app)/_layout.tsx` per `14-navigation § Drawer mount-point`.
- [ ] **T-05.2.4** Long-press on bar triggers end-confirm dialog. Closes STORY-006 AC 6.7.
- [ ] **T-05.2.5** Presenter tests for the bar (pulse animation, tap to expand, long-press end).

## Phase 05.3 — ActiveSessionPresenter rebuild (1 PR)

- [ ] **T-05.3.1** Rebuild `<ActiveSessionPresenter>` per `design.md` layout. Implements STORY-002 + STORY-003 ACs.
- [ ] **T-05.3.2** Author `<ExerciseBlock>` spec-local composite (icon tile + name + meta + swap IconBtn + set grid header + set rows + inline add/rest links). Closes STORY-003 AC 3.1–3.7.
- [ ] **T-05.3.3** Author `<SetRow>` spec-local composite (5-column grid, `$mono` numerics, REPS + KG inputs commit on blur via `onRecordSet`, delete IconBtn). Closes STORY-003 AC 3.3 + 3.4 + 3.8.
- [ ] **T-05.3.4** Sticky `<Btn>Finish Workout` CTA at `bottom: 24, left: 16, right: 16`. Closes STORY-002 (locked decision #6).
- [ ] **T-05.3.5** `<ActiveSessionContainer>` rewired per `design.md § <ActiveSessionContainer> plumbing`. Existing V2 hooks all preserved.
- [ ] **T-05.3.6** Presenter tests rewritten — match new structure; preserve behaviour assertions (set commit, swap, rest start, finish).

## Phase 05.4 — End-confirm dialog (1 PR)

- [ ] **T-05.4.1** Author `<EndConfirmDialogPresenter>` per `design.md § <EndConfirmDialogPresenter>`. Implements STORY-005 ACs.
- [ ] **T-05.4.2** Centred modal with `rgba(0,0,0,0.65)` backdrop + `blur(6px)`. zIndex `$modal`.
- [ ] **T-05.4.3** "Keep going" (outline primary) + "End" (filled error) CTAs. Closes STORY-005 AC 5.3.
- [ ] **T-05.4.4** Remove V2's `Alert.alert` end-confirmation call site.
- [ ] **T-05.4.5** Presenter tests: both CTAs fire correct handlers; backdrop tap dismisses.

## Phase 05.5 — TrainerBanner slot (1 PR)

- [ ] **T-05.5.1** Author `<TrainerBannerPresenter>` per `design.md § <TrainerBannerPresenter>`. Implements STORY-004 ACs.
- [ ] **T-05.5.2** `withClient` + `retroactive` props default `undefined` → no banner. Wired by M8 later.
- [ ] **T-05.5.3** Render only when `withClient !== undefined`. Closes STORY-004 AC 4.6.
- [ ] **T-05.5.4** Presenter tests cover both LIVE (success pulse) and RETRO (neutral) states + eyebrow text variants.

## Phase 05.6 — Summary + Rating shell refresh (1 PR)

- [ ] **T-05.6.1** Rewrite `<SessionSummaryPresenter>` shell with `<HeaderBar>`, `<Card>`, `<Stat>`, `<PRCard>` (from `01-design-system`). Implements STORY-008 ACs.
- [ ] **T-05.6.2** Rewrite `<WorkoutRatingPresenter>` shell with `<SemiCircleSlider>` preserved + new RPE band → token mapping. Implements STORY-009 ACs.
- [ ] **T-05.6.3** After Rating submit, call `useActiveWorkout().end()` to clear Zustand state. Closes STORY-009 AC 9.4.
- [ ] **T-05.6.4** Visual regression vs prototype (no dedicated prototype Summary/Rating — match the strong V2 surfaces with new chrome).

## Phase 05.7 — Cleanup + verification

- [ ] **T-05.7.1** Run `01-design-system § Codemod` against the new files.
- [ ] **T-05.7.2** Verify gating from `04-workout-management` Start CTA — manual smoke from Train > Workouts row → Start → Active session loads with right exercises.
- [ ] **T-05.7.3** `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit` — all green.
- [ ] **T-05.7.4** 90% coverage on touched files. Application layer (sessions) coverage preserved.
- [ ] **T-05.7.5** Manual e2e — full active-session flow:
  - Start workout from Train
  - Log sets on first exercise
  - Tap chevron-down → bar appears → navigate to You tab → bar still visible
  - Tap bar → expanded screen returns; in-progress sets present
  - Long-press bar → end-confirm dialog
  - End workout → Summary → Continue → Rating → Submit → return to Train tab
  - Force-quit during session → relaunch → session resumes minimised
  - Submit set offline → reconnect → assert sync

---

## Acceptance gate (active session phase complete)

- [ ] All 7 phases above shipped as PRs.
- [ ] No backend changes.
- [ ] `useActiveWorkout` state machine independently tested; SQLite cache preserved.
- [ ] ActiveWorkoutBar floats correctly over the tab bar in both modes (athlete + coach).
- [ ] Trainer banner slot ready for M8 wiring.
- [ ] Summary + Rating shells refreshed; SemiCircleSlider intact.
- [ ] Manual e2e in T-05.7.5 passes end-to-end.

---

_End of `05-active-session/tasks.md` · 2026-05-27 (rewritten from scratch)_
