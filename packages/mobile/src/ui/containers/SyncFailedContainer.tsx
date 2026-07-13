import { useCallback } from "react";
import { Alert } from "react-native";
import { processSyncQueue } from "@/application/commands/sync.command";
import { getApiBaseUrl } from "@/adapters/api";
import type { SyncQueueEntry } from "@/domain/ports/storage.port";
import { SyncFailedPresenter } from "@/ui/presenters/SyncFailedPresenter";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useFailedSyncEntries } from "@/ui/hooks/useFailedSyncEntries";

/**
 * Container for the `/sync-failed` review screen.
 *
 * Spec: specs/milestones/M13-sync-hardening § Failed-sync review UI
 *
 * Mirrors `SyncBlockedContainer` (M10.6). Responsibilities:
 *   - Read failed-exhausted entries via `useFailedSyncEntries`
 *   - Retry: `storage.resetFailedEntries([entry.id])` (returns the single
 *     entry to `pending` with a clean retry budget), refresh immediately
 *     so the card leaves the list, then fire a best-effort
 *     `processSyncQueue` flush so it actually gets sent right away
 *     instead of waiting for the next foreground/reconnect trigger.
 *   - Discard: confirmation `Alert` then `storage.discardEntries([entry.id])`
 *     + refresh. The warning copy escalates for a `session` entry — a
 *     completed workout mutation only exists on this device; discarding
 *     it loses that workout forever (no server copy to fall back on).
 */
export function SyncFailedContainer() {
  const { storage, auth } = useAdapters();
  const failed = useFailedSyncEntries();

  const onRetry = useCallback(
    (entry: SyncQueueEntry) => {
      storage.resetFailedEntries([entry.id]);
      failed.refresh();

      // Best-effort immediate flush. Any error here is non-fatal: the
      // entry is already back to `pending` and will still be picked up
      // by `useSyncWorker`'s ordinary foreground/reconnect triggers.
      void processSyncQueue(storage, auth, getApiBaseUrl())
        .catch((err) => {
          console.error("[SyncFailedContainer] retry flush failed:", err);
        })
        .finally(() => {
          failed.refresh();
        });
    },
    [storage, auth, failed],
  );

  const onDiscard = useCallback(
    (entry: SyncQueueEntry) => {
      const isSession = entry.entityType === "session";
      Alert.alert(
        "Discard this item?",
        isSession
          ? "This will be removed from your sync queue. Because it's a completed workout, discarding it means that workout is lost — it only exists on this device and will never reach the server."
          : "This will be removed from your sync queue and will never sync.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              storage.discardEntries([entry.id]);
              failed.refresh();
            },
          },
        ],
      );
    },
    [storage, failed],
  );

  return (
    <SyncFailedPresenter
      entries={failed.entries}
      onRetry={onRetry}
      onDiscard={onDiscard}
    />
  );
}
