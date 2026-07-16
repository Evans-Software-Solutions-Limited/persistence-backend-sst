import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { EntitlementFeature } from "@/domain/models/entitlement";
import type { SubscriptionTierName } from "@/domain/models/subscription";
import type { SyncQueueEntry } from "@/domain/ports/storage.port";
import { color } from "@/ui/theme/tokens";

/**
 * Sync-blocked review screen — pure presenter.
 *
 * Spec: specs/11-payments-subscriptions/design.md
 *       § Sync-queue entitlement handling (M10.6) > UI
 * Satisfies: requirements.md AC 12.5
 *
 * Renders blocked entries grouped by the verdict's upgrade target
 * tier. Each group surfaces:
 *   - The feature label + tier-upgrade hint ("Unlimited workouts
 *     requires Premium · 5 items")
 *   - A summary line per entry (entityType + relative timestamp)
 *   - Primary CTA: "Upgrade to <tier> and retry" → onUpgrade(group)
 *     Or — when `upgradeTo === null` — "Contact support" instead.
 *   - Secondary CTA: "Discard these items" → onDiscardGroup(group),
 *     which the container wraps in a confirmation modal before
 *     calling `storage.discardEntries(...)`.
 *
 * Empty state: friendly "all clear" copy — happens after the user
 * resolves the last blocked entry (upgrade succeeds + auto-retry
 * lands, or they discard everything).
 */

const FEATURE_DISPLAY_NAMES: Record<EntitlementFeature, string> = {
  create_workout: "Custom workouts beyond your monthly limit",
  ai_workout: "AI Workouts",
  ai_access: "AI photo & text food logging",
  gym_buddy: "Gym Buddy access",
  unlimited_exercise_library: "Unlimited exercise library",
  trainer_clients: "Trainer client management",
};

const TIER_DISPLAY_NAMES: Record<SubscriptionTierName, string> = {
  free: "Free",
  premium: "Premium",
  individual_trainer: "Individual Trainer",
  small_business: "Small Business Trainer",
  medium_enterprise: "Medium / Enterprise Trainer",
};

export interface SyncBlockedGroup {
  /**
   * Stable key for React lists — `upgradeTo ?? "no-upgrade"`. Groups
   * with the same upgrade target merge regardless of feature so the
   * user sees one CTA per upgrade decision, not one per feature.
   */
  key: string;
  upgradeTo: SubscriptionTierName | null;
  upgradePriceMonthly: number | null;
  entries: SyncQueueEntry[];
}

export interface SyncBlockedPresenterProps {
  groups: SyncBlockedGroup[];
  onUpgrade: (group: SyncBlockedGroup) => void;
  onDiscardGroup: (group: SyncBlockedGroup) => void;
  onContactSupport: () => void;
}

function describeEntry(entry: SyncQueueEntry): string {
  const verdict = entry.entitlementVerdict;
  const featureLabel = verdict
    ? FEATURE_DISPLAY_NAMES[verdict.feature]
    : entry.entityType;
  // Brief: "Workout #1 from 2026-05-23". We use entityType +
  // createdAt because entityId can be a local UUID that's
  // meaningless to the user.
  const createdDate = entry.createdAt.slice(0, 10);
  return `${entry.entityType} from ${createdDate} — ${featureLabel}`;
}

export function SyncBlockedPresenter({
  groups,
  onUpgrade,
  onDiscardGroup,
  onContactSupport,
}: SyncBlockedPresenterProps) {
  if (groups.length === 0) {
    return (
      <View style={styles.emptyContainer} testID="sync-blocked-empty">
        <Ionicons
          name="checkmark-circle-outline"
          size={48}
          color={color.$success}
        />
        <Text style={styles.emptyTitle}>All clear</Text>
        <Text style={styles.emptyBody}>
          No items are currently blocked by your plan.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      testID="sync-blocked-list"
    >
      {groups.map((group) => {
        const hasUpgrade = group.upgradeTo !== null;
        const tierLabel = group.upgradeTo
          ? TIER_DISPLAY_NAMES[group.upgradeTo]
          : null;
        const countLabel =
          group.entries.length === 1
            ? "1 item"
            : `${group.entries.length} items`;
        const priceLabel =
          group.upgradePriceMonthly !== null
            ? `£${group.upgradePriceMonthly}/month`
            : null;

        return (
          <View
            key={group.key}
            style={styles.card}
            testID={`sync-blocked-group-${group.key}`}
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>
                {tierLabel
                  ? `Requires ${tierLabel}`
                  : "Already at the top tier"}
              </Text>
              <Text style={styles.cardCount}>{countLabel}</Text>
            </View>

            {priceLabel && <Text style={styles.priceLine}>{priceLabel}</Text>}

            <View style={styles.entriesList}>
              {group.entries.map((entry) => (
                <View
                  key={entry.id}
                  style={styles.entryRow}
                  testID={`sync-blocked-entry-${entry.id}`}
                >
                  <Ionicons
                    name="lock-closed-outline"
                    size={14}
                    color={color.$text3}
                  />
                  <Text style={styles.entryText} numberOfLines={2}>
                    {describeEntry(entry)}
                  </Text>
                </View>
              ))}
            </View>

            <View style={styles.ctaRow}>
              {hasUpgrade ? (
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => onUpgrade(group)}
                  activeOpacity={0.7}
                  testID={`sync-blocked-upgrade-${group.key}`}
                >
                  <Text style={styles.primaryButtonText}>
                    Upgrade to {tierLabel} and retry
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={onContactSupport}
                  activeOpacity={0.7}
                  testID={`sync-blocked-contact-${group.key}`}
                >
                  <Text style={styles.primaryButtonText}>Contact support</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={() => onDiscardGroup(group)}
                activeOpacity={0.7}
                testID={`sync-blocked-discard-${group.key}`}
              >
                <Text style={styles.secondaryButtonText}>
                  Discard these items
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: 16,
    gap: 16,
  },
  card: {
    backgroundColor: color.$surface,
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
    gap: 8,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: color.$text,
  },
  cardCount: {
    fontSize: 13,
    fontWeight: "600",
    color: color.$text2,
  },
  priceLine: {
    fontSize: 14,
    fontWeight: "600",
    color: color.$primary,
  },
  entriesList: {
    gap: 4,
    marginTop: 4,
  },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  entryText: {
    fontSize: 13,
    color: color.$text2,
    flex: 1,
  },
  ctaRow: {
    gap: 8,
    marginTop: 8,
  },
  primaryButton: {
    backgroundColor: color.$primary,
    paddingVertical: 8 + 2,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: color.$bg,
  },
  secondaryButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: color.$text3,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: color.$text,
  },
  emptyBody: {
    fontSize: 14,
    color: color.$text2,
    textAlign: "center",
  },
});
