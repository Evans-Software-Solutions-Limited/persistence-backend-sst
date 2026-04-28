# 04 — Workout Management: Requirements

## Overview

CRUD operations for workouts: create workout templates with nested exercises, configure sets/reps targets, support supersets, manage visibility (private/friends/public). Workouts are templates that get instantiated as sessions. M2 ships the surface end-to-end against the V2 SST backend; M3 wires the active-session execution surface on top.

---

## User Stories

### STORY-001: As a user, I want to see my list of workouts

**Acceptance Criteria:**

- 1.1 [ ] Workouts tab renders three sections: **Mine** (`createdBy = me`), **Assigned** (PT-assigned via `workout_assignments`), **Default** (`visibility = public` and not mine)
- 1.2 [ ] Each `WorkoutCard` shows: name, exercise count, estimated duration, target muscles (icons), required equipment (icons)
- 1.3 [ ] Card actions: tap → popover with workout detail; "Start" CTA (M3 stub in M2); "Edit" (owner only); "Delete" (owner only with confirmation)
- 1.4 [ ] Sections are expandable / collapsible; collapse state is local to the screen instance
- 1.5 [ ] Search bar filters across all three sections by workout name (case-insensitive substring)
- 1.6 [ ] Loading from local cache first, background API refresh; cache TTL 5 min
- 1.7 [ ] Empty state: per-section "No workouts yet" copy with a "Create your first workout" CTA on the Mine section
- 1.8 [ ] Pull-to-refresh refetches all three section calls in parallel; bypasses TTL
- 1.9 [ ] Quota indicator: when the user has a `workout_limit`, render `WorkoutLimitIndicator` with `used / limit`; tap routes to `/coming-soon` (M10)

### STORY-002: As a user, I want to create a new workout

**Acceptance Criteria:**

- 2.1 [ ] `Create` CTA on the Workouts tab navigates to `/workouts/create` (modal stack)
- 2.2 [ ] Form fields: name (required, non-empty after trim), description (optional), estimated duration (number, default 30, editable)
- 2.3 [ ] Add exercises via `AddExercisePopover` bottom sheet — searches the M0 exercise library, supports multi-select with checkboxes
- 2.4 [ ] Picker has two action CTAs: **Add as exercises** (each selected exercise added with its own `supersetGroup = null`) and **Add as superset** (all selected exercises share a new `supersetGroup`, requires ≥2 selections)
- 2.5 [ ] Exercises in the form render as `ExerciseConfigCard`s with editable `targetSets`, `targetRepsMin`–`targetRepsMax`, `restSeconds`. `targetSets` and `restSeconds` on superset peers are visually disabled and mirror the lead exercise's values
- 2.6 [ ] Editing `targetSets` or `restSeconds` on the lead exercise of a superset propagates to all peers (`propagateSupersetSharedFields` pure function)
- 2.7 [ ] Remove a single exercise from the form deletes that row; removing the lead of a superset promotes the next peer (or ungroups if only one peer remains)
- 2.8 [ ] Reorder is implicit on add (newest exercise appended to the end with `sortOrder = max + 1`); explicit drag-and-drop reorder is M11 polish
- 2.9 [ ] Validation on submit: name required + non-empty; ≥1 exercise; `targetRepsMin <= targetRepsMax`; `targetSets >= 1` when set
- 2.10 [ ] Submit posts a single `POST /workouts` with the full nested `exercises[]`; backend transaction guarantees atomic create
- 2.11 [ ] On success, navigates back to the Workouts tab and the new workout appears under Mine; cache is updated optimistically with the server-returned row
- 2.12 [ ] Dirty-form back-navigation prompts a "Discard changes?" confirmation; clean-form back-nav navigates without prompt

### STORY-003: As a user, I want to group exercises into supersets

**Acceptance Criteria:**

- 3.1 [ ] Picker's "Add as superset" CTA assigns a new monotonic `supersetGroup` integer to all selected exercises in one batch
- 3.2 [ ] Superset peers render visually grouped — connector lines between adjacent peers, a badge with the group number, peer-shared fields (`targetSets`, `restSeconds`) shown on the lead row only
- 3.3 [ ] Ungroup-superset action available on the lead row's overflow menu; sets `supersetGroup = null` on every peer
- 3.4 [ ] A workout can have multiple distinct supersets; group integers are unique within a workout but not across workouts

### STORY-004: As a user, I want to edit an existing workout

**Acceptance Criteria:**

- 4.1 [ ] Edit CTA on a `WorkoutCard` (owner only) navigates to `/workouts/[id]/edit` (modal stack)
- 4.2 [ ] Editor shows the same form as the creator, pre-populated with the workout's current state (name / description / estimatedDurationMinutes / exercises with their `id`s preserved for traceability, though the backend full-replaces on submit)
- 4.3 [ ] Initial fetch shows a `PLogoDrawLoader` full-screen until the detail call returns; on error, an `ErrorState` with retry
- 4.4 [ ] Add / remove / reorder / regroup exercises behaves identically to the creator
- 4.5 [ ] Submit fires `PATCH /workouts/:id` with `{ name, description, estimatedDurationMinutes, exercises[] }`; backend full-replaces the junction rows in a transaction
- 4.6 [ ] On success, the cached detail + cached list rows update; navigates back to the Workouts tab
- 4.7 [ ] Dirty-form discard confirmation only fires if the form was actually edited (avoid spurious prompts on read-only navigation)
- 4.8 [ ] Non-owner attempting to navigate to the edit URL sees a 404 / forbidden state (defense-in-depth; the UI shouldn't surface the route)

### STORY-005: As a user, I want to delete a workout

**Acceptance Criteria:**

- 5.1 [ ] Delete action on `WorkoutCard` (owner only) shows a confirmation dialog with the workout name
- 5.2 [ ] Confirm fires `DELETE /workouts/:id`; FK cascade on `workout_exercises.workoutId` cleans up junction rows
- 5.3 [ ] Sessions with this `workoutId` get `workoutId = NULL` (FK `onDelete: set null`); historical session data is preserved
- 5.4 [ ] On success, the row vanishes from the list and the cached list / detail rows are removed
- 5.5 [ ] Soft-delete (mark deleted + retain row for analytics) is **deferred** — see tasks.md for the follow-up rationale

### STORY-006: As a user, I want to control who can see my workouts

**Acceptance Criteria:**

- 6.1 [ ] Visibility setting on workout: `private` (default), `friends`, `public`
- 6.2 [ ] Private: only owner can see (GET returns 404 for non-owner)
- 6.3 [ ] Friends: owner + accepted friends can see (bidirectional `friendships.status = 'accepted'`)
- 6.4 [ ] Public: anyone authenticated can view (read-only); only owner can edit / delete
- 6.5 [ ] Visibility changeable via PATCH; M2 frontend exposes it in the editor (selector); creator defaults to private
- 6.6 [ ] Default-tab list (`type=default`) excludes the user's own public workouts (those show under Mine)

### STORY-007: As a user, I want to view workout details

**Acceptance Criteria:**

- 7.1 [ ] Tap a `WorkoutCard` opens `WorkoutPopover` modal with the full workout detail (name, description, exercises with targets, supersets visually grouped)
- 7.2 [ ] "Start Workout" CTA in popover (M3 wiring; M2 routes to `/coming-soon` placeholder)
- 7.3 [ ] Owner sees Edit and Delete CTAs; non-owner sees neither
- 7.4 [ ] Popover dismisses via tap-outside, swipe-down, or back button

### STORY-008: As a user, I want my workouts available offline

**Acceptance Criteria:**

- 8.1 [ ] All three list-section payloads cached locally in `cached_workouts` (scoped by `userId` + `type`)
- 8.2 [ ] Detail payloads cached in `cached_workout_detail` (scoped by `userId` + `workoutId`); populated on first detail open + refreshed on each list refetch
- 8.3 [ ] Create / edit / delete behave optimistically: form submit returns immediately, write enqueues into the sync queue, server-issued IDs replace client-issued temp UUIDs on sync
- 8.4 [ ] Workouts tab browsable without network: cached payload renders, "last synced" caption shows; pull-to-refresh fails gracefully and preserves the cache
- 8.5 [ ] Sync-failure surface: persistent banner on the Workouts tab when a queued mutation fails after retries, with a manual "Retry sync" CTA

### STORY-009: As an authenticated user, my workouts are isolated from other users

**Acceptance Criteria (data isolation — non-negotiable):**

- 9.1 [ ] `GET /workouts?type=mine` for user A never returns user B's workouts (verified in two-user repository test)
- 9.2 [ ] `GET /workouts/:id` of user A's private workout by user B returns 404 (verified in handler test)
- 9.3 [ ] `PATCH /workouts/:id` of user A's workout by user B returns 404 (verified in handler test)
- 9.4 [ ] `DELETE /workouts/:id` of user A's workout by user B returns 404 (verified in handler test)
- 9.5 [ ] `friends`-visibility workout of user A is visible to user B iff a row in `friendships` exists with `(A, B)` or `(B, A)` and `status = 'accepted'`
