import { useCallback } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import { localIdFactory } from "@/application/commands/localId";
import { logEntryCommand } from "@/application/commands/nutrition.command";
import type { LogEntryInput, NutritionEntry } from "@/domain/models/nutrition";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Log a nutrition entry (M9). Optimistic: recomputes the cached day aggregate
 * so the ring updates instantly, enqueues `POST /nutrition/entries`, then
 * fire-and-forget drains the queue. Returns the optimistic entry (null when
 * signed out) so the container can fire the immediate goal-hit celebration off
 * the freshly-recomputed totals.
 */
export function useLogEntry(): {
  mutate: (input: LogEntryInput) => Promise<NutritionEntry | null>;
} {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const mutate = useCallback(
    async (input: LogEntryInput) => {
      if (!userId) return null;
      const entry = logEntryCommand(
        { storage, userId, idFactory: localIdFactory },
        input,
      );
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useLogEntry] queue flush failed:", err);
      }
      return entry;
    },
    [auth, storage, userId],
  );

  return { mutate };
}
