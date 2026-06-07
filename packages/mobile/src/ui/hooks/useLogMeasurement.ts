import { useCallback } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import { logMeasurementCommand } from "@/application/commands/log-measurement.command";
import type { LogMeasurementInput } from "@/domain/ports/api.port";
import type { Result, ValidationError } from "@/shared/errors";
import { fail } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Log a body measurement (06-progress-goals, Phase 06.7; STORY-005). Optimistic
 * body-trend append + queue (logMeasurementCommand), then a queue drain.
 * `day` defaults to today (YYYY-MM-DD).
 */
export function useLogMeasurement(): {
  mutate: (
    input: LogMeasurementInput,
    day?: string,
  ) => Promise<Result<void, ValidationError>>;
} {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const mutate = useCallback(
    async (input: LogMeasurementInput, day?: string) => {
      if (!userId) {
        return fail<ValidationError>({
          kind: "validation",
          fields: { weightKg: "Not signed in." },
        });
      }
      const result = logMeasurementCommand(
        { storage, userId, day: day ?? new Date().toISOString().slice(0, 10) },
        input,
      );
      if (!result.ok) return result;
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useLogMeasurement] queue flush failed:", err);
      }
      return result;
    },
    [auth, storage, userId],
  );

  return { mutate };
}
