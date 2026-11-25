import { useEffect } from "react";
import { AppState } from "react-native";
import { processProgressPhotoUploads } from "@/application/commands/sync.command";
import { PENDING_PROGRESS_PHOTO_TABLES } from "@/adapters/storage/tables";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/** The soonest a scheduled retry fires, so a burst of failures can't spin. */
export const PHOTO_UPLOAD_MIN_WAIT_MS = 1_000;

/**
 * PER-137 (APP-F1): keeps the progress photo upload step running while the
 * athlete is signed in — the files' counterpart of `useSyncWorker`, which
 * only drains the JSON queue. Runs a pass on mount, when a set is saved
 * (the pending table changes), on foreground, on reconnect, and when the
 * earliest back-off window opens. Mounted once, beside `useSyncWorker`.
 */
export function useProgressPhotoUploadWorker(): void {
  const { storage, api, netInfo } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = null;
      const due = storage
        .getPendingProgressPhotoSets(userId)
        .filter((p) => !p.failed)
        .map((p) => Date.parse(p.nextAttemptAt));
      if (due.length === 0) return;
      const wait = Math.max(
        Math.min(...due) - Date.now(),
        PHOTO_UPLOAD_MIN_WAIT_MS,
      );
      timer = setTimeout(() => void run(), wait);
    };

    const run = async () => {
      if (cancelled) return;
      try {
        await processProgressPhotoUploads(storage, api, userId);
      } catch (err) {
        console.error("[useProgressPhotoUploadWorker] pass failed:", err);
      }
      if (!cancelled) schedule();
    };

    void run();
    const tableUnsub = storage.subscribe(PENDING_PROGRESS_PHOTO_TABLES, () =>
      schedule(),
    );
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") void run();
    });
    const netUnsub = netInfo.subscribe((connected) => {
      if (connected) void run();
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      tableUnsub();
      appStateSub.remove();
      netUnsub();
    };
  }, [storage, api, netInfo, userId]);
}
