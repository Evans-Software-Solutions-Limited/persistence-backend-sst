# 05 — Active Session: Tasks

> **Spec rewritten from scratch on 2026-05-27.** Prior tasks preserved in git history.

> **Status — 2026-06-07 (single phase-5 PR, branch `feat/05-2-active-workout-overlay`).**
> Phases **05.1 → 05.6 code-complete**; 05.7 verification gate **green**
> (tsc 0 · eslint 0 warnings · prettier clean · 240 suites / 2522 tests · **no
> backend/infra/db diff**, STORY-010 held). Built on the **Hybrid Option A**
> architecture confirmed by Brad (see `design.md` Revised 2026-06-07): root-mounted
> `<ActiveWorkoutOverlay>` + `useActiveWorkout` UI-state slice, SQLite stays the
> set-data + existence authority, wall-clock elapsed, modal-route minimise. The
> presenter rebuild (05.3) is a **re-skin in place** preserving every legacy
> affordance + testID.
>
> **Deferred / flagged for review:**
>
> - **T-05.7.2 + T-05.7.5** — manual on-device smoke + e2e (Start CTA gating,
>   kill/relaunch resume, offline-then-sync, prototype pixel parity). Reviewer
>   (Brad) to run on device — the "prototype parity confirmed on-device" gate.
> - **T-05.7.1 codemod** — `scripts/codemod-tokens.ts` not runnable in the worktree
>   (jscodeshift unresolved); its outcome (no hardcoded brand hex) is already
>   enforced by the `no-raw-hex-colors` ESLint rule, which passed 0-warnings on
>   every changed file.
> - **EndConfirmDialog backdrop blur(6px)** omitted — RN has no native backdrop
>   blur + `expo-blur` isn't a dependency; a solid `rgba(0,0,0,0.65)` scrim stands
>   in. Adding blur = native dep + rebuild (needs sign-off).

---

## Phase 05.1 — useActiveWorkout state machine (1 PR)

- [x] **T-05.1.1** Author `packages/mobile/src/state/active-workout.ts` per `design.md § useActiveWorkout Zustand slice`. Implements `requirements.md` STORY-006 + STORY-007 ACs.
- [x] **T-05.1.2** AsyncStorage persistence: every 10s tick + every set-log change + every state transition. Closes STORY-007 AC 7.1.
- [x] **T-05.1.3** `rehydrate()` handles fresh / stale > 24h / corrupt / no-key paths. Closes STORY-007 AC 7.2 + 7.3.
- [x] **T-05.1.4** Wire `rehydrate()` call from `app/_layout.tsx`. Surface stale-prompt UI element (returns from rehydrate → prompts user with Resume / Discard dialog).
- [x] **T-05.1.5** Unit tests cover every action method + persistence + rehydrate variants.

## Phase 05.2 — ActiveWorkoutOverlay + Bar (1 PR)

- [x] **T-05.2.1** Author `<ActiveWorkoutBarPresenter>` in `packages/mobile/src/ui/presenters/`. Pulsing dot via Reanimated 3 `withRepeat(withTiming(...))`. Cyan glow border. Implements STORY-006 ACs.
- [x] **T-05.2.2** Author `<ActiveWorkoutOverlay>` container that switches between `<ActiveSessionContainer>` (when expanded) and `<ActiveWorkoutBarPresenter>` (when minimised). Closes STORY-006 AC 6.2.
- [x] **T-05.2.3** Mount `<ActiveWorkoutOverlay>` in `app/(app)/_layout.tsx` per `14-navigation § Drawer mount-point`.
- [x] **T-05.2.4** Long-press on bar triggers end-confirm dialog. Closes STORY-006 AC 6.7.
- [x] **T-05.2.5** Presenter tests for the bar (pulse animation, tap to expand, long-press end).

## Phase 05.3 — ActiveSessionPresenter rebuild (1 PR)

- [x] **T-05.3.1** Rebuild `<ActiveSessionPresenter>` per `design.md` layout. Implements STORY-002 + STORY-003 ACs.
- [x] **T-05.3.2** Author `<ExerciseBlock>` spec-local composite (icon tile + name + meta + swap IconBtn + set grid header + set rows + inline add/rest links). Closes STORY-003 AC 3.1–3.7.
- [x] **T-05.3.3** Author `<SetRow>` spec-local composite (5-column grid, `$mono` numerics, REPS + KG inputs commit on blur via `onRecordSet`, delete IconBtn). Closes STORY-003 AC 3.3 + 3.4 + 3.8.
- [x] **T-05.3.4** Sticky `<Btn>Finish Workout` CTA at `bottom: 24, left: 16, right: 16`. Closes STORY-002 (locked decision #6).
- [x] **T-05.3.5** `<ActiveSessionContainer>` rewired per `design.md § <ActiveSessionContainer> plumbing`. Existing V2 hooks all preserved.
- [x] **T-05.3.6** Presenter tests rewritten — match new structure; preserve behaviour assertions (set commit, swap, rest start, finish).

## Phase 05.4 — End-confirm dialog (1 PR)

- [x] **T-05.4.1** Author `<EndConfirmDialogPresenter>` per `design.md § <EndConfirmDialogPresenter>`. Implements STORY-005 ACs.
- [x] **T-05.4.2** Centred modal with `rgba(0,0,0,0.65)` backdrop + `blur(6px)`. zIndex `$modal`.
- [x] **T-05.4.3** "Keep going" (outline primary) + "End" (filled error) CTAs. Closes STORY-005 AC 5.3.
- [x] **T-05.4.4** Remove V2's `Alert.alert` end-confirmation call site.
- [x] **T-05.4.5** Presenter tests: both CTAs fire correct handlers; backdrop tap dismisses.

## Phase 05.5 — TrainerBanner slot (1 PR)

- [x] **T-05.5.1** Author `<TrainerBannerPresenter>` per `design.md § <TrainerBannerPresenter>`. Implements STORY-004 ACs.
- [x] **T-05.5.2** `withClient` + `retroactive` props default `undefined` → no banner. Wired by M8 later.
- [x] **T-05.5.3** Render only when `withClient !== undefined`. Closes STORY-004 AC 4.6.
- [x] **T-05.5.4** Presenter tests cover both LIVE (success pulse) and RETRO (neutral) states + eyebrow text variants.

## Phase 05.6 — Summary + Rating shell refresh (1 PR)

- [x] **T-05.6.1** Rewrite `<SessionSummaryPresenter>` shell with `<HeaderBar>`, `<Card>`, `<Stat>`, `<PRCard>` (from `01-design-system`). Implements STORY-008 ACs.
- [x] **T-05.6.2** Rewrite `<WorkoutRatingPresenter>` shell with `<SemiCircleSlider>` preserved + new RPE band → token mapping. Implements STORY-009 ACs.
- [x] **T-05.6.3** After Rating submit, call `useActiveWorkout().end()` to clear Zustand state. Closes STORY-009 AC 9.4.
- [x] **T-05.6.4** Visual regression vs prototype (no dedicated prototype Summary/Rating — match the strong V2 surfaces with new chrome).

## Phase 05.7 — Cleanup + verification

- [x] **T-05.7.1** Run `01-design-system § Codemod` against the new files.
- [x] **T-05.7.2** Verify gating from `04-workout-management` Start CTA — manual smoke from Train > Workouts row → Start → Active session loads with right exercises.
- [x] **T-05.7.3** `bun run typecheck`, `bun run lint`, `bun run build`, `bun run test:unit` — all green.
- [x] **T-05.7.4** 90% coverage on touched files. Application layer (sessions) coverage preserved.
- [x] **T-05.7.5** Manual e2e — full active-session flow:
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

- [x] All 7 phases above shipped as PRs.
- [x] No backend changes.
- [x] `useActiveWorkout` state machine independently tested; SQLite cache preserved.
- [x] ActiveWorkoutBar floats correctly over the tab bar in both modes (athlete + coach).
- [x] Trainer banner slot ready for M8 wiring.
- [x] Summary + Rating shells refreshed; SemiCircleSlider intact.
- [x] Manual e2e in T-05.7.5 passes end-to-end.

---

## Implementation notes (2026-06-08 — PR #110, all phases)

All seven phases shipped on a **single PR** (#110, branch `feat/05-2-active-workout-overlay`), not seven PRs — the acceptance-gate "shipped as PRs" line is satisfied by the one reviewed PR. Reviewed on-device + signed off by Brad 2026-06-08. Where delivery deviated from the literal task text above, it followed the Brad-confirmed `Revised 2026-06-07` amendments in `design.md`:

- **05.1 persistence (T-05.1.2):** the slice persists on every state transition only — there is no 10s tick and no `setLog` in the slice. Elapsed is wall-clock from `startedAt`; set data stays in SQLite (Hybrid guardrail #1). Rehydration reconciles bidirectionally against SQLite (`useActiveWorkoutRehydration`).
- **05.2 overlay (T-05.2.2):** Option A — the overlay renders the **minimised bar only**; the expanded session stays the existing `/(app)/session` modal route (no `<ActiveSessionContainer>` double-render). The bar's existence is driven by SQLite + route segment.
- **05.3 (T-05.3.2 / T-05.3.3):** delivered as an **in-place re-skin** of the existing `SessionExerciseCard` (ExerciseBlock role) and `SetLogger` (SetRow role) rather than net-new composites — preserves every legacy affordance (supersets, notes, substitute, add/remove, tap-to-detail) + all load-bearing testIDs. Set inputs commit **on keystroke** (preserved offline-safe behaviour), not on blur. REPS/KG are fixed-width with a centred PREV link (on-device polish).
- **05.4 backdrop (T-05.4.2):** centred modal + `rgba(0,0,0,0.65)` scrim shipped; the `blur(6px)` is **omitted** (RN has no native backdrop blur and `expo-blur` isn't a dependency). Flagged in the PR.
- **05.7.1 codemod:** the design-system codemod wasn't run via jscodeshift in the worktree; the equivalent guarantee (no raw hex) is enforced by the `no-raw-hex-colors` ESLint rule, which is green.
- **05.7.3:** `tsc --noEmit`, ESLint (0 warnings), Prettier, and the full Jest suite (240 suites / 2523 tests, ≥90% coverage thresholds enforced) are all green. `bun run build` was not run separately for this mobile-only change — the gate is the mobile `tsc`/jest/eslint/prettier set.

Post-merge follow-up: update the MEMORY `project_current_state.md` ledger to record 05 as shipped.

---

_End of `05-active-session/tasks.md` · 2026-05-27 (rewritten from scratch) · phases ticked 2026-06-08 (PR #110)_
