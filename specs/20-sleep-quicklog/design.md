# 20 — Sleep quick-log + HealthKit — Design

> **SIGNED OFF 2026-07-16.** Decisions D1–D4 are LOCKED to the recommended
> options (Brad accepted the recommendations). Everything else follows the
> established WeighIn pattern 1:1.

## Architecture overview

Three vertical slices, sequenced as **two PRs** (backend first, then the mobile

- health-port vertical against that contract), mirroring the WeighIn flow:

```
Home quick-log "Sleep" tile (QuickLogStripPresenter, +onSleep)
        │ tap
        ▼
<SleepLogSheet>  (BottomSheet, like WeighInSheet)
  container: prefill from health.getSleepLastNight() (best-effort)
        │ save(durationMinutes, sleepDate)
        ▼
logSleepCommand  ── optimistic cache write (cacheSleepToday)
        │            └─ enqueue sync-queue entry (entityType "sleep")
        │            └─ invalidateHome(userId)
        ▼
useLogSleep → processSyncQueue → POST /health/sleep
        │                              │
        │  after accept (fire&forget)  ▼
        └─ health.writeSleep(start,end)   sleep_data upsert (data_source='manual')
                                          getHomeHandler → micro.sleep = "7h 30m"
```

## Backend (PR-A: `microservices/core` + `packages/db` migration)

### Migration — add `'manual'` to `health_provider`

Idempotent Supabase migration:

```sql
ALTER TYPE health_provider ADD VALUE IF NOT EXISTS 'manual';
```

`ADD VALUE IF NOT EXISTS` is idempotent and forward-only (Postgres enums can't
drop values — acceptable; the value is additive). Mirror in
`packages/db/src/schema.ts` `healthProviderEnum`. **⚠ `ALTER TYPE ... ADD VALUE`
cannot run inside a transaction block that then uses the new value in the same
migration** — keep it as its own migration statement (no same-migration insert
using `'manual'`).

### `sleep_data` upsert — the unique-index resolution

The existing index is `(user_id, sleep_date, data_source)`. Because manual rows
now write a **concrete** `data_source = 'manual'` (not NULL), the tuple is
concrete and `ON CONFLICT (user_id, sleep_date, data_source) DO UPDATE`
enforces exactly **one manual row per user per day** (AC 1.4 / 2.4). No schema
change to the index is needed. (A device-synced `apple_health` row for the same
day coexists as a separate tuple — intended; see Decision D3 for which one the
pill shows.)

### Endpoints (Elysia, authed via `requireAuth` → `getUser`)

- `POST /health/sleep` — body `{ sleepDate: string(YYYY-MM-DD), durationMinutes:
int > 0, sleepStart?: ISO, sleepEnd?: ISO }`. Upserts the manual row. Returns
  the stored record. Validation: `durationMinutes` in `(0, 1440]`.
- `GET /health/sleep?date=YYYY-MM-DD` — returns the caller's record for that
  date (Decision D3 governs source precedence), or `{ sleep: null }`.
- New `SleepRepository` (userId-scoped, first param `userId` per the repo
  convention) + a thin service; handler tested via repo/service tests to the
  90% bar. **Data-isolation test:** two users, same date, each reads only own.

### Home pill wiring (`getHomeHandler.ts:114`)

Replace `sleep: null` with a formatted string derived from the latest sleep
record for the user (Decision D3). Format helper: `durationMinutes` →
`"{h}h {m}m"` (e.g. `450 → "7h 30m"`; `< 60 → "{m}m"`). Null when no record.

## Mobile + health-port (PR-B: `packages/mobile`)

### Health port additions (`health.port.ts` + 3 impls)

```ts
// HealthPort
getSleepLastNight(): Promise<Result<HealthSleep | null, HealthError>>;
writeSleep(start: Date, end: Date): Promise<Result<void, HealthError>>;
```

- `HealthSleep = { durationMinutes: number; start: Date; end: Date }`.
- Add `sleep` to `HealthPermissionStatus`.
- **expo-healthkit adapter:** `SleepAnalysis` is a **category** sample, not a
  quantity — it needs the category query API (`queryCategorySamples` /
  `saveCategorySample`), NOT the `queryStatisticsForQuantity` path the file uses
  today. Add `HKCategoryTypeIdentifierSleepAnalysis` to READ + WRITE identifiers
  and the `requestAuthorization` set. `getSleepLastNight` sums "asleep" samples
  overlapping the last-night window; `writeSleep` writes one asleep sample.
- **Android stub + no-op/InMemory double:** `getSleepLastNight → fail(UNAVAILABLE)`
  (stub) / controllable value (InMemory); `writeSleep → fail/no-op`. The
  InMemory double is what CI exercises.

### `api.port` + adapters

```ts
logSleep(input: LogSleepInput): Promise<Result<ApiSleep, ApiError>>;
getSleepToday(date: string): Promise<Result<ApiSleep | null, ApiError>>;
```

`LogSleepInput = { sleepDate: string; durationMinutes: number; sleepStart?:
string; sleepEnd?: string }`. Implement in `SSTApiAdapter` + `InMemoryApiAdapter`
(the two ApiPort impls). `getSleepToday` mirrors the date-keyed `getWaterToday`/
`getFuelToday` precedent.

### Command + hook + cache + sync-queue

- `application/commands/log-sleep.command.ts` — mirrors
  `log-measurement.command.ts`: optimistic `cacheSleepToday`, enqueue
  `{ entityType: "sleep", entityId: sleepDate, operation: "create", payload,
endpoint: "/health/sleep", method: "POST" }`, `invalidateHome(userId)`.
- `useLogSleep()` — runs the command then `processSyncQueue(...)` (like
  `useLogMeasurement`).
- `StoragePort`: add `getCachedSleepToday(userId, date)` /
  `cacheSleepToday(userId, date, record)` + SQLite adapter impl.
- `sync.command.ts` drain: `"sleep"` entries POST to `/health/sleep`. It is an
  idempotent day-keyed upsert, so a reconnect replay is safe (unlike
  `/sessions/record`); no id-swap needed.

### UI

- `QuickLogStripPresenter`: add `onSleep` prop + a 4th `{ key: "sleep", icon:
<IconClock .../> (success tone, matching the Home pill), label: "Sleep",
onPress: onSleep }` item. Its container wires `onSleep` to open the sheet.
- `<SleepLogSheet>` (presenter + container) — a `BottomSheet` mirroring
  `WeighInSheet`: hours + minutes entry, Save. Container prefills from
  `health.getSleepLastNight()` when available, calls `useLogSleep().mutate`,
  then best-effort `health.writeSleep(start, end)`.

## Decisions (LOCKED 2026-07-16 — Brad accepted the recommendations)

- **D1 — Manual input model → DURATION (hours + minutes).** Fastest quick-log,
  matches "how much did you sleep." HealthKit + `sleep_start/sleep_end` need
  concrete times, so we **synthesise** a window: anchor wake at a fixed local
  hour (07:00 on the wake day = `sleepDate`), `start = end − duration`, and
  store both — documented as an approximation. (Not bedtime+wake-time pickers.)
- **D2 — Sleep-date semantics → WAKE DAY.** `sleepDate` is the day you log on
  (the morning-after day), matching how the Home pill reads "today."
- **D3 — Home-pill source precedence → MOST-RECENT BY `created_at`.** When both
  a `'manual'` and a device (`apple_health`) row exist for the day, the newer
  row wins — a fresh manual entry shows immediately; a later device sync
  supersedes it. (Not device-always-wins.)
- **D4 — Ship shape → TWO PRs.** PR-A backend endpoint + migration, then PR-B
  mobile + health-port against that contract (ROADMAP §5.1's recommended split).

## Testing & gates

- Backend: repo/service tests (data-isolation two-user test; upsert-overwrite;
  duration validation; kcal-style formatter unit test) to the 90% bar;
  PgDialect render guard on any new conflict fragment (per the mocked-DB
  blind-spot lesson).
- Mobile: command/hook/cache tests + presenter render tests; InMemory health
  double drives the prefill/mirror paths; jest gorhom/health mocks as usual.
- HealthKit category read/write is **device-only** (flag in both PRs).
