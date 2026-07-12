# Workout Authoring v2 — smoke test (e2e gate)

> Gates merge of the milestone to `main`. Pairs with `requirements.md`
> (D1–D8) + `design.md`. Split into CI-gateable-now (mocked, both PRs #203
> backend + #204 mobile) vs on-device (needs a fresh EAS dev build).

## A. CI-gateable now (no external setup)

1. **Full gate green:** `bun run prettier:check && bun run typecheck &&
bun run lint && bun run build && bun run test:unit` (backend/core) and the
   mobile jest suite with ≥90% coverage on changed files.
2. **New column, additive:** the `workouts.show_in_owner_library` migration is
   idempotent (`ADD COLUMN IF NOT EXISTS … NOT NULL DEFAULT true`); every
   pre-existing + athlete-authored workout reads back `true`.
3. **List filter is opt-in + athlete-safe:** `GET /workouts?type=mine` with no
   `ownerLibraryOnly` is byte-identical to before; `ownerLibraryOnly=true` adds
   `show_in_owner_library = true` to the `mine` WHERE only (`assigned`/`default`
   untouched). Quota still counts ALL authored workouts (display-only filter).
4. **History aggregation:** `GET /workouts/:id/history` returns
   `{completedCount, lastCompletedAt, avgDurationSeconds, lastSession}` scoped
   to `user_id = me`; never-done → `completedCount:0` + nulls, HTTP 200;
   `canRead` false → 404 (no existence leak). PgDialect render test asserts the
   `user_id` / `workout_id` / `status='completed'` predicates + the
   `weight_kg * reps` volume term.
5. **Two-user isolation:** user B's completed sessions never appear in user A's
   `/workouts/:id/history`.
6. **Create/update persist the flag:** `POST /workouts` with
   `showInOwnerLibrary:false` persists false (absent → true); PATCH only writes
   the flag when present (no clobber on a partial update).
7. **Trainer caps (D8):** the seeded trainer tiers (`individual_trainer`,
   `small_business`, `medium_enterprise`) resolve `workout_limit === null` and
   `assertEntitlement(create_workout)` allows regardless of count.

### Mobile (mocked)

8. **Coach create de-crowds the personal list:** a coach creates a workout with
   **"Show in my workouts" OFF** → it does NOT appear in the coach's personal
   My Workouts / Home carousel (both consume `useWorkouts`, which sends
   `ownerLibraryOnly` for a trainer) → but IS assignable (AssignWorkoutSheet
   lists all authored workouts, unfiltered).
9. **Athlete unchanged:** a regular athlete's create path renders the Visibility
   tri-state (default private), no owner-visibility toggle, and sends
   `showInOwnerLibrary` true → their My Workouts is unaffected.
10. **Coach Workout library:** the coach-gated `workouts/library` screen lists
    the coach's authored workouts UNFILTERED (owner-visible or not); a non-coach
    deep-linking there is redirected to the tabs index; Create CTA opens the
    creator in coach context; tap → edit in coach context.
11. **Detail hero + history:** the v3 hero renders (equipment eyebrow or plain
    "WORKOUT", duration/exercises/total-sets, muscle pills); the history block
    renders only when `completedCount > 0`, otherwise the quiet "Not done yet"
    empty state — never zeros-as-data; no "Not done yet" flash before the fetch
    resolves.
12. **Superset parity:** the centred SUPERSET-letter pill renders in both the
    creator/editor and the detail, and letters stay in sync (lone-member groups
    render as singles in both).
13. **Create-and-assign (Client Detail):** the "Create" quick action opens the
    creator in coach context; on save it creates the workout online then
    ad-hoc-assigns it to the client; if the assign call fails the created
    workout is KEPT and the failure surfaced (retryable from AssignWorkoutSheet).

## B. On-device (needs a fresh EAS dev build)

Requires an EAS dev build signed into a trainer account with ≥1 client.

14. **Coach OFF-library create → assign → athlete sees it:** coach builds a
    workout with the toggle OFF, assigns it to a client; it's absent from the
    coach's own My Workouts but the client sees the assigned workout, and the
    coach can still find/assign it from the library + AssignWorkoutSheet.
15. **Personal list de-crowded on device:** a trainer who has authored several
    client-only workouts sees only their owner-visible ones in the Home
    carousel and My Workouts.
16. **Detail history is real:** complete a workout twice on device → the detail
    history block shows COMPLETED 2×, a sensible LAST DONE / AVG TIME, and the
    last-session recap (volume in kg, minutes).
17. **Editor toggle round-trip:** a coach flips "Show in my workouts" on an
    existing workout in the editor → it appears/disappears from their personal
    list after the PATCH syncs.
18. **Create-and-assign on device:** from Client Detail → Create → save → the
    ad-hoc assignment lands in the client's upcoming sessions.

## Done

A1–A13 green to merge the milestone branch. B14–B18 verified on a TestFlight/dev
build (Brad runs EAS). Item 8 (coach OFF-library create stays assignable but
off the personal list) is the headline behaviour of this milestone.
