# 05 — Active Session: Tasks

## Current state (2026-04-19)

**Shipped: 0 of ~50 tasks complete on mobile. Not started.**

What's there:

- **Backend** — full session lifecycle exists at `microservices/core/src/application/sessions/` — create, list, get, update, delete, plus nested `sessions/exercises` (create/get/delete) and `sessions/sets` (create/get/update/delete). JWT ownership scoped.
- **Mobile `ApiPort`** declares `getSessions`, `getSession`, `createSession`, `updateSession`, `deleteSession`, `createSet`, `updateSet` stubs.

Nothing else is built: no session domain model, no active-session persistence in SQLite, no rest timer, no set logger, no session-resume flow, no summary screen.

Parent milestone: **M3 Active session (offline-critical)**. Backend brief verifies lifecycle endpoints and decides client-vs-server PR detection; frontend brief is offline-first-heavy — every set persists to SQLite first, syncs on reconnect, app recovers mid-session if backgrounded.

## Phase 1: Domain

- [ ] Create `WorkoutSession`, `SessionExercise`, `ExerciseSet`, `SessionSummary` models
- [ ] Implement `createSessionFromWorkout()` (maps workout exercises to session exercises)
- [ ] Implement `createEmptySession()` (blank session for quick start)
- [ ] Implement `addSetToExercise()`, `completeSet()` (immutable state updates)
- [ ] Implement `substituteExercise()` (preserves old sets, adds new exercise)
- [ ] Implement `addExerciseToSession()` (for quick sessions)
- [ ] Implement `calculateSummary()` (duration, volume, completion stats)
- [ ] Implement `calculateVolume()` (weight x reps per set, summed)
- [ ] Implement `detectPersonalRecords()` (compare against previous records)
- [ ] Write comprehensive tests for all session domain logic

## Phase 2: Ports & Adapters

- [ ] Extend `ApiPort` with session CRUD (create, complete, cancel, get history)
- [ ] Extend `StoragePort` with active session persistence (save/load/clear active session)
- [ ] Implement session SQLite tables (sessions, session_exercises, exercise_sets)
- [ ] Implement active session save/restore in SQLite adapter
- [ ] Write adapter tests

## Phase 3: Application Commands

- [ ] Create `StartSessionCommand` (from workout or empty)
- [ ] Create `LogSetCommand` (saves set to SQLite immediately)
- [ ] Create `CompleteSetCommand` (marks complete, triggers timer)
- [ ] Create `SubstituteExerciseCommand`
- [ ] Create `AddExerciseCommand` (for quick sessions)
- [ ] Create `CompleteSessionCommand` (finalise, summary, queue sync)
- [ ] Create `CancelSessionCommand` (mark cancelled, queue sync)
- [ ] Create `ResumeSessionCommand` (load from SQLite on app open)
- [ ] Write tests for each command

## Phase 4: Rest Timer

- [ ] Create `useRestTimer` hook (countdown, progress, auto-start option)
- [ ] Implement background notification when timer completes
- [ ] Persist timer state for background survival
- [ ] Create `RestTimerDisplay` presenter (countdown ring, skip/extend buttons)
- [ ] Write tests for timer logic

## Phase 5: UI — Active Session

- [ ] Create `SetLogger` component (weight/reps/RPE inputs, complete button)
- [ ] Create `ExerciseProgress` component (sets completed / target)
- [ ] Create `SessionExerciseCard` component (exercise name, sets list, add set)
- [ ] Create `SessionHeader` component (duration timer, exercise nav, progress indicator)
- [ ] Create `QuickFillSuggestion` component (previous session values)
- [ ] Create `ActiveSessionPresenter` (full session screen: header, exercise cards, rest timer)
- [ ] Create `ActiveSessionContainer` (session state, set logging, exercise navigation)
- [ ] Create `app/(app)/session/index.tsx` screen
- [ ] Implement swipe/tap navigation between exercises
- [ ] Write tests for all presenters and container

## Phase 6: UI — Session Summary

- [x] **Decide PR-detection placement: hybrid** — server canonical, client predictive (decided 2026-05-02; see [`specs/milestones/M3-active-session/BACKEND_BRIEF.md`](../milestones/M3-active-session/BACKEND_BRIEF.md) § "PR-detection decision" and `design.md` § "Personal-record detection: hybrid")
  - [ ] Server: implement PR upsert in `sessionsUpdateHandler` when status transitions to `completed`; flag winning sets `is_personal_record = true`
  - [ ] Client: cache `personal_records` slice via `GET /personal-records`; feed quick-fill + Summary screen detection
- [ ] Create `SessionSummaryPresenter` (duration, volume, completion, PRs)
- [ ] Create `SessionSummaryContainer` (computes summary from completed session)
- [ ] Create confirmation dialog (save/discard)
- [ ] Write tests

## Phase 7: Quick Start

- [ ] Create "Quick Start" entry point (creates empty session)
- [ ] Implement add exercise on-the-fly during session
- [ ] Write tests

## Phase 8: Session Recovery

- [ ] Implement active session detection on app launch
- [ ] Create resume prompt UI ("Continue Push Day?" with resume/discard options)
- [ ] Test: close app mid-session, reopen, verify state restored exactly
- [ ] Test: complete session offline, verify queued for sync

## Phase 9: Quality Gates

- [ ] All session tests pass with 90% coverage
- [ ] Quality gates pass
