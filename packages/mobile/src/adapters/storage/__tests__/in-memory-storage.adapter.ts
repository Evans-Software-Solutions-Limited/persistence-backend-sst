import type {
  StoragePort,
  SyncQueueEntry,
  SyncStats,
  EnqueueMutationInput,
} from "@/domain/ports/storage.port";
import type { SyncStatus } from "@/domain/ports/sync.types";

/**
 * In-memory storage adapter for testing.
 * No SQLite dependency — stores everything in arrays/maps.
 */
export class InMemoryStorageAdapter implements StoragePort {
  private queue: SyncQueueEntry[] = [];
  private metadata: Map<string, string> = new Map();
  private nextId = 1;

  initialize(): void {
    // No-op for in-memory
  }

  enqueueMutation(entry: EnqueueMutationInput): void {
    this.queue.push({
      id: this.nextId++,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      operation: entry.operation,
      payload: JSON.stringify(entry.payload),
      endpoint: entry.endpoint,
      method: entry.method,
      status: "pending",
      retryCount: 0,
      maxRetries: 3,
      errorMessage: null,
      createdAt: new Date().toISOString(),
    });
  }

  getPendingMutations(): SyncQueueEntry[] {
    return this.queue.filter(
      (e) =>
        (e.status === "pending" || e.status === "failed") &&
        e.retryCount < e.maxRetries,
    );
  }

  markMutationInFlight(id: number): void {
    this.updateStatus(id, "in_flight");
  }

  markMutationCompleted(id: number): void {
    this.updateStatus(id, "completed");
  }

  markMutationFailed(id: number, errorMessage: string): void {
    const entry = this.queue.find((e) => e.id === id);
    if (entry) {
      entry.status = "failed";
      entry.errorMessage = errorMessage;
      entry.retryCount++;
    }
  }

  getSyncStats(): SyncStats {
    const stats = { pending: 0, failed: 0, inFlight: 0 };
    for (const entry of this.queue) {
      if (entry.status === "pending") stats.pending++;
      else if (entry.status === "failed") stats.failed++;
      else if (entry.status === "in_flight") stats.inFlight++;
    }
    return stats;
  }

  pruneCompletedMutations(_olderThanHours?: number): void {
    this.queue = this.queue.filter((e) => e.status !== "completed");
  }

  getLastSyncedAt(entityType: string): string | null {
    return this.metadata.get(entityType) ?? null;
  }

  setLastSyncedAt(entityType: string, timestamp: string): void {
    this.metadata.set(entityType, timestamp);
  }

  private updateStatus(id: number, status: SyncStatus): void {
    const entry = this.queue.find((e) => e.id === id);
    if (entry) entry.status = status;
  }
}
