import { useCallback } from "react";
import { useRouter, type Href } from "expo-router";
import { SyncFailedBanner } from "@/ui/components/subscription/SyncFailedBanner";
import { useFailedSyncEntries } from "@/ui/hooks/useFailedSyncEntries";

/**
 * Thin container that mounts the `SyncFailedBanner` on the Home tab.
 * Reads failed-exhausted-entries state via `useFailedSyncEntries` and
 * routes Review to `/(app)/sync-failed`.
 *
 * Spec: specs/milestones/M13-sync-hardening § Failed-sync review UI
 *
 * Mirrors `SyncBlockedBannerMount` (M10.6). Returns null when there are
 * zero failed-exhausted entries — no layout flicker, no banner-shaped gap
 * when the queue is clean.
 */
export function SyncFailedBannerMount() {
  const router = useRouter();
  const failed = useFailedSyncEntries();

  const onReview = useCallback(() => {
    router.push("/(app)/sync-failed" as Href);
  }, [router]);

  return <SyncFailedBanner total={failed.total} onReview={onReview} />;
}
