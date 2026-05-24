# M10.6 — Mobile Agent Brief (`m106-sync-rcheck`)

You are the sole agent for M10.6. Read the parent [`BRIEF.md`](./BRIEF.md) first.

Your worktree forks off the post-M10.5-merge state of `main`. The `assertEntitlement` backend helper and the `SSTApiAdapter` 402 interception are in place. Your job: make the sync engine + UI handle entitlement-blocked entries gracefully.

## Authority

- Parent spec: [`../../11-payments-subscriptions/`](../../11-payments-subscriptions/) — STORY-012 + new "Sync-queue entitlement handling" section in `design.md`.
- Mobile rules: [`../../_agent.md`](../../_agent.md).
- Existing sync surface to read first:
  - `packages/mobile/src/application/commands/sync.command.ts` (the `processSyncQueue` worker)
  - `packages/mobile/src/domain/ports/sync.types.ts` (`SyncEntry` type + status enum)
  - `packages/mobile/src/ui/hooks/useSyncWorker.tsx` (the flush trigger)
  - `packages/mobile/src/adapters/storage/` (where sync entries persist)
  - `packages/mobile/src/adapters/api/sst-api.adapter.ts` (specifically the 402 interception added in M10.5 Wave 1)

## Spec alignment

Cite in commit footer:

```
Implements: specs/11-payments-subscriptions/design.md § Sync-queue entitlement handling (M10.6)
Closes: specs/11-payments-subscriptions/tasks.md § Phase 13
Satisfies: specs/11-payments-subscriptions/requirements.md AC 12.x
```

## Scope

Four logical slices. Recommended commit order: storage model → sync engine → UI banner → retry-on-upgrade.

### 1. Storage model: blocked-entitlement state

Extend `SyncEntry` in `packages/mobile/src/domain/ports/sync.types.ts`:

```typescript
export type SyncEntryStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "failed"           // generic / network / 5xx
  | "blocked_entitlement"; // NEW: M10.6 — server returned 402 with ENTITLEMENT_DENIED

export interface SyncEntry {
  id: string;
  // ... existing fields ...
  status: SyncEntryStatus;
  // NEW: M10.6 — populated when status === "blocked_entitlement"
  entitlementVerdict?: {
    feature: EntitlementFeature;
    currentTier: SubscriptionTierName;
    upgradeTo: SubscriptionTierName | null;
    upgradePriceMonthly: number | null;
    blockedAt: string;  // ISO timestamp
  };
}
```

Storage adapter changes:
- Add `getBlockedEntries(): SyncEntry[]` to `StoragePort` for the UI to enumerate blocked entries
- Add `unblockEntries(ids: string[]): void` for the retry path (flips status back to `pending`)
- Extend the SQLite schema if needed (add the `entitlement_verdict` column as JSON OR a sibling table). Use the simpler JSON-column approach if the schema-migration cost is non-trivial.

In-memory storage adapter (test) mirrors.

### 2. Sync engine 402 handling

`packages/mobile/src/application/commands/sync.command.ts`:

Today's behaviour (line ~94):
```typescript
if (!response.ok) {
  throw new Error(`HTTP ${response.status}: ${body}`);
}
```

Replace with:

```typescript
if (response.status === 402) {
  const apiError = parseApiError(body);  // existing helper from M10.5 Wave 1 adapter
  if (apiError.code === "ENTITLEMENT_DENIED" && apiError.entitlement) {
    // Record the verdict and mark the entry blocked
    await storage.markEntryBlocked(entry.id, {
      ...apiError.entitlement,
      blockedAt: new Date().toISOString(),
    });
    // DO NOT throw — this isn't a transient failure, retry won't help
    continue;
  }
}
if (!response.ok) {
  throw new Error(`HTTP ${response.status}: ${body}`);
}
```

Add `markEntryBlocked` to the `StoragePort`. The sync engine continues processing the rest of the queue after a 402 — one blocked entry doesn't poison the whole flush.

**Don't retry blocked entries on subsequent flushes.** The flush worker filters `status === "pending"` only; `blocked_entitlement` entries are explicitly excluded. They re-enter the pool ONLY via:
- The user explicitly tapping "Retry" / "Upgrade and retry" on the UI
- An automatic re-pool when `useMySubscription` reports a tier change that would satisfy the verdict's `upgradeTo` (e.g., user upgrades from basic to premium → all blocked entries with `upgradeTo: 'premium'` get unblocked)

### 3. UI: blocked-entries banner + review screen

`packages/mobile/src/ui/hooks/useBlockedSyncEntries.ts` (new):

```typescript
// Polls storage on a slow interval (every 30s) for blocked entries.
// Returns count + grouped-by-feature breakdown.
export interface BlockedEntriesSummary {
  total: number;
  byFeature: Record<EntitlementFeature, number>;
  earliestBlockedAt: string | null;
}

export function useBlockedSyncEntries(): BlockedEntriesSummary;
```

`packages/mobile/src/ui/components/SyncBlockedBanner.tsx` (new):

Small banner component, rendered at the top of Home tab (after the existing offline indicator if any). When `total > 0`:

```
⚠ 5 items couldn't sync — Upgrade to Premium [Review]
```

Tapping "Review" routes to a new screen: `packages/mobile/app/(app)/sync-blocked.tsx`.

`packages/mobile/src/ui/containers/SyncBlockedContainer.tsx` (new) + `SyncBlockedPresenter.tsx` (new):

Lists blocked entries grouped by the upgrade target tier. Each group shows:
- "Unlimited workouts requires Premium · 5 items"
- An expandable list of the entries (brief: "Workout #1 from 2026-05-23", "Workout #2…")
- "Upgrade to Premium and retry" primary CTA → routes to `/(auth)/subscription-selection?tier=premium`
- "Discard these items" secondary CTA → confirmation modal → calls `storage.discardEntries([ids])` which deletes both the sync entries AND the local cached data they referenced (e.g., the cached Workout rows)

### 4. Auto-retry on tier change

In `packages/mobile/src/ui/hooks/useSyncWorker.tsx` (or a new hook adjacent to it):

```typescript
// Watch useMySubscription for tier changes. When the tier changes to one
// that satisfies any blocked entries' upgradeTo, unblock those entries
// and trigger a sync flush.
export function useAutoRetryOnUpgrade(): void;
```

Implementation:
- Subscribe to `useMySubscription`
- Track the previously-observed `tierName` in a ref
- On change from old → new tier: query `storage.getBlockedEntries()`, filter to those whose `entitlementVerdict.upgradeTo` is satisfied by the new tier (tier hierarchy: premium > basic > free; trainer pro > trainer standard > free)
- Call `storage.unblockEntries([ids])` to flip them back to `pending`
- Trigger `processSyncQueue` to flush

Tier hierarchy comparison helper goes in `packages/mobile/src/domain/services/subscriptionService.ts` (extend existing) — `tierSatisfies(currentTier, requiredTier): boolean`.

## Tests

`packages/mobile/src/application/commands/__tests__/sync.command.test.ts` (extend):
- 402 with ENTITLEMENT_DENIED → entry marked blocked + verdict stored + sync continues
- 402 without ENTITLEMENT_DENIED body → falls through to generic error path (today's behaviour)
- 200 + 5xx + transient errors → unchanged from today

`packages/mobile/src/ui/hooks/__tests__/useBlockedSyncEntries.test.tsx`:
- Returns correct totals + breakdown per feature
- Updates on storage changes (polling or subscription)
- Returns earliest `blockedAt` correctly

`packages/mobile/src/ui/containers/__tests__/SyncBlockedContainer.test.tsx`:
- Empty state when no blocked entries
- Grouped list when present
- "Upgrade and retry" routes with correct tier param
- "Discard" confirmation flow

`packages/mobile/src/ui/hooks/__tests__/useAutoRetryOnUpgrade.test.tsx`:
- Tier change to one satisfying blocked entries → unblock + flush
- Tier change that doesn't satisfy → no-op
- No tier change → no-op
- Free → trainer tier doesn't unblock user-tier-required entries (no cross-track retry)

`packages/mobile/src/domain/services/__tests__/subscriptionService.test.ts` (extend):
- `tierSatisfies(currentTier, requiredTier)` for all relevant combinations

90% global coverage non-negotiable.

## Quality gates

```bash
bun run prettier:check
bun run typecheck
bun run lint
bun run build
bun --filter @persistence/mobile test:unit
```

Expected delta: ~30–50 new tests.

## Files you will touch

```
packages/mobile/src/domain/ports/
  sync.types.ts                                                # extend
  storage.port.ts                                              # extend (markEntryBlocked, getBlockedEntries, unblockEntries, discardEntries)
packages/mobile/src/domain/services/
  subscriptionService.ts                                       # extend (tierSatisfies helper)
  __tests__/subscriptionService.test.ts                        # extend
packages/mobile/src/application/commands/
  sync.command.ts                                              # extend with 402 handling
  __tests__/sync.command.test.ts                               # extend
packages/mobile/src/adapters/storage/
  sqlite.adapter.ts                                            # extend (new column or sibling table for verdict)
  __tests__/in-memory-storage.adapter.ts                       # extend
  __tests__/sqlite.adapter.test.ts                             # extend
packages/mobile/src/ui/hooks/
  useBlockedSyncEntries.ts                                     # new
  useAutoRetryOnUpgrade.ts                                     # new
  __tests__/useBlockedSyncEntries.test.tsx                     # new
  __tests__/useAutoRetryOnUpgrade.test.tsx                     # new
packages/mobile/src/ui/components/
  SyncBlockedBanner.tsx                                        # new
  __tests__/SyncBlockedBanner.test.tsx                         # new
packages/mobile/src/ui/containers/
  SyncBlockedContainer.tsx                                     # new
  __tests__/SyncBlockedContainer.test.tsx                      # new
packages/mobile/src/ui/presenters/
  SyncBlockedPresenter.tsx                                     # new
  __tests__/SyncBlockedPresenter.test.tsx                      # new
packages/mobile/app/(app)/
  sync-blocked.tsx                                             # new (thin screen wrapper)
packages/mobile/app/(app)/(tabs)/
  home.tsx OR _layout.tsx                                       # add SyncBlockedBanner mount
```

## Files you will NOT touch

- `microservices/` — backend already correct from M10.5
- Wave 1 primitives (`useFeatureGate`, `FeatureGatePrompt`) — final
- Wave 2 per-screen gate integrations — final
- The Subscription screens — final
- The Stripe handlers / webhook / reconcile script — final

## Edge cases

- **User has both user-tier blocked entries + trainer-tier blocked entries** (e.g., they're on a mixed-purpose account — rare). Show both groups in the review screen. Independent upgrade paths.
- **User discards an entry that references local data also referenced by another non-blocked entry** (e.g., 2 sets of the same workout, one blocked, one not). `discardEntries` deletes the entry but NOT the local data unless the entry is the only reference. Implement reference-counting in storage OR just leave the local data and document the leak (small + bounded).
- **User upgrades, then downgrades again before retry completes.** The auto-retry hook should debounce/guard against this. Use `useEffect` cleanup correctly.
- **`upgradeTo === null` blocked entries** (no upgrade path). Surface "Contact support" instead of "Upgrade". Same as `FeatureGatePrompt`'s edge case.
- **Server returns 402 with malformed body.** Treat as a generic failure (existing path), not as `blocked_entitlement`. Don't trust partial parses.

## Inspector Brad expectations

Sync engine has been Brad-blast-tested before — the 2026-05-04 dashboard incident traces back to lib/supabase queries handling. Expect 1–3 sweeps. Patterns to watch:

- Sync engine accidentally retrying blocked entries on the next flush
- Storage adapter not persisting the verdict across app restarts
- Race condition where auto-retry fires before storage has settled
- Toast / banner UI flicker on fast tier changes
- Tests that mock the sync engine itself instead of using a real `InMemoryStorageAdapter` (low signal)

TRACE before patching. Same protocol.

## When you finish

Report:
- Branch name
- Commits
- Test delta
- Coverage on touched files
- Storage schema decisions (column vs sibling table)
- Spec amendment flags
- Any decisions that diverged from the brief
