/**
 * Log-sleep command — offline-first (specs/20-sleep-quicklog STORY-001 AC
 * 1.3/1.4). Enqueues the durable POST /health/sleep on the sync queue (the
 * offline-durability mechanism here — there is no local read-cache for
 * sleep, unlike `logMeasurementCommand`'s body-trend cache, which a LIST
 * hook reads back; the Sleep sheet prefills from HealthKit and the Home
 * pill is server-driven, so nothing locally reads a cached sleep row). The
 * backend upserts by `(userId, sleepDate, 'manual')`, so re-saving the same
 * day overwrites rather than duplicating (AC 1.4) — a reconnect replay of
 * the queued POST is therefore safe (idempotent day-keyed upsert, unlike
 * `/sessions/record` which creates a new row on every call).
 */

import type { StoragePort } from "@/domain/ports/storage.port";
import type { LogSleepInput } from "@/domain/ports/api.port";
import { fail, ok, type Result, type ValidationError } from "@/shared/errors";

export type LogSleepCommandDeps = {
  storage: StoragePort;
  userId: string;
};

export function logSleepCommand(
  deps: LogSleepCommandDeps,
  input: LogSleepInput,
): Result<void, ValidationError> {
  // Mirrors the backend's `(0, 1440]` validation (healthSleepPostHandler) —
  // keep an invalid entry out of the queue entirely rather than letting the
  // sync worker discover a 422 with no feedback loop back to the user.
  if (
    !Number.isFinite(input.durationMinutes) ||
    input.durationMinutes <= 0 ||
    input.durationMinutes > 1440
  ) {
    return fail({
      kind: "validation",
      fields: { durationMinutes: "Enter a realistic sleep duration." },
    });
  }

  deps.storage.enqueueMutation({
    entityType: "sleep",
    entityId: input.sleepDate,
    operation: "create",
    payload: input,
    endpoint: "/health/sleep",
    method: "POST",
  });

  deps.storage.invalidateHome(deps.userId);
  return ok(undefined);
}
