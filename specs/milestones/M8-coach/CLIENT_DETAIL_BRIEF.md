# M8 Coach — Client Detail (read-only v1) brief

> Vertical slice, backend-then-frontend, one PR (two agents) — same shape as Coach You (#123)
> and Clients list (#125). This is the **row-tap target** from the Clients roster: replaces the
> `app/(app)/clients/[id]` `ComingSoon` stub with the real client screen.
>
> **Scope = READ-ONLY v1.** All on-behalf _writes_ (log session, assign workout/goal, set
> targets, add note) + their audit infrastructure are the NEXT slice, not this one. Several
> prototype sections depend on infra that doesn't exist yet (programmes, nutrition, AI, health)
> and ship as clearly-marked placeholders here — each later slice fills one in.

## Context

Coach mode, the `trainers/` backend foundation, Coach You (#123), and the Clients roster (#125)
are in. Tapping a roster row currently pushes a `ComingSoon` stub. This slice builds the actual
Client Detail view and the first **per-client read endpoint**, which also introduces the
`assertTrainerCanActForClient` authorization helper that every future per-client route depends on.

**Authoritative sources**

- Prototype (port 1:1): `~/Downloads/handoff/design-source/screens/client-detail.jsx` →
  `ClientDetailScreen` (16–75) and its section components: `ClientHeader` (78), `LiveSessionCTA`
  (112), `QuickActionsRow` (174), `AISummaryCard` (200), `GoalCard` (344), `TargetsCard` (398),
  `ThisWeekCard` (436), `AdherenceBreakdown` (516), `ProgrammeCard` (564), `CoachNotesCard` (595).
- Spec: `specs/10-trainer-features/requirements.md` STORY-003 (+ STORY-014 AI stub); `tasks.md`
  T-10.9.3, T-10.2 (`assertTrainerCanActForClient`), T-10.5.1 (notes read).
- Cross-cuts: `specs/_shared/cross-cuts.md` § 1.3 (`assertTrainerCanActForClient`).
- Reuse: `microservices/core/src/application/repositories/trainerRepository.ts` (#123/#125) and the
  athlete progress repos (`streakRepository`, volume/PR/measurement repos from `06-progress-goals`)
  — call them with the **client's** userId after the relationship check.

**⚠ Prototype vs spec conflict (prototype wins — see memory `feedback_prototype_first_source_of_truth`).**
`design.md § Frontend — Client Detail` describes a **5-tab strip** (Overview/Workouts/Nutrition/
Notes/Settings). The prototype is a **single scrolling screen** with the sections above. **Build
the single-scroll prototype layout**, and fix the spec's 5-tab description in the same PR (note it
in the PR body).

---

## Backend slice (agent 1 — lands first)

### 1. `assertTrainerCanActForClient(trainerId, clientId)` (foundational — cross-cuts § 1.3)

New shared helper (put it in `trainerRepository.ts` next to `isTrainer`, or a small
`relationships` helper if cleaner). Throws / returns false when there is no **active**
`pt_client_relationships` row for `(trainerId, clientId)`. Every per-client route — this one and
all future on-behalf routes — calls it. The handler maps a failure to **403** (use a typed error
like the existing `InviteError`, or a boolean the handler checks). Unit-test: active rel → ok;
missing / pending / inactive / terminated / wrong-trainer → 403.

### 2. `GET /trainers/me/clients/:clientId` → `{ data: ClientDetail }` (trainer-role-gated + relationship-gated)

One aggregate for the whole screen. Reuse the client-progress computations by passing the
**client's** userId. No migrations.

```ts
interface ClientDetail {
  client: {
    id: string;
    name: string;
    initials: string;
    avatarUrl: string | null;
    status: "active" | "pending";
    ageYears: number | null; // from profiles DOB if present, else null
    heightCm: number | null; // from profiles if present, else null
  };
  goal: {
    // client's primary user_goals row, or null
    title: string;
    weight: {
      startKg: number | null;
      nowKg: number | null;
      targetKg: number | null;
    };
    pct: number | null; // progress 0..1 (start→target), null if not computable
  } | null;
  thisWeek: {
    // client's own data, current week (UTC)
    workoutsCompleted: number;
    workoutsPlanned: number | null; // planned null until programmes
    volumeKg: number | null;
    prs: number;
    checkIns: number | null;
  };
  adherence: {
    // v1: workouts category only (see note)
    overall: number | null; // = workouts-completed % this window (reuse getAdherenceRows)
    band: "stellar" | "strong" | "wobbling" | "atRisk" | "crisis" | null;
    categories: {
      label: string;
      pct: number | null;
      sub: string;
      available: boolean;
    }[];
  };
  recentSessions: {
    id: string;
    name: string | null;
    completedAt: string;
    volumeKg: number | null;
  }[]; // last ~10
  notes: {
    id: string;
    noteType: string;
    title: string;
    content: string;
    createdAt: string;
  }[]; // read-only (WHERE trainer_id = self)
}
```

**Per-field v1 rules (document in code):**

- `ageYears`/`heightCm`: only if `profiles` actually has the columns; else null (header hides them). Check the schema before assuming.
- `goal`: most recent active `user_goals` for the client + weight from `body_measurements` (start = earliest in window, now = latest, target from the goal if present). Null when the client has no goal.
- `thisWeek`: reuse session/volume/PR computations for the client's userId; `workoutsPlanned` is **null** (needs `program_assignments`).
- `adherence.overall` + `band`: reuse `getAdherenceRows` + the 5-band classifier for the client. `categories` returns the 5 prototype rows but with `available:false` + `pct:null` for everything except "Workouts completed" — calorie/protein/check-in/sleep need M9 nutrition + HealthKit (not merged). The presenter renders unavailable rows muted/"—".
- `recentSessions`: client's completed `workout_sessions`, newest first, ~10.
- `notes`: `trainer_client_notes` WHERE `trainer_id = me AND client_id = :clientId`, newest first. **Read only.** Visibility test: another trainer's notes for the same client never returned.

**Tests (90%):** `assertTrainerCanActForClient` (all relationship states); endpoint 403 for non-trainer and for no-active-relationship; aggregate shape with a populated client; null/empty fallbacks (no goal, no sessions, no notes); notes never leak across trainers. Mock `getDb` per the existing trainerRepository test patterns.

---

## Frontend slice (agent 2 — depends on backend)

### 1. Route — replace the stub

`app/(app)/clients/[id]/index.tsx` currently renders `ComingSoon`. Replace with
`<ClientDetailContainer clientId={id} />`. **Gate it:** if `useUserMode().mode !== 'coach'`,
redirect to `(app)/(tabs)/index` (per `design.md § risks` — a mode flip mustn't strand the user
on a coach-only route).

### 2. Data layer (offline-first, mirror #123/#125)

- Domain model `src/domain/models/clientDetail.ts` (the `ClientDetail` shape).
- `ApiPort.getClientDetail(clientId)` + impls in the SST adapter **and** in-memory double.
- `StoragePort.getCachedClientDetail/cacheClientDetail` keyed by `userId:clientId` + both adapters.
- `useGetClientDetail(clientId)` via `useCachedResource`.

### 3. `<ClientDetailContainer>` + `<ClientDetailPresenter>` (single-scroll, port 1:1)

Mirror `CoachYouContainer`/`Presenter`. Sub-presenters under `src/ui/presenters/coach/`. Port the
prototype section order exactly. Section-by-section v1 state:

| Prototype section                                                                        | v1 state                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClientHeader` (back to Clients, avatar gold, name, age·height·program, MISSED/WK pills) | **Real** — name/avatar/status; age·height only if present; MISSED from flags; **WK pill hidden** (no programme yet). Message/more icons are no-ops.                                                           |
| `LiveSessionCTA` ("today's session" + Start / Log past)                                  | **Placeholder** — "No active programme" empty state. Start/Log-past are on-behalf (next slice).                                                                                                               |
| `QuickActionsRow` (Assign / Macros / Goals / Schedule)                                   | **Render, disabled** — wired in the on-behalf slice.                                                                                                                                                          |
| `AISummaryCard`                                                                          | **Stub per STORY-014** — "AI insights coming soon", Regenerate locked. (Build `AISummaryCardPresenter`.)                                                                                                      |
| `GoalCard` (primary goal + start/now/target weight axis)                                 | **Real** (read-only; edit pencil disabled). Hidden when `goal` is null.                                                                                                                                       |
| `TargetsCard` (calories/protein/workouts/volume)                                         | **Placeholder** — "Targets arrive with Fuel (M9)".                                                                                                                                                            |
| `ThisWeekCard` (4 mini-stats + daily activity chart)                                     | **Real** mini-stats (workouts/volume/PRs/check-ins; show "—" for null). Daily-activity bar chart: port the visual but drive from real sessions where possible, else render the bar shell with available data. |
| `AdherenceBreakdown`                                                                     | **Real overall + band**; only the "Workouts completed" category is live, the rest render muted with "—" + an "available with Fuel/Health" hint (driven by `category.available`).                              |
| `ProgrammeCard` (week progress bars)                                                     | **Placeholder** — "No programme assigned".                                                                                                                                                                    |
| `CoachNotesCard` (private notes list + add)                                              | **Read-only** — render the notes list; the `+` is disabled (add lands with the on-behalf/notes slice).                                                                                                        |

Trainer accent throughout; `ScrollView` + pull-to-refresh; cache-first (render stale while
refreshing); loader/error/empty states like `CoachYouPresenter`. Reuse existing primitives
(`Card`, `Pill`, `Bar`, `Avatar`, `HeaderBar`/back, `IconBtn`, the `relativeTime` helper from
`RecentActivityFeedPresenter`). Reuse athlete progress sub-presenters (`BodyTrend`/weight axis,
volume) where they fit rather than rebuilding.

### 4. Tests (90%)

Each sub-presenter renders (real + placeholder + null states); container hook-integration with the
in-memory adapter; the mode-gate redirect (athlete mode → bounced); notes-empty and notes-list;
adherence with only workouts available. Add the new ApiPort/StoragePort methods to any
port-contract enumeration tests.

---

## Verification

- Backend: `bun run typecheck && bun run lint && bun run test:unit && bun run prettier:check`.
  Exercise `GET /trainers/me/clients/:clientId` against a trainer + active client; confirm 403 for
  a client the trainer has no active relationship with, and that notes don't leak across trainers.
- Frontend: same gates. Expo, trainer + coach mode → Clients → tap a row → the detail screen
  renders (was the stub); placeholders read as "coming soon", real sections show the client's data;
  switching to athlete mode while on the screen bounces home.

## Out of scope → the slices after this

- **On-behalf writes + audit** (the natural next slice): `trainer_actions_audit` table + `action_type_enum` migration (10.1), `auditTrainerAction` helper (10.2), and the write endpoints/sheets — Add Note, Assign Workout, Assign Goal, Set Targets, Log session for client (10.3/10.10/10.11). This fills the disabled Quick Actions, the Notes `+`, and the Live-session CTA.
- **Programmes** (10.4/10.12): `program_assignments` table → fills ProgrammeCard, the WK pill, `workoutsPlanned`, and the Clients-roster `programLabel`/"Programme ends".
- **Nutrition targets on this screen**: depends on M9 (separate agent) → fills TargetsCard + the nutrition adherence categories.
- **AI summary content**: M9.5 / Tier B → replaces the STORY-014 stub.
- **Coach Home** still needs a design decision (what differentiates it from Coach You).
