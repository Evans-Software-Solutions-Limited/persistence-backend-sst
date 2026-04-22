# 03 — Exercise Library: Requirements

## Overview

Browse, search, filter, and view exercises from the SST backend. Users can also create custom exercises. The exercise library is the foundation for workout building and session logging.

**Backend dependency:** SST exercise endpoints exist. Algolia search wrapper is a future enhancement (SST endpoint serves as fallback).

---

## User Stories

### STORY-001: As a user, I want to browse all available exercises

**Acceptance Criteria:**

- [ ] Exercise list screen with scrollable list
- [ ] Each exercise shows: name, primary muscle group, equipment, category, difficulty
- [ ] Supports pagination (cursor-based or infinite scroll)
- [ ] Loading skeleton while fetching
- [ ] Empty state if no exercises found
- [ ] Data loads from local cache first, refreshes from API in background

### STORY-002: As a user, I want to search exercises by name

**Acceptance Criteria:**

- [ ] Search bar at top of exercise list
- [ ] Debounced search (300ms) to avoid excessive API calls
- [ ] Results update as user types
- [ ] Clear search button
- [ ] "No results" state with suggestion to adjust filters

### STORY-003: As a user, I want to filter exercises by muscle group, equipment, and category

**Acceptance Criteria:**

- [ ] Filter chips/buttons for: muscle group, equipment type, category, difficulty
- [ ] Multiple filters can be active simultaneously
- [ ] Active filters shown as removable chips
- [ ] "Clear all filters" option
- [ ] Filters applied locally on cached data + sent to API for fresh results
- [ ] Muscle groups: chest, back, shoulders, biceps, triceps, legs (quads, hamstrings, glutes, calves), core, full body
- [ ] Equipment: barbell, dumbbell, machine, cable, bodyweight, kettlebell, resistance band, other
- [ ] Categories: strength, cardio, flexibility, balance, plyometric, olympic, mobility

### STORY-004: As a user, I want to view exercise details

**Acceptance Criteria:**

- [ ] Detail screen with: name, description, instructions, primary/secondary muscles, equipment, difficulty
- [ ] Muscle group visual indicator
- [ ] Category and accessibility tags
- [ ] Navigation back to list preserves filter/search state

### STORY-005: As a user, I want to create a custom exercise

**Acceptance Criteria:**

- [ ] "Create Exercise" button accessible from library
- [ ] Form: name (required), description, muscle groups (multi-select), equipment, category, difficulty
- [ ] Validates name uniqueness (client-side warning)
- [ ] Saves to local DB immediately, queues sync to API
- [ ] Custom exercises appear in library alongside standard ones
- [ ] Custom exercises marked with visual indicator

### STORY-006: As a user, I want my exercise library to work offline

**Acceptance Criteria:**

- [ ] Exercises cached locally in SQLite
- [ ] Full library browsable without network
- [ ] Search and filter work on cached data
- [ ] New custom exercises saved offline, synced when online
- [ ] Stale data indicator shown when cache is old (>24 hours)

---

## Milestone-scoped Acceptance Criteria (numbered)

ACs below are numbered so commit footers and PR descriptions can trace
implementation to a specific criterion (e.g. `AC 7.3`). Append-only.

### M0 — Integration baseline (backend track)

Parent milestone: [`specs/milestones/M0-integration-baseline/BRIEF.md`](../milestones/M0-integration-baseline/BRIEF.md)

- **AC 7.3** — An authenticated user can `POST /exercises` with a valid
  payload. The backend sets `created_by` to the caller's `sub` from the
  JWT (never trusted from the body) and returns `201 { data: ApiExercise }`.
  Missing/invalid JWT returns `401`. Validation failures return `400`.

- **AC 7.4** — The creator of an exercise can `PATCH /exercises/:id` to
  partially update any subset of fields; unset fields are untouched.
  Response is `200 { data: ApiExercise }`. A non-creator calling PATCH
  on an existing exercise receives `404` (not `403`) to avoid leaking
  the existence of other users' customs. Non-existent id also returns
  `404`.

- **AC 7.5** — The creator of an exercise can `DELETE /exercises/:id`
  and receive `204 No Content`; the row is hard-deleted. A non-creator
  receives `404`. There is no soft-delete / `deleted_at` semantics in
  M0.

- **AC 7.6** — `GET /exercises` accepts repeated-key array query params
  (`?targeted_muscles_any=<uuid>&targeted_muscles_any=<uuid>`). Values
  within a single axis OR-match; values across different axes (muscles,
  equipment, difficulty, category) AND-match. Multi-select filters return
  the correct subset end-to-end.

- **AC 7.7** — `GET /exercises?created_by=<value>` accepts the enum
  strings `"mine" | "system" | "pt" | "physio" | "all"` (NOT user UUIDs).
  The backend translates each value into the documented subquery. Values
  `"mine"`, `"pt"`, `"physio"` require a valid JWT — otherwise return
  `400`. `"system"` and `"all"` are public. Multiple values union
  together.

- **AC 7.8** — The visibility predicate is always applied on `GET /exercises`
  (list) and `GET /exercises/:id` (detail), regardless of filter:
  a caller sees a row iff `created_by IS NULL` OR `created_by = sub`
  OR `created_by IN (active trainer_ids for sub from pt_client_relationships
WHERE is_ai_trainer = false)`. Other users' customs are never returned.
  Attempting `GET /exercises/:id` on an invisible row returns `404`.

- **AC 7.9** — Reference-list endpoints (`GET /exercises/muscle-groups`,
  `/equipment`, `/categories`) return the shapes documented in
  `design.md § Reference-list endpoints`. `equipment` emits
  `display_name: null` (no DB column); `categories` continues to return
  `{ data: string[] }` as an M0 shim with the real catalog table
  deferred.

### M0 — Integration baseline (frontend track)

Parent milestone: [`specs/milestones/M0-integration-baseline/BRIEF.md`](../milestones/M0-integration-baseline/BRIEF.md)

AC 7.10 onward covers the mobile track — reference-list cache,
hierarchical modal port, filter wire format, sync-queue mapping,
delete UX port, and the `__DEV__` creator hook.

- **AC 7.10** — On the first Exercises-tab open per app session, the
  mobile client fetches the three reference lists (muscle groups,
  equipment, categories) from the backend and caches them in SQLite
  in the `reference_lists` table. Subsequent tab opens read from the
  cache synchronously (no network) unless the cache is older than 24
  hours, in which case a background refresh fires while the cached
  values render.

- **AC 7.11** — The filter modal is a nested stack: a section list
  of four axes (Muscle Groups, Equipment, Difficulty, Created By);
  each axis navigates to its own detail screen; Muscles and Equipment
  detail screens include a search bar; Difficulty and Created By do
  not. The component hierarchy is ported 1:1 from
  `persistence-mobile/components/exercises/` (no structural redesign).

- **AC 7.12** — A sticky "Show N exercises" Apply bar persists at the
  bottom of the filter modal across child-route navigation; its count
  updates live as the user toggles selections in any axis. Tapping
  Apply commits the diff to the list's filter state and dismisses
  the modal.

- **AC 7.13** — `SSTApiAdapter.buildExerciseQueryParams` sends the
  backend-shaped filter: `q`, `category[]`, `difficulty_level[]`,
  `targeted_muscles_any[]` (UUIDs via reference cache), `equipment_any[]`
  (UUIDs via reference cache), `created_by[]` (enum strings unchanged),
  `limit`, `offset`. Repeated-key array format. The cursor param is
  dropped; `refreshExerciseCache` walks via offset.

- **AC 7.14** — The reference-list cache renders when the device is
  offline. After one successful online fetch, the filter modal and
  any cache-consuming hook render the cached entries without network.

- **AC 7.15** — `createExerciseCommand` enqueues the sync-queue entry
  with a wire-format (snake_case) payload: `difficulty_level`,
  `primary_muscles` (UUID[]), `equipment_required` (UUID[]), etc.
  An offline create flushes successfully to `POST /exercises` on
  reconnect without further mapping. Missing cache mappings cause
  the enqueue to error upstream; the queue never holds a broken
  payload.

- **AC 7.16** — The V2 `Exercise` domain model gains `videoUrl` and
  `thumbnailUrl`. The ported legacy exercise card renders `thumbnailUrl`
  when present. Legacy-but-unused backend fields (`region_type`,
  `movement_type`, accessibility\_\*, `is_public`, `secondary_muscles`)
  are accepted at the adapter boundary but not projected into the
  V2 domain model in M0.

- **AC 7.17** — A delete from the exercise list is triggered by the
  legacy-pattern affordance (long-press / three-dot menu) and shows
  a destructive `Alert.alert` confirm ("Are you sure you want to
  delete {name}? This action cannot be undone.") with Cancel /
  Delete. On confirm the app calls `DELETE /exercises/:id` and
  invalidates the local cache on success. UX ported 1:1 from
  `persistence-mobile`.

- **AC 7.18** — A minimal `__DEV__`-gated creator form exists at
  `app/(app)/exercises/create.tsx` with fields for name + primary
  muscle + equipment, enough to exercise `POST /exercises` against
  `bun run dev` for the M0 smoke test. The real creator ships in M5;
  this is a smoke-test enabler only.
