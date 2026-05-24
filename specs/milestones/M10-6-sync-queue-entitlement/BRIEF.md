# M10.6 — Sync-Queue Entitlement Re-check

## Why this milestone

M10.5 closed the obvious abuse paths: server-side `assertEntitlement` blocks any premium-only mutation regardless of what the JWT claims. But it left one specific edge case open: **the offline-then-flush abuse path.**

Scenario:

1. Basic-tier user is at workout limit (N workouts this month)
2. User goes offline (airplane mode, plane, no signal)
3. User creates 50 more workouts → local SQLite saves them all + queues 50 sync entries
4. User comes back online → sync engine flushes
5. First entry → `POST /workouts` → backend `assertEntitlement` sees count >= limit → 402 → entry rejected
6. Sync engine today: throws generic "HTTP 402" → either silently drops the entry, retries forever, or surfaces a vague error

What the user experiences: 50 workouts in local app, but they "disappear" on next sync (or refuse to sync at all without explanation). Bad UX for legitimate users (e.g., a basic-tier user who legitimately maxed their limit). Pointless ambiguity for abusers (no clear "you can't have this" message).

M10.6 closes the loop: sync engine classifies 402 responses as entitlement-blocked, surfaces a clear UI path to "Upgrade and retry these", and only retries the blocked entries once the user's tier actually changes.

## Parent spec

[`../../11-payments-subscriptions/`](../../11-payments-subscriptions/) — STORY-012 (new) covers the contract. Design.md adds a "Sync-queue entitlement handling" section.

## Scope summary — single mobile agent

This is a smaller milestone — backend work is zero (Wave 1's `assertEntitlement` already returns the right 402 shape on every mutation). Only the mobile sync engine + UX need work.

| Agent | Brief | Scope |
|---|---|---|
| `m106-sync-rcheck` | [`MOBILE_BRIEF.md`](./MOBILE_BRIEF.md) | Sync engine catches 402, marks entries as `blocked-entitlement`, records the verdict on the entry. UI: banner on Home + Profile showing "X items blocked"; tap → list of blocked entries grouped by tier-upgrade-required; "Upgrade and retry" CTA → routes to Selection with target tier pre-selected; on tier change (detected via `useMySubscription` invalidation), automatically retry the previously-blocked entries. |

## When this milestone spawns

After M10.5 Wave 1 backend has merged (the `assertEntitlement` helper must be wired into the mutation endpoints). M10.5 Wave 2 is NOT a dependency — M10.6 is independent of the per-screen gate work and can spawn in parallel with Wave 2 if you want maximum velocity.

## Success criteria

Done when:

1. **Basic user at limit, offline path:** offline → create 5 workouts → all locally cached + queued → come online → sync flushes → server returns 402 on entries 1-5 → mobile marks all 5 as `blocked-entitlement` with the server's verdict captured
2. **Banner UX:** Home tab shows "5 workouts couldn't sync — Upgrade to Premium [Review]" → tap Review → list of blocked entries with feature label ("Unlimited workouts") + summary
3. **Retry on upgrade:** user taps "Upgrade and retry" → routes to Selection with Premium pre-selected → completes upgrade → returns to app → blocked entries automatically retry → all 5 land successfully (or fail with new specific reason if data is stale)
4. **Discard path:** user taps "Discard" on the blocked list → entries removed from queue + storage; local cached workouts deleted accordingly (with a confirmation modal)
5. **Mixed batch:** offline user creates 3 fresh workouts + 2 set-completions on an existing workout → comes online → fresh workouts rejected (count limit); set completions succeed (no fresh-workout entitlement check). UI groups them — only the 3 fresh ones flagged as blocked.
6. Per-PR gates: prettier / typecheck / lint / build / all suites green; 90%+ branch coverage on touched files.

## Out of scope for M10.6

- Backend changes (assertEntitlement is already correct)
- Other sync-queue improvements (transient-network retries, exponential backoff, etc. — that's its own slice)
- Per-feature blocked-entry classifications beyond `entitlement` reason (server / network / data-validation errors stay as today)
- Auto-downgrade local data (if user cancels mid-month, premium features they used during the active period stay — we don't retroactively delete)

## Cross-cutting

- The `ApiError` shape (set up in M10.5 Wave 1's `SSTApiAdapter` 402 interception) IS the contract — the sync engine reads `error.entitlement` to record the verdict, doesn't re-derive
- Blocked entries persist across app restarts (storage-backed)
- "Upgrade and retry" deep-links work even when launched from a freshly-installed app (entries stored locally, recoverable)
- Telemetry: log when blocked entries pile up — useful signal for product (where users actually hit limits)
