import type { ApiPort } from "@/domain/ports/api.port";
import type { AuthPort } from "@/domain/ports/auth.port";
import type { NetInfoPort } from "@/domain/ports/netInfo.port";
import type { RecentSetEntry, StoragePort } from "@/domain/ports/storage.port";
import type { TogetherPreviousRow } from "@/domain/ports/togetherShared.port";

/** Own-history refresh only: this function never authorizes or publishes sharing. */
export async function refreshTogetherOwnPrevious(deps: {
  api: Pick<ApiPort, "getRecentSets">;
  auth: Pick<AuthPort, "getSession" | "onAuthStateChange">;
  netInfo: Pick<NetInfoPort, "isConnected">;
  storage: Pick<StoragePort, "getPreviousForTogether" | "upsertRecentSets">;
  userId: string;
  exerciseIds: readonly string[];
  before: string;
  isCurrent: () => boolean;
}): Promise<readonly TogetherPreviousRow[] | null> {
  const ids = [...new Set(deps.exerciseIds)];
  const before = Date.parse(deps.before);
  if (!ids.length || ids.length > 100 || !Number.isFinite(before)) return [];
  let validAccount = true;
  const current = () => validAccount && deps.isCurrent();
  const read = (cutoff = deps.before) =>
    deps.storage.getPreviousForTogether?.(deps.userId, ids, cutoff) ?? [];
  const project = (rows: readonly RecentSetEntry[]) =>
    rows.map((row) => ({ ...row, recordedAt: Date.parse(row.recordedAt) }));
  const fallback = () => (current() ? project(read()) : null);
  const unsubscribe = deps.auth.onAuthStateChange((session, event) => {
    if (event === "SIGNED_OUT" || (session && session.userId !== deps.userId))
      validAccount = false;
  });
  try {
    if (!current() || !(await deps.netInfo.isConnected())) return fallback();
    const auth = await deps.auth.getSession();
    if (!current() || !auth.ok || auth.value?.userId !== deps.userId)
      return null;
    const result = await deps.api.getRecentSets({
      exerciseIds: ids,
      before: deps.before,
    });
    if (!current()) return null;
    if (!result.ok) return fallback();
    const rows = result.value.filter(
      (row) =>
        ids.includes(row.exerciseId) &&
        Number.isFinite(Date.parse(row.recordedAt)) &&
        Date.parse(row.recordedAt) < before &&
        Number.isInteger(row.setNumber) &&
        row.setNumber > 0 &&
        Number.isFinite(row.reps) &&
        row.reps >= 0 &&
        Number.isFinite(row.weightKg) &&
        row.weightKg >= 0,
    );
    const key = (row: RecentSetEntry) => `${row.exerciseId}:${row.setNumber}`;
    // Re-read after the await: a just-finished offline workout may be newer.
    const latest = new Map(
      read("9999-12-31T23:59:59.999Z").map((row) => [key(row), row]),
    );
    const safe = rows.filter(
      (row) =>
        Date.parse(row.recordedAt) >
        Date.parse(latest.get(key(row))?.recordedAt ?? "1970-01-01T00:00:00Z"),
    );
    deps.storage.upsertRecentSets(deps.userId, safe);
    const previous = new Map(rows.map((row) => [key(row), row]));
    for (const row of read()) {
      const old = previous.get(key(row));
      if (!old || Date.parse(row.recordedAt) >= Date.parse(old.recordedAt))
        previous.set(key(row), row);
    }
    return project([...previous.values()]);
  } catch {
    return fallback();
  } finally {
    unsubscribe();
  }
}
