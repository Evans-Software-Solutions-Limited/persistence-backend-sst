import { useCallback } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import { localIdFactory } from "@/application/commands/localId";
import { logEntryCommand } from "@/application/commands/nutrition.command";
import type { LogEntryInput, NutritionEntry } from "@/domain/models/nutrition";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Log several entries at once (PER-132: Add to a meal, Copy from earlier
 * days). Each is written to the day cache and queued with its own
 * Idempotency-Key, offline-first; then ONE drain sends them together through
 * `POST /nutrition/entries/batch`.
 */
export function useLogEntries(): {
  mutate: (inputs: readonly LogEntryInput[]) => Promise<NutritionEntry[]>;
} {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const mutate = useCallback(
    async (inputs: readonly LogEntryInput[]) => {
      if (!userId || inputs.length === 0) return [];
      const entries = inputs.map((input) =>
        logEntryCommand({ storage, userId, idFactory: localIdFactory }, input),
      );
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useLogEntries] queue flush failed:", err);
      }
      return entries;
    },
    [auth, storage, userId],
  );

  return { mutate };
}
