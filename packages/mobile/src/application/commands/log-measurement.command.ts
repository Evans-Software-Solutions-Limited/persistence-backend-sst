/**
 * Log-measurement command — offline-capable (06-progress-goals, Phase 06.6;
 * STORY-005). Optimistic cache append + enqueue POST /measurements. The
 * body-trend sparkline reflects the new weight on the next You render; the
 * server's measurement_streak engine reconciles on the next drain.
 */

import type { StoragePort } from "@/domain/ports/storage.port";
import type { LogMeasurementInput } from "@/domain/ports/api.port";
import type { BodyTrendPoint } from "@/domain/models/progress";
import { fail, ok, type Result, type ValidationError } from "@/shared/errors";

export type LogMeasurementCommandDeps = {
  storage: StoragePort;
  userId: string;
  /** YYYY-MM-DD the measurement is for (defaults to today, caller-supplied). */
  day: string;
};

export function logMeasurementCommand(
  deps: LogMeasurementCommandDeps,
  input: LogMeasurementInput,
): Result<void, ValidationError> {
  // A weigh-in with no weight and no body-fat is meaningless — keep it out of
  // the queue (the sync worker has no feedback loop to reject it).
  if (input.weightKg == null && input.bodyFatPercentage == null) {
    return fail({
      kind: "validation",
      fields: { weightKg: "Enter a weight or body-fat value." },
    });
  }
  if (input.weightKg != null && (input.weightKg <= 0 || input.weightKg > 999)) {
    return fail({
      kind: "validation",
      fields: { weightKg: "Enter a realistic weight." },
    });
  }

  // Optimistic body-trend append (or replace same-day point) so the sparkline
  // reflects the weigh-in before the queue drains. A weight-only OR
  // body-fat-only weigh-in must NOT wipe the other field on the same day —
  // merge onto the prior same-day point so a body-fat-only log keeps the
  // morning's weight in the cache until the server reconciles.
  const series = deps.storage.getCachedBodyTrend(deps.userId);
  const prior = series.find((p) => p.date === deps.day);
  const point: BodyTrendPoint = {
    date: deps.day,
    weightKg: input.weightKg ?? prior?.weightKg ?? null,
    bodyFat: input.bodyFatPercentage ?? prior?.bodyFat ?? null,
  };
  const next = [...series.filter((p) => p.date !== deps.day), point].sort(
    (a, b) => a.date.localeCompare(b.date),
  );
  deps.storage.cacheBodyTrend(deps.userId, next);

  deps.storage.enqueueMutation({
    entityType: "measurement",
    entityId: deps.day,
    operation: "create",
    payload: input,
    endpoint: "/measurements",
    method: "POST",
  });

  deps.storage.invalidateHome(deps.userId);
  return ok(undefined);
}
