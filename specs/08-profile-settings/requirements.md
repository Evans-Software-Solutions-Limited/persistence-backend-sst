# 08 — Profile & Settings: Requirements

## Overview

User profile management, app preferences, and account settings. Includes fitness profile (height, weight, fitness level, available equipment), display preferences, and account actions.

---

## User Stories

### STORY-001: As a user, I want to view and edit my profile

**Acceptance Criteria:**

- [ ] Profile screen showing: name, email, avatar, role, member since
- [ ] Edit: display name, avatar (photo upload)
- [ ] Fitness profile: height, weight, fitness level (beginner/intermediate/advanced/expert)
- [ ] Available equipment (multi-select: barbell, dumbbell, machine, etc.)
- [ ] Accessibility needs (tags for exercise modifications)
- [ ] Changes saved locally and synced

### STORY-002: As a user, I want to configure app preferences

**Acceptance Criteria:**

- [ ] Theme: system / light / dark
- [ ] Weight unit: kg / lbs
- [ ] Distance unit: km / miles
- [ ] Default rest timer duration
- [ ] Auto-start rest timer toggle
- [ ] Notification preferences (workout reminders, rest timer, PR alerts)
- [ ] Preferences persisted locally (AsyncStorage)

### STORY-003: As a user, I want to manage my account

**Acceptance Criteria:**

- [ ] Change password (for email/password accounts)
- [ ] Sign out (clears session, preserves sync queue)
- [ ] Delete account (confirmation, irreversible, calls API)
- [ ] View subscription status
- [ ] Link to privacy policy, terms of service, help centre

### STORY-004: As a user, I want to see my workout history

**Acceptance Criteria:**

- [ ] Session history list (past completed sessions)
- [ ] Each entry: workout name, date, duration, exercise count
- [ ] Tap to view session detail (sets logged, volume)
- [ ] Filter by date range
- [ ] Cached locally for offline access

### STORY-005: As a user, I want my profile and settings to work offline

**Acceptance Criteria:**

- [ ] Profile viewable from cache
- [ ] Profile edits saved locally, synced when online
- [ ] Preferences always local (no API dependency)
- [ ] Session history cached
