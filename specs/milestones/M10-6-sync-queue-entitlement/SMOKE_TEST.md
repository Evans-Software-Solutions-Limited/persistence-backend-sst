# M10.6 — Smoke Test

End-to-end verification for the sync-queue entitlement re-check + UX. Run AFTER M10.5 (Wave 1 + Wave 2 if shipped) has landed on `main` so the full server-side enforcement + per-screen gates are in place.

## Setup

Same setup as M10.5 SMOKE_TEST, plus:

- Test user **U-Basic-Slim**: basic tier active, at the workout limit minus 1 (so they can create exactly 1 more workout online before hitting limit)

## Walkthrough

### Step 1 — Offline → over-limit creates → flush → blocked

- [ ] Sign in as U-Basic-Slim → create 1 workout online (now exactly at limit). Confirm.
- [ ] Enable airplane mode in the simulator.
- [ ] Create 5 more workouts via the app (workout creator). Each saves to local SQLite + queues a sync entry. UI shows them in the workout list with a "pending sync" indicator.
- [ ] Disable airplane mode. `useSyncWorker` fires a flush.
- [ ] Watch network logs: 5 × `POST /workouts` → all 5 return 402 with `ENTITLEMENT_DENIED` + `feature: "create_workout"` + `upgrade_to: "premium"`
- [ ] Storage: query the local DB (via dev probe) → all 5 entries have `status: "blocked_entitlement"` + `entitlementVerdict` populated
- [ ] Sync engine did NOT throw — it processed all 5 (and any other entries in the queue) without aborting

**Validates:** sync engine 402 handling; storage model

### Step 2 — Banner + review screen

- [ ] On Home tab: banner visible "⚠ 5 items couldn't sync — Upgrade to Premium [Review]"
- [ ] Tap Review → routes to `/sync-blocked`
- [ ] Sync Blocked screen shows: 1 group ("Unlimited workouts requires Premium · 5 items"), expanded list with the 5 entries identified by their local references (e.g., "Workout 'Push Day' from 2026-05-23", etc.)
- [ ] Primary CTA: "Upgrade to Premium and retry" → routes to `/(auth)/subscription-selection?tier=premium`
- [ ] Selection screen lands with Premium pre-selected

**Validates:** AC 12.x (banner + review)

### Step 3 — Upgrade → auto-retry

- [ ] On Selection screen (still U-Basic-Slim), tap Premium card → Apple Pay → confirm → success screen lands
- [ ] Return to Home (success screen → Go to Home)
- [ ] Within ~10 seconds (depends on `useMySubscription` invalidation + auto-retry hook): the blocked banner disappears; sync engine flushes; all 5 previously-blocked workouts land on the server (201 each)
- [ ] Network logs: 5 × `POST /workouts` → all 5 return 201
- [ ] Storage: all 5 entries now `status: "synced"`
- [ ] Postgres: 6 new workouts total (1 from Step 0 + 5 from Step 1)

**Validates:** AC 12.x (auto-retry on upgrade)

### Step 4 — Discard path

- [ ] Repeat Step 1 (create another blocked batch — needs to be a fresh user or a manual reset). Get to the `/sync-blocked` screen.
- [ ] Tap "Discard these items" → confirmation modal
- [ ] Confirm → all 5 sync entries deleted + local cached workouts referenced ONLY by those entries also deleted
- [ ] Workout list in the app shows only the 1 originally-synced workout (not the 5 discarded)
- [ ] Sync queue is empty

**Validates:** AC 12.x (discard path)

### Step 5 — Mixed batch (some allowed, some blocked)

- [ ] Reset U-Basic-Slim to at-limit state.
- [ ] Offline: create 3 fresh workouts AND log 4 sets on an existing workout (e.g., the one from Step 0). Total sync entries: 7 (3 workout creates + 4 set creates).
- [ ] Come online → flush → server returns 402 on the 3 fresh workouts; 201 on each of the 4 set creates
- [ ] Storage: 3 blocked, 4 synced
- [ ] Banner shows "3 items couldn't sync" (not 7)

**Validates:** sync engine doesn't poison the queue on 402; mixed-batch handling

### Step 6 — Restart app — blocked entries persist

- [ ] After Step 5, force-quit the app (or use Cmd+Shift+H to background it for a long time)
- [ ] Reopen → Home tab → banner still shows "3 items couldn't sync — Upgrade to Premium"
- [ ] Tap Review → blocked entries still listed with the original verdict

**Validates:** persistence across app launches

### Step 7 — Wrong tier upgrade doesn't unblock unrelated entries

- [ ] Set up: U-Basic-Slim has 3 user-tier blocked entries (workout creates).
- [ ] Imagine they upgrade to a Trainer tier instead of Premium (unusual flow but possible if they want to add client management).
- [ ] After tier change → auto-retry hook fires → checks blocked entries' `upgradeTo: 'premium'` against new tier (trainer-pro) → trainer-pro does NOT satisfy `premium` (different track)
- [ ] Entries remain blocked. Banner still shows.
- [ ] User upgrades again to Premium-and-Trainer (if such a combo exists) OR adjusts. Entries unblock when the satisfying tier change lands.

**Validates:** tier hierarchy logic; cross-track blocking

### Step 8 — 5xx and other errors are unchanged

- [ ] Trigger a 5xx response by some means (kill the staging API temporarily or use a fault-injection probe).
- [ ] Sync entries don't go to `blocked_entitlement` — they go to `failed` (existing behaviour).
- [ ] Next flush retries them.

**Validates:** sync engine 402 handling doesn't accidentally swallow other error classes

## Pass criteria

All 8 steps tick-mark. No silently-lost workouts. No infinite retry loops. Banner UX is clear.

## Known-acceptable

- The auto-retry might take ~5–15 seconds after upgrade depending on `useMySubscription` invalidation cadence + sync worker debounce. Don't expect instantaneous.
- If the user upgrades but the new sub fails to commit (3DS rejected, etc.), the auto-retry might attempt + fail again — entries return to blocked. Acceptable.

## Rollback plan

- Revert the `m106-sync-rcheck` agent's merge. Sync engine returns to today's behaviour (generic 402 → entries go to `failed` and retry). UX regresses but no data loss.
- Storage schema migration (new column or table) needs to be backwards-compatible — old entries without `entitlement_verdict` field treated as `null` → fall through to existing paths.
