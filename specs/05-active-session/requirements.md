# 05 — Active Session: Requirements

> **Spec rewritten from scratch on 2026-05-27** to absorb the May 2026 design package. Prior version preserved in git history.

---

## Overview

The active-workout execution surface — the most offline-critical screen in the app. Users start a session from a workout template, log sets (weight, reps, optional RPE), use rest timers, swap exercises mid-flow, and end with a summary + rating prompt. The new design package rebuilds the screen significantly (chevron-down minimise + tabular 5-column set grid + trainer banner slot + end-confirm dialog) and introduces a **minimise-to-bar** pattern: the session can collapse to a persistent floating bar that survives tab navigation, then re-expand.

Authoritative references:

1. `~/Downloads/handoff/design-source/screens/active-workout.jsx` — full screen (`ActiveWorkoutScreen`, lines 3–139) + minimised bar (`ActiveWorkoutBar`, lines 142–181)
2. `~/Downloads/handoff/CLAUDE_CODE_MIGRATION_PLAN.md` § "Active workout specifically — minimize/restore pattern" — Zustand store + root-mount pattern
3. `docs/design-port-audit.md` § "Active session"
4. Legacy V1 reference (behavioural source of truth): `../persistence-mobile/app/workout/[id]/active.tsx`

Legacy V2 reference: `packages/mobile/src/ui/presenters/ActiveSessionPresenter.tsx` (456 LOC, currently a 1:1 port of legacy V1 visual).

---

## Locked decisions

> **Revised 2026-06-08 (Hybrid architecture — see `design.md` § Revised 2026-06-07).** Decisions #7 and #9 describe the slice's _internals_ as `elapsedSeconds`/`tick` + `setLog[]` persisted to AsyncStorage. Implementation (Brad-confirmed) supersedes those internals: the slice holds **UI state only** (a workout pointer + `expanded`); elapsed is derived **wall-clock** from `startedAt` (no tick); and **set data stays in SQLite**, not a parallel AsyncStorage `setLog`. The slice's AsyncStorage entry persists only the lightweight "active + minimised" pointer. The _user-facing intent_ of #7/#9 (minimise-to-bar; session survives backgrounding/force-quit; relaunch starts minimised) is unchanged and met. Decision #5's `blur(6px)` ships as a solid `rgba(0,0,0,0.65)` scrim (RN has no native backdrop blur; `expo-blur` not a dep).

| #   | Decision                | Locked value                                                                                                                                                                                                                                                                                                          |
| --- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Header pattern          | Chevron-down minimise IconBtn (left, 36×36) + centred name + tabular timer + End pill (right). Per `active-workout.jsx:16–42`.                                                                                                                                                                                        |
| 2   | Trainer banner slot     | Always included as a presenter prop (`withClient?: ClientRef`, `retroactive?: boolean`). Renders only when `withClient !== undefined`. M8 (`10-trainer-features`) wires real data; until then, props default `undefined` and the banner doesn't render. Per locked decision #4 in `01-design-system/requirements.md`. |
| 3   | Set grid layout         | 5-column grid `36pt SET · 1fr PREV · 1fr REPS · 1fr KG · 24pt ×`. Mono numerics with `tnum` + `zero`. Per `active-workout.jsx:85–96`.                                                                                                                                                                                 |
| 4   | Inline set actions      | `+ ADD SET` (left) and `60S REST` (right) below each exercise's set table. `$primary` text, ghost background. Per `active-workout.jsx:97–104`.                                                                                                                                                                        |
| 5   | End-confirm dialog      | Centred modal with blur backdrop (`rgba(0,0,0,0.65)` + `blur(6px)`). 320pt max width, 20pt radius. "Keep going" outline / "End" filled-error CTAs. Per `active-workout.jsx:115–136`. Replaces V2's `Alert.alert`.                                                                                                     |
| 6   | Sticky Finish CTA       | `<Btn full variant="filled" tone="primary" size="lg" icon={<IconCheck/>}>Finish Workout</Btn>` floating at `bottom: 24, left: 16, right: 16`. Per `active-workout.jsx:110–112`.                                                                                                                                       |
| 7   | Minimise-to-bar pattern | `useActiveWorkout` Zustand slice with `workout`, `expanded`, `elapsedSeconds`. AsyncStorage rehydration on launch. `<ActiveWorkoutOverlay>` mounted at `(app)/_layout.tsx`. Per migration plan §"Active workout specifically".                                                                                        |
| 8   | Minimised bar visual    | Floating pill at `bottom: tabBarHeight + 12pt`. Pulse `$primary` dot + "WORKOUT IN PROGRESS" eyebrow + workout name + mono timer + chevron-right (rotated -90°). Cyan glow border. Tap to expand. Per `active-workout.jsx:142–181`.                                                                                   |
| 9   | Session persistence     | `workout` + `elapsedSeconds` + `setLog[]` written to AsyncStorage on every state change. Rehydrate on mount; if `workout !== null` on launch, start in MINIMISED state (let user re-expand).                                                                                                                          |
| 10  | Summary + Rating        | Existing V2 surfaces (`SessionSummaryPresenter`, `WorkoutRatingPresenter`) preserved with token + primitive refresh. No structural changes.                                                                                                                                                                           |

---

## User stories

### STORY-001: As a user, I want to start a workout session from a workout template and immediately enter the active screen

**Acceptance Criteria:**

- 1.1 [ ] Calling `useStartSession({ workoutId })` (existing V2 hook) creates a `Session` row via `POST /sessions` and navigates to `(app)/session/index.tsx`.
- 1.2 [ ] The active screen renders the workout's exercise list with empty set rows pre-populated up to the configured `targetSets` per exercise.
- 1.3 [ ] Session state persists immediately to local SQLite via the existing V2 session adapter — preserved.
- 1.4 [ ] Only one active session at a time. If one exists, the user is prompted to resume or discard before starting a new one.
- 1.5 [ ] On entering the screen, the timer starts from `elapsedSeconds = 0` and updates every 1s.

### STORY-002: As a user mid-workout, I want a clean header that lets me see the workout name, elapsed time, and quickly minimise or end

**Acceptance Criteria:**

- 2.1 [ ] Header layout per `active-workout.jsx:16–42`: chevron-down minimise IconBtn left (36×36, `$surface2` bg, `$border` 1pt) + centred name + mono timer (`$primary` colour, 12pt) + "End" pill button right (transparent, `$border2` border, `$text3` fg).
- 2.2 [ ] Timer renders in `$mono` with `tnum`+`zero` — never bounces on update.
- 2.3 [ ] Workout name truncates with ellipsis if too long for the centre slot.
- 2.4 [ ] Chevron-down IconBtn calls `useActiveWorkout().minimize()`; user lands on whichever tab they came from with the `<ActiveWorkoutBar>` visible above the tab bar.
- 2.5 [ ] "End" button opens the end-confirm dialog (STORY-005). Single tap doesn't end the session.

### STORY-003: As a user logging sets, I want a tight tabular grid so I can read PREV, REPS, KG at a glance and tap-in values mid-set

**Acceptance Criteria:**

- 3.1 [ ] Per-exercise card layout per `active-workout.jsx:73–106`: 28×28 toned icon tile + name + "{N} sets × {min}-{max} reps" caption + swap IconBtn (`<IconSwap>`, ghost, 28pt).
- 3.2 [ ] Set grid header row per `active-workout.jsx:85–87`: `SET · PREV · REPS · KG · ×` in uppercase `$display` weight 600, `$text3` colour, 10.5pt, 0.1em letterSpacing. 5-column grid: `36pt 1fr 1fr 1fr 24pt`.
- 3.3 [ ] Each set row per `active-workout.jsx:88–96`: mono set number + mono previous value (or `—` for `$text4`) + REPS input + KG input + `<IconX>` delete. Bottom border `$border`.
- 3.4 [ ] Inputs use `<TextInput>` with `keyboardType="numeric"`, `$surface2` bg, `$border` 1pt, `$sm` radius (6pt), `$mono` font 13pt, centred text alignment. Auto-fill PREV value when input is focused and empty.
- 3.5 [ ] On each value commit (input blur or Enter), the set is persisted to local SQLite via the existing `usePostRecordSet` mutation. Bulk-record flush remains preserved for performance.
- 3.6 [ ] `+ ADD SET` inline link adds a new row to the exercise's set list (post-`targetSets`).
- 3.7 [ ] `60S REST` inline link starts a rest timer (preserved hook). Timer renders in a separate persistent component (preserved `<RestTimerDisplay>`).
- 3.8 [ ] Each set row has a delete `<IconX>` at the right end. Tap → confirm + remove the set from the local state + queue the deletion mutation.

### STORY-004: As a coach using on-behalf logging (M8), I want a banner on the active session that signals I'm training live with a client or retroactively logging for them

**Acceptance Criteria:**

- 4.1 [ ] `ActiveSessionPresenter` accepts `withClient?: { initials: string; name: string }` and `retroactive?: boolean` props. Defaults `undefined`.
- 4.2 [ ] When `withClient !== undefined`, render the banner per `active-workout.jsx:45–63`: gradient `$accentTrainerDim` → `$surface2` bg, `$accentTrainerDim` border, 10pt radius, 8/12pt padding, 28pt `<Avatar tone="trainer">` + eyebrow + name + LIVE/RETRO pill.
- 4.3 [ ] LIVE pill: `$success` tone with pulsing dot + `LIVE` text (when `retroactive: false`).
- 4.4 [ ] RETRO pill: `neutral` tone with `RETRO` text (when `retroactive: true`).
- 4.5 [ ] Eyebrow text: `TRAINING LIVE WITH` (live) or `LOGGING SESSION FOR` (retro).
- 4.6 [ ] Banner only renders when `withClient !== undefined`. Athlete users never see it.
- 4.7 [ ] M8 (`10-trainer-features`) wires `withClient` + `retroactive` via the trainer-on-behalf session creation flow. This spec ships the slot + visual; M8 wires the data.

### STORY-005: As a user, I want a confirmation dialog before ending the workout so I don't lose progress accidentally

**Acceptance Criteria:**

- 5.1 [ ] Tapping the End button opens a centred modal per `active-workout.jsx:115–136`. Dialog content uses `<BottomSheet>` from `01-design-system` with `peek` height OR a dedicated `<Dialog>` primitive — see `design.md`.
- 5.2 [ ] Dialog title: "End workout?" Body: "Your progress so far ({elapsed}) won't be saved as a completed workout."
- 5.3 [ ] Two CTAs: "Keep going" (outline, primary, flex 1) and "End" (filled, error, flex 1). Tap "End" → fires `useEndSession()` → navigates to `(app)/session/summary.tsx`.
- 5.4 [ ] Backdrop tap dismisses the dialog (returns to active screen, no action).
- 5.5 [ ] Backdrop: `rgba(0,0,0,0.65)` + `backdropFilter: blur(6px)`. zIndex above the active screen.

### STORY-006: As a user, I want to minimise the active session to a floating bar so I can navigate to other tabs without losing my progress

**Acceptance Criteria:**

- 6.1 [ ] `useActiveWorkout` Zustand slice exposes `{ workout, expanded, elapsedSeconds, start, minimize, expand, end, tick }` per migration plan.
- 6.2 [ ] When `workout !== null && expanded === false`, `<ActiveWorkoutBar>` renders at `bottom: tabBarHeight + 12pt` per `active-workout.jsx:146`.
- 6.3 [ ] Bar visual per `active-workout.jsx:142–181`: pulse `$primary` dot (1.4s ease-in-out, opacity 1 → 0.35) + "WORKOUT IN PROGRESS" eyebrow + workout name (truncated) + mono timer + chevron-right rotated -90°. Cyan glow border.
- 6.4 [ ] Tap on the bar calls `expand()` → `<ActiveWorkoutOverlay>` renders the full screen.
- 6.5 [ ] Bar is hidden when `workout === null` OR `expanded === true`.
- 6.6 [ ] Tab navigation continues normally underneath the bar. The bar is `position: absolute`, not part of any tab's content tree.
- 6.7 [ ] Long-press on bar reveals an End option (escape hatch). Confirmation via same dialog as STORY-005.

### STORY-007: As a user, I want my session to survive app backgrounding, force-quit, and device restart so I never lose set data

**Acceptance Criteria:**

- 7.1 [ ] On every state change in `useActiveWorkout`, the slice writes `workout`, `elapsedSeconds`, and the set log to AsyncStorage under `persistence.activeWorkout`.
- 7.2 [ ] On app launch, the slice rehydrates from AsyncStorage. If `workout !== null`, start in `expanded: false` (minimised state) — user decides whether to re-expand.
- 7.3 [ ] On app launch with a stored session older than 24h, prompt the user with: "We found a workout from {date}. Resume or discard?" Resume → restore state. Discard → clear AsyncStorage + cancel any unsynced set mutations.
- 7.4 [ ] Set data writes are independently persisted to local SQLite via the existing V2 bulk-record flush pattern — preserved.
- 7.5 [ ] Force-quit during active session: on next launch, both the Zustand state AND the SQLite cache contain the session data; no double-counted sets.

### STORY-008: As a user finishing a workout, I want to see a clean summary screen with the key stats and any PRs I hit

**Acceptance Criteria:**

- 8.1 [ ] Calling `useEndSession({ sessionId })` fires `PUT /sessions/:id` with `endedAt: now` and navigates to `(app)/session/summary.tsx`.
- 8.2 [ ] Summary screen layout preserved from V2 (`SessionSummaryPresenter` — already strong per the audit). Shell refresh only: tokens + new primitives.
- 8.3 [ ] PR cards within Summary use the new `<PRCard>` composite from `01-design-system`.
- 8.4 [ ] Continue CTA navigates to `(app)/session/rate.tsx`.

### STORY-009: As a user, I want to rate the workout difficulty so I can track effort over time

**Acceptance Criteria:**

- 9.1 [ ] Route `(app)/session/rate.tsx` renders the `WorkoutRatingPresenter` with the existing `SemiCircleSlider` (preserved — it's the signature interaction).
- 9.2 [ ] Per-band colours map to new tokens: easy → `$success`, moderate → `$info`, hard → `$warning`, very hard → `$warning7`, maximal → `$error`. Confirmed mapping in `design.md`.
- 9.3 [ ] Submit fires `PUT /sessions/:id` with `rpe` + `notes` then navigates back to whichever tab the user came from (Train, You, Home).
- 9.4 [ ] After submit, `useActiveWorkout().end()` is called to clear the session state.

### STORY-010: As a developer, I want the data layer unchanged so the existing 90% coverage holds and the sync engine doesn't regress

**Acceptance Criteria:**

- 10.1 [ ] No SST routes added or modified. Existing endpoints: `GET /sessions`, `GET /sessions/:id`, `POST /sessions`, `PUT /sessions/:id`, `DELETE /sessions/:id`, `POST /sessions/:id/sets`, etc. consumed as-is.
- 10.2 [ ] No Drizzle migrations.
- 10.3 [ ] No changes to `domain/ports/api.port.ts` or the sync-queue handlers.
- 10.4 [ ] Existing session-related hooks (`useStartSession`, `useEndSession`, `usePostRecordSet`, `useRestTimer`, `useSupersetCommand`, etc.) keep their signatures.
- 10.5 [ ] The new `useActiveWorkout` Zustand slice is a presentation-layer concern — it doesn't touch the SST API directly, it just orchestrates the UI state machine. Set persistence still goes through `usePostRecordSet`.

---

## Out of scope

- **Trainer banner data wiring** — `withClient` + `retroactive` data come from M8 (`10-trainer-features`). This spec ships the presenter slot + visual; M8 wires the props.
- **Backend additions** — none. Pure presentation rebuild + state-machine introduction.
- **Rest timer redesign** — `<RestTimerDisplay>` preserved as-is. If the prototype reveals a new visual, that's a "**Revised YYYY-MM-DD:**" amendment.
- **PR detection logic** — owned by `06-progress-goals`. This spec consumes detected PRs for the Summary screen but doesn't compute them.
- **Streak engine triggers** — owned by `06-progress-goals` + `_shared/cross-cuts.md § 3`. Session completion fires the streak engine via existing event hook (preserved from V2 if already present, or added by 06).

---

## Dependencies and what this spec unlocks

**Depends on:**

| Spec                    | What's consumed                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `01-design-system`      | `<Card>`, `<Btn>`, `<Pill>`, `<IconBtn>`, `<HeaderBar>`, `<MicroPill>`, `<PRCard>`, `<Section>`, `<BottomSheet>` (dialog use), `<Stat>`, Lucide icons, tokens, mono font |
| `04-workout-management` | `useStartSession({ workoutId })` resolves from the workout-detail Start CTA                                                                                              |
| `14-navigation`         | `<ActiveWorkoutOverlay>` + `<ActiveWorkoutBar>` mount alongside `<ProfileDrawer>` at `(app)/_layout.tsx`; tab bar height contract from STORY-008                         |

**Unlocks:**

| Downstream spec       | What it can do once 05 lands                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `06-progress-goals`   | Streak engine + PR detection fires on session completion; Home + Progress show "in-progress" indicators when an active session exists |
| `10-trainer-features` | Trainer banner slot accepts `withClient` + `retroactive`; on-behalf session creation routes through the same UI                       |

---

## Open questions

None. All 10 decisions locked at the top. Any ambiguity surfaces as a "**Revised YYYY-MM-DD:**" append.

---

_End of `05-active-session/requirements.md` · 2026-05-27 (rewritten from scratch)_
