import { useCallback } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import { localIdFactory } from "@/application/commands/localId";
import { setWaterCommand } from "@/application/commands/nutrition.command";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Set the day's water cups (M9) as an ABSOLUTE value (last-write-wins). The
 * command coalesces rapid +/- taps onto one pending mutation so replay stays
 * idempotent. Optimistic cache update + queued `PATCH`.
 */
export function useSetWater(): {
  mutate: (args: { date: string; cups: number }) => Promise<void>;
} {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const mutate = useCallback(
    async ({ date, cups }: { date: string; cups: number }) => {
      if (!userId) return;
      setWaterCommand(
        { storage, userId, idFactory: localIdFactory },
        date,
        cups,
      );
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useSetWater] queue flush failed:", err);
      }
    },
    [auth, storage, userId],
  );

  return { mutate };
}
