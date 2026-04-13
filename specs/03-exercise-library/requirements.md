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
