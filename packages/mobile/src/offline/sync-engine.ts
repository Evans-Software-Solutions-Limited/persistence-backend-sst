import { getAccessToken } from "../auth/supabase";
import {
  getPendingEntries,
  markCompleted,
  markFailed,
  markInFlight,
  pruneCompleted,
} from "./sync-queue";

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
export async function processSyncQueue(apiBaseUrl: string): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const entries = getPendingEntries();
  let succeeded = 0;
  let failed = 0;

  const token = await getAccessToken();

  for (const entry of entries) {
    markInFlight(entry.id);

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

      markCompleted(entry.id);
      succeeded++;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      markFailed(entry.id, message);
      failed++;
    }
  }

  // Clean up old completed entries
  pruneCompleted();

  return { processed: entries.length, succeeded, failed };
}
