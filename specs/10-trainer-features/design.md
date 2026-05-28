# 10 — Trainer Features: Design

> **Spec rewritten from scratch on 2026-05-27.** Pairs with `requirements.md`.

---

## Architecture overview

```
microservices/core/src/application/
├── trainers/                            ← NEW: on-behalf handlers, audit writer
├── relationships/                       ← assertTrainerCanActForClient helper (cross-cuts § 1.3)
├── programs/                            ← NEW: programs CRUD + assignments
├── notes/                               ← NEW: trainer_client_notes CRUD
└── ai-summary/                          ← NEW: stub (Tier B deferred)

packages/mobile/
├── app/(app)/
│   ├── (tabs)/
│   │   ├── index.tsx                    ← branches: HomeContainer (athlete) | CoachHomeContainer (coach)
│   │   ├── clients.tsx                  ← ClientsListContainer
│   │   ├── programs.tsx                 ← ProgramsListContainer
│   │   └── you.tsx                      ← branches: YouContainer (athlete) | CoachYouContainer (coach)
│   ├── clients/
│   │   └── [id].tsx                     ← ClientDetailContainer
│   └── programs/
│       ├── create.tsx
│       └── [id].tsx                     ← ProgramEditorContainer
└── src/ui/
    ├── containers/
    │   ├── CoachHomeContainer.tsx       ← NEW
    │   ├── CoachYouContainer.tsx        ← NEW
    │   ├── ClientsListContainer.tsx     ← NEW
    │   ├── ClientDetailContainer.tsx    ← NEW
    │   ├── ProgramsListContainer.tsx    ← NEW
    │   ├── ProgramEditorContainer.tsx   ← NEW
    │   ├── AddClientSheetContainer.tsx  ← NEW
    │   ├── AssignWorkoutSheetContainer.tsx
    │   ├── AssignGoalSheetContainer.tsx
    │   ├── EditNutritionTargetsSheetContainer.tsx
    │   └── AddNoteSheetContainer.tsx
    └── presenters/
        ├── CoachHomePresenter.tsx
        ├── CoachYouPresenter.tsx
        ├── ClientsListPresenter.tsx
        ├── ClientDetailPresenter.tsx
        ├── ProgramsListPresenter.tsx
        ├── ProgramEditorPresenter.tsx
        ├── BusinessStatsPresenter.tsx
        ├── ClientOverviewDonutPresenter.tsx
        ├── AISummaryCardPresenter.tsx
        ├── AddClientSheetPresenter.tsx
        ├── AssignWorkoutSheetPresenter.tsx
        ├── AssignGoalSheetPresenter.tsx
        └── AddNoteSheetPresenter.tsx
```

Cross-cuts.md is the source of truth for on-behalf, audit, goals, AI entitlement, notifications.

---

## Backend — on-behalf endpoints

Per cross-cuts § 1.2. Every `/trainers/me/clients/:clientId/...` route:

1. Authenticates trainer JWT.
2. Checks `role IN ('personal_trainer', 'physiotherapist')`.
3. Calls `assertTrainerCanActForClient(trainerId, clientId)` per cross-cuts § 1.3.
4. Validates request body using the same validator as the client's self-write route.
5. Inside a transaction: writes the target row with `logged_by_user_id = trainerId` + writes one `trainer_actions_audit` row per cross-cuts § 1.4.2.
6. Returns the new row.
7. Async: emits notification per cross-cuts § 5.

### Endpoint catalog (M8 scope)

| Self route                  | Trainer-on-behalf route                                   | Action type                                                |
| --------------------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| `GET /sessions`             | `GET /trainers/me/clients/:clientId/sessions`             | (read; no audit)                                           |
| `POST /sessions`            | `POST /trainers/me/clients/:clientId/sessions`            | `workout_logged_on_behalf`                                 |
| `PUT /sessions/:id`         | `PUT /trainers/me/clients/:clientId/sessions/:id`         | `workout_logged_on_behalf` (treats as same logical action) |
| `GET /measurements`         | `GET /trainers/me/clients/:clientId/measurements`         | (read)                                                     |
| `POST /measurements`        | `POST /trainers/me/clients/:clientId/measurements`        | `measurement_logged_on_behalf`                             |
| `GET /goals`                | `GET /trainers/me/clients/:clientId/goals`                | (read)                                                     |
| `POST /goals`               | `POST /trainers/me/clients/:clientId/goals`               | `goal_assigned`                                            |
| `PUT /goals/:id`            | `PUT /trainers/me/clients/:clientId/goals/:id`            | (no new audit if same trainer; 403 if not assigner)        |
| `PUT /nutrition/targets`    | `PUT /trainers/me/clients/:clientId/nutrition/target`     | `nutrition_target_set`                                     |
| `POST /workout-assignments` | `POST /trainers/me/clients/:clientId/workout-assignments` | `workout_assigned`                                         |
| `GET .../notes` (new)       | `GET /trainers/me/clients/:clientId/notes`                | (read)                                                     |
| `POST .../notes` (new)      | `POST /trainers/me/clients/:clientId/notes`               | `client_note_added`                                        |
| `PUT .../notes/:id`         | `PUT /trainers/me/clients/:clientId/notes/:noteId`        | `client_note_updated`                                      |
| `DELETE .../notes/:id`      | `DELETE /trainers/me/clients/:clientId/notes/:noteId`     | `client_note_deleted`                                      |

### `assertTrainerCanActForClient` helper

Per cross-cuts § 1.3. Shared helper in `microservices/core/src/application/relationships/`:

```ts
export async function assertTrainerCanActForClient(
  trainerId: string,
  clientId: string,
): Promise<void> {
  const rel = await db
    .select()
    .from(ptClientRelationships)
    .where(
      and(
        eq(ptClientRelationships.trainerId, trainerId),
        eq(ptClientRelationships.clientId, clientId),
        eq(ptClientRelationships.status, "active"),
      ),
    )
    .limit(1);
  if (rel.length === 0) {
    throw new ForbiddenError("No active relationship");
  }
}
```

Tested in `application/relationships/__tests__/`; consumed by every trainer route handler.

### `auditTrainerAction` helper

Per cross-cuts § 1.4.2:

```ts
export async function auditTrainerAction(args: {
  trainerId: string;
  clientId: string;
  actionType: ActionType;
  targetTable: string;
  targetRowId: string;
  payload: Record<string, unknown>;
  tx: Transaction; // MUST be inside the same transaction as the row write
}): Promise<void> {
  await args.tx.insert(trainerActionsAudit).values({
    trainerId: args.trainerId,
    clientId: args.clientId,
    actionType: args.actionType,
    targetTable: args.targetTable,
    targetRowId: args.targetRowId,
    payload: args.payload,
  });
}
```

Failure to write the audit row → entire transaction rolls back → handler returns 500.

---

## Backend — programs

New tables:

```sql
CREATE TABLE programs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id      uuid NOT NULL REFERENCES profiles(id),
  name            text NOT NULL,
  description     text,
  weeks_count     integer NOT NULL,
  days_per_week   integer NOT NULL,
  accent_tone     text DEFAULT 'primary',
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE TABLE program_weeks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      uuid NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  week_number     integer NOT NULL,
  notes           text,
  UNIQUE (program_id, week_number)
);

CREATE TABLE program_days (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_week_id   uuid NOT NULL REFERENCES program_weeks(id) ON DELETE CASCADE,
  day_number        integer NOT NULL,
  workout_id        uuid REFERENCES workouts(id),     -- nullable for rest days
  is_rest           boolean NOT NULL DEFAULT false,
  UNIQUE (program_week_id, day_number)
);

CREATE TABLE program_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      uuid NOT NULL REFERENCES programs(id),
  client_id       uuid NOT NULL REFERENCES profiles(id),
  started_at      date NOT NULL,
  current_week    integer NOT NULL DEFAULT 1,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','paused','cancelled')),
  UNIQUE (program_id, client_id)
);
```

Endpoints:

| Method | Path                                                                 |
| ------ | -------------------------------------------------------------------- |
| GET    | `/trainers/me/programs`                                              |
| POST   | `/trainers/me/programs`                                              |
| GET    | `/trainers/me/programs/:id`                                          |
| PUT    | `/trainers/me/programs/:id`                                          |
| DELETE | `/trainers/me/programs/:id`                                          |
| POST   | `/trainers/me/programs/:id/assign` (body: `{ clientId, startedAt }`) |
| POST   | `/trainers/me/programs/:id/days` (bulk-upsert week+day structure)    |

---

## Backend — trainer notes

New table:

```sql
CREATE TABLE trainer_client_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id      uuid NOT NULL REFERENCES profiles(id),
  client_id       uuid NOT NULL REFERENCES profiles(id),
  body            text NOT NULL,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
CREATE INDEX trainer_client_notes_trainer_client ON trainer_client_notes (trainer_id, client_id, created_at DESC);
```

Endpoints per the catalog above. **Client never sees these.** Visibility enforced by `WHERE trainer_id = self.id` in every read.

---

## Backend — audit log

Table per cross-cuts § 1.4:

```sql
CREATE TYPE action_type_enum AS ENUM (
  'workout_logged_on_behalf',
  'measurement_logged_on_behalf',
  'nutrition_entry_logged_on_behalf',
  'goal_assigned',
  'nutrition_target_set',
  'workout_assigned',
  'client_note_added',
  'client_note_updated',
  'client_note_deleted'
);

CREATE TABLE trainer_actions_audit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id      uuid NOT NULL REFERENCES profiles(id),
  client_id       uuid NOT NULL REFERENCES profiles(id),
  action_type     action_type_enum NOT NULL,
  target_table    text NOT NULL,
  target_row_id   uuid NOT NULL,
  payload         jsonb NOT NULL,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX trainer_actions_audit_client_ts ON trainer_actions_audit (client_id, created_at DESC);
CREATE INDEX trainer_actions_audit_trainer_ts ON trainer_actions_audit (trainer_id, created_at DESC);
```

---

## Backend — recent activity feed

Endpoint `GET /trainers/me/recent-activity` returns last 20 events for Coach Home recent-activity section:

```ts
type RecentActivityEvent = {
  type:
    | "session_completed"
    | "pr_achieved"
    | "missed_day"
    | "goal_assigned_to_client"
    | "streak_milestone";
  clientId: string;
  clientName: string;
  clientInitials: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
};
```

Backend joins sessions, PRs, streaks, goal assignments, missed-day computations for the trainer's clients.

---

## Frontend — Coach Home (`<CoachHomePresenter>`)

Per `coach.jsx:12–48`.

```ts
type CoachHomeProps = {
  trainer: { name: string; initials: string };
  businessStats: BusinessStats;
  clientHealthBreakdown: { label: string; count: number; color: string }[];
  yourTrainingPeek: {
    streak: number;
    lastSession?: { name: string; daysAgo: number };
  };
  programStats: { activeCount: number; assignmentsCount: number };
  recentActivity: RecentActivityEvent[];
  onOpenDrawer: () => void;
  onSwitchToAthlete: () => void;
  onOpenClient: (clientId: string) => void;
  onOpenProgram: (programId: string) => void;
};
```

Sub-presenters: `<BusinessStatsPresenter>` (2×2 grid), `<ClientOverviewDonutPresenter>` (donut SVG), `<YourTrainingPeekPresenter>` (small card), `<ProgramStatsPresenter>`, `<RecentActivityFeedPresenter>`.

---

## Frontend — Clients List (`<ClientsListPresenter>`)

Per `extra.jsx:190–241`.

```ts
type ClientsListProps = {
  clients: Client[];
  attentionCount: number;
  newPRCount: number;
  programmeEndingCount: number;
  filter: "Active" | "All" | "Archive";
  searchQuery: string;
  onSearch: (q: string) => void;
  onFilterChange: (f: string) => void;
  onOpenClient: (id: string) => void;
  onAddClient: () => void;
};
```

Layout: `<HeaderBar large>` + summary chip row + `<SearchBar>` + `<Segmented>` + `FlashList` of `<ClientRow>`s.

---

## Frontend — Client Detail (`<ClientDetailPresenter>`)

Per `client-detail.jsx`. Tab strip with 5 tabs (Overview / Workouts / Nutrition / Notes / Settings). Each tab's content reuses athlete-side composites where possible (Overview = `<StreakHero>` + `<BodyTrend>` + `<VolumeStats>` from `06-progress-goals`; Nutrition Targets uses form from `13-nutrition-tracking`).

---

## Frontend — Programs List + Editor

`<ProgramsListPresenter>` per `coach.jsx ProgramsScreen` + `extra.jsx:290–328`. Card per program with left-border accent + weeks pill + clients pill + chevron.

`<ProgramEditorPresenter>` — week-by-week grid; each cell shows assigned workout or rest. Drag-drop to reorder (out of scope for v1, defer to follow-up).

---

## Frontend — On-behalf flow integration with `05-active-session`

When trainer taps "Log session for client" on Client Detail → Workouts tab:

1. Container calls `useStartSession({ workoutId, clientId, retroactive })`.
2. Session is created server-side at `POST /trainers/me/clients/:clientId/sessions` (instead of self route).
3. `useActiveWorkout().start()` is called with `withClient: { id, initials, name }` + `retroactive: true|false`.
4. `<ActiveSessionPresenter>` renders the trainer banner (per `05-active-session` STORY-004).
5. Set logs route through the same trainer-on-behalf endpoint per existing pattern.
6. Session-end behaves identically; backend writes `logged_by_user_id` + audit row.

---

## Frontend — Notification triggers

Per cross-cuts § 5, this spec emits:

| Trigger                                                 | Event                              |
| ------------------------------------------------------- | ---------------------------------- |
| Trainer assigns goal                                    | `goal_assigned_by_trainer`         |
| Trainer assigns workout                                 | `workout_assigned` (existing enum) |
| Trainer logs workout on behalf                          | `workout_logged_on_behalf`         |
| Trainer logs measurement on behalf                      | `measurement_logged_on_behalf`     |
| Trainer sets nutrition target                           | `nutrition_target_set_by_trainer`  |
| (Tier C / M9.5+) Trainer logs nutrition entry on behalf | `nutrition_entry_logged_on_behalf` |

M7 (`09-notifications-social`) owns delivery + rendering.

---

## Frontend — Mode-aware screen branching

The same tab slot (`index.tsx`, `you.tsx`) hosts different containers based on `useUserMode().mode`:

```tsx
// app/(app)/(tabs)/index.tsx
import { useUserMode } from "~/state/user-mode";
import { HomeContainer } from "~/ui/containers/HomeContainer"; // 06-progress-goals
import { CoachHomeContainer } from "~/ui/containers/CoachHomeContainer"; // 10-trainer-features

export default function Index() {
  const mode = useUserMode((s) => s.mode);
  return mode === "coach" ? <CoachHomeContainer /> : <HomeContainer />;
}
```

Same pattern for `you.tsx`.

---

## Offline behaviour

- Coach Home + Clients list + Programs list + Client Detail all read from SQLite cache first.
- On-behalf write mutations queue via the sync queue with the trainer-context payload preserved.
- Audit log: server-side only — no offline write of audit rows. Trainer client never holds these locally.
- Notes: read + write fully offline-capable.

---

## Testing strategy

### Unit tests (backend)

- `assertTrainerCanActForClient` — passes for active relationship, throws for missing/inactive.
- Each on-behalf handler — happy path + 403 on missing relationship + 403 on wrong role + audit row written inside transaction + audit row rolls back on row-write failure.
- Programs CRUD + assignments — happy paths + ownership checks.
- Notes CRUD — trainer-only visibility.

### Unit tests (frontend)

- Each presenter — render assertions.
- Each container — hook integration with in-memory adapter.

### Integration tests

- Trainer flow: open Clients → tap client → log session on behalf → assert active session opens with banner → set logs route through trainer endpoint → end session → audit row + attribution.
- Athlete view: log in as the client → assert session shows "Logged by Coach Bradley" badge.

### Coverage

90% per `_agent.md`.

---

## Risks + mitigations

| Risk                                                                                | Mitigation                                                                                                                 |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Audit-row write failing inside transaction can mask the real underlying bug         | Bubble the failure error in dev / staging with full context; production logs to Sentry with audit row payload.             |
| `assertTrainerCanActForClient` check vs role check order                            | Helper enforces order (role first, then relationship) per cross-cuts § 1.3.                                                |
| Programs editor is complex — week × day × workout matrix                            | Ship v1 with simple list-of-days editing; defer drag-drop reorder + visual calendar to follow-up.                          |
| Mode-switch mid-Client-Detail breaks the screen (no coach mode → coach screen gone) | `(app)/clients/[id].tsx` is gated: if `mode === 'athlete'`, redirect to `(app)/(tabs)/index`. Same for `(app)/programs/*`. |
| AI summary card placeholder might confuse trainers                                  | Show "AI insights coming soon" copy + lock the Regenerate Btn until M9.5 wires `aiAccess`.                                 |
| Trainer notes leakage to client                                                     | Visibility enforced in EVERY read query via `WHERE trainer_id = self.id`. Integration test covers the leak path.           |

---

_End of `10-trainer-features/design.md` · 2026-05-27 (rewritten from scratch)_
