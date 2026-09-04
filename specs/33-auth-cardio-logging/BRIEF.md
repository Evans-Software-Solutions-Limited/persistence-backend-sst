# Auth usability and cardio/activity logging

Status: approved for implementation from user feedback on 2026-09-04.

## Outcomes

1. Password entry is inspectable and signup never leaves a user guessing why
   two hidden values do not match.
2. Cardio is a first-class exercise category that records elapsed time and
   distance, including indoor and outdoor runs.
3. Plyometric exercises use reps plus optional measured jump distance instead
   of being forced through a weight-only row.
4. A workout can be logged for a past date.
5. Completed-workout and exercise-detail surfaces show the relevant cardio
   values and personal records.

## Locked decisions

- Password, confirm-password, sign-in, and reset-password fields have an
  accessible Show/Hide control. Password values are still compared exactly;
  passwords are not trimmed or silently rewritten.
- Signup shows live neutral/match/mismatch guidance after confirmation entry.
- Exercise category drives the logging row:
  - `strength` and other non-cardio/non-plyometric categories: reps + weight;
  - `cardio`: duration + distance;
  - `plyometric`: reps + jump distance.
- Canonical storage remains seconds and metres. Metric users see km/cm;
  imperial users see miles/inches. No unit-dependent values are persisted.
- A cardio distance is optional so time-only activities (bike, rower, circuits)
  can be logged. A duration is required to finish a cardio set.
- A plyometric distance is optional so ordinary rep-counted jumps remain
  loggable. Reps are required to finish a plyometric set.
- `indoor` / `outdoor` and a free-text location name are optional session-level
  metadata. GPS coordinates, route maps, automatic location lookup, and
  background tracking are out of scope.
- Retrospective logging is launched from Train > Workouts, selects a past
  completion date and duration, and records a completed session through the
  existing offline-first session path.
- Cardio PRs are exercise-scoped:
  - `longest_distance`: greatest completed-set distance in metres;
  - `best_time`: shortest positive duration for the same exercise only when a
    distance is present. This first slice does not compare unlike fixed-distance
    race efforts or claim a pace PR.
- Exercise detail shows strength PRs/estimates for strength exercises and
  longest-distance / best-time values for cardio when available.

## Acceptance criteria

- All password controls retain focus/value when toggled and expose an
  accessibility label describing the next action.
- Creating or editing a custom exercise can choose Strength, Cardio, or
  Plyometric; muscle selection is not required for Cardio.
- Active-session rows write `durationSeconds` / `distanceMeters` through the
  existing commands, sync payload, API, and database columns.
- Finish validation accepts a valid cardio or plyometric set and continues to
  reject an entirely empty workout.
- Session metadata survives SQLite rehydration and bulk-record sync.
- Backdated timestamps cannot be in the future and completion cannot precede
  start.
- Summary/history formatting never labels seconds or metres as kilograms.
- Existing strength logging and PR behaviour remain unchanged.

## Quality gates

Focused regression tests, repository formatting, typecheck, lint, build, and
unit tests. Render and visually inspect every changed mobile surface before
handoff.
