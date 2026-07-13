import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { processSyncQueue } from "@/application/commands/sync.command";
import { getApiBaseUrl } from "@/adapters/api";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Debounce window for the reconnect-triggered resurrect + flush (Task 2,
 * M13 sync-hardening). A flaky wifi handoff or airplane-mode toggle can
 * fire several rapid false→true transitions in a row — this collapses
 * them so only the LAST transition in a burst actually resets + flushes,
 * instead of hammering the queue once per blip.
 *
 * Exported so tests can assert against the exact cadence.
 */
export const SYNC_RECONNECT_DEBOUNCE_MS = 1_000;

/**
 * Drain the sync queue at app launch, on every foreground transition, and
 * on an offline→online reconnect (M13 sync-hardening).
 *
 * Without this, mutations (workout create/edit/delete, exercise
 * create/delete) only land in the local SQLite cache via
 * `enqueueMutation` — `processSyncQueue` is the worker that actually
 * POSTs them to the SST backend. M0 + M1 were read-only so this gap
 * went unnoticed; M2 ships the first mutation surface and surfaces it.
 *
 * Wiring rules:
 * - Run once on mount when an authenticated session is available.
 *   The hook reads `session?.userId` to gate the first run; without
 *   a session the queue stays paused (prevents POSTs with stale or
 *   anonymous tokens after sign-out).
 * - Run on `AppState change → active`. Catches the common case of
 *   user backgrounding mid-edit while offline, then returning with
 *   connectivity restored.
 * - Run on a NetInfo false→true reconnect transition (M13). This is the
 *   fix for the "stranded mutation" bug: `getPendingMutations()`
 *   deliberately excludes entries that have exhausted their retry
 *   budget (`status='failed' AND retry_count >= max_retries`), so a
 *   `POST /sessions/record` that failed 3 times during an offline
 *   stretch was invisible to EVERY future drain — every server-derived
 *   view (coach adherence, workout-detail PR state, the You-page volume
 *   stat) read empty forever even after connectivity came back. On a
 *   real false→true transition we now `resetFailedEntries` ONCE for the
 *   exhausted SESSION-RECORD entries only (they carry `clientSessionId`,
 *   so a re-POST is server-idempotent — self-heal for a failure that was
 *   plausibly connectivity, not a genuine rejection) and then flush.
 *   Non-idempotent creates are deliberately NOT auto-resurrected here;
 *   they surface in the `/sync-failed` review UI for explicit retry. A
 *   session the server genuinely rejects will simply re-exhaust and
 *   surface there too, instead of looping silently.
 *
 * Not in scope here (deferred to a follow-up):
 * - Debounced flush after enqueue
 * - Periodic background polling
 *
 * Mount once, near the auth boundary, in the authenticated layout.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-008 AC 8.3
 *       (sync queue replays optimistic mutations to the backend)
 *       specs/milestones/M13-sync-hardening
 */
export function useSyncWorker(): void {
  const { storage, auth, netInfo } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  // Avoid concurrent flushes — `processSyncQueue` walks pending entries
  // serially, so two overlapping calls would double-mark the same row
  // in-flight. The flag is reset in the finally block.
  const flushingRef = useRef(false);
  // Set when a flush is requested while one is already in progress — the
  // active drain re-runs one more pass on finish so entries enqueued or
  // resurrected mid-flush (notably the reconnect resurrect below) aren't
  // stranded until the next foreground/reconnect trigger.
  const reflushRef = useRef(false);
  // Last-observed connectivity state. `null` until the FIRST signal
  // (either the one-shot probe below or the first `subscribe` callback)
  // arrives — that first signal only SEEDS this ref, it never counts as
  // a transition (mirrors `useAutoRetryOnUpgrade`'s "first observation
  // seeds, doesn't act" rule; otherwise a cold start on an already-online
  // device would spuriously fire a resurrect+flush on mount).
  const prevConnectedRef = useRef<boolean | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;

    const flush = async () => {
      // Already draining — record that another pass is wanted and let the
      // in-progress loop pick it up, rather than no-op'ing the caller
      // (which would strand a just-resurrected entry: the running drain
      // captured its pending list before the reset).
      if (flushingRef.current) {
        reflushRef.current = true;
        return;
      }
      flushingRef.current = true;
      try {
        do {
          reflushRef.current = false;
          try {
            await processSyncQueue(storage, auth, getApiBaseUrl());
          } catch (err) {
            // The worker itself catches per-entry errors and marks them
            // failed; an unexpected throw here means something at the
            // shell level (e.g. invalid base URL) is wrong. Log and
            // keep going — next foreground attempt may succeed.
            console.error("[useSyncWorker] flush failed:", err);
          }
          // Loop again only if a flush was requested during this pass.
        } while (reflushRef.current);
      } finally {
        flushingRef.current = false;
      }
    };

    // M13: one-shot self-heal on reconnect, then flush. Best-effort —
    // any failure here still falls through to `flush()` so a resurrect
    // bug never blocks the ordinary drain.
    const resurrectAndFlush = async () => {
      try {
        const exhausted = storage.getFailedExhaustedEntries();
        // Only auto-resurrect the idempotent session-record mutations:
        // they carry `clientSessionId`, so the server dedups a replay via
        // the (user_id, client_session_id) unique index — a re-POST after
        // an ambiguous success is safe. Other exhausted creates
        // (workout/exercise/nutrition) have NO idempotency key, so
        // auto-re-POSTing could duplicate a row that actually committed;
        // those stay in the /sync-failed review UI for explicit,
        // user-acknowledged retry. Both self (`/sessions/record`) and
        // on-behalf (`.../clients/:id/sessions/record`) endpoints match.
        const idempotent = exhausted.filter((e) =>
          e.endpoint.endsWith("/sessions/record"),
        );
        if (idempotent.length > 0) {
          storage.resetFailedEntries(idempotent.map((e) => e.id));
        }
      } catch (err) {
        console.error("[useSyncWorker] reconnect resurrect failed:", err);
      }
      await flush();
    };

    void flush();

    const appStateSub = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState === "active") {
          void flush();
        }
      },
    );

    let mounted = true;
    // Guards the one-shot probe below from clobbering a fresher value
    // the subscribe stream already produced — mirrors `useOnlineStatus`'s
    // `subscribeFired` race guard (Inspector Brad PR #72 pattern).
    let subscribeFired = false;

    netInfo
      .isConnected()
      .then((connected) => {
        if (mounted && !subscribeFired && prevConnectedRef.current === null) {
          prevConnectedRef.current = connected;
        }
      })
      .catch(() => {
        // Swallow probe failures — the subscribe stream (or the next
        // AppState/mount flush) will still drive the worker correctly.
      });

    const netInfoUnsub = netInfo.subscribe((connected) => {
      subscribeFired = true;
      const prev = prevConnectedRef.current;
      prevConnectedRef.current = connected;

      // Only a genuine false→true TRANSITION triggers the resurrect +
      // flush. `prev === null` (first-ever signal) seeds only; going
      // offline (connected === false) never triggers it; repeated
      // "online" signals with no intervening offline are a no-op too.
      if (prev !== false || connected !== true) return;

      // Debounce: rapid toggles collapse onto the LAST transition in
      // the window instead of firing once per blip.
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        void resurrectAndFlush();
      }, SYNC_RECONNECT_DEBOUNCE_MS);
    });

    return () => {
      mounted = false;
      appStateSub.remove();
      netInfoUnsub();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };
  }, [storage, auth, netInfo, userId]);
}
