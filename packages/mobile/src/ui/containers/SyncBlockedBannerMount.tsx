import { useCallback, useMemo } from "react";
import { useRouter, type Href } from "expo-router";
import type { SubscriptionTierName } from "@/domain/models/subscription";
import { SyncBlockedBanner } from "@/ui/components/subscription/SyncBlockedBanner";
import { useBlockedSyncEntries } from "@/ui/hooks/useBlockedSyncEntries";

/**
 * Thin container that mounts the `SyncBlockedBanner` on the Home tab.
 * Reads blocked-entries state via `useBlockedSyncEntries`, picks the
 * most-common upgrade target, and routes Review to `/(app)/sync-blocked`.
 *
 * Spec: specs/11-payments-subscriptions/design.md
 *       § Sync-queue entitlement handling (M10.6) > UI
 * Satisfies: requirements.md AC 12.4
 *
 * Returns null when there are zero blocked entries — no layout flicker
 * on the Home tab, no banner-shaped gap when the queue is clean.
 */

const TIER_DISPLAY_NAMES: Record<SubscriptionTierName, string> = {
  free: "Free",
  basic: "Basic",
  premium: "Premium",
  individual_trainer_standard: "Individual Trainer",
  individual_trainer_pro: "Individual Trainer (Pro)",
  small_business_standard: "Small Business",
  small_business_pro: "Small Business (Pro)",
  medium_enterprise_standard: "Medium Enterprise",
  medium_enterprise_pro: "Medium Enterprise (Pro)",
};

export function SyncBlockedBannerMount() {
  const router = useRouter();
  const blocked = useBlockedSyncEntries();

  // Pick the most-common upgrade target as the banner's CTA hint.
  // When two tracks are blocked we return null so the banner falls
  // back to a generic "Upgrade your plan" CTA (the review screen
  // handles per-group decisions).
  const upgradeTargetLabel = useMemo<string | null>(() => {
    if (blocked.entries.length === 0) return null;
    const counts = new Map<SubscriptionTierName, number>();
    for (const entry of blocked.entries) {
      const target = entry.entitlementVerdict?.upgradeTo;
      if (target === undefined || target === null) continue;
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    if (counts.size === 0) return null;
    // Mode (most-common). Tie-break by insertion order — which is
    // FIFO by `blockedAt` thanks to the hook's ordering, so the
    // earliest-blocked wins. Predictable enough for UX.
    let bestTarget: SubscriptionTierName | null = null;
    let bestCount = 0;
    for (const [target, count] of counts) {
      if (count > bestCount) {
        bestCount = count;
        bestTarget = target;
      }
    }
    return bestTarget ? TIER_DISPLAY_NAMES[bestTarget] : null;
  }, [blocked.entries]);

  const onReview = useCallback(() => {
    router.push("/(app)/sync-blocked" as Href);
  }, [router]);

  return (
    <SyncBlockedBanner
      total={blocked.total}
      upgradeTargetLabel={upgradeTargetLabel}
      onReview={onReview}
    />
  );
}
