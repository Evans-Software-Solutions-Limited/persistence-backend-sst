# 10 — Trainer Features: Technical Design

## Domain Models

```typescript
// src/domain/models/trainer.ts
export interface PTClientRelationship {
  id: string;
  trainerId: string;
  clientId: string;
  status: PTRelationshipStatus;
  trainerName: string;
  clientName: string;
  clientAvatarUrl: string | null;
  clientLastActive: string | null;
  createdAt: string;
}

export type PTRelationshipStatus =
  | "pending"
  | "active"
  | "inactive"
  | "terminated";

export interface WorkoutAssignment {
  id: string;
  trainerId: string;
  clientId: string;
  workoutId: string;
  workoutName: string;
  status: AssignmentStatus;
  notes: string | null;
  targetDate: string | null;
  assignedAt: string;
  completedAt: string | null;
}

export type AssignmentStatus = "assigned" | "in_progress" | "completed";
```

## Port Extensions

```typescript
// ApiPort
getClients(): Promise<Result<PTClientRelationship[], ApiError>>;
inviteClient(email: string): Promise<Result<PTClientRelationship, ApiError>>;
respondToInvitation(relationshipId: string, accept: boolean): Promise<Result<void, ApiError>>;
terminateRelationship(relationshipId: string): Promise<Result<void, ApiError>>;
getClientProfile(clientId: string): Promise<Result<UserProfile, ApiError>>;
getClientSessions(clientId: string): Promise<Result<WorkoutSession[], ApiError>>;
getClientProgress(clientId: string): Promise<Result<{ measurements: BodyMeasurement[]; goals: Goal[]; records: PersonalRecord[] }, ApiError>>;
assignWorkout(data: { clientId: string; workoutId: string; notes?: string; targetDate?: string }): Promise<Result<WorkoutAssignment, ApiError>>;
getAssignments(clientId?: string): Promise<Result<WorkoutAssignment[], ApiError>>;
```

## UI Components

```
containers/ClientListContainer.tsx           # Fetches clients
presenters/ClientListPresenter.tsx           # Client list
containers/ClientDetailContainer.tsx         # Client profile + data
presenters/ClientDetailPresenter.tsx         # Client summary view
containers/InviteClientContainer.tsx         # Invite form
presenters/InviteClientPresenter.tsx         # Invite UI
containers/AssignWorkoutContainer.tsx        # Workout assignment
presenters/AssignWorkoutPresenter.tsx        # Assignment form
components/ClientCard.tsx                    # Client list item
components/AssignmentCard.tsx                # Assignment list item
```

## Role-Based Visibility

```typescript
// In tab navigator
const { session } = useAuth();
const isTrainer =
  session?.role === "personal_trainer" || session?.role === "physiotherapist";

// Clients tab only rendered if isTrainer
```

## Authorization

All trainer endpoints enforce role check server-side:

- JWT must contain `personal_trainer` or `physiotherapist` role
- Client data access requires active relationship
- Terminated relationships block all client data access

---

## Extension — On-behalf, audit, programmes, UI architecture (added 2026-05-26)

This block extends the original design with the M8 Tier A / Tier B surfaces that close out the trainer-features spec. Every section cites `specs/_shared/cross-cuts.md` rather than redefining the shared primitives.

**Reading order:** § 1 (on-behalf architecture) is foundational — § 2..§ 8 are concrete features that consume it. § 9..§ 14 are cross-cutting (UI, mobile, auth, endpoint inventory, notifications, migration sequencing).

---

### § 1. On-behalf logging architecture

The on-behalf pattern is defined in full at `specs/_shared/cross-cuts.md § 1`. This section spec-binds the M8 Tier A scope to that contract.

#### 1.1 Request flow (single transaction)

```
Client (trainer mobile)
  │
  │ POST /trainers/me/clients/:clientId/sessions
  │ Authorization: Bearer <trainer JWT>
  ▼
Elysia handler
  │
  ├─► requireAuth  (validates JWT, surfaces user.role)
  │     └─► throws 401 if invalid
  │
  ├─► assertRole IN ('personal_trainer', 'physiotherapist')
  │     └─► throws 403 if regular user
  │
  ├─► assertTrainerCanActForClient(trainer.id, params.clientId)
  │     └─► reads pt_client_relationships where trainer_id=?, client_id=?, status='active'
  │     └─► throws 403 if no active relationship
  │
  ├─► validate body against shared sessionCreateSchema  (reused from POST /sessions)
  │
  └─► db.transaction(async tx => {
        const session = await tx.insert(workout_sessions).values({
          user_id: clientId,
          logged_by_user_id: trainer.id,  // ← per cross-cuts § 1.1
          ...body
        }).returning();

        await auditTrainerAction(tx, {
          trainerId: trainer.id,
          clientId,
          actionType: 'workout_logged_on_behalf',
          targetTable: 'workout_sessions',
          targetRowId: session.id,
          payload: body,
        });  // ← per cross-cuts § 1.4.2

        return session;
      });
  │
  ▼
emit notification (workout_logged_on_behalf) per cross-cuts § 5
  │
  ▼
streak engine on-write hook per cross-cuts § 3.4 (the client's row counts toward their streak)
```

The transaction is the contract: if the audit insert fails (FK violation, malformed payload, etc.) the entire request 500s and the data row rolls back. Per `cross-cuts § 1.4.2`, we never have a `logged_by_user_id IS NOT NULL` row without an audit entry.

#### 1.2 Endpoints in M8 Tier A

Four on-behalf write endpoints ship in M8 Tier A:

| Endpoint                                                 | Action type                       | Underlying table   |
| -------------------------------------------------------- | --------------------------------- | ------------------ |
| `POST /trainers/me/clients/:clientId/sessions`           | `workout_logged_on_behalf`        | `workout_sessions` |
| `POST /trainers/me/clients/:clientId/measurements`       | `measurement_logged_on_behalf`    | `body_measurements`|
| `POST /trainers/me/clients/:clientId/goals`              | `goal_assigned`                   | `user_goals`       |
| `PUT  /trainers/me/clients/:clientId/nutrition/target`   | `nutrition_target_set`            | `nutrition_targets` (M9-owned table; this endpoint stub-ships in M8, lights up post-M9) |

Tier B / Tier C (deferred):

- `POST /trainers/me/clients/:clientId/nutrition/entries` — deferred to M9.5 per `cross-cuts § 1.2` (Tier C). Nutrition entries are noisy and the on-behalf use case is marginal until the client-side nutrition logging UX matures.

#### 1.3 Authorization helper sourcing

`assertTrainerCanActForClient` is a shared helper per `cross-cuts § 1.3`. It lives at `microservices/core/src/application/relationships/assertTrainerCanActForClient.ts` and is unit-tested once. Every Tier A endpoint imports it; misordered checks (relationship before role) are prevented by the helper's contract (it asserts role check ran first via a typed precondition).

#### 1.4 Rationale: why not impersonation

Per `cross-cuts § 1.1`: the trainer's own JWT authenticates the request. There is no "act-as-user" token, no JWT swap. This is operationally simpler (no token-minting surface), more secure (a stolen trainer JWT only enables the trainer-scoped routes, not arbitrary client impersonation), and audit-friendly (every row write has the trainer's `sub` in `logged_by_user_id` and an audit-log entry — no token-exchange step to retroactively trace).

---

### § 2. Trainer-set goals subsystem

Cross-cuts § 2 in full. The spec contract:

- Endpoint: `POST /trainers/me/clients/:clientId/goals`
- Body: `{ goalTypeId, targetValue?, targetDate?, notes?, priority? }` — mirrors self-write `POST /goals`
- Behaviour: insert `user_goals` with `user_id = clientId`, `assigned_by_user_id = trainer.id`; audit + notification per § 1
- Defer goal-type seeds to `06-progress-goals § Goal-types seed list` — this spec does not re-enumerate the seed values

#### 2.1 Trainer-side goal-author UX

Form sections:

1. **Goal type picker** — segmented control over the seed list (Strength PR / Body weight / Body fat % / Frequency / Habit / Custom)
2. **Target value** — numeric stepper or freeform input depending on goal type (e.g. kg for strength, days/week for frequency, count for habit)
3. **Target date** — date picker, optional
4. **Notes** — free-text textarea, optional, surfaces in client's goal card
5. **Priority** — 1-3 stepper (matches existing `user_goals.priority`)
6. **Sticky CTA:** "Assign to {client.displayName}" — pressed state shows audit-log success toast

Empty state when no goal types are loaded yet: skeleton (not spinner) per `CLAUDE.md` UX checklist.

#### 2.2 Trainer-side goal-list-per-client UX

Renders on the Client Detail screen (§ 9 below). Three groupings:

- **Set by me** — editable / completable / deletable by this trainer per `cross-cuts § 2.2`
- **Set by client** — read-only with explicit "Goal set by client" attribution
- **Set by another trainer** — read-only with "Set by Coach X" attribution (the client may have had a previous trainer, or use both physio + PT)

#### 2.3 Frequency-target preset

STORY-008's "training-frequency target" is a Goal Type Picker preset that:

- Pre-selects `goalType = workout_count_per_week`
- Pre-fills target value to 3 with explicit copy "{client.displayName} aims for X sessions per week"
- Pre-creates a `user_streaks` row server-side on goal insert (per `cross-cuts § 3.2`) with `streak_type = 'workout_streak'`, `source_goal_id = newGoal.id`
- Surfaces inline a small streak preview "Current streak: 0 weeks" once the row exists

---

### § 3. Trainer-set nutrition targets

Cross-cut with `13-nutrition-tracking`. The `nutrition_targets` table is **owned by the Nutrition spec** (M9 migration per `cross-cuts § 6`); the trainer endpoint is owned here.

#### 3.1 Endpoint

```
PUT /trainers/me/clients/:clientId/nutrition/target

Request body:
{
  "calories": 2400,
  "proteinG": 200,
  "carbsG": 240,
  "fatG": 80,
  "effectiveFrom": "2026-06-01"  // optional, defaults to today
}

Response (200):
{
  "id": "uuid",
  "clientId": "uuid",
  "calories": 2400,
  "proteinG": 200,
  "carbsG": 240,
  "fatG": 80,
  "effectiveFrom": "2026-06-01",
  "setByUserId": "trainer-uuid",
  "createdAt": "..."
}

Errors:
  403 — no active PT-client relationship per cross-cuts § 1.3
  503 — if M9 nutrition tables not yet deployed (feature-flagged per requirements STORY-009 note)
```

Body shape mirrors self-write `PUT /nutrition/targets` so the validator is reusable (per `cross-cuts § 1.2`).

#### 3.2 Trainer-side UX

Single-screen modal:

1. **Calorie target** — large numeric input, default-focused on open
2. **Macro split** — three-way percentage slider (P / C / F) constrained to sum-to-100. Grams shown live as `(calories * pct) / kcalPerGram` per macro
3. **Effective-from** — date picker, default today
4. **Apply CTA** — single button. On success: toast "Set Coach Bradley's nutrition target for {client.displayName}". On 503: "Nutrition system not yet available — try again after the next release." (Feature-flag fallback per STORY-009.)

Visual: dark card on premium dark background (matches `CLAUDE.md` UX guidance), macro slider uses Tamagui `Slider` primitive with a custom three-segment track.

Audit notes: one `trainer_actions_audit` row with `action_type = 'nutrition_target_set'` per `§ 1.4`.

---

### § 4. Audit log — trainer-side surface

Backend schema and write-through middleware live in `cross-cuts § 1.4`. This section spec-binds the UI surface.

#### 4.1 Trainer-side audit views

**Per-client audit (Client Detail → "Activity" tab):**

- Chronological list of `trainer_actions_audit` rows where `client_id = currentClient.id AND trainer_id = self.id`
- Filter chips: This week / This month / All time (default: This month)
- Each row renders as: action icon + action description + relative timestamp ("2 hours ago", "yesterday")
- Tap row → deep links to the affected resource (e.g. `/sessions/:id`)

**Global "what I did this week" (Trainer Dashboard tile):**

- Aggregate count by action type, summed across all clients
- "12 workouts logged · 4 measurements · 3 goals set · 2 nutrition targets"
- Tap → opens a global audit list (default filter: this week)

#### 4.2 Client-side audit view

**Profile → Settings → "Actions my trainer took for me":**

- Reverse-chronological list of `trainer_actions_audit` rows where `client_id = self.id`
- No filter chips (volume is low for any single client)
- Each row: trainer's display name + action + relative timestamp
- Tap row → deep links to the affected resource if visible to client (e.g. session detail), or shows a read-only payload sheet (e.g. for the goal-assigned action which the client cannot edit)

#### 4.3 No edit/delete

Per `cross-cuts § 1.4` and STORY-012: audit log is append-only. No UI affordance for delete/edit on any surface. Retention forever per `cross-cuts § 1.4.3`.

#### 4.4 Endpoints

```
GET /trainers/me/audit
  Query: ?clientId=uuid (optional)
         &from=YYYY-MM-DD&to=YYYY-MM-DD (optional)
         &actionType=workout_logged_on_behalf,goal_assigned (optional, CSV)
         &limit=50&offset=0
  Auth: trainer JWT
  Returns: { entries: AuditEntry[], totalCount }

GET /users/me/audit/trainer-actions
  Query: ?from=YYYY-MM-DD&to=YYYY-MM-DD (optional)
         &limit=50&offset=0
  Auth: any JWT
  Returns: { entries: AuditEntry[], totalCount }
```

Auth: trainer endpoint enforces role + the trainer can only see their own audit rows; client endpoint scopes to `client_id = self.id`.

---

### § 5. Trainer notes domain

Adopts `trainer_client_notes` (schema lines 888-914) which is currently spec-uncovered.

#### 5.1 Domain model

```typescript
// src/domain/models/trainerClientNote.ts
export interface TrainerClientNote {
  id: string;
  trainerId: string;
  clientId: string;
  noteType: NoteType;          // 'progress' | 'injury' | 'milestone' | 'concern' | 'general'
  title: string;
  content: string;
  isPrivate: boolean;          // future-proof; v1 always private to the authoring trainer
  sessionId: string | null;    // optional link to a session
  createdAt: string;
  updatedAt: string;
}

export type NoteType = 'progress' | 'injury' | 'milestone' | 'concern' | 'general';
```

#### 5.2 Endpoints

```
GET    /trainers/me/clients/:clientId/notes?noteType=&limit=50&offset=0
POST   /trainers/me/clients/:clientId/notes        { noteType, title, content, sessionId? }
PATCH  /trainers/me/clients/:clientId/notes/:noteId  { noteType?, title?, content? }
DELETE /trainers/me/clients/:clientId/notes/:noteId
```

All four enforce:
1. Role check (`personal_trainer` or `physiotherapist`)
2. `assertTrainerCanActForClient`
3. For PATCH / DELETE: the row's `trainerId` must equal `self.id` (a different trainer cannot edit your notes about a shared client)

Each write writes a `trainer_actions_audit` row with action_type ∈ {`client_note_added`, `client_note_updated`, `client_note_deleted`} per `cross-cuts § 1.4.1`.

#### 5.3 Privacy

**Notes are trainer-private.** No client endpoint exposes them. `GET /users/me/notes` does NOT include trainer notes. The audit log row for note actions DOES surface in the client's audit feed (per § 4.2), but only the action metadata ("Coach Bradley added a progress note") — not the note title or content. This balances client trust ("you should know what your trainer is logging about you") against trainer authorship ("your notes don't accidentally become a written report to the client").

The `is_private` column is a v2 lever for trainer-internal sharing (e.g. a coaching team where multiple PTs share notes on a single client); v1 always treats notes as private to the authoring trainer.

#### 5.4 Trainer-side UX

Renders on Client Detail → "Notes" tab.

- List view: notes sorted by `createdAt desc`, grouped by `noteType` collapsibly
- Each note card: type badge (color-coded), title, first 2 lines of content, timestamp
- Tap card → full-screen read view with edit / delete affordances
- FAB "+ Add note" → modal with type picker (segmented control), title input, content textarea, optional "Link to recent session" picker

---

### § 6. Bulk assignment

#### 6.1 Endpoint

```
POST /workout-assignments/bulk

Request body:
{
  "clientIds": ["uuid", "uuid", ...],   // max 50 per call (locked in M8 BRIEF)
  "workoutId": "uuid",
  "assignedDate": "2026-06-01",
  "dueDate": "2026-06-07",              // optional
  "trainerNotes": "..."                 // optional
}

Response (201):
{
  "assignments": WorkoutAssignment[],
  "auditEntryCount": 8                  // one per client
}

Errors:
  400 — clientIds empty or > 50
  403 — any one client has no active relationship (all-or-nothing; rolls back the batch)
```

#### 6.2 Implementation notes

- Single transaction: assertTrainerCanActForClient runs once per clientId (sequential array call); if any fails, the whole batch 403s
- N rows inserted into `workout_assignments`
- N rows inserted into `trainer_actions_audit` with action_type = `workout_assigned`
- N notifications emitted with type `workout_assigned` (existing enum value)
- Lambda timeout consideration: 50-client cap keeps the transaction well under timeout; lifting the cap requires moving to a queue-based async pattern (out of v1 scope)

#### 6.3 Trainer-side UX

Multi-select on the Client List:

- Long-press a client card → enters multi-select mode; checkboxes appear on every card
- Header transforms into "Selected (N)" + "Cancel" + "Assign to selected (N)"
- Tap "Assign to selected" → modal with workout picker, assigned-date, due-date, notes
- Confirm → progress indicator → success toast "Assigned to {N} clients"

---

### § 7. Workout programmes (multi-week)

Adopts the unused `workout_programs` / `program_weeks` / `program_workouts` schema (lines 625-668).

#### 7.1 Domain model

```typescript
// src/domain/models/workoutProgram.ts
export interface WorkoutProgram {
  id: string;
  name: string;
  description: string | null;
  totalWeeks: number;
  createdBy: string;
  isPublic: boolean;
  weeks: ProgramWeek[];
}

export interface ProgramWeek {
  id: string;
  programId: string;
  weekNumber: number;
  name: string | null;
  description: string | null;
  workouts: ProgramWorkout[];
}

export interface ProgramWorkout {
  id: string;
  programWeekId: string;
  workoutId: string;
  workoutName: string;        // joined for convenience
  dayOfWeek: number | null;   // 1=Monday .. 7=Sunday
  sortOrder: number;
}
```

#### 7.2 Endpoints

```
POST   /workout-programs                              { name, description?, totalWeeks }
GET    /workout-programs?createdBy=me|public&q=...    list (own + public templates)
GET    /workout-programs/:id                          full programme with weeks + workouts
PATCH  /workout-programs/:id                          { name?, description?, isPublic? }
DELETE /workout-programs/:id

POST   /workout-programs/:id/weeks                    { weekNumber, name?, description? }
PATCH  /program-weeks/:id                             { name?, description? }
DELETE /program-weeks/:id

POST   /program-weeks/:id/workouts                    { workoutId, dayOfWeek?, sortOrder? }
PATCH  /program-workouts/:id                          { dayOfWeek?, sortOrder? }
DELETE /program-workouts/:id

POST   /workout-programs/:id/assign                   { clientIds: uuid[], startDate }
```

Programme-CRUD endpoints enforce role + `createdBy = self.id` for write ops (PATCH/DELETE). Programme-assign enforces the bulk-assign rules from § 6.

#### 7.3 Assignment materialisation

`POST /workout-programs/:id/assign` materialises into `workout_assignments` rows:

```
For each clientId:
  assertTrainerCanActForClient(trainer.id, clientId)
For each week W (1..totalWeeks):
  For each programWorkout PW in week W:
    For each clientId:
      INSERT workout_assignments (
        trainer_id = trainer.id,
        client_id = clientId,
        workout_id = PW.workoutId,
        assigned_date = startDate + (W-1)*7 + (PW.dayOfWeek - 1) days,
        due_date = same as assigned_date,  // single-day default
        trainer_notes = `Programme: ${program.name}, Week ${W}`,
        status = 'assigned'
      )
      INSERT trainer_actions_audit (action_type = 'workout_assigned')
For each clientId:
  EMIT notification (type = 'workout_assigned', once-per-client summary, not once-per-workout)
```

Auto-advance is implicit: each week's assignments have their own `assigned_date`. There is no continuous scheduler running — assignment is a one-shot materialisation at programme-assign time. Trainer wants to alter the programme mid-flight? They delete future-dated `workout_assignments` and re-assign from the modified programme (v1 lever; v2 may add "shift programme by N days" / "switch client to programme variant" affordances).

#### 7.4 Trainer-side UX (programme builder)

Tree-style layout:

```
┌─ Programme: Push/Pull/Legs 6-week ─────────────────┐
│  Description: "Hypertrophy block, 4 sessions/week"  │
│  [Edit] [Make public] [Assign to clients]           │
├─ Week 1 (Foundation) ───────────────────────────────┤
│  • Mon — Push Day A    [drag handle]               │
│  • Wed — Pull Day A    [drag handle]               │
│  • Fri — Legs Day A    [drag handle]               │
│  • Sat — Conditioning  [drag handle]               │
│  [+ Add workout to Week 1]                          │
├─ Week 2 (Intensification) ──────────────────────────┤
│  ...                                                │
└─────────────────────────────────────────────────────┘
```

Affordances:
- Drag-and-drop to reorder workouts within a week or move between weeks
- "Duplicate week" copies all workouts to a new week with auto-incremented `weekNumber`
- "Save as template" toggles `isPublic = true` (programme remains in own list but is visible to all trainers in `/workout-programs?createdBy=public`)
- "Assign to clients" → modal reusing the § 6 bulk-assign UI plus a date picker for `startDate`

#### 7.5 Client-side UX

Assigned programme workouts appear in the client's normal workout-assignment list (`GET /workout-assignments?clientId=self`). No special programme view client-side in v1 — the trainer authored the programme; the client experiences it as N weeks of regular workouts with `trainer_notes` indicating which week they're in.

v2 consideration: a "Programme view" on the client side that visualises the multi-week arc with completed/upcoming weeks. Not in v1 scope.

---

### § 8. Client check-in forms [Tier B]

Inspired by Everfit (research pass 2026-05-25). Deferred to Tier B / post-M8 milestone.

#### 8.1 Schema additions (Tier B)

```sql
CREATE TYPE check_in_field_type AS ENUM ('number', 'text', 'photo', 'choice');
CREATE TYPE check_in_cadence AS ENUM ('weekly', 'biweekly', 'monthly');

CREATE TABLE check_in_form_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  name          text NOT NULL,
  description   text,
  fields        jsonb NOT NULL,  -- [{ key, label, type, required, options? }]
  is_archived   boolean NOT NULL DEFAULT false,
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

CREATE TABLE check_in_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id      uuid NOT NULL REFERENCES profiles(id),
  client_id       uuid NOT NULL REFERENCES profiles(id),
  template_id     uuid NOT NULL REFERENCES check_in_form_templates(id),
  cadence         check_in_cadence NOT NULL,
  starts_on       date NOT NULL,
  ends_on         date,
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz DEFAULT now(),
  UNIQUE(trainer_id, client_id, template_id, starts_on)
);

CREATE TABLE check_in_submissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id   uuid NOT NULL REFERENCES check_in_assignments(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES profiles(id),
  period_start    date NOT NULL,   -- the week/biweek/month this submission covers
  answers         jsonb NOT NULL,  -- { fieldKey: value, ... }
  submitted_at    timestamptz DEFAULT now(),
  UNIQUE(assignment_id, period_start)
);

ALTER TYPE notification_type ADD VALUE 'check_in_due';
```

#### 8.2 Endpoints (Tier B)

```
POST   /check-in-form-templates                       { name, description?, fields }
GET    /check-in-form-templates?createdBy=me
PATCH  /check-in-form-templates/:id
DELETE /check-in-form-templates/:id                   (soft-delete: sets is_archived=true)

POST   /trainers/me/clients/:clientId/check-in-assignments
                                                       { templateId, cadence, startsOn, endsOn? }
GET    /trainers/me/clients/:clientId/check-in-assignments
DELETE /trainers/me/clients/:clientId/check-in-assignments/:id

POST   /check-in-submissions                          { assignmentId, answers }
GET    /users/me/check-in-assignments                 list of own check-in obligations
GET    /trainers/me/clients/:clientId/check-in-submissions
```

#### 8.3 UX sketch

- Trainer builds a template once (form fields: weight, photos, hunger/sleep ratings 1-5, free text)
- Assigns to one or more clients with a cadence
- Client receives `check_in_due` notification at start of each period
- Client fills via in-app form; submissions stored with `period_start`
- Trainer reviews per client → can read all historical submissions side-by-side to spot trends

---

### § 9. Trainer-side UI architecture (net-new screens)

Channels `frontend-design` skill principles: premium gym aesthetic, distinctive trainer-mode visual identity, Tamagui tokens, accessibility-first.

**Trainer-mode visual cue (proposed, requires Brad sign-off):**

- Trainer-mode chrome uses a **subtle indigo accent** (Tamagui token: propose `$accentTrainer` mapping to a desaturated indigo, e.g. `#6366f1`-derived) replacing the default brand orange in headers + active-state highlights
- Client-mode remains brand-orange — the contrast prevents trainers from accidentally executing in the wrong mode
- Bottom-nav tab labels render "(Trainer)" suffix when in trainer mode (e.g. "Clients" tab is unmistakable)
- This is NOT a full theme swap — most surfaces (cards, text, background) remain identical to client mode for consistency

This is a low-friction visual signal that mirrors TrueCoach's "Coach console" affordance without going as far as a full second app shell.

#### 9.1 Trainer Dashboard (`app/(app)/(trainer)/dashboard.tsx`)

Entry point for users where `session.role IN ('personal_trainer', 'physiotherapist')`.

Information architecture (top to bottom):
1. **Header** — "Welcome back, Coach Bradley" + trainer-mode accent
2. **Quick stats tiles (2x2 grid):**
   - Active clients (count + delta vs last week)
   - Workouts logged on behalf this week (per § 4.1)
   - Pending invitations (count, deep links to invitation list)
   - Programmes (count, deep links to programme builder)
3. **Recent activity** — collapsible list of this week's audit entries across all clients
4. **CTAs** — "Invite a client" / "Create a programme" / "Assign workout" — three large action cards

Empty state: "Welcome to your coach console. Start by [inviting a client] or [creating a programme]."

Accessibility:
- All tiles have `accessibilityLabel` describing both the count and the delta
- Header announces "Trainer console" to VoiceOver on first render
- Tile touch targets are 88×88pt minimum (≥ 44pt WCAG, comfortable on a phone)

#### 9.2 Client List (`app/(app)/(trainer)/clients/index.tsx`)

Information architecture:
1. **Search bar** (top, sticky) — text input filters by display name
2. **Filter chips** — All / Active / Pending / Inactive (default Active)
3. **Sort** — Recent activity (default) / Alphabetical / Date added
4. **Multi-select trigger** — long-press a card → enters multi-select mode per § 6.3
5. **Client card** — avatar, display name, last-active timestamp, relationship-status pill, tap → Client Detail
6. **FAB** — "+ Invite client" → invite modal (existing STORY-002 flow)

Empty state (no clients yet): A friendly illustration + copy "No clients yet — invite your first one" + primary CTA. (Memory says: empty states with personality.)

#### 9.3 Client Detail (`app/(app)/(trainer)/clients/[id].tsx`)

Single-client aggregate view. Tab bar at top:
1. **Overview** — recent sessions, current goals (with "Set by me" indicator), latest measurement, current nutrition target
2. **Activity** — chronological audit log (per § 4.1)
3. **Goals** — full goal list with section grouping per § 2.2 + "Add goal" CTA
4. **Programmes** — assigned programmes + history
5. **Notes** — private trainer notes per § 5.4
6. **Settings** — terminate relationship, edit invitation reason

Header includes:
- Client avatar + display name
- Pill: relationship status
- Action menu (3-dot) — "Log workout on behalf", "Log measurement on behalf", "Set nutrition target", "Set goal", "Add note", "Remove client"

#### 9.4 Programme Builder (`app/(app)/(trainer)/programmes/[id]/edit.tsx`)

The tree view sketched in § 7.4. Tamagui structure:

```
ScrollView
└─ ProgrammeHeader        (name, desc, action buttons)
└─ For each ProgramWeek:
   └─ WeekCard
      ├─ WeekHeader      (number, name, description)
      ├─ For each ProgramWorkout:
      │  └─ WorkoutRow   (day, name, drag handle, delete)
      └─ "+ Add workout"  inline CTA
└─ "+ Duplicate week" / "+ Add empty week"  at bottom
└─ Sticky "Assign to clients" CTA at bottom
```

Drag handle uses `react-native-reanimated` for spring-physics drag per `CLAUDE.md` performance guidance. Drag-targets between weeks are explicit drop zones (highlighted on drag-hover).

#### 9.5 Log workout on behalf (modal)

Invoked from Client Detail header action menu OR from Client Detail Overview → "Log workout for client" FAB.

Reuses the same workout-logging container the client uses (`ActiveSessionContainer` from `05-active-session`), with two adapter-level changes:
1. Container injected with `clientId` prop → posts to `/trainers/me/clients/:clientId/sessions` instead of `/sessions`
2. UI chrome shows a persistent banner: "Logging as Coach Bradley for {client.displayName}" — trainer-mode accent

**Confirm gate before save:**

> ⚠️ Confirm — this will be logged as a workout for {client.displayName}.
>
> [Cancel] [Confirm and save]

This is the one place where we deliberately add friction: per `cross-cuts § 1.5`, the client cannot directly delete an on-behalf row, so the trainer should be certain.

#### 9.6 Log measurement on behalf

Same pattern as § 9.5, simpler form. Container `MeasurementLogContainer` reused with `clientId` prop. Confirm-gate present.

#### 9.7 Bulk-assign modal

Invoked from Client List multi-select header → "Assign to selected (N)".

Modal structure:
1. **Title** — "Assign workout to {N} clients"
2. **Selected clients chip-row** — read-only, with X to remove individuals
3. **Workout picker** — search + list, single-select
4. **Assigned-date** — date picker (default today)
5. **Due-date** — date picker, optional
6. **Trainer notes** — multiline input
7. **CTA** — "Assign to {N} clients" (disabled until workout picked)

On confirm: loading state, then success toast with link to "View assignments". On 403 (one client lost relationship): error toast "One or more clients no longer have an active relationship — refresh client list and retry."

#### 9.8 Audit log view (`app/(app)/(trainer)/audit/index.tsx`)

Global "what I did" view (per § 4.1):

- Filter chips at top: This week (default) / This month / All time
- Section grouping: by client (collapsible) OR by action-type (toggle in header)
- Each entry: action icon, description, target row preview, timestamp, deep link

Per-client audit lives on the Client Detail "Activity" tab (§ 9.3).

#### 9.9 Accessibility checklist (channels `design:accessibility-review`)

For each net-new screen:
- [ ] Color contrast 4.5:1 normal text, 3:1 large/UI per WCAG 2.1 AA
- [ ] Trainer-mode indigo accent verified against dark + light themes
- [ ] Touch targets ≥ 44×44pt (most are larger; FAB is 56×56pt)
- [ ] Every interactive element has `accessibilityLabel`
- [ ] Focus order documented in design.md per screen
- [ ] VoiceOver flow for log-on-behalf gate: form fields announce their values; the confirm-gate sheet announces "Confirm: this will log a workout for {client}"
- [ ] All forms reachable + completable via external keyboard (Bluetooth keyboard on iPad)
- [ ] Drag-and-drop in programme builder has a non-gesture fallback (long-press → "Move to..." picker)

---

### § 10. Mobile architecture

Per `_agent.md` hexagonal architecture rules.

#### 10.1 Ports

```typescript
// src/domain/ports/trainer.port.ts
export interface TrainerPort {
  // Existing (from STORY-001..006)
  listMyClients(): Promise<Result<PTClientRelationship[], ApiError>>;
  invite(input: InviteInput): Promise<Result<PTClientRelationship, ApiError>>;
  respondToInvitation(id: string, accept: boolean): Promise<Result<void, ApiError>>;
  terminate(id: string): Promise<Result<void, ApiError>>;

  // Net-new (STORY-007..017)
  getClientDetail(clientId: string): Promise<Result<ClientDetail, ApiError>>;
  setGoalForClient(clientId: string, goal: GoalInput): Promise<Result<Goal, ApiError>>;
  setNutritionTargetForClient(clientId: string, target: NutritionTargetInput): Promise<Result<NutritionTarget, ApiError>>;
  logSessionForClient(clientId: string, session: SessionInput): Promise<Result<WorkoutSession, ApiError>>;
  logMeasurementForClient(clientId: string, measurement: MeasurementInput): Promise<Result<BodyMeasurement, ApiError>>;
  assignWorkout(input: AssignWorkoutInput): Promise<Result<WorkoutAssignment, ApiError>>;
  bulkAssignWorkout(input: BulkAssignInput): Promise<Result<BulkAssignResult, ApiError>>;
  getTrainerAudit(filter: AuditFilter): Promise<Result<AuditEntry[], ApiError>>;
  listNotes(clientId: string, filter?: NoteFilter): Promise<Result<TrainerClientNote[], ApiError>>;
  addNote(clientId: string, note: NoteInput): Promise<Result<TrainerClientNote, ApiError>>;
  updateNote(clientId: string, noteId: string, note: Partial<NoteInput>): Promise<Result<TrainerClientNote, ApiError>>;
  deleteNote(clientId: string, noteId: string): Promise<Result<void, ApiError>>;
}

// src/domain/ports/programme.port.ts
export interface ProgrammePort {
  listProgrammes(filter: ProgrammeFilter): Promise<Result<WorkoutProgram[], ApiError>>;
  getProgramme(id: string): Promise<Result<WorkoutProgram, ApiError>>;
  createProgramme(input: ProgrammeInput): Promise<Result<WorkoutProgram, ApiError>>;
  updateProgramme(id: string, input: Partial<ProgrammeInput>): Promise<Result<WorkoutProgram, ApiError>>;
  deleteProgramme(id: string): Promise<Result<void, ApiError>>;
  addWeek(programmeId: string, input: WeekInput): Promise<Result<ProgramWeek, ApiError>>;
  addWorkoutToWeek(weekId: string, input: ProgramWorkoutInput): Promise<Result<ProgramWorkout, ApiError>>;
  // ...rest of CRUD per § 7.2
  assignProgramme(id: string, input: ProgrammeAssignInput): Promise<Result<ProgrammeAssignResult, ApiError>>;
}
```

#### 10.2 Queries + commands

```typescript
// src/application/queries/
listMyClients.ts
getClientDetail.ts          // joins sessions + goals + measurements + nutrition + notes + audit summary
getTrainerActionAudit.ts
listProgrammes.ts
getProgramme.ts

// src/application/commands/
inviteClient.ts
setGoalForClient.ts
setNutritionTargetForClient.ts
logSessionForClient.ts
logMeasurementForClient.ts
assignWorkout.ts
bulkAssignWorkout.ts
addNote.ts                  / updateNote.ts / deleteNote.ts
createProgramme.ts          / addProgrammeWeek.ts / etc.
assignProgramme.ts
```

#### 10.3 Trainer-mode toggle

Navigation root reads `session.role` and renders either the client-mode tab navigator OR the trainer-mode tab navigator. Trainer-mode tabs:

1. Dashboard (`/(trainer)/dashboard`)
2. Clients (`/(trainer)/clients`)
3. Programmes (`/(trainer)/programmes`)
4. Audit (`/(trainer)/audit`)
5. Profile (shared with client mode)

A "Switch to my own view" affordance in the Profile screen lets dual-role users (a trainer who also trains themselves) flip into client mode and back. This is a UI-only toggle — the JWT role doesn't change.

---

### § 11. Authorization

All trainer endpoints in this extension run through the same middleware sandwich:

```typescript
.use(requireAuth())                              // JWT validation
.use(requireRole(['personal_trainer', 'physiotherapist']))
.derive(async ({ params, user, db }) => ({
  ...(params.clientId
    ? { client: await assertTrainerCanActForClient(db, user.id, params.clientId) }
    : {})
}))
```

Per `cross-cuts § 1.3`: role check ALWAYS runs before relationship check. The middleware order enforces this — `requireRole` precedes the relationship helper.

Endpoints without a `:clientId` (e.g. `GET /trainers/me/audit`, programme CRUD) skip the relationship helper but still require role.

---

### § 12. Backend endpoints inventory

| # | Method | Path | Body / Query | Auth | Audit | Tier |
|---|--------|------|--------------|------|-------|------|
| 1 | POST | `/trainers/me/clients/:clientId/sessions` | session body | trainer + relationship | `workout_logged_on_behalf` | A |
| 2 | POST | `/trainers/me/clients/:clientId/measurements` | measurement body | trainer + relationship | `measurement_logged_on_behalf` | A |
| 3 | POST | `/trainers/me/clients/:clientId/goals` | goal body | trainer + relationship | `goal_assigned` | A |
| 4 | PUT | `/trainers/me/clients/:clientId/nutrition/target` | nutrition target body | trainer + relationship | `nutrition_target_set` | A (lit post-M9) |
| 5 | GET | `/trainers/me/clients/:clientId/sessions` | none | trainer + relationship | none (read) | A |
| 6 | GET | `/trainers/me/clients/:clientId/measurements` | none | trainer + relationship | none | A |
| 7 | GET | `/trainers/me/clients/:clientId/goals` | none | trainer + relationship | none | A |
| 8 | GET | `/trainers/me/clients/:clientId/notes` | `?noteType=` | trainer + relationship | none | A |
| 9 | POST | `/trainers/me/clients/:clientId/notes` | note body | trainer + relationship | `client_note_added` | A |
| 10 | PATCH | `/trainers/me/clients/:clientId/notes/:noteId` | partial note body | trainer + relationship + own-note | `client_note_updated` | A |
| 11 | DELETE | `/trainers/me/clients/:clientId/notes/:noteId` | none | trainer + relationship + own-note | `client_note_deleted` | A |
| 12 | GET | `/trainers/me/audit` | filter query | trainer | none | A |
| 13 | GET | `/users/me/audit/trainer-actions` | filter query | any | none | A |
| 14 | POST | `/workout-assignments/bulk` | bulk body | trainer + relationship (per client) | `workout_assigned` (per client) | A |
| 15 | POST | `/workout-programs` | programme body | trainer | none | A |
| 16 | GET | `/workout-programs` | filter query | trainer | none | A |
| 17 | GET | `/workout-programs/:id` | none | trainer + ownership-or-public | none | A |
| 18 | PATCH | `/workout-programs/:id` | partial programme | trainer + ownership | none | A |
| 19 | DELETE | `/workout-programs/:id` | none | trainer + ownership | none | A |
| 20 | POST | `/workout-programs/:id/weeks` | week body | trainer + ownership | none | A |
| 21 | PATCH | `/program-weeks/:id` | partial week | trainer + ownership | none | A |
| 22 | DELETE | `/program-weeks/:id` | none | trainer + ownership | none | A |
| 23 | POST | `/program-weeks/:id/workouts` | week-workout body | trainer + ownership | none | A |
| 24 | PATCH | `/program-workouts/:id` | partial week-workout | trainer + ownership | none | A |
| 25 | DELETE | `/program-workouts/:id` | none | trainer + ownership | none | A |
| 26 | POST | `/workout-programs/:id/assign` | assign body | trainer + relationship (per client) | `workout_assigned` (per assignment) | A |
| 27 | POST | `/check-in-form-templates` | template body | trainer | none | B |
| 28 | GET | `/check-in-form-templates` | filter | trainer | none | B |
| 29 | PATCH | `/check-in-form-templates/:id` | partial | trainer + ownership | none | B |
| 30 | DELETE | `/check-in-form-templates/:id` | none | trainer + ownership | none | B |
| 31 | POST | `/trainers/me/clients/:clientId/check-in-assignments` | assignment body | trainer + relationship | (Tier B audit type TBD) | B |
| 32 | POST | `/check-in-submissions` | submission body | any (client) | none | B |
| 33 | GET | `/trainers/me/clients/:clientId/check-in-submissions` | filter | trainer + relationship | none | B |

Existing endpoints from STORY-001..006 (client list, invite, terminate, view client profile) are not re-tabulated — see the original design.md sections above.

---

### § 13. Notification triggers

Per `cross-cuts § 5`. M8 introduces 4 new event types in the cross-feature taxonomy:

| Event                                | Type enum                          | Emitted by                                                  | Default opt-in | Deep link                    |
| ------------------------------------ | ---------------------------------- | ----------------------------------------------------------- | -------------- | ---------------------------- |
| Workout logged on behalf             | `workout_logged_on_behalf`         | `POST /trainers/me/clients/:clientId/sessions`              | on             | `/sessions/:id`              |
| Measurement logged on behalf         | `measurement_logged_on_behalf`     | `POST /trainers/me/clients/:clientId/measurements`          | on             | `/progress/measurements/:id` |
| Goal assigned by trainer             | `goal_assigned_by_trainer`         | `POST /trainers/me/clients/:clientId/goals`                 | on             | `/progress/goals/:id`        |
| Nutrition target set by trainer      | `nutrition_target_set_by_trainer`  | `PUT /trainers/me/clients/:clientId/nutrition/target`       | on             | `/nutrition/targets`         |
| Workout assigned (incl. programme)   | `workout_assigned` (existing)      | bulk assign, programme assign                               | on             | `/workouts/:id`              |
| (Tier B) Check-in due                | `check_in_due`                     | scheduled job — start of each check-in period               | on             | `/check-ins/:id`             |

Per `cross-cuts § 5`: M7 owns the `notification_type` enum migration. This spec's M8 BRIEF must call out the four new enum values so M7 can sequence them — flagging here ensures the BRIEF author doesn't miss it.

#### 13.1 Trainer-side notifications (Tier B)

M8 Tier B also wants:
- `client_missed_assigned_workout` — nightly cron: for each `workout_assignment` where `due_date < today AND status = 'assigned' AND no completed_session_id`, emit one notification to the assigning trainer
- `client_logged_session` — opt-in per trainer, default off (noisy for trainers with many clients) — emitted to the trainer when their client completes any session

These are bidirectional notifications (server emits to a trainer, not a client). The existing `notifications` table schema supports this — `user_id` is the recipient and the event types live in the same enum.

---

### § 14. Migration sequencing

Per `cross-cuts § 6`, the M8 migration block is small:

| Migration                                                | Owner | Notes                                                                                                          |
| -------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| `trainer_actions_audit` table                            | M8    | Per `cross-cuts § 1.4`. Indexes on `(client_id, created_at desc)` and `(trainer_id, created_at desc)`.         |
| `action_type_enum`                                       | M8    | Values per `cross-cuts § 1.4.1`. Append-only.                                                                  |
| `notification_type` enum: 4 new values                   | M7    | M7 lands the migration; M8 spec flags the required additions per § 13.                                         |
| `workout_sessions.logged_by_user_id` light-up            | M8    | Column lands in M4 nullable per `cross-cuts § 6`. M8 begins writing non-`NULL` values.                         |
| `body_measurements.logged_by_user_id` light-up           | M8    | Same shape as the workout_sessions column.                                                                     |
| `nutrition_targets.set_by_user_id` light-up              | M8    | Column lands in M9 nullable; M8 begins writing non-`NULL` values via § 3 endpoint. Feature-flagged per STORY-009. |
| `user_goals.assigned_by_user_id` light-up                | M8    | Column lands in M4 nullable per `cross-cuts § 6`. M8 begins writing non-`NULL` values via § 2 endpoint.        |
| (Tier B) `check_in_form_templates`, `check_in_submissions`, `check_in_assignments` tables + enums | post-M8 | Per § 8.1.                                              |

M4 carries the bigger upstream migration (the `logged_by_*` columns + Goals model extensions); M8 is mostly endpoint wiring + the new audit table.
