import type { StoragePort } from "@/domain/ports/storage.port";
import { isAutoResolvableSyncEntry } from "@/domain/ports/sync.types";

export function hasTemplatePreference(payload: string): boolean {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).showTemplateWorkouts ===
        "boolean"
    );
  } catch {
    return false;
  }
}

/**
 * Remove an older terminal template preference without reviving its mutation.
 * Any unrelated failed profile fields remain available to the manual Retry UI.
 */
export function stripSupersededTemplatePreferences(
  storage: StoragePort,
  userId: string,
  beforeId = Number.POSITIVE_INFINITY,
): void {
  for (const entry of storage.getQueuedEntriesForEntity("profile", userId)) {
    if (entry.id >= beforeId || isAutoResolvableSyncEntry(entry)) continue;

    try {
      const payload = JSON.parse(entry.payload) as unknown;
      if (
        typeof payload !== "object" ||
        payload === null ||
        Array.isArray(payload) ||
        !("showTemplateWorkouts" in payload)
      ) {
        continue;
      }

      const remaining = { ...(payload as Record<string, unknown>) };
      delete remaining.showTemplateWorkouts;
      if (Object.keys(remaining).length === 0) {
        storage.discardEntries([entry.id]);
      } else {
        storage.replaceInactiveMutationPayload(entry.id, remaining);
      }
    } catch {
      // Preserve malformed failure evidence for the review UI.
    }
  }
}
