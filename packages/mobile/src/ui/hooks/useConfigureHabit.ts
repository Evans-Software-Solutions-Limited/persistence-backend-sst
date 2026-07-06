import { useCallback } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import {
  configureHabitCommand,
  disableHabitCommand,
  type ConfigureHabitCommandInput,
} from "@/application/commands/configure-habit.command";
import type { HabitCategory } from "@/domain/models/habit-config";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Enable/edit a habit (18-habit-setup, Phase 18.7 — T-18.7.5). Optimistic cache
 * write + queue (configureHabitCommand), then a fire-and-forget drain. Offline:
 * the write persists + drains later. `clientId` routes the write on a client's
 * behalf (coach mode).
 */
export function useConfigureHabit(clientId?: string): {
  mutate: (input: ConfigureHabitCommandInput) => Promise<void>;
} {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const mutate = useCallback(
    async (input: ConfigureHabitCommandInput) => {
      if (!userId) return;
      configureHabitCommand(
        {
          storage,
          userId,
          idFactory: () =>
            `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        },
        input,
        clientId,
      );
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useConfigureHabit] queue flush failed:", err);
      }
    },
    [auth, storage, userId, clientId],
  );

  return { mutate };
}

/**
 * Disable a habit (deferred to next Monday server-side). Optimistic queue +
 * drain, mirroring `useConfigureHabit`. `clientId` routes on a client's behalf.
 */
export function useDisableHabit(clientId?: string): {
  mutate: (category: HabitCategory) => Promise<void>;
} {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const mutate = useCallback(
    async (category: HabitCategory) => {
      if (!userId) return;
      disableHabitCommand({ storage, userId }, category, clientId);
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useDisableHabit] queue flush failed:", err);
      }
    },
    [auth, storage, userId, clientId],
  );

  return { mutate };
}
