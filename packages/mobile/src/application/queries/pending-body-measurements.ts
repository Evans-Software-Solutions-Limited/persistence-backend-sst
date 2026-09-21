import type { BodyTrendPoint } from "@/domain/models/progress";
import type { StoragePort } from "@/domain/ports/storage.port";
import { isAutoResolvableSyncEntry } from "@/domain/ports/sync.types";

/** Match the log command's same-day merge while a measurement awaits sync.
 * Evaluate at GET completion, since a write can be queued after it started.
 */
export function reconcilePendingBodyMeasurements(
  storage: StoragePort,
  points: BodyTrendPoint[],
): BodyTrendPoint[] {
  let merged = [...points];
  for (const entry of storage.getUncompletedMutations()) {
    if (
      entry.entityType !== "measurement" ||
      entry.endpoint !== "/measurements" ||
      entry.method !== "POST" ||
      !entry.entityId ||
      !isAutoResolvableSyncEntry(entry)
    )
      continue;
    try {
      const parsed: unknown = JSON.parse(entry.payload);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        continue;
      const patch = parsed as Record<string, unknown>;
      const weight =
        typeof patch.weightKg === "number" && Number.isFinite(patch.weightKg)
          ? patch.weightKg
          : undefined;
      const fat =
        typeof patch.bodyFatPercentage === "number" &&
        Number.isFinite(patch.bodyFatPercentage)
          ? patch.bodyFatPercentage
          : undefined;
      if (weight === undefined && fat === undefined) continue;
      const prior = merged
        .filter((point) => point.date === entry.entityId)
        .at(-1);
      const point: BodyTrendPoint = {
        date: entry.entityId,
        weightKg: weight ?? prior?.weightKg ?? null,
        bodyFat: fat ?? prior?.bodyFat ?? null,
        measuredAt:
          typeof patch.measuredAt === "string"
            ? patch.measuredAt
            : prior?.measuredAt,
      };
      merged = [...merged.filter((value) => value.date !== point.date), point];
    } catch {
      // Malformed queue entries must not prevent the trend from loading.
    }
  }
  return merged.sort((a, b) => a.date.localeCompare(b.date));
}
