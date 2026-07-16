import { useCallback } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import { logSleepCommand } from "@/application/commands/log-sleep.command";
import type { LogSleepInput } from "@/domain/ports/api.port";
import type { Result, ValidationError } from "@/shared/errors";
import { fail } from "@/shared/errors";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Log a manual sleep entry (specs/20-sleep-quicklog STORY-001 AC 1.3/1.4).
 * Optimistic day-keyed cache write + queue (logSleepCommand), then a queue
 * drain — mirrors `useLogMeasurement`.
 */
export function useLogSleep(): {
  mutate: (input: LogSleepInput) => Promise<Result<void, ValidationError>>;
} {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const mutate = useCallback(
    async (input: LogSleepInput) => {
      if (!userId) {
        return fail<ValidationError>({
          kind: "validation",
          fields: { durationMinutes: "Not signed in." },
        });
      }
      const result = logSleepCommand({ storage, userId }, input);
      if (!result.ok) return result;
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useLogSleep] queue flush failed:", err);
      }
      return result;
    },
    [auth, storage, userId],
  );

  return { mutate };
}
