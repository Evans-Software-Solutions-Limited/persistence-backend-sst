import type { AuthPort } from "@/domain/ports/auth.port";
import type { StoragePort } from "@/domain/ports/storage.port";

export type SyncResult = {
  processed: number;
  succeeded: number;
  failed: number;
};

/**
 * Process the sync queue: send pending mutations to the SST API.
 *
 * Entries are processed in FIFO order. Each entry is marked in-flight,
 * sent, then marked completed or failed. Failed entries are retried
 * up to their max_retries limit.
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

  const token = await auth.getAccessToken();

  for (const entry of entries) {
    storage.markMutationInFlight(entry.id);

    try {
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
