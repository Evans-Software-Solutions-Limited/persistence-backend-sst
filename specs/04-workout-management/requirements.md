# 04 — Workout Management: Requirements

## Overview

CRUD operations for workouts: create workout templates with exercises, configure sets/reps targets, support supersets, manage visibility (private/friends/public). Workouts are templates that get instantiated as sessions.

---

## User Stories

### STORY-001: As a user, I want to see my list of workouts

**Acceptance Criteria:**

- [ ] Workout list screen showing all user's workouts
- [ ] Each workout shows: name, exercise count, estimated duration, last performed date
- [ ] Sort by: recently created, recently performed, alphabetical
- [ ] Loading from local cache first, background API refresh
- [ ] Empty state with "Create your first workout" CTA

### STORY-002: As a user, I want to create a new workout

**Acceptance Criteria:**

- [ ] Create workout form: name (required), description (optional)
- [ ] Add exercises from exercise library (navigates to picker, returns selected)
- [ ] For each exercise: configure target sets, target reps, target weight (optional)
- [ ] Reorder exercises via drag-and-drop
- [ ] Remove exercises from workout
- [ ] Save creates workout locally and queues API sync
- [ ] Validation: name required, at least 1 exercise

### STORY-003: As a user, I want to group exercises into supersets

**Acceptance Criteria:**

- [ ] Select 2+ exercises to group as a superset
- [ ] Superset visually grouped in the workout view
- [ ] Exercises in a superset share the same set count
- [ ] Can ungroup a superset
- [ ] Superset order within workout is maintained

### STORY-004: As a user, I want to edit an existing workout

**Acceptance Criteria:**

- [ ] Edit button on workout detail/list
- [ ] Same form as create, pre-populated with current data
- [ ] Can add/remove/reorder exercises
- [ ] Can modify set/rep targets
- [ ] Changes saved locally and synced

### STORY-005: As a user, I want to delete a workout

**Acceptance Criteria:**

- [ ] Delete button with confirmation dialog
- [ ] Soft delete (marked as deleted, synced to API)
- [ ] Removes from workout list immediately
- [ ] Associated sessions remain (historical data preserved)

### STORY-006: As a user, I want to control who can see my workouts

**Acceptance Criteria:**

- [ ] Visibility setting on workout: private (default), friends, public
- [ ] Private: only owner can see
- [ ] Friends: owner + friends can see
- [ ] Public: anyone can view (only owner can edit)
- [ ] Visibility changeable after creation

### STORY-007: As a user, I want to view workout details

**Acceptance Criteria:**

- [ ] Detail screen showing: name, description, exercises with targets
- [ ] Supersets visually indicated
- [ ] "Start Workout" button (navigates to active session)
- [ ] Edit and delete options
- [ ] Last performed date and session count

### STORY-008: As a user, I want my workouts available offline

**Acceptance Criteria:**

- [ ] All user workouts cached locally
- [ ] Create/edit/delete work offline (queued for sync)
- [ ] Workout list browsable without network
