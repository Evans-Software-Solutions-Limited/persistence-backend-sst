# M4 — Progress — SMOKE_TEST

E2E test plan. Run against `bun run dev` before merging the milestone PR. Steps map 1:1 to acceptance criteria in `specs/06-progress-goals/requirements.md` and the Brad-on-device review.

## Setup

- iOS sim running, backend at `bun run sst dev --stage bradleysimms-evans`
- Two test accounts: one free-tier, one premium

## Tests

### T1 — Progress tab renders for premium user (replaces M10.5 Wave 2 placeholder)

- [ ] Sign in as premium user.
- [ ] Tap Progress tab.
- [ ] Verify PR carousel renders with at least the M3 seed PRs (1rm/3rm/5rm/10rm/max_weight/max_volume).
- [ ] Verify 2×2 stat tile grid renders with: sessions this month, total volume, workout streak, +1 (legacy-confirmed metric).
- [ ] Verify trend chart renders with a default range (1M).
- [ ] Verify entry points present: "View all PRs", "Measurements", "Goals".

### T2 — Free-tier gate still works (Wave 2 regression check)

- [ ] Sign in as free user.
- [ ] Tap Progress tab.
- [ ] Verify `FeatureGatePrompt` upgrade card renders (Wave 2 contract).
- [ ] Verify no M4 content leaks above or below the gate.

### T3 — Trend chart range selector

- [ ] On Progress tab (premium), tap chart range selector.
- [ ] Verify options: 1M / 3M / 6M / 1Y / All.
- [ ] Select 6M, verify chart updates and data points reflect 6-month range.
- [ ] Select All, verify chart shows full history.

### T4 — Measurement editor (offline)

- [ ] Sign in as premium user, enable airplane mode.
- [ ] Progress tab → Measurements → tap "Add".
- [ ] Fill: weight 75 kg, body fat 18%, chest 100, waist 80, notes "test".
- [ ] Save. Verify navigate back to list with new entry at top, marked offline-pending.
- [ ] Disable airplane mode. Wait for sync. Verify pending indicator clears.

### T5 — Measurement list + chart

- [ ] After T4, on Measurements screen verify chart renders the new data point.
- [ ] Verify list shows newest-first.
- [ ] Tap a row. Verify navigate to edit screen (or read-only — confirm legacy behaviour).

### T6 — Goal CRUD

- [ ] Progress tab → Goals → tap "Add".
- [ ] Fill: name "Squat 100kg", type "strength", target 100, target date +6 months.
- [ ] Save. Verify goal appears in Active tab with 0% progress bar.
- [ ] Tap goal. Verify edit screen.
- [ ] Mark as Completed. Verify it moves to Completed tab.

### T7 — Personal Records list

- [ ] Progress tab → "View all PRs".
- [ ] Verify records grouped by exercise.
- [ ] Tap an exercise group, verify expand/collapse.
- [ ] Verify record type badges: 1rm / 3rm / 5rm / 10rm / max_weight / max_volume.
- [ ] Verify NO Epley estimates anywhere. NO first-occurrence records.

### T8 — Sync queue interaction (M10.6 regression)

- [ ] Sign in as basic-tier user with workout limit at zero.
- [ ] Create a measurement offline. (Measurements should NOT be tier-gated; confirm.)
- [ ] Reconnect. Verify the measurement syncs successfully — no `blocked_entitlement` banner.
- [ ] If measurement IS tier-gated, verify the M10.6 banner appears, tap → review screen → discard or wait for upgrade.

### T9 — Cache-first read (offline)

- [ ] Sign in as premium, load Progress tab. Wait for fresh data.
- [ ] Enable airplane mode. Kill app. Reopen.
- [ ] Verify Progress tab renders from cache within 500ms — no spinner, no empty state.
- [ ] Verify "Last updated X minutes ago" indicator if legacy had one.

### T10 — Pull-to-refresh

- [ ] On Progress tab, pull down.
- [ ] Verify spinner appears, network call fires, data updates.

## Gate

- [ ] All 10 tests above pass on iOS sim.
- [ ] `bun run prettier:check && bun run typecheck && bun run lint && bun run build && bun run test:unit && bun --filter @persistence/web test:unit` all green.
- [ ] Coverage ≥ 90% on changed files.

## Brad-on-device review

After local gate green, Brad runs the iOS sim and looks for:

- Premium aesthetic bar (no generic-looking UI).
- Chart visual quality.
- Touch target sizes (≥ 44 pt).
- Premium gym-app feel on transitions.

If Brad flags revamp items, those are out of scope for M4 and tracked separately.
