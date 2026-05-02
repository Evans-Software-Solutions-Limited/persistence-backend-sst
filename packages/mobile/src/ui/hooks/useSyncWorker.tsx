import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { processSyncQueue } from "@/application/commands/sync.command";
import { getApiBaseUrl } from "@/adapters/api";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Drain the sync queue at app launch + on every foreground transition.
 *
 * Without this, mutations (workout create/edit/delete, exercise
 * create/delete) only land in the local SQLite cache via
 * `enqueueMutation` — `processSyncQueue` is the worker that actually
 * POSTs them to the SST backend. M0 + M1 were read-only so this gap
 * went unnoticed; M2 ships the first mutation surface and surfaces it.
 *
 * Wiring rules (kept conservative for M2):
 * - Run once on mount when an authenticated session is available.
 *   The hook reads `session?.userId` to gate the first run; without
 *   a session the queue stays paused (prevents POSTs with stale or
 *   anonymous tokens after sign-out).
 * - Run on `AppState change → active`. Catches the common case of
 *   user backgrounding mid-edit while offline, then returning with
 *   connectivity restored.
 *
 * Not in scope here (deferred to a follow-up):
 * - NetInfo connectivity-restored trigger
 * - Debounced flush after enqueue
 * - Periodic background polling
 *
 * Mount once, near the auth boundary, in the authenticated layout.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-008 AC 8.3
 *       (sync queue replays optimistic mutations to the backend)
 */
export function useSyncWorker(): void {
  const { storage, auth } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  // Avoid concurrent flushes — `processSyncQueue` walks pending entries
  // serially, so two overlapping calls would double-mark the same row
  // in-flight. The flag is reset in the finally block.
  const flushingRef = useRef(false);

  useEffect(() => {
    if (!userId) return;

    const flush = async () => {
      if (flushingRef.current) return;
      flushingRef.current = true;
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        // The worker itself catches per-entry errors and marks them
        // failed; an unexpected throw here means something at the
        // shell level (e.g. invalid base URL) is wrong. Log and
        // keep going — next foreground attempt may succeed.
        console.error("[useSyncWorker] flush failed:", err);
      } finally {
        flushingRef.current = false;
      }
    };

    void flush();

    const subscription = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus) => {
        if (nextState === "active") {
          void flush();
        }
      },
    );

    return () => subscription.remove();
  }, [storage, auth, userId]);
}
