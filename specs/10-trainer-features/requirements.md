# 10 — Trainer Features: Requirements

## Overview

Personal trainer (PT) and physiotherapist features: manage clients, assign workouts, view client progress. Only users with `personal_trainer` or `physiotherapist` role see these features.

**Backend dependency:** Trainer/client relationship endpoints and workout assignment endpoints in SST API.

---

## User Stories

### STORY-001: As a trainer, I want to see my client list

**Acceptance Criteria:**

- [ ] "Clients" tab visible only for trainer/physio roles
- [ ] Client list with: name, avatar, last active date, relationship status
- [ ] Filter: active, pending, inactive clients
- [ ] Empty state with "Invite a client" CTA

### STORY-002: As a trainer, I want to invite clients

**Acceptance Criteria:**

- [ ] Invite by email or shareable invite link
- [ ] Invitation creates pending PT-client relationship
- [ ] Client receives notification of invitation
- [ ] Client can accept or decline

### STORY-003: As a client, I want to accept or decline a trainer invitation

**Acceptance Criteria:**

- [ ] Notification for new trainer invitation
- [ ] Accept: relationship becomes active, trainer gains read access
- [ ] Decline: relationship removed
- [ ] View active trainer relationship in profile

### STORY-004: As a trainer, I want to view a client's workout history and progress

**Acceptance Criteria:**

- [ ] Tap client to see their profile summary
- [ ] View client's recent sessions
- [ ] View client's measurements and progress
- [ ] View client's active goals
- [ ] Read-only access (trainer cannot edit client data directly)

### STORY-005: As a trainer, I want to assign workouts to clients

**Acceptance Criteria:**

- [ ] Select workout from trainer's library
- [ ] Assign to one or more clients
- [ ] Assignment includes optional notes and target date
- [ ] Client sees assigned workout in their workout list
- [ ] Assignment status: assigned, in_progress, completed
- [ ] Client notification on new assignment

### STORY-006: As a trainer, I want to manage client relationships

**Acceptance Criteria:**

- [ ] Remove client (terminates relationship)
- [ ] View relationship status (pending, active, inactive)
- [ ] Cannot access client data after relationship terminated
