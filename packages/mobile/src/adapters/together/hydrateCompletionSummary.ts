import type { ApiPort } from "../../domain/ports/api.port";
import type { StoragePort } from "../../domain/ports/storage.port";

/** Best-effort read of an already saved result; never creates or records history. */
export async function hydrateTogetherCompletionSummary(options: {
  api: Pick<ApiPort, "getSession">;
  storage: Pick<StoragePort, "cacheRecordResponse">;
  userId: string;
  localSessionId: string;
  historyId: string;
  effectsPending?: boolean;
  /** Re-check both signed-in account and the local workout being displayed. */
  isCurrent(): boolean;
}): Promise<boolean> {
  if (options.effectsPending || !options.historyId || !options.isCurrent())
    return false;
  try {
    const result = await options.api.getSession(options.historyId, {
      summary: true,
    });
    if (!options.isCurrent() || !result.ok) return false;
    const session = result.value;
    if (
      session.id !== options.historyId ||
      session.userId !== options.userId ||
      session.status !== "completed" ||
      !Array.isArray(session.personalRecords) ||
      !Number.isSafeInteger(session.workoutsThisMonth) ||
      session.workoutsThisMonth! < 0
    )
      return false;
    options.storage.cacheRecordResponse(options.userId, {
      localSessionId: options.localSessionId,
      personalRecords: session.personalRecords,
      workoutsThisMonth: session.workoutsThisMonth!,
      cachedAt: new Date().toISOString(),
    });
    return true;
  } catch {
    return false;
  }
}
