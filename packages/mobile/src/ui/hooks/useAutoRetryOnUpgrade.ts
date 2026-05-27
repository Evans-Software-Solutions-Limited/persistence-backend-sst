import { useEffect, useRef } from "react";
import { processSyncQueue } from "@/application/commands/sync.command";
import { getApiBaseUrl } from "@/adapters/api";
import type { SubscriptionTierName } from "@/domain/models/subscription";
import { tierSatisfies } from "@/domain/services/subscriptionService";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useMySubscription } from "@/ui/hooks/useMySubscription";

/**
 * Watch the user's tier; on a change to a tier that satisfies one or
 * more blocked entries' upgrade requirement, unblock those entries and
 * trigger a sync flush.
 *
 * Spec: specs/11-payments-subscriptions/design.md
 *       § Sync-queue entitlement handling (M10.6) > Auto-retry
 * Satisfies: requirements.md AC 12.3, 12.7
 *
 * Behaviour:
 *   1. Track the previously-observed `tierName` in a ref.
 *   2. On a *transition* (old !== new), query
 *      `storage.getBlockedEntries()` and filter to entries whose
 *      verdict's `upgradeTo` is satisfied by the new tier (via
 *      `tierSatisfies` — track-aware, so a user-tier upgrade NEVER
 *      unblocks trainer-tier-required entries and vice versa).
 *   3. Call `storage.unblockEntries(ids)` for matching rows.
 *   4. Fire-and-forget `processSyncQueue` so the freshly-unblocked
 *      entries flush in the same loop.
 *
 * Mounted once at the authenticated layout root, alongside
 * `useSyncWorker`. Re-mounts cleanly on sign-out (auth boundary
 * unmounts the tree); the ref resets so the next sign-in is a
 * clean slate.
 *
 * Race protection:
 *   - The `processingRef` guards against re-entrancy from a fast
 *     tier flip-flop (upgrade then downgrade) — only one flush is
 *     in flight at a time. Subsequent flushes get queued by
 *     `useSyncWorker`'s own AppState handler if needed.
 *   - First render is NOT a transition — we seed the ref from the
 *     first observed tier and only act on subsequent changes.
 */
export function useAutoRetryOnUpgrade(): void {
  const { storage, auth } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const subQuery = useMySubscription();
  const currentTier = subQuery.data?.tierName ?? null;

  const lastTierRef = useRef<SubscriptionTierName | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    if (!userId) {
      // Reset on sign-out so a sign-back-in doesn't pretend the prior
      // tier was already observed.
      lastTierRef.current = null;
      return;
    }
    if (currentTier === null) return; // sub data hasn't loaded yet

    // First observation: seed the ref but do NOT act. A user signing
    // in for the first time on an upgrade-eligible tier shouldn't see
    // their existing blocked entries auto-retry just because the
    // hook just mounted.
    if (lastTierRef.current === null) {
      lastTierRef.current = currentTier;
      return;
    }

    // No transition → nothing to do.
    if (lastTierRef.current === currentTier) return;

    const prevTier = lastTierRef.current;

    // The actual unblock/flush. Wrapped in an IIFE so the useEffect
    // body stays synchronous (we don't want to return a promise from
    // the effect — its cleanup contract is sync).
    //
    // Inspector Brad PR #73 medium-severity find — sweep #3: don't
    // advance `lastTierRef` until we've committed to processing.
    // Otherwise a fast tier flip-flop (e.g. premium → individual_trainer
    // arriving while basic→premium is still in-flight) lands here,
    // bumps the ref to the latest tier, hits the processingRef guard
    // and returns early — the second transition is silently dropped
    // because no further render fires (lastTierRef === currentTier).
    if (processingRef.current) return;
    processingRef.current = true;
    lastTierRef.current = currentTier;

    void (async () => {
      try {
        const blocked = storage.getBlockedEntries();
        if (blocked.length === 0) return;
        const matching: number[] = [];
        for (const entry of blocked) {
          const verdict = entry.entitlementVerdict;
          if (!verdict) continue;
          // A blocked entry with `upgradeTo: null` means "already top
          // tier" — auto-retry has nothing to do; the user has to
          // contact support or discard.
          if (verdict.upgradeTo === null) continue;
          if (tierSatisfies(currentTier, verdict.upgradeTo)) {
            matching.push(entry.id);
          }
        }
        if (matching.length === 0) return;

        storage.unblockEntries(matching);
        // Telemetry surface (informational): worth a debug log so
        // the device-review workflow can confirm the auto-retry
        // fired without instrumenting Sentry.
        console.warn(
          `[useAutoRetryOnUpgrade] Tier change ${prevTier} → ${currentTier} unblocked ${matching.length} entries`,
        );

        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useAutoRetryOnUpgrade] flush failed:", err);
      } finally {
        processingRef.current = false;
      }
    })();
  }, [userId, currentTier, storage, auth]);
}
