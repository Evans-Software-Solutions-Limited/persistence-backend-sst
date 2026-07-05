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

> **⚠ Superseded 2026-07-03 by `specs/19-programs/design.md`** — this section
> chose to keep the week-structured tables; that decision was reversed after
> the Phase-0 audit (all four tables empty in prod, Brad confirmed flat
> ordered-list shape + nullable duration). Do not build from this section.

Existing tables in `packages/db/src/schema.ts` cover the program structure end-to-end:

| Table (Drizzle name → SQL name)               | Shape                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `workoutPrograms` → `workout_programs` (:647) | `(id, name, description, total_weeks, created_by FK → profiles, is_public, created_at, updated_at)`                       |
| `programWeeks` → `program_weeks` (:660)       | `(id, program_id FK → workout_programs, week_number, name, description, created_at)` + `UNIQUE (program_id, week_number)` |
| `programWorkouts` → `program_workouts` (:677) | `(id, program_week_id FK → program_weeks, workout_id FK → workouts, day_of_week, sort_order, created_at)`                 |

**Spec aligns to existing shape — no new program/week/day tables.** Day-of-week is encoded on `program_workouts.day_of_week` (integer 1–7) instead of a separate `program_days` table; rest days are represented as the absence of a `program_workouts` row for that day.

One net-new table is required for trainer client-assignment tracking — there is no existing `program_assignments` analogue in the schema:

```sql
CREATE TABLE program_assignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      uuid NOT NULL REFERENCES workout_programs(id) ON DELETE CASCADE,
  client_id       uuid NOT NULL REFERENCES profiles(id),
  assigned_by     uuid NOT NULL REFERENCES profiles(id),                          -- the trainer; cross-cuts § 1.4 audit also fires
  started_at      date NOT NULL,
  current_week    integer NOT NULL DEFAULT 1,
  status          assignment_status NOT NULL DEFAULT 'assigned',                  -- reuses existing assignmentStatusEnum (assigned/started/completed/skipped) per schema.ts:97
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX program_assignments_program_client_uq ON program_assignments (program_id, client_id);
CREATE INDEX program_assignments_client_status ON program_assignments (client_id, status);
```

Existing `assignmentStatusEnum` (`assigned`/`started`/`completed`/`skipped`) covers the four states the prototype's Programs screen needs; no new enum required.

Optional UI-only column on `workout_programs` (not required for v1; flag in implementation PR if the design's `accent_tone` chrome is needed at backend level rather than client-side):

```sql
-- Optional follow-up if a server-side accent override is wanted; otherwise
-- the client derives accent from the program's index in the trainer's list.
-- ALTER TABLE workout_programs ADD COLUMN accent_tone text DEFAULT 'primary';
```

Endpoints:

| Method | Path                                                                                                             |
| ------ | ---------------------------------------------------------------------------------------------------------------- |
| GET    | `/trainers/me/programs`                                                                                          |
| POST   | `/trainers/me/programs`                                                                                          |
| GET    | `/trainers/me/programs/:id`                                                                                      |
| PUT    | `/trainers/me/programs/:id`                                                                                      |
| DELETE | `/trainers/me/programs/:id`                                                                                      |
| POST   | `/trainers/me/programs/:id/assign` (body: `{ clientId, startedAt }`) — creates `program_assignments` row + audit |
| POST   | `/trainers/me/programs/:id/structure` (bulk-upsert `program_weeks` + `program_workouts` rows for week 1..N)      |

---

## Backend — trainer notes

Existing table `trainerClientNotes` → `trainer_client_notes` (`packages/db/src/schema.ts:908`):

```
trainer_client_notes
  id            uuid PK
  trainer_id    uuid NOT NULL FK → profiles
  client_id     uuid NOT NULL FK → profiles
  note_type     note_type_enum DEFAULT 'progress'   -- values: progress | injury | milestone | concern | general
  title         text NOT NULL
  content       text NOT NULL
  is_private    boolean DEFAULT false
  session_id    uuid FK → workout_sessions ON DELETE SET NULL
  created_at    timestamptz DEFAULT now()
  updated_at    timestamptz DEFAULT now()
  UNIQUE INDEX trainer_client_notes_trainer_client_fk (trainer_id, client_id)
```

**Spec aligns to existing shape — no new table.** The richer existing shape (`note_type`, `title`, `content`, `is_private`, `session_id`) is preserved and exposed:

- `note_type` — drives the Notes section's tone-tinted left border in `<ClientDetailPresenter>`. `<Card accent>` and `<Pill tone>` unions (01 § Card / § Pill) don't include `"warning"`, so the five `note_type_enum` values map onto the available tones as: `progress` → `success`, `injury` → `ember`, `milestone` → `gold`, `concern` → `ember` (urgency-without-failure — matches sweep-4 fix for `streak_at_risk` in `09-notifications-social`), `general` → no accent (renders as a default `<Card>` with no left-border tint).
- `title` + `content` — the spec's earlier `body` field is split. Title shows in the row preview, content in the detail sheet.
- `is_private` — `true` notes never leave the trainer's device-tied view; `false` notes may surface in trainer-to-trainer handover flows when the relationship transfers (post-launch).
- `session_id` — when a note is anchored to a specific session (e.g. "Felt good on the heavy 5×5 today"), links back to the session row for context.

**Existing `UNIQUE (trainer_id, client_id)` constraint is incorrect for "many notes per relationship".** It enforces one-note-per-trainer-client-pair, which contradicts the cross-cuts § 1.4 audit pattern (`client_note_added` event fires multiple times per relationship). **M8 implementation MUST drop the unique constraint and replace with a non-unique index optimised for the per-client timeline read:**

```sql
-- M8 first migration:
DROP INDEX trainer_client_notes_trainer_client_fk;
CREATE INDEX trainer_client_notes_trainer_client_created_idx
  ON trainer_client_notes (trainer_id, client_id, created_at DESC);
```

Visibility enforced by `WHERE trainer_id = self.id` in every read. Client never sees these.

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

Layout authority: `~/Downloads/handoff/design-source/screens/coach-home.jsx` (extracted
verbatim 2026-07-05 from the interactive prototype's inline `CoachHome`). See
**§ Coach Home layout reconciliation** below — the old `coach.jsx:12–48`
reference pointed at `CoachYouScreen`, not Coach Home.

Coach Home is a **daily triage screen**, not the business dashboard. Blocks, top to bottom:

1. **Header** — date eyebrow + "Good morning, Coach" + `IconBell` + `Avatar badge="COACH"` (opens drawer).
2. **Today's Schedule hero** — `<Card>` counting appointments + `<ScheduleRow>` list. **DEFERRED from v1** (see reconciliation below).
3. **"Needs you today"** — flagged clients (`<Card>` of rows, tone-tinted subtitle, tap → Client Detail) + "All clients" link.
4. **Programme alerts** — `<Card>` of rows (programme nearing end, tap → Client Detail / program).
5. **Train yourself** — accented `<Card>` button that switches to athlete mode (`SWITCHES MODE` pill).

```ts
type CoachHomeProps = {
  trainer: { name: string; initials: string };
  flaggedClients: {
    clientId: string;
    name: string;
    initials: string;
    sub: string; // e.g. "4 days idle · Cut wk 6" | "🏆 New PR · Mobility wk 1"
    tone: "error" | "ember" | "gold";
  }[];
  programmeAlerts: {
    clientId: string;
    programId?: string;
    client: string;
    text: string; // e.g. "Strength Foundations ends in 2 weeks"
    tone: "trainer" | "ember";
  }[];
  yourTrainingPeek: {
    streak: number;
    queuedWorkout?: string;
  };
  // v1-DEFERRED — populated only once the appointments domain lands:
  schedule?: {
    start: string;
    end: string;
    clientId: string;
    name: string;
    initials: string;
    kind: "session" | "check-in" | "review";
    tone: string;
    mode: string;
    soon?: boolean;
  }[];
  onOpenDrawer: () => void;
  onTrainYourself: () => void; // switches mode → athlete
  onOpenClient: (clientId: string) => void;
  onOpenClients: () => void;
  onOpenProgram?: (programId: string) => void;
};
```

Sub-presenters: `<FlaggedClientsPresenter>` (rows → Client Detail), `<ProgrammeAlertsPresenter>`, `<TrainYourselfCardPresenter>` (mode switch), and — deferred — `<ScheduleHeroPresenter>` + `<ScheduleRow>`.

### Coach Home layout reconciliation (2026-07-05)

The 2026-05-27 spec described Coach Home as a business dashboard (business-stats
grid, client-health donut, your-training peek, program stats, recent-activity
feed) referencing `coach.jsx:12–48`. That reference and layout are **wrong for
Coach Home**: `coach.jsx:12` is `CoachYouScreen`, the coach's own dashboard,
which is what those blocks actually describe (and is already shipped as
`CoachYouPresenter` per T-10.13.1). The prototype's real Coach Home
(`CoachHome`, inline in `Persistence - Interactive Prototype.html` ~L759–925)
is the daily **triage** screen above. STORY-001's acceptance criteria (AC 1.2–1.7)
still describe the dashboard layout and will be revised to the triage layout when
Coach Home v1 lands (Phase 10.9.1); the business/donut/recent-activity content
lives on Coach You.

### Decision — appointments / scheduling domain DEFERRED (2026-07-05)

The "Today's Schedule" hero (block 2) depends on an appointments/scheduling
domain that **does not exist** — there is no appointments table, no booking
endpoints, no calendar model anywhere in the backend. Rather than invent one to
satisfy a hero card, **appointments/scheduling (and add-to-calendar export) is
parked as its own future spec.** Consequences:

- **Coach Home v1 ships WITHOUT the schedule hero.** The remaining three blocks
  all wire to endpoints that exist today: **flagged clients** derive from
  `GET /trainers/me/clients` (the roster carries per-client 28-day adherence +
  band + last-seen + derivable flags — filter to At-Risk/Wobbling/idle rows; note
  `GET /trainers/me/overview` powers **Coach You**, not Coach Home, so it is NOT the
  flagged-clients source), **programme alerts** from the programs adherence/dashboard
  endpoints (#152), and **train-yourself** from the athlete-mode streak/last-session hooks.
- **Client Detail v1 ships WITHOUT any scheduling / add-to-calendar module.**
- The `CoachHomeProps.schedule` field + `<ScheduleHeroPresenter>` + `<ScheduleRow>`
  are kept in the design (and in the extracted `coach-home.jsx`) so the hero can
  be re-enabled unchanged once the appointments spec lands.

> **Default pending Brad's confirmation** (Phase-0 ping): v1 = no schedule hero.
> If Brad wants a stopgap hero backed by a lightweight appointments table, that
> is a separate scoping decision, not part of this coach-mode completion mandate.

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

## Frontend — Invite by code + QR (STORY-015)

Backend shipped in #136; this is the two-sided mobile wiring.

**Coach side — inside `<AddClientSheetPresenter>`:**

- The sheet gains a second path beside the email-invite form. "Share a code" calls
  `POST /trainers/me/invite-codes` → `{ data: { id, code, expiresAt, isExisting } }`
  (24 h expiry; a still-valid code is reused, `isExisting: true`). **No server-supplied
  deep link** — the client constructs it from `data.code`.
- `data.code` is shown large in `$mono`, tap-to-copy, with `data.expiresAt` as
  "expires in 24h". Below it, a QR renders the deep link.
- **QR generation:** a pure-JS library (e.g. `react-native-qrcode-svg`, SVG-native, no
  native module) draws the matrix into an SVG. This is **rendering only** — the coach
  never scans anything, so there is **no camera permission and no EAS rebuild**. The deep
  link encodes `persistencemobile://accept-invite?code=<data.code>` (app scheme is
  `persistencemobile`, per `packages/mobile/app.json`).
- A `Share.share()` action sends code + link through the OS share sheet.
- Offline: generate is disabled; standard offline banner (mirrors `SnapAISheet`).

**Athlete side — Requests / trainer section on `you.tsx`:**

- A "Have a coach's code?" row opens a small input (bottom sheet or inline field).
- Submit → `POST /trainers/accept-invite-code` `{ code }` → `{ data: { success,
relationshipId, trainerName, message } }`. This creates a **pending**
  `pt_client_relationships` row (status `pending`) and sends the trainer a
  `pt_request` / `physio_request` notification — it does **not** auto-connect. Refresh
  `GET /clients/me/relationships` (the #136 handshake) so "Your trainer" renders the
  **pending request** state ("Training request sent to <trainer>"), awaiting the
  trainer's acceptance. There is no redeem-confirmed notification back to the athlete.
- **New deep-link route:** register `persistencemobile://accept-invite` in the mobile
  router (it does not exist yet) to route here with `code` pre-filled, so a coach's QR
  scanned by any generic reader lands on redeem.
- Invalid/expired/redeemed → inline error from the endpoint; no row created.

No new backend, no new native permissions, no migration. Pure frontend + a JS QR dep +
one new deep-link route.

---

## Frontend — Notification triggers

Per cross-cuts § 5, this spec emits:

| Trigger                                                 | Event                              | Enum status                |
| ------------------------------------------------------- | ---------------------------------- | -------------------------- |
| Trainer assigns goal                                    | `goal_assigned_by_trainer`         | **NEW — needs ALTER TYPE** |
| Trainer assigns workout                                 | `workout_assigned`                 | Existing (`schema.ts:140`) |
| Trainer logs workout on behalf                          | `workout_logged_on_behalf`         | **NEW — needs ALTER TYPE** |
| Trainer logs measurement on behalf                      | `measurement_logged_on_behalf`     | **NEW — needs ALTER TYPE** |
| Trainer sets nutrition target                           | `nutrition_target_set_by_trainer`  | **NEW — needs ALTER TYPE** |
| (Tier C / M9.5+) Trainer logs nutrition entry on behalf | `nutrition_entry_logged_on_behalf` | **NEW — needs ALTER TYPE** |

**Enum-extension requirement (per cross-cuts § 5 + `09-notifications-social § Backend — enum-extension contract`).** The live `notification_type` Postgres enum at `packages/db/src/schema.ts:139` includes `workout_assigned` but none of the other five values. The first M8 backend PR that emits any of these MUST coordinate a companion migration owned by `09-notifications-social`:

```sql
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'goal_assigned_by_trainer';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'workout_logged_on_behalf';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'measurement_logged_on_behalf';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'nutrition_target_set_by_trainer';
-- M9.5 cut (deferred until trainer-nutrition-on-behalf ships):
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'nutrition_entry_logged_on_behalf';
```

Without the migration sequenced BEFORE the on-behalf handlers ship, the first `INSERT INTO notifications` for any new type fails at runtime with `invalid input value for enum notification_type`. Per the cross-cuts § 5 procedure, the same PR also appends the new types to the cross-cuts taxonomy table (already done in PR #76) + extends `09-notifications-social/design.md § Frontend — domain models` `NotificationType` union (already done).

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
