import { useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useWorkoutTotalCapGate } from "@/ui/hooks/useWorkoutTotalCapGate";

/**
 * Watch the free-tier over-limit verdict; once it clears (the user is no
 * longer over the workout-total limit), unblock any `workout_limit_exceeded`
 * sync-queue entries and trigger a flush.
 *
 * Inspector Brad local sweep, HIGH finding: `blocked_entitlement` entries
 * are excluded from the normal drain (`sqlite.adapter.ts`'s
 * `getPendingMutations`) and the ONLY existing auto-retry
 * (`useAutoRetryOnUpgrade`) fires on a TIER TRANSITION only. But this
 * feature's primary resolution path is "delete down to ≤ limit", which
 * does NOT change tier — so a completed session recorded during the
 * gate's fail-open window (or from a stale cache / second device), 402'd
 * with `workout_limit_exceeded`, sat in the local queue FOREVER once the
 * user resolved the problem by deleting rather than upgrading. Silent
 * loss of a completed workout (sets, PRs, streak/volume never reaching
 * history).
 *
 * `useWorkoutTotalCapGate().isOverLimit` clearing is the correct, single
 * signal to key on — it already covers BOTH resolution paths (delete
 * brings the count back under the limit; upgrade changes the effective
 * tier to one with `workoutLimit: null`, which the gate's
 * `computeWorkoutTotalCapVerdict` also resolves to not-over-limit). A
 * tier-based upgrade that ALSO satisfies a `workout_limit_exceeded` entry
 * would already be caught by `useAutoRetryOnUpgrade` too (a `verdict
 * .upgradeTo` is set on this reason like any other `create_workout`
 * deny) — this hook's job is specifically the delete path that hook can
 * never see, but it doesn't hurt to overlap on the upgrade path: a second
 * `unblockEntries` call against an already-unblocked/already-succeeded
 * entry is a no-op (`storage.getBlockedEntries()` simply won't return it
 * anymore).
 *
 * ## Why "open episode", not a strict A → B transition diff
 *
 * `useAutoRetryOnUpgrade` detects work by diffing the PREVIOUS tier
 * against the CURRENT one. That works there because tier is multi-valued
 * — a transition recovered after a guarded miss (premium → individual_
 * trainer) is never equal to the value the ref last committed (premium),
 * so the diff still fires once the guard clears.
 *
 * `isOverLimit` is a BOOLEAN, so that same diff strategy has a hole: a
 * false → true → false round-trip that happens entirely while a previous
 * flush is in flight (episode re-opens and re-resolves before the guard
 * clears) leaves the ref back at its ORIGINAL "false" value — indistin-
 * guishable from "no change at all" once the recheck re-runs, even though
 * a genuinely NEW blocked entry may have appeared during that window and
 * would be silently skipped forever.
 *
 * So this hook tracks an "open episode" flag instead of the raw
 * boolean's last value:
 *   - Any render that observes `isOverLimit === true` marks the episode
 *     open (idempotent — safe to mark repeatedly, even mid-flush; this
 *     branch never touches `processingRef`).
 *   - A render that observes `isOverLimit === false` while an episode is
 *     open is the "resolve" moment: guarded the same way as the tier hook
 *     (re-entrancy + missed-transition recovery via `recheckTick`), and
 *     only CLEARS the open-episode flag once it actually starts
 *     processing (i.e. passes the guard).
 *   - A `false` observation with no open episode is a plain no-op (avoids
 *     re-running the unblock scan on every render once already resolved).
 *
 * This means the flag only ever gets cleared at the moment the unblock
 * scan actually runs, so a recovered recheck always re-reads
 * `storage.getBlockedEntries()` fresh — picking up anything that was
 * enqueued during the guarded window, round-trips included.
 *
 * Mounted once at the authenticated layout root, alongside
 * `useAutoRetryOnUpgrade` and `useSyncWorker`.
 */
export function useAutoRetryOnWorkoutLimitResolved(): void {
  const { storage, auth } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const gate = useWorkoutTotalCapGate();

  // True while there's an over-limit episode that hasn't yet had its
  // resolve-unblock attempted. Deliberately NOT reset to false merely by
  // observing `isOverLimit === false` — only clearing it once the
  // unblock scan actually starts (see docstring above).
  const openEpisodeRef = useRef(false);
  const processingRef = useRef(false);
  const pendingRecheckRef = useRef(false);
  const [recheckTick, setRecheckTick] = useState(0);

  useEffect(() => {
    if (!userId) {
      // Reset on sign-out so a sign-back-in doesn't pretend a prior
      // session's over-limit episode is still open.
      openEpisodeRef.current = false;
      return;
    }
    // Subscription/quota hasn't resolved yet — `isOverLimit` is a
    // provisional `false` from `useWorkoutTotalCapGate`'s fail-open
    // default, not a real "resolved" signal. Wait for a real read.
    if (!gate.isResolved) return;

    if (gate.isOverLimit) {
      // Mark (or re-mark) the episode open. Safe to do unconditionally,
      // even while a previous resolve is still flushing — it costs
      // nothing and guarantees the NEXT resolve observation (however
      // many times the boolean flips before then) is treated as
      // needing an unblock check.
      openEpisodeRef.current = true;
      return;
    }

    // Not over limit. Nothing pending → nothing to do (avoids re-running
    // the scan on every render once already resolved and handled).
    if (!openEpisodeRef.current) return;

    // Race protection — mirrors useAutoRetryOnUpgrade's sweep #3/#4 fix.
    // A resolve that arrives while a previous flush is still in flight
    // must NOT clear the open-episode flag (so it stays detectable once
    // recheckTick forces a re-run), and must flag pendingRecheckRef so
    // the in-flight IIFE's `finally` re-fires this effect when safe.
    if (processingRef.current) {
      pendingRecheckRef.current = true;
      return;
    }
    processingRef.current = true;
    openEpisodeRef.current = false;

    void (async () => {
      try {
        const blocked = storage.getBlockedEntries();
        const matching = blocked
          .filter(
            (entry) =>
              entry.entitlementVerdict?.reason === "workout_limit_exceeded",
          )
          .map((entry) => entry.id);
        if (matching.length === 0) return;

        storage.unblockEntries(matching);
        // Telemetry surface (informational): worth a debug log so the
        // device-review workflow can confirm the auto-retry fired
        // without instrumenting Sentry.
        console.warn(
          `[useAutoRetryOnWorkoutLimitResolved] over-limit resolved, unblocked ${matching.length} workout_limit_exceeded entries`,
        );

        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error(
          "[useAutoRetryOnWorkoutLimitResolved] flush failed:",
          err,
        );
      } finally {
        processingRef.current = false;
        if (pendingRecheckRef.current) {
          pendingRecheckRef.current = false;
          setRecheckTick((t) => t + 1);
        }
      }
    })();
  }, [userId, gate.isResolved, gate.isOverLimit, storage, auth, recheckTick]);
}
