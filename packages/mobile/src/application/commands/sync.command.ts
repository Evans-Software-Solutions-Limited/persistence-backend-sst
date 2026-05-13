import type { AuthPort } from "@/domain/ports/auth.port";
import type {
  RecordResponseSummary,
  RecordResponseSummaryPR,
  StoragePort,
} from "@/domain/ports/storage.port";

export type SyncResult = {
  processed: number;
  succeeded: number;
  failed: number;
};

/**
 * Server response shape returned by `POST /sessions/record` —
 * `data: {…session, personalRecords, totalWorkoutsCompleted}`. Only
 * the augmented fields (Phase 3b) are read here; the rest of the
 * payload is the canonical session re-fetch which the swap path
 * already consumes elsewhere.
 *
 * Spec: microservices/core/src/application/repositories/sessionRepository.ts
 *       (RecordedSession + DetectedPersonalRecord).
 */
type RecordSessionApiResponse = {
  data: {
    id: string;
    personalRecords: RecordResponseSummaryPR[];
    totalWorkoutsCompleted: number;
  };
};

/**
 * Process the sync queue: send pending mutations to the SST API.
 *
 * Entries are processed in FIFO order. Each entry is marked in-flight,
 * sent, then marked completed or failed. Failed entries are retried
 * up to their max_retries limit.
 *
 * The auth token is refreshed per-entry to avoid mass 401 failures
 * when the token expires mid-queue (realistic after long offline periods).
 *
 * Call this when:
 * - Network connectivity is restored
 * - App comes to foreground
 * - After a local mutation is enqueued (debounced)
 */
export async function processSyncQueue(
  storage: StoragePort,
  auth: AuthPort,
  apiBaseUrl: string,
): Promise<SyncResult> {
  const entries = storage.getPendingMutations();
  let succeeded = 0;
  let failed = 0;

  for (const entry of entries) {
    storage.markMutationInFlight(entry.id);

    try {
      // Fetch token per-entry to handle expiry mid-queue
      const token = await auth.getAccessToken();

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }

      const response = await fetch(`${apiBaseUrl}${entry.endpoint}`, {
        method: entry.method,
        headers,
        body: entry.method !== "DELETE" ? entry.payload : undefined,
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HTTP ${response.status}: ${body}`);
      }

      // M3 Phase 3b: capture the `/sessions/record` augmented response
      // so the Summary screen can swap its local prediction for
      // server-truth (PRs with previousValue + totalWorkoutsCompleted).
      // Single-active-session invariant means the cache is keyed by
      // userId; cleared by `clearActiveSession` when the user taps
      // Continue. Other endpoints are unaffected — their bodies are
      // still discarded.
      //
      // Any parse failure is non-fatal: the mutation already succeeded
      // server-side, the Summary screen falls back to its local
      // prediction, and the queue entry still marks completed.
      // Logging + best-effort capture matches the brief's "trust but
      // verify" pattern for offline-first sync paths.
      if (
        entry.entityType === "session" &&
        entry.endpoint === "/sessions/record"
      ) {
        try {
          const body = (await response.json()) as RecordSessionApiResponse;
          const session = await auth.getSession();
          if (session.ok && session.value && body.data) {
            const summary: RecordResponseSummary = {
              localSessionId: entry.entityId ?? body.data.id,
              personalRecords: body.data.personalRecords ?? [],
              totalWorkoutsCompleted: body.data.totalWorkoutsCompleted ?? 0,
              cachedAt: new Date().toISOString(),
            };
            storage.cacheRecordResponse(session.value.userId, summary);
          }
        } catch (err) {
          // Body wasn't valid JSON, response.json() rejected, or
          // auth.getSession() rejected. Either way: the POST succeeded
          // (we passed `response.ok` above) so the queue entry should
          // still mark completed and the Summary screen falls back to
          // its local prediction. Swallow with a log so debugging is
          // possible without breaking the sync flow.
          console.warn(
            "[sync] /sessions/record succeeded but response capture failed; Summary will use local prediction:",
            err,
          );
        }
      }

      storage.markMutationCompleted(entry.id);
      succeeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      storage.markMutationFailed(entry.id, message);
      failed++;
    }
  }

  // Clean up old completed entries
  storage.pruneCompletedMutations();

  return { processed: entries.length, succeeded, failed };
}
