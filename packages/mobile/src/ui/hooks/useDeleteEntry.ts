import { useCallback } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import { localIdFactory } from "@/application/commands/localId";
import { deleteEntryCommand } from "@/application/commands/nutrition.command";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Delete a logged entry (M9). `date` is the cached day the entry lives in.
 * Optimistic cache removal + queued `DELETE`.
 */
export function useDeleteEntry(): {
  mutate: (args: { id: string; date: string }) => Promise<void>;
} {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const mutate = useCallback(
    async ({ id, date }: { id: string; date: string }) => {
      if (!userId) return;
      deleteEntryCommand(
        { storage, userId, idFactory: localIdFactory },
        id,
        date,
      );
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useDeleteEntry] queue flush failed:", err);
      }
    },
    [auth, storage, userId],
  );

  return { mutate };
}
