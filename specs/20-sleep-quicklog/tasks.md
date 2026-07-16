# 20 — Sleep quick-log + HealthKit — Tasks

> **DRAFT — do not start until Brad signs off requirements + design (esp.
> Decisions D1–D4).** Sequenced as two PRs per Decision D4.

## PR-A — Backend endpoint + migration (`microservices/core`, `packages/db`)

- [ ] **T-20.A.1** Add `'manual'` to `healthProviderEnum` in
  `packages/db/src/schema.ts`. Implements STORY-002 AC 2.4.
- [ ] **T-20.A.2** Idempotent Supabase migration:
  `ALTER TYPE health_provider ADD VALUE IF NOT EXISTS 'manual';` as its own
  statement (not in a txn that also uses the value). Verify forward-apply +
  re-apply are safe.
- [ ] **T-20.A.3** `SleepRepository` (userId-first) — `upsertManual(userId,
  { sleepDate, durationMinutes, sleepStart?, sleepEnd? })` using
  `ON CONFLICT (user_id, sleep_date, data_source) DO UPDATE`; `getForDate(userId,
  date)` applying the Decision-D3 source precedence. PgDialect render guard on
  the conflict fragment.
- [ ] **T-20.A.4** `SleepService` + `POST /health/sleep` + `GET /health/sleep`
  handlers (authed; `t.Object` validation, `durationMinutes` in `(0, 1440]`).
  Mount in `src/api.ts`. Implements STORY-002 AC 2.1–2.3.
- [ ] **T-20.A.5** `getHomeHandler`: replace `sleep: null` with the formatted
  string from the latest record (Decision D3) + a `formatSleepDuration`
  helper (unit-tested). Implements STORY-001 AC 1.5 / STORY-002 AC 2.5.
- [ ] **T-20.A.6** Tests to 90%: two-user data-isolation; upsert-overwrite (one
  row/day); duration validation (0 / >1440 → 422); formatter; home-pill
  wiring. No fake tests.

## PR-B — Mobile + health-port vertical (`packages/mobile`)

- [ ] **T-20.B.1** `HealthPort`: add `getSleepLastNight()` + `writeSleep(start,
  end)` + `HealthSleep` type + `sleep` in `HealthPermissionStatus`. Implements
  STORY-003 AC 3.1.
- [ ] **T-20.B.2** expo-healthkit adapter: `SleepAnalysis` category read/write
  (category query API, not the quantity path) + add to READ/WRITE identifiers +
  `requestAuthorization` set. Android stub + no-op/InMemory double impls.
- [ ] **T-20.B.3** `api.port` `logSleep` / `getSleepToday` + `LogSleepInput` /
  `ApiSleep`; implement in `SSTApiAdapter` + `InMemoryApiAdapter`.
- [ ] **T-20.B.4** `StoragePort` `getCachedSleepToday` / `cacheSleepToday`
  + SQLite adapter impl.
- [ ] **T-20.B.5** `log-sleep.command.ts` (optimistic cache + enqueue
  `entityType:"sleep"` + `invalidateHome`) + `useLogSleep()` hook + `sync.command`
  drain branch for `"sleep"` (idempotent day-keyed POST, no id-swap).
  Implements STORY-001 AC 1.3–1.4.
- [ ] **T-20.B.6** `QuickLogStripPresenter`: `onSleep` prop + 4th "Sleep" tile
  (IconClock, success tone). Container wires it to open the sheet. Implements
  STORY-001 AC 1.1.
- [ ] **T-20.B.7** `<SleepLogSheet>` presenter + container (BottomSheet, mirrors
  WeighIn per Decision D1): prefill from `getSleepLastNight()` best-effort, save
  via `useLogSleep`, then best-effort `writeSleep`. Implements STORY-001 AC 1.2 /
  STORY-003 AC 3.2–3.3.
- [ ] **T-20.B.8** Tests to 90%: command/hook/cache; presenter renders (strip
  4th tile, sheet save); InMemory health double drives prefill + mirror; mirror
  failure never fails the save.

## Cross-cutting / caveats

- HealthKit category read/write is **device-only** — CI covers the port
  contract via the InMemory double (flag in PR-B, per the existing HealthKit
  caveat).
- ⚠ PROD migration is **manual** (staging auto-applies on merge) — note in PR-A.
- Gates per PR: `typecheck && lint && prettier:check && build && test:unit`
  (+ mobile `test`), Inspector-Brad-local sweep, note the sweep in the PR body.

## Acceptance gate (feature complete)

- [ ] Athlete logs sleep offline → syncs on reconnect → Home pill updates.
- [ ] One manual row per user per day; zero cross-user leakage.
- [ ] HealthKit mirror best-effort (device-verified on EAS); prefill works.
- [ ] Migration idempotent; prod apply documented.

---

_Draft authored 2026-07-16 from `ROADMAP.md § 5.1` + a code-verified groundwork
pass. Requirements + design + Decisions D1–D4 need Brad's sign-off before code._
