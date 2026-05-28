# 06 — Progress, Goals & Home: Design

> **Spec rewritten from scratch on 2026-05-27.** Pairs with `requirements.md`.

---

## Architecture overview

```
microservices/core/src/application/
├── progress/                            ← NEW: weekly volume, by-muscle, body-trend aggregations
├── streaks/                             ← per cross-cuts § 3: engine + cron
├── achievements/                        ← per cross-cuts § 3.6: trigger writer
├── habits/                              ← per cross-cuts § 3.3
├── personal-records/                    ← existing V1 logic, ported
└── goals/                               ← existing; extended for streak source link

packages/mobile/
├── app/(app)/(tabs)/
│   ├── index.tsx                        ← HomeContainer (athlete) | CoachHomeContainer (mode === 'coach')
│   └── you.tsx                          ← YouContainer
├── src/
│   ├── application/
│   │   ├── home/                        ← NEW: orchestrates ring + carousel + habits + volume + PRs reads
│   │   ├── progress/                    ← NEW: lifetime view orchestration
│   │   ├── streaks/                     ← NEW: client-side streak count derivation from cache
│   │   ├── habits/                      ← NEW: useGetHabits + useToggleHabitDay
│   │   └── measurements/                ← existing extended
│   ├── domain/models/
│   │   ├── streak.ts                    ← NEW
│   │   ├── habit-completion.ts          ← NEW
│   │   ├── achievement.ts               ← NEW
│   │   └── personal-record.ts           ← NEW (or extend existing)
│   ├── adapters/api/
│   │   └── … (new HTTP clients for the new endpoints)
│   └── ui/
│       ├── containers/
│       │   ├── HomeContainer.tsx
│       │   ├── YouContainer.tsx
│       │   ├── WeighInSheetContainer.tsx
│       │   └── HabitsGridContainer.tsx
│       └── presenters/
│           ├── HomePresenter.tsx
│           ├── YouPresenter.tsx
│           ├── TodayHeroPresenter.tsx
│           ├── HabitsGridPresenter.tsx
│           ├── QuickLogStripPresenter.tsx
│           ├── WeeklyVolumePresenter.tsx
│           ├── PRCarouselPresenter.tsx
│           ├── CoachQuickPeekPresenter.tsx
│           ├── StreakHeroPresenter.tsx
│           ├── MilestonesRowPresenter.tsx
│           ├── BodyTrendPresenter.tsx
│           ├── VolumeStatsPresenter.tsx
│           ├── PRHistoryPresenter.tsx
│           └── WeighInSheetPresenter.tsx
```

---

## Backend audit

Per locked decision #11 and STORY-010. Splits the M4 backend surface into what's already shipped (PR #77 spec extension lays the groundwork; the prior M4 milestone brief previously lived at `specs/milestones/M4-progress/` — that folder is deleted as of the design-port rewrite PR, git history is canonical) vs what's net new for this rewrite.

### Already exists in V2 / specced in PR #77 cross-cuts integration

| Endpoint                                                                                                               | Purpose                                                          |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `GET /users/me/profile`                                                                                                | User metadata for Home greeting + drawer                         |
| `GET /workouts`                                                                                                        | Workouts list — consumed by Home carousel                        |
| `GET /sessions`                                                                                                        | Session history — feeds PR detection + weekly volume aggregation |
| `POST /measurements`, `GET /measurements`                                                                              | Body-measurement reads + writes (existing)                       |
| `POST /habit-completions`                                                                                              | Habit toggle (per cross-cuts § 3.3)                              |
| `GET /habit-completions?goalId=&window=7d`                                                                             | Habit completion reads (per cross-cuts § 3.3)                    |
| Tables: `user_goals`, `user_streaks`, `habit_completions`, `streak_type_enum`, `body_measurements`, `personal_records` | All defined by PR #77 + this spec's design                       |
| Streak engine (`evaluateStreaks` + nightly cron at 02:00 UTC)                                                          | Per cross-cuts § 3                                               |
| Notification taxonomy entries (`streak_milestone`, `streak_at_risk`, `freeze_token_applied`, `goal_milestone`)         | Per cross-cuts § 5                                               |

### Net-new for this rewrite

| Endpoint                                                                                              | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /users/me/home`                                                                                  | Aggregated read for Home — returns `{ rings, todayWorkout[], habits[], weeklyVolume, recentPRs }` in a single request. Reduces round-trips for the cold-start ring render.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /users/me/today-rings`                                                                           | Just the rings data — `{ move: { current, target, pct }, train: { … }, fuel: { … } }`. Stand-alone in case Home expansion is needed elsewhere (e.g. widget).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET /users/me/weekly-volume?window=7d`                                                               | 7-day breakdown for the Weekly Volume bar chart. `[{ date, volumeKg, isRest, isToday }, …]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `GET /users/me/volume-stats?window=month`                                                             | Lifetime view stats — workouts count, total volume tonnes, adherence %, volume-by-muscle array.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `GET /users/me/body-trend?window=30d`                                                                 | Body-measurement trend — `[{ date, weightKg, bodyFat?, … }, …]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `GET /users/me/prs?limit=N&order=achieved_at desc`                                                    | PR list (Home carousel + You history). Reads `personal_records` joined to `exercises` for the name.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `GET /users/me/achievements`                                                                          | All achievements unlocked. Reads `user_achievements` joined to `achievements` for tier metadata.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **Existing table** `personal_records` (`packages/db/src/schema.ts:492`)                               | `(id, user_id, exercise_id, record_type record_type_enum, value decimal(10,2), set_id, achieved_at)` + `UNIQUE (user_id, exercise_id, record_type)`. Enum values: `'1rm','3rm','5rm','10rm','max_reps','max_weight','max_volume','best_time','longest_distance'`. **Spec aligns to this shape — no new migration.**                                                                                                                                                                                                                                                                                                                                |
| **Existing tables** `achievements` + `user_achievements` (`packages/db/src/schema.ts:540` and `:550`) | `achievements` is a lookup: `(id, name, description, category achievement_category_enum, requirements jsonb, icon_url, created_at)`. `user_achievements` is the unlock record: `(id, user_id, achievement_id FK → achievements.id, unlocked_at)` + `UNIQUE (user_id, achievement_id)`. **Spec aligns to this shape — no new migration.**                                                                                                                                                                                                                                                                                                           |
| **Data migration** — seed `achievements` rows for cross-cuts § 3.6 tiers                              | For each (streak type × tier) in cross-cuts § 3.6, INSERT one `achievements` row with `category='streak'`, `requirements={ streak_type: 'workout_streak', threshold: 4 }` etc. Idempotent (upsert by `name`). Lookup by `(category, requirements)` JSONB equality when inserting `user_achievements` rows.                                                                                                                                                                                                                                                                                                                                         |
| Server-side PR detection on `PUT /sessions/:id { endedAt }`                                           | Inspects just-logged sets, compares to user's max per `(exercise_id, record_type)`. For each record_type the session could move (`'1rm','3rm','5rm','10rm','max_weight','max_volume'` per `feedback_pr_detection_legacy_parity.md` — exact-rep match on `1rm/3rm/5rm/10rm`, no Epley estimates). Reads prior `value` (if any) before insert so the response can carry `previousValue` to the summary screen; the DB stores only the current row (UNIQUE (user_id, exercise_id, record_type) enforces one-per-record-type, prior rows are overwritten). Emits `streak_milestone` / PR notification per cross-cuts § 5 when a new record_type lands. |
| Server-side volume aggregation cron                                                                   | Daily 03:00 UTC sweep that materialises `weekly_volume_per_user` + `volume_by_muscle_per_user` tables for quick reads. Recomputes on session completion as backup.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

Migration block owned by this spec (per cross-cuts § 6).

---

## Streak engine implementation

Per `_shared/cross-cuts.md § 3` verbatim. Reproduced below for spec-side reference; cross-cuts.md is the source of truth.

### `user_streaks` table

```sql
CREATE TABLE user_streaks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES profiles(id),
  streak_type       streak_type_enum NOT NULL,
  source_goal_id    uuid REFERENCES user_goals(id),
  period            text NOT NULL CHECK (period IN ('daily','weekly','monthly')),
  current_count     integer NOT NULL DEFAULT 0,
  longest_count     integer NOT NULL DEFAULT 0,
  last_period_end   date NOT NULL,
  freeze_tokens     integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active','broken','paused')),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);
-- Partial uniqueness is not valid inline in CREATE TABLE (Postgres restricts
-- WHERE clauses to indexes). Implements cross-cuts § 3.2's "one user_streak
-- per source_goal_id" constraint for non-NULL source_goal_id rows.
CREATE UNIQUE INDEX user_streaks_user_source_goal_uq
  ON user_streaks (user_id, source_goal_id)
  WHERE source_goal_id IS NOT NULL;
CREATE INDEX user_streaks_user_status ON user_streaks (user_id, status);
```

### `habit_completions` table

```sql
CREATE TABLE habit_completions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES profiles(id),
  goal_id         uuid NOT NULL REFERENCES user_goals(id),
  completed_at    timestamptz NOT NULL,
  value           numeric
);
-- Inline UNIQUE constraints can't carry expressions; lift to an expression
-- index. Two-argument `date_trunc(text, timestamptz)` is STABLE (depends on
-- session TimeZone), so Postgres rejects it in an index. Cast through
-- `AT TIME ZONE 'UTC'` to coerce to `timestamp without time zone` — that
-- overload of date_trunc is IMMUTABLE and index-safe.
CREATE UNIQUE INDEX habit_completions_user_goal_day_uq
  ON habit_completions (user_id, goal_id, (date_trunc('day', completed_at AT TIME ZONE 'UTC')));
CREATE INDEX habit_completions_user_goal_ts ON habit_completions (user_id, goal_id, completed_at DESC);
```

**Note on UTC bucketing vs user-local time.** This index enforces "one completion per user / goal / **UTC** day". Cross-cuts § 3.4 specifies that streak periods are evaluated against user-local time (using `profiles.timezone`, default `Europe/London`). The two layers are intentionally different:

- The DB index bucket is UTC because expression indexes require an IMMUTABLE expression — we can't index against a per-row timezone.
- The streak engine reads completions at query time using `date_trunc('day', completed_at AT TIME ZONE user.tz)` to group by user-local day. The streak's `current_count` advance depends on the user-local bucket, not the index bucket.
- The mismatch is benign: a user can theoretically log two completions on the same user-local day if those completions straddle UTC midnight (e.g. 23:30 local in California maps to 06:30 UTC; 01:30 next-local-day maps to 08:30 UTC — different UTC days). Both rows persist; the streak engine groups them as one local-day for streak-advance purposes.
- If stricter user-local-per-day uniqueness becomes a requirement, follow-up adds a `local_completion_date date` denormalised column populated by the writer + uniqueness on `(user_id, goal_id, local_completion_date)`. Out of scope for v1.

### `streak_type_enum` values

```
workout_streak     -- weekly
habit_streak       -- daily
measurement_streak -- weekly
nutrition_streak   -- daily (M9-gated)
```

### Engine entrypoint

```ts
// microservices/core/src/application/streaks/engine.ts
export async function evaluateStreaks(
  userId: string,
  eventType:
    | "workout_logged"
    | "habit_completed"
    | "measurement_logged"
    | "nutrition_in_target",
  ts: Date,
): Promise<{ advanced: Streak[]; milestones: Achievement[] }> {
  // 1. Find all active user_streaks rows for user_id where streak_type matches the event.
  // 2. For each: compute period boundary in user-local TZ.
  // 3. If `ts` falls in a new period AND threshold met: advance current_count, update longest_count, last_period_end.
  // 4. If current_count crosses a milestone threshold: insert user_achievements row + emit notification.
  // 5. Return advanced streaks + milestones for caller's logging.
}
```

### Nightly cron

```ts
// microservices/core/src/application/streaks/cron.ts
// Scheduled at 02:00 UTC.
export async function streakCron() {
  // Sweep all user_streaks where status = 'active' AND last_period_end < (today - 1 day per user TZ).
  // For each:
  //   if freeze_tokens > 0: decrement, set last_period_end = yesterday, emit freeze_token_applied notification.
  //   else: set status = 'broken', current_count = 0, emit streak_lost (if a streak event of that type is defined).
}
```

### Achievement triggers (per cross-cuts § 3.6)

```ts
const MILESTONES = {
  weekly: [1, 2, 4, 8, 12],
  daily: [7, 14, 28, 60, 90],
};

const ACHIEVEMENT_ICONS = {
  // weekly tiers
  "workout_streak/1": { icon: "IconFire", tone: "ember" },
  "workout_streak/2": { icon: "IconBolt", tone: "primary" },
  "workout_streak/4": { icon: "IconDumbbell", tone: "gold" },
  "workout_streak/8": { icon: "IconMedal", tone: "trainer" },
  "workout_streak/12": { icon: "IconCrown", tone: "gold" },
  // … same pattern for habit_streak / measurement_streak / nutrition_streak with their daily tiers
};
```

---

## Home composition — presenter contracts

### `<HomePresenter>`

```ts
type HomeProps = {
  user: { name: string; initials: string };
  date: Date;
  rings: { move: RingData; train: RingData; fuel: RingData | "gated" };
  micro: { streak: number; water: string; strain: number; sleep: string };
  todayWorkout: Workout | null;
  workoutSuggestions: Workout[];
  habits: Habit[];
  weeklyVolume: WeeklyVolume;
  recentPRs: PR[];
  showCoachPeek: boolean;
  coachPeek?: { clientCount: number; needAttention: number; newPRs: number };

  onOpenWorkout: (workoutId: string) => void;
  onOpenTab: (tab: "train" | "fuel" | "you" | "progress") => void;
  onOpenWeighIn: () => void;
  onOpenMealLog: () => void;
  onLogWater: () => void;
  onLogMood: () => void;
  onToggleHabitDay: (goalId: string, date: Date) => void;
  onOpenCoach: () => void;
  onOpenDrawer: () => void;
};
```

Composition per `home.jsx:21–63` + the locked decisions. Sub-presenters: `<TodayHeroPresenter>`, `<HabitsGridPresenter>` (data-aware), `<QuickLogStripPresenter>`, `<WeeklyVolumePresenter>`, `<PRCarouselPresenter>` (composes `<PRCard>`), `<CoachQuickPeekPresenter>`.

### `<TodayHeroPresenter>`

```ts
type TodayHeroProps = {
  rings: {
    move: { current: number; target: number; pct: number; unit: string };
    train: { current: number; target: number; pct: number; unit: string };
    fuel:
      | { current: number; target: number; pct: number; unit: string }
      | "gated";
  };
  micro: { streak: number; water: string; strain: number; sleep: string };
  onOpenMove: () => void;
  onOpenTrain: () => void;
  onOpenFuel: () => void;
};
```

Layout per `home.jsx:83–120`. `<MultiRing>` outer = move, middle = train, inner = fuel (or `'gated'` shows the ring with 0% fill + `--` legend value).

### `<HabitsGridContainer>` + `<HabitsGridPresenter>`

```ts
// Container
const habits = useGetHabits();           // returns Habit[] with 7-day completion array
const toggle = useToggleHabitDay();      // mutation hook
return <HabitsGridPresenter habits={habits.data} onToggle={(goalId, date) => toggle.mutate({ goalId, date })} />;

// Presenter
type HabitsGridProps = {
  habits: { id: string; label: string; tone: HabitTileTone; days: boolean[] }[];   // days array length 7, today is last
  onToggle: (goalId: string, date: Date) => void;
};

// Re-exported from 01-design-system to keep <HabitsGrid> aligned with <HabitTile>:
//   HabitTileTone = "primary" | "gold" | "trainer" | "ember" | "success"
// Narrower than PillTone (which includes "neutral" and "error"). The container
// (HabitsGridContainer) is responsible for mapping any goal-level tone hint
// to a value in this 5-element subset before constructing each habit row.
```

Each cell renders as `<HabitTile>` (from `01-design-system`) with the appropriate state.

---

## You / Progress composition

### `<YouPresenter>`

```ts
type YouProps = {
  user: { initials: string; totalWorkouts: number };
  streak: { current: number; longest: number; freezeTokens: number };
  milestones: {
    tier: string;
    earned: boolean;
    tone: PillTone;
    icon: IconName;
  }[];
  bodyTrend: { weight: TrendData; bodyFat: TrendData };
  volumeStats: {
    workouts: number;
    totalKg: number;
    adherencePct: number;
    byMuscle: { muscle: string; pct: number; kg: number }[];
  };
  prHistory: PR[];

  onOpenDrawer: () => void;
  onOpenCalendar: () => void;
  onUseFreezeToken: () => void;
  onOpenPRSeeAll: () => void;
};
```

Sub-presenters: `<StreakHeroPresenter>`, `<MilestonesRowPresenter>`, `<BodyTrendPresenter>` (two `<Card>`s with SVG sparkline + bar chart), `<VolumeStatsPresenter>`, `<PRHistoryPresenter>`.

### `<BodyTrendPresenter>`

Per `progress.jsx:141–194`. Two cards side-by-side:

```ts
type BodyTrendProps = {
  weight: {
    current: number;
    unit: "kg" | "lb";
    deltaKg: number;
    series: number[];
  };
  bodyFat: { current: number; deltaPct: number; series: number[] };
};
```

Weight card: stat header + SVG sparkline with area-fill gradient + last-point dot. Body fat card: stat header + bar chart with `$primaryDim` fill + `$primary` top border.

SVG dimensions: 320 × 80 viewBox. Path computed from series via `d = pts.map(([x, y], i) => i === 0 ? \`M ${x} ${y}\` : \`L ${x} ${y}\`).join(' ')`(each`pts`entry is a`[x, y]` tuple — destructure inside the callback).

For future-proofing the chart library swap (e.g. `victory-native`): the SVG path computation is wrapped in a `computePath(series, dims): string` pure function — easy to replace.

---

## Frontend hooks (new + extended)

```ts
// packages/mobile/src/ui/hooks/
useGetHome(); // GET /users/me/home — aggregate
useGetTodayRings(); // GET /users/me/today-rings
useGetMyWorkouts(); // existing
useGetHabits(); // GET /habit-completions?window=7d + user_goals join
useToggleHabitDay(); // POST /habit-completions (idempotent, optimistic)
useGetWeeklyVolume(); // GET /users/me/weekly-volume
useGetRecentPRs(limit); // GET /users/me/prs?limit=&order=achieved_at desc
useGetVolumeStats(); // GET /users/me/volume-stats
useGetBodyMeasurements(window); // existing extended (window param)
useGetPRHistory(); // GET /users/me/prs?limit=20
useGetAchievements(); // GET /users/me/achievements
useLogMeasurement(); // existing POST /measurements
useUseFreezeToken(); // POST /users/me/streaks/:id/use-token (new)
```

Each hook hits the SQLite cache first then refreshes from API per `_agent.md § Offline-First Architecture`.

---

## Offline behaviour

### Reads

All Home + You data flows through cached repositories. Cold-start renders from cache; background refresh updates the screen.

### Writes

| Mutation         | Optimistic behaviour                                                                                                    | Conflict resolution                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Habit toggle     | Cell flips immediately + cache write to `habit_completions`; streak engine evaluation deferred until next API roundtrip | Server-wins: if server already had the completion (deduplicated by unique constraint), engine doesn't re-advance |
| Weigh-in         | New measurement appears in cache; body-trend sparkline reflects on next render                                          | Server-wins                                                                                                      |
| Water / Mood log | Same pattern — optimistic cache + sync queue                                                                            |

### Streak count derivation client-side

When offline, the client derives "current streak" from cached `habit_completions` by walking back from today:

```ts
function deriveStreak(
  completions: HabitCompletion[],
  today: Date,
  period: "daily" | "weekly",
): number {
  // Walk back day-by-day or week-by-week from today.
  // Count consecutive periods with at least one completion.
  // Stop when a period has none.
}
```

On reconnect, the server-side engine reconciles + the cache refreshes. If client derived 5 but server says 6 (because of a freeze-token spend), server wins.

---

## Drizzle migrations

Per cross-cuts § 6:

1. **M4 (this spec) ships as schema migrations:**
   - `user_goals.assigned_by_user_id` (nullable, for trainer-assigned goals per cross-cuts § 2)
   - `user_goals.target_value`, `current_value`, `unit` (extension for goal progress)
   - `user_streaks` table + `streak_type_enum`
   - `habit_completions` table
   - `workout_sessions.logged_by_user_id` (nullable, populated by M8 later)
   - `body_measurements.logged_by_user_id` (nullable, populated by M8 later)

2. **NOT shipped as schema migrations — both tables already exist on the live schema (per the reconciled "Already exists in V2" audit at § Backend audit):**
   - `personal_records` — `packages/db/src/schema.ts:492`. Existing `(id, user_id, exercise_id, record_type, value, set_id, achieved_at)` shape is what this spec reads + writes.
   - `user_achievements` — `packages/db/src/schema.ts:550`. Existing FK-to-`achievements` shape is what this spec reads + writes.
   - Running `CREATE TABLE` on either fails with `relation already exists` — do not include them in the M4 migration block.

3. **M4 also ships as a data migration (not schema):**
   - Seed rows in the existing `achievements` lookup table for every (streak type × tier) in cross-cuts § 3.6. Each row: `category='streak'`, `requirements` JSONB `{ streak_type, threshold }`. Idempotent upsert by `name`. The streak engine looks up `achievement_id` by JSONB equality on insertion to `user_achievements`.

Schema migrations land as one block in the first M4 PR. The achievements seed lands in the same PR as a separate data-migration file (so rollback can target just the seed).

---

## Notification triggers

Per cross-cuts § 5. This spec emits:

| Trigger                                          | Event                  | Default opt-in | Enum status                |
| ------------------------------------------------ | ---------------------- | -------------- | -------------------------- |
| Streak milestone hit                             | `streak_milestone`     | on             | **NEW — needs ALTER TYPE** |
| Streak about to expire (last day, not satisfied) | `streak_at_risk`       | on             | **NEW — needs ALTER TYPE** |
| Freeze token auto-applied                        | `freeze_token_applied` | on             | **NEW — needs ALTER TYPE** |
| Goal milestone (% of target reached)             | `goal_milestone`       | on             | Existing (`schema.ts:147`) |

**Enum-extension requirement (per cross-cuts § 5 + `09-notifications-social § Backend — enum-extension contract`).** The live `notification_type` Postgres enum at `packages/db/src/schema.ts:139` includes `'workout_assigned','friend_request','pt_request','pt_accepted','physio_request','physio_accepted','workout_reminder','goal_milestone','trainer_feedback'`. Three of the four triggers above introduce NEW values. The first M4 PR that emits any of these MUST coordinate a companion migration owned by `09-notifications-social`:

```sql
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'streak_milestone';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'streak_at_risk';
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'freeze_token_applied';
```

Without this migration sequenced BEFORE the streak engine ships, the first `INSERT INTO notifications` for any of the three new types fails at runtime with `invalid input value for enum notification_type`. Per the cross-cuts § 5 procedure, the same PR also appends the new types to the cross-cuts taxonomy table (already done in PR #76) + extends `09-notifications-social/design.md § Frontend — domain models` `NotificationType` union (already done).

Implementation: emit via M7-defined notification dispatcher. M7 (`09-notifications-social`) owns delivery + rendering.

---

## Testing strategy

### Unit tests

- `evaluateStreaks` engine — every event type, period rollover scenarios, milestone advancement, freeze-token spend, eligibility-loss edge cases.
- Streak cron — missed-period detection + freeze-token spend + status transition.
- `deriveStreak` client-side helper — daily + weekly walks, edge cases (empty cache, future-dated completions, gaps).
- Each presenter — props → render, sub-presenter integration.

### Integration tests

- Cold-start Home with SQLite seeded → assert TodayHero rings render with correct percentages.
- Habit toggle offline → assert optimistic flip + queue write; reconnect → assert sync flush + engine evaluation.
- Session completion → assert PR detection + insertion + notification emission.
- Weigh-in offline → assert sparkline updates on next render.

### Visual regression

- `<HomePresenter>` vs `home.jsx`.
- `<YouPresenter>` vs `progress.jsx` + `prototype-hubs.jsx:152–289` (the alternate You hub layout).

### Coverage

90% per `_agent.md § Quality Gates`. Streak engine + cron especially — they're high-stakes correctness code.

---

## Risks + mitigations

| Risk                                                                       | Mitigation                                                                                                                                                                             |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Volume aggregation cron lag → Home shows stale weekly volume               | Recompute on session completion as backup, not just on the 03:00 cron. Two-write redundancy.                                                                                           |
| Body-trend sparkline performance with 30 data points × multiple components | Pure SVG, no third-party chart library yet. Memoise the path computation. If perf becomes an issue at scale (>180-day windows), swap in `victory-native`.                              |
| Habit toggle race condition (double-tap fires two mutations)               | Mutation hook debounces (200ms) + server unique constraint catches duplicates.                                                                                                         |
| PR detection slows down `PUT /sessions/:id` significantly                  | Run PR detection async via SST queue worker — session response returns before PRs are computed. Notification fires when worker finishes. Pattern matches existing V2 session-end flow. |
| Client-side streak derivation diverges from server                         | Server-wins on next refresh. Brief flicker during reconciliation; acceptable.                                                                                                          |
| Freeze-token UX confusion (auto-spend feels invisible)                     | `freeze_token_applied` notification + small badge on streak hero shows token count. No animation on spend (quiet recovery per cross-cuts § 3.5).                                       |
| Achievement icon mapping table needs expansion as more milestones land     | Table lives in this spec's `design.md § Achievement triggers`. Future tiers → spec amendment via "**Revised YYYY-MM-DD:**".                                                            |

---

_End of `06-progress-goals/design.md` · 2026-05-27 (rewritten from scratch)_
