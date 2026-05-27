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
  premium: "Premium",
  individual_trainer: "Individual Trainer",
  small_business: "Small Business Trainer",
  medium_enterprise: "Medium / Enterprise Trainer",
};

// Track classification for multi-track detection. A user-track upgrade
// (free → premium) never satisfies a trainer-track requirement and
// vice versa, so a single CTA on the banner would be misleading when
// both tracks are represented. The review screen handles per-group
// decisions; the banner falls back to a generic copy.
const TRAINER_TIERS: ReadonlySet<SubscriptionTierName> = new Set([
  "individual_trainer",
  "small_business",
  "medium_enterprise",
]);

function trackOf(tier: SubscriptionTierName): "trainer" | "user" {
  return TRAINER_TIERS.has(tier) ? "trainer" : "user";
}

export function SyncBlockedBannerMount() {
  const router = useRouter();
  const blocked = useBlockedSyncEntries();

  // Pick the most-common upgrade target as the banner's CTA hint.
  // When two tracks are blocked we return null so the banner falls
  // back to a generic "Upgrade your plan" CTA (the review screen
  // handles per-group decisions).
  //
  // Inspector Brad PR #73 sweep #4 low-severity find — the multi-track
  // case was promised in the comment but never implemented; we picked
  // the mode and advertised one track's tier even when the other
  // track's entries couldn't be satisfied by it. Now detected explicitly.
  const upgradeTargetLabel = useMemo<string | null>(() => {
    if (blocked.entries.length === 0) return null;
    const counts = new Map<SubscriptionTierName, number>();
    for (const entry of blocked.entries) {
      const target = entry.entitlementVerdict?.upgradeTo;
      if (target === undefined || target === null) continue;
      counts.set(target, (counts.get(target) ?? 0) + 1);
    }
    if (counts.size === 0) return null;

    // Multi-track guard: if the blocked targets span BOTH the user and
    // trainer tracks, no single label is honest. Return null so the
    // banner shows generic copy.
    const tracks = new Set<"trainer" | "user">();
    for (const target of counts.keys()) {
      tracks.add(trackOf(target));
      if (tracks.size > 1) return null;
    }

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
