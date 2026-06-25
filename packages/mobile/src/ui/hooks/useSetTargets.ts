import { useCallback } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import { localIdFactory } from "@/application/commands/localId";
import { setTargetCommand } from "@/application/commands/nutrition.command";
import type {
  NutritionTarget,
  SetTargetsInput,
} from "@/domain/models/nutrition";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Upsert the caller's daily target (M9). `date` is the currently-viewed Fuel
 * day so its cached `remainingKcal` updates optimistically. Optimistic cache
 * write + queued `PUT`. Returns the optimistic target (null when signed out).
 */
export function useSetTargets(): {
  mutate: (
    input: SetTargetsInput,
    date: string,
  ) => Promise<NutritionTarget | null>;
} {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const mutate = useCallback(
    async (input: SetTargetsInput, date: string) => {
      if (!userId) return null;
      const target = setTargetCommand(
        { storage, userId, idFactory: localIdFactory },
        input,
        date,
      );
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useSetTargets] queue flush failed:", err);
      }
      return target;
    },
    [auth, storage, userId],
  );

  return { mutate };
}
