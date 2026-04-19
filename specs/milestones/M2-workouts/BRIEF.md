# M2 — Workouts (list + create + edit) — BRIEF (stub)

Briefs to be authored before milestone starts.

**Parent spec:** [`../../04-workout-management/`](../../04-workout-management/).

**Scope sketch:**

- Backend: verify `GET /workouts` `type=mine|assigned|default` matches legacy; confirm `GET /workouts/:id` includes nested exercises; check if `POST /workouts` accepts a nested exercises array (if not, add `POST /workouts/:id/exercises` batch); confirm `PATCH /workouts/:id` supports nested exercise edits.
- Frontend: `WorkoutsListContainer` + presenter ported from legacy `app/(tabs)/workouts.tsx`; `WorkoutCreatorContainer` + presenter from legacy `app/workout-creator.tsx` (form with `ExercisePicker` sheet reusing list container); `WorkoutEditorContainer`; supersets; sync queue wires writes; offline cache.
- Review gate: create a workout with 3 exercises, delete one from Mine list, edit another, all against the real backend.
