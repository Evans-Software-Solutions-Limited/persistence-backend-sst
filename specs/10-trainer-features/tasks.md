# 10 — Trainer Features: Tasks

## Current state (2026-04-19)

**Shipped: 0 of ~40 tasks complete. Not started.**

What's there: nothing trainer-specific. Backend has no trainer/PT endpoints; mobile has no client list, invite flow, or role-gated tabs.

Parent milestone: **M8 Trainer features (role-gated)** — adds `GET /trainers/me/clients`, `GET /trainers/me/invitations/pending`, `POST /trainers/me/invite`, `DELETE /trainers/me/invitations/:id`, `POST /workout-assignments`, `GET /trainers/me/stats` with JWT role check; adds a 6th tab `Clients` conditional on `session.role === "personal_trainer" || "physiotherapist"`, `ClientsContainer` + presenter, invite sheet, assign-workout flow. The 6-tab layout is short-term; M11 revisits navigation when nutrition + trainer features both land.

## Phase 1: Domain

- [ ] Create `PTClientRelationship`, `PTRelationshipStatus` models
- [ ] Create `WorkoutAssignment`, `AssignmentStatus` models
- [ ] Write model tests

## Phase 2: Ports & Adapters

- [ ] Extend `ApiPort` with trainer/client methods
- [ ] Implement in SST API adapter
- [ ] Implement in-memory adapter for tests
- [ ] Write adapter tests

## Phase 3: Application Layer

- [ ] Create `GetClientsQuery`
- [ ] Create `InviteClientCommand`
- [ ] Create `RespondToInvitationCommand`
- [ ] Create `GetClientDetailQuery` (profile + sessions + progress)
- [ ] Create `AssignWorkoutCommand`
- [ ] Create `GetAssignmentsQuery`
- [ ] Write tests

## Phase 4: UI — Client List

- [ ] Create `ClientCard` presenter (name, avatar, status, last active)
- [ ] Create `ClientListPresenter` (list with filter tabs, empty state)
- [ ] Create `ClientListContainer` (fetches clients)
- [ ] Create `app/(app)/(tabs)/clients.tsx` screen (conditionally shown)
- [ ] Write tests

## Phase 5: UI — Invite Client

- [ ] Create `InviteClientPresenter` (email input, send button, invite link)
- [ ] Create `InviteClientContainer` (invite flow)
- [ ] Write tests

## Phase 6: UI — Client Detail

- [ ] Create `ClientDetailPresenter` (profile summary, recent sessions, progress, goals)
- [ ] Create `ClientDetailContainer` (fetches client data)
- [ ] Create `app/(app)/clients/[id].tsx` screen
- [ ] Write tests

## Phase 7: UI — Assign Workout

- [ ] Create `AssignWorkoutPresenter` (workout picker, notes, target date, client selector)
- [ ] Create `AssignWorkoutContainer` (form state, assign action)
- [ ] Create `AssignmentCard` component (assignment status, workout name)
- [ ] Write tests

## Phase 8: Client-Side — Accept/Decline Invitation

- [ ] Create invitation notification handler
- [ ] Create accept/decline UI in notifications
- [ ] Display active trainer in profile
- [ ] Display assigned workouts in workout list
- [ ] Write tests

## Phase 9: Role-Based Tab Visibility

- [ ] Conditionally show "Clients" tab for trainer/physio roles
- [ ] Test: regular user doesn't see clients tab
- [ ] Test: trainer sees clients tab
- [ ] Write tests

## Phase 10: Quality Gates

- [ ] All trainer tests pass with 90% coverage
- [ ] Quality gates pass
