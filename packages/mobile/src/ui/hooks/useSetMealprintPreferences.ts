import { useCallback } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import { processSyncQueue } from "@/application/commands/sync.command";
import { setMealprintPreferencesCommand } from "@/application/commands/mealprint.command";
import type {
  MealprintPreferences,
  SetMealprintPreferencesInput,
} from "@/domain/models/mealprint";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * Save the caller's Mealprint food preferences (spec-26 AC 1.3).
 *
 * Optimistic cache write + a QUEUED `PUT /nutrition/preferences`, then a
 * best-effort drain. Queued rather than online-direct on purpose: preferences are
 * ordinary user data, the write is a full last-write-wins replacement, and there
 * is no reason a user on the Tube should be unable to record a peanut allergy.
 * The AI surfaces are the online-only ones.
 *
 * ⚠ **Resolves as soon as the local write lands** — it does not wait for the
 * server, and callers must not treat resolution as "saved server-side". The
 * `processSyncQueue` call below is a nudge to flush promptly when there is a
 * connection; its failure is logged and swallowed, because the mutation is
 * already durable in the queue and the worker will retry. A caller that awaited
 * server truth here would block the Save button on a network round trip and still
 * be wrong offline.
 *
 * ⚠ **A rejected PUT surfaces through the sync-failure path, not here.** That
 * matters because a 400 `INVALID_PREFERENCE` names a field
 * (`MealprintApiError.preferenceField`) and the queue cannot show it inline. The
 * client mirrors the server's caps (`MAX_FREE_TEXT_ITEMS` / `MAX_FREE_TEXT_LENGTH`)
 * and its vocabularies are closed unions, so the editor should make a 400
 * unreachable — that mirroring is the real defence, and the drain's
 * permanent-failure classification is the backstop.
 */
export function useSetMealprintPreferences(): {
  mutate: (
    input: SetMealprintPreferencesInput,
  ) => Promise<MealprintPreferences | null>;
} {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const mutate = useCallback(
    async (input: SetMealprintPreferencesInput) => {
      if (!userId) return null;
      const optimistic = setMealprintPreferencesCommand(
        { storage, userId },
        input,
      );
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useSetMealprintPreferences] queue flush failed:", err);
      }
      return optimistic;
    },
    [auth, storage, userId],
  );

  return { mutate };
}
