import { useCallback } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import {
  toggleHabitDayCommand,
  type ToggleHabitInput,
} from "@/application/commands/toggle-habit.command";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Habit-day toggle (06-progress-goals, Phase 06.7; STORY-004). Optimistic
 * cache flip + queue (toggleHabitDayCommand), then a fire-and-forget queue
 * drain so it syncs when online. Offline: the flip persists + drains later.
 */
export function useToggleHabitDay(): {
  mutate: (input: ToggleHabitInput) => Promise<void>;
} {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const mutate = useCallback(
    async (input: ToggleHabitInput) => {
      if (!userId) return;
      toggleHabitDayCommand(
        {
          storage,
          userId,
          idFactory: () =>
            `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
        input,
      );
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useToggleHabitDay] queue flush failed:", err);
      }
    },
    [auth, storage, userId],
  );

  return { mutate };
}
