import { useCallback } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import { localIdFactory } from "@/application/commands/localId";
import { editEntryCommand } from "@/application/commands/nutrition.command";
import type { EditEntryInput } from "@/domain/models/nutrition";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Edit a logged entry (M9). `date` is the cached day the entry lives in (so
 * the aggregate recomputes). Optimistic cache update + queued `PUT`.
 */
export function useEditEntry(): {
  mutate: (args: {
    id: string;
    date: string;
    input: EditEntryInput;
  }) => Promise<void>;
} {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const mutate = useCallback(
    async ({
      id,
      date,
      input,
    }: {
      id: string;
      date: string;
      input: EditEntryInput;
    }) => {
      if (!userId) return;
      editEntryCommand(
        { storage, userId, idFactory: localIdFactory },
        id,
        date,
        input,
      );
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useEditEntry] queue flush failed:", err);
      }
    },
    [auth, storage, userId],
  );

  return { mutate };
}
