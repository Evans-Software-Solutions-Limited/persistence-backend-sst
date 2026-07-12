# Workout Authoring v2 — Tasks

> **Authored 2026-07-12.** Pairs with `requirements.md` + `design.md`. Execution:
> **backend PR lands first, then mobile PR** (mobile consumes the new column +
> history endpoint). Every backend PR runs the full gate (`prettier:check`,
> `typecheck`, `lint`, `build`, `test:unit` ≥ 90% on changed repos/services);
> the mobile PR runs the mobile gate from repo root. Run the `inspector-brad`
> subagent on the full branch diff before **each** PR; fix all findings; note
> `🕵️ Inspector Brad (local): clean @ <sha>` in the PR body. Do **not** fire the
> `@inspector-brad` CI action.

---

## Phase A — Backend (PR 1)

- [ ] **T-A.1** Migration
      `supabase/migrations/<ts>_workouts_show_in_owner_library.sql` —
      `ALTER TABLE workouts ADD COLUMN IF NOT EXISTS show_in_owner_library
boolean NOT NULL DEFAULT true;` (header comment per design §1; timestamp
      after the newest applied migration at authoring time).
- [ ] **T-A.2** `schema.ts` mirror: add `showInOwnerLibrary` boolean notNull
      default(true) to `workouts`; regenerate/adjust derived `Workout` types.
- [ ] **T-A.3** List filter: add `ownerLibraryOnly` to the `GET /workouts` query
      schema + `WorkoutRepository.list`/`buildListWhereClause` `mine` branch
      (design §2). `assigned`/`default`/quota unchanged.
- [ ] **T-A.4** Create/update persist: `showInOwnerLibrary` in the create body
      schema + `createWithExercises` (default `true` when absent); accept +
      persist in the update handler + `WorkoutRepository.update` (present-only,
      no clobber).
- [ ] **T-A.5** History endpoint `GET /workouts/:id/history` (design §4):
      `canRead`-gated (404 on !canRead), scoped `user_id = me`; aggregate +
      last-session + last-session-volume; `WorkoutHistory` DTO; empty state
      (count 0 / nulls, HTTP 200). Mount next to `GET /workouts/:id`.
- [ ] **T-A.6** Tests — repo/service ≥ 90%:
  - list `ownerLibraryOnly` true/false × mine (owner-visible only vs all);
    assigned/default unaffected; quota still counts all created.
  - create default `true` when omitted; create/update persist explicit
    `false`/`true`; update present-only (no clobber).
  - history: completed-count/avg/last-session/volume correctness; empty state;
    **two-user isolation** (my history never includes another user's sessions of
    the same workout); !canRead → 404.
  - **PgDialect render guard** on the history SQL (user_id + workout_id +
    `status='completed'` predicates + `weight_kg * reps` volume term).
  - **Caps guard (D8):** trainer tiers resolve `workout_limit === null` and
    `assertEntitlement(create_workout)` allows a trainer at any count.
- [ ] **T-A.7** Gates green; `inspector-brad` clean; open backend PR (note IB sha,
      `⚠ PROD migration manual` — staging auto-applies on merge).

## Phase B — Mobile (PR 2, off backend PR merged / on the shared branch)

- [ ] **T-B.1** API port + adapters + domain (design §12): `ownerLibraryOnly` on
      `getWorkouts`; `showInOwnerLibrary` on create/update inputs + `Workout`;
      new `getWorkoutHistory` + `WorkoutHistory` model; SST + InMemory adapters.
- [ ] **T-B.2** Data layer: `workouts.query.ts` + StoragePort — `ownerLibraryOnly`
      in the `mine` cache key; `getCachedWorkoutHistory`/`cacheWorkoutHistory`
      slots; commands thread `showInOwnerLibrary`.
- [ ] **T-B.3** Creator v3 (`WorkoutCreatorPresenter` + `ExerciseConfigCard`):
      add the Visibility tri-state; matched superset styling (centred SUPERSET
      {letter} pill + connector + keep 3px left accent + shared sets/rest);
      preserve all legacy behaviours. Match `workout-creator.jsx` 1:1.
- [ ] **T-B.4** Owner-visibility toggle (coach-context only) in creator + editor;
      creation-context (`ctx=coach`) drives render + default `false`; athlete
      context sends `true`, no toggle. Editor applies matched superset styling +
      the toggle.
- [ ] **T-B.5** Detail v3 (`WorkoutDetailPresenter` + container): hero
      (equipment/name/duration·exercises·total-sets + muscle pills via
      `classifyWorkoutSplit`; omit equipment token if unavailable); history block
      via `useWorkoutHistory` with clean empty state; matched superset styling;
      Start/nav unchanged. Match `workout-detail.jsx` 1:1.
- [ ] **T-B.6** Personal My Workouts branch: `WorkoutsListContainer` reads
      `isTrainerEligible` (`useUserMode`) → `ownerLibraryOnly=true` for trainers;
      regular athletes unchanged.
- [ ] **T-B.7** Coach Workouts library screen: coach-gated route (redirect
      pattern), coach-library variant (unfiltered `mine` + templates, Create CTA,
      tap→edit); "Workout library" entry in the coach You section.
- [ ] **T-B.8** Client Detail "Create & assign workout": creator in coach context
      → create then ad-hoc `assignClientWorkout`; surface assign errors, keep the
      created workout on partial failure.
- [ ] **T-B.9** Mobile tests (≥ 90%): creator Visibility + superset render +
      toggle-in-coach-context-only; detail hero/history/empty-state; list
      trainer-filter vs athlete-unchanged; coach-library gating + unfiltered
      list; create+assign happy path + assign-fails-keeps-workout; any new pure
      formatter (relative date / volume) unit-tested.
- [ ] **T-B.10** Mobile gate green; `inspector-brad` clean; open mobile PR
      (note IB sha; on-device verify flagged as outstanding — needs an EAS dev
      build; UI-fidelity check vs prototype).

## Phase C — Close-out

- [ ] **T-C.1** Update `STATE.md` (shipped slices, manual prod migration, device
      verify outstanding) + the `project_workout_authoring_v2` memory.
- [ ] **T-C.2** Slack ping on each PR up + merge.

---

## Open flags for Brad (non-blocking, surface in the PRs)

1. **Equipment token** on the detail hero has no mobile DTO source today — v1
   derives from cached exercises and omits the token if absent. Confirm, or greenlight
   a DTO/exercise-cache extension in a follow-up.
2. **Coach library entry placement** (You section) is not prototype-specified —
   confirm the location.
3. **Relative-date / volume-unit** copy on the history block is reversible.
