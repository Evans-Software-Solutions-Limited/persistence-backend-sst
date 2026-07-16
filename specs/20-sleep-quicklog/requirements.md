# 20 — Sleep quick-log + HealthKit — Requirements

> **Status: DRAFT — awaiting Brad's sign-off before any code (per the spec-12
> brief, item 1).** Net-new feature spanning 3 spec areas (backend health,
> `07-health-integration`, `06-progress-goals`). Plan of record: `ROADMAP.md
> § 5.1`.

## Context (verified against the code, 2026-07-16)

There is **no Mood/Sleep quick-log to port** — the legacy app
(`../persistence-mobile/`) has no quick-log strip and no sleep/mood code at all.
This is a net-new addition driven by the prototype + ROADMAP §5.1, not a port.

Groundwork that already exists (do NOT rebuild):

- **`sleep_data` table** — `packages/db/src/schema.ts:1381-1407`. Defined but
  DORMANT: no handler reads or writes it, no endpoint. Columns:
  `id, user_id, sleep_date (text, NOT NULL), duration_minutes, quality_score,
  deep/light/rem/awake_minutes, sleep_start, sleep_end, data_source
  (health_provider enum, nullable), created_at`. Unique index
  `sleep_data_user_date_source_idx` on `(user_id, sleep_date, data_source)`.
- **`health_provider` enum** — `schema.ts:129-135`: `apple_health | google_fit |
  fitbit | samsung_health | garmin`. **No `manual` value** (this spec adds it).
- **Home "sleep" micro-pill UI already exists** —
  `TodayHeroPresenter.tsx:187-192` renders a `sleep` `<MicroPill>` (`IconClock`,
  `success` tone) showing `micro.sleep ?? "—"`. `MicroPills.sleep` is already
  `string | null` (`progress.ts:25-30`). The backend
  `getHomeHandler.ts:114` hardcodes `sleep: null` — so the pill shows "—" today.
- **HealthKit** — `HealthPort` (`health.port.ts:51-109`) reads weight / body-fat
  / steps / energy / heart-rate and writes weight / body-fat. It has **no sleep
  read or write**. The expo-healthkit adapter declares quantity identifiers only
  (no `SleepAnalysis` category). Android stub + no-op stub also implement the
  port. Adding a sleep method touches all four.
- **QuickLogStrip** — `QuickLogStripPresenter.tsx` renders **3 tiles**
  (Weigh in / Log meal / Water); there is **no Mood tile to rename** (it was
  removed at launch). Sleep is a net-new 4th tile + a new `onSleep` prop.
- **Analogue to mirror: WeighIn** — `WeighInSheetContainer.tsx` +
  `WeighInSheetPresenter.tsx` → `logMeasurementCommand` →
  `useLogMeasurement` → sync-queue (`entityType: "measurement"`) + body-trend
  cache; prefills from `health.getLatestBodyWeight()`, mirrors to HealthKit
  best-effort after the durable write is accepted.

## Stories

### STORY-001 — Manual sleep quick-log (athlete)
As an athlete, from the Home quick-log strip I can tap a **Sleep** tile, enter
how long I slept last night, and save it — so my sleep is tracked without a
wearable.

- **AC 1.1** The Home quick-log strip shows a 4th tile, **Sleep** (icon +
  "Sleep" label), alongside Weigh in / Log meal / Water. Tapping it opens the
  Sleep log sheet.
- **AC 1.2** The sheet lets the user enter last night's sleep **duration**
  (hours + minutes) and Save. (Input model — see design §Decision D1.)
- **AC 1.3** Save writes a durable backend `sleep_data` row for the sleep date
  with `data_source = 'manual'`, and is **offline-first** (optimistic + enqueued
  in the sync queue, flushed on reconnect) — same posture as WeighIn.
- **AC 1.4** Re-saving for the same day **overwrites** that day's manual row
  (one manual row per user per day), not a duplicate.
- **AC 1.5** After a successful save the Home "sleep" micro-pill reflects the
  logged value (e.g. "7h 30m") without a manual refresh.

### STORY-002 — Durable backend sleep record + endpoint
As the system, a manual sleep log is persisted server-side (userId-scoped) so it
survives reinstall/device-switch and feeds the Home pill.

- **AC 2.1** `POST /health/sleep` (authed) upserts a `sleep_data` row for
  `(userId, sleepDate, 'manual')` with `durationMinutes` (+ optional
  `sleepStart`/`sleepEnd`). Returns the stored record.
- **AC 2.2** `GET /health/sleep?date=YYYY-MM-DD` (authed) returns the caller's
  sleep record for that date (most-authoritative source — see design §Decision
  D3), or an empty/null result when none.
- **AC 2.3** All queries are **userId-scoped** (no cross-user read/write). Two
  users logging the same date see only their own row.
- **AC 2.4** `'manual'` is a valid `health_provider` enum value (idempotent
  Supabase migration), so the existing unique index enforces
  one-manual-row-per-day (`data_source` is now a concrete value, not NULL).
- **AC 2.5** The Home handler (`getHomeHandler`) returns `micro.sleep` as a
  formatted string from the latest available sleep record (see design §Decision
  D3) instead of hardcoded `null`.

### STORY-003 — HealthKit sleep read + best-effort mirror
As an athlete with Apple Health, my manual entry is mirrored to HealthKit and my
Home pill prefers HealthKit's own sleep data when present.

- **AC 3.1** The health port gains `getSleepLastNight()` (read a
  `SleepAnalysis` category sample → duration) and `writeSleep(start, end)`
  (write a category sample), implemented in the expo-healthkit adapter; the
  Android stub + no-op/InMemory double return `unavailable` / no-op.
- **AC 3.2** On opening the Sleep sheet, if HealthKit is available and has last
  night's sleep, the duration field **prefills** from it (mirrors WeighIn
  prefill from `getLatestBodyWeight`).
- **AC 3.3** After the durable backend write is accepted, the entry is mirrored
  to HealthKit **best-effort** (`writeSleep`), fire-and-forget — a HealthKit
  failure never blocks or fails the save.
- **AC 3.4** HealthKit sleep behaviour is **device-only** (category samples
  aren't exercised in CI) — same documented caveat as the existing HealthKit
  reads; CI covers the port contract via the InMemory double.

## Non-goals / out of scope

- Sleep **quality/stages** (deep/light/rem) capture in the manual flow — the
  columns exist but the manual quick-log is duration-only (v1). Reading stages
  from HealthKit is a later slice.
- Android Health Connect sleep (Android stub returns `unavailable`).
- A dedicated Sleep history/trend screen (only the Home pill consumes it in v1).
- Coach-side sleep visibility.

## Success criteria

- Athlete can log sleep offline; it syncs; the Home pill updates.
- Zero cross-user leakage; migration is idempotent forward + safe.
- HealthKit mirror is strictly best-effort and never user-visible on failure.
- Mobile UI matches the prototype's quick-log strip + a WeighIn-style sheet
  (1:1 with the established sheet pattern; no bespoke primitives).
