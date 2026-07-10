import { useCallback, useMemo } from "react";
import { Alert } from "react-native";
import { useRouter, type Href } from "expo-router";
import type { BillingCycle } from "@/domain/models/subscription";
import {
  SyncBlockedPresenter,
  type SyncBlockedGroup,
} from "@/ui/presenters/SyncBlockedPresenter";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useBlockedSyncEntries } from "@/ui/hooks/useBlockedSyncEntries";
import { useMySubscription } from "@/ui/hooks/useMySubscription";

/**
 * Container for the `/sync-blocked` review screen.
 *
 * Spec: specs/11-payments-subscriptions/design.md
 *       § Sync-queue entitlement handling (M10.6) > UI
 * Satisfies: requirements.md AC 12.4, 12.5
 *
 * Responsibilities:
 *   - Read blocked entries via `useBlockedSyncEntries`
 *   - Group entries by upgrade target tier (merge across features —
 *     one CTA per upgrade decision)
 *   - Route "Upgrade and retry" to the Selection screen with the
 *     target tier + the user's current billing cycle pre-applied
 *     (`/(auth)/subscription-selection?tier=...&cycle=...`)
 *   - Wrap "Discard these items" in a confirmation Alert + call
 *     `storage.discardEntries(...)` then `refresh()` so the screen
 *     re-renders with the now-shorter list
 *   - "Contact support" affordance for already-top-tier verdicts —
 *     opens a confirmation alert (a deep-link to support is M11 work)
 *
 * The container does NOT touch the cached local data that an entry
 * referenced. The brief calls out reference-counting as overkill for
 * the small + bounded leak; we leave the leaked rows in place so
 * the bug surface is bounded to "user discarded a workout — the
 * cached row still shows in offline reads but never syncs". Future
 * milestone can wire reference counts.
 */
export function SyncBlockedContainer() {
  const router = useRouter();
  const { storage } = useAdapters();
  const blocked = useBlockedSyncEntries();
  const subQuery = useMySubscription();

  const billingCycle: BillingCycle = subQuery.data?.billingCycle ?? "monthly";

  // Group entries by upgrade target tier — entries that all want the
  // same upgrade collapse into one card, even when they're for
  // different features. The user makes one upgrade decision per
  // group, not per feature.
  const groups = useMemo<SyncBlockedGroup[]>(() => {
    const byTarget = new Map<string, SyncBlockedGroup>();
    for (const entry of blocked.entries) {
      const verdict = entry.entitlementVerdict;
      if (!verdict) continue;
      const key = verdict.upgradeTo ?? "no-upgrade";
      const existing = byTarget.get(key);
      if (existing) {
        existing.entries.push(entry);
        // Prefer the first-seen price (verdicts should agree on price
        // per tier, but defensively don't overwrite with null).
        if (
          existing.upgradePriceMonthly === null &&
          verdict.upgradePriceMonthly !== null
        ) {
          existing.upgradePriceMonthly = verdict.upgradePriceMonthly;
        }
        continue;
      }
      byTarget.set(key, {
        key,
        upgradeTo: verdict.upgradeTo,
        upgradePriceMonthly: verdict.upgradePriceMonthly,
        entries: [entry],
      });
    }
    return Array.from(byTarget.values());
  }, [blocked.entries]);

  const onUpgrade = useCallback(
    (group: SyncBlockedGroup) => {
      if (group.upgradeTo === null) return;
      router.push(
        `/(auth)/subscription-selection?tier=${group.upgradeTo}&cycle=${billingCycle}` as Href,
      );
    },
    [router, billingCycle],
  );

  const onDiscardGroup = useCallback(
    (group: SyncBlockedGroup) => {
      const countLabel =
        group.entries.length === 1
          ? "this 1 item"
          : `these ${group.entries.length} items`;
      Alert.alert(
        "Discard blocked items?",
        `${countLabel} will be removed from your queue. The local data they referenced will stay on this device but will never sync.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              storage.discardEntries(group.entries.map((e) => e.id));
              blocked.refresh();
            },
          },
        ],
      );
    },
    [storage, blocked],
  );

  const onContactSupport = useCallback(() => {
    Alert.alert(
      "Contact support",
      "You're already on our top tier. Email admin@evans-software-solutions.com and we'll help you sort this out.",
    );
  }, []);

  return (
    <SyncBlockedPresenter
      groups={groups}
      onUpgrade={onUpgrade}
      onDiscardGroup={onDiscardGroup}
      onContactSupport={onContactSupport}
    />
  );
}
