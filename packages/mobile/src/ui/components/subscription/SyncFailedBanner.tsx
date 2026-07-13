import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import {
  BorderRadius,
  Colors,
  Spacing,
} from "@/ui/theme/subscriptionLegacyTheme";

/**
 * Single-line banner shown at the top of the Home tab when one or more
 * sync-queue entries have exhausted their retry budget.
 *
 * Spec: specs/milestones/M13-sync-hardening § Failed-sync review UI
 *
 * Pure presenter — no hooks, no router. The container reads
 * `useFailedSyncEntries()`, decides whether to mount, and wires
 * `onReview` to a `router.push('/(app)/sync-failed')`.
 *
 * Mirrors `SyncBlockedBanner` (M10.6) exactly in structure/style — same
 * warning-strip pattern the two banners are designed to stack under one
 * another on the Home tab — but uses the `error` (not `warning`) tint:
 * a blocked-by-plan entry has a known fix (upgrade), a failed-exhausted
 * entry needs the user to actively decide Retry vs. Discard, which reads
 * as a step more severe.
 *
 * Hidden when `total === 0` to avoid layout flicker on first mount
 * (same Inspector Brad pattern as `SyncBlockedBanner`).
 */
export interface SyncFailedBannerProps {
  total: number;
  onReview: () => void;
}

export function SyncFailedBanner({ total, onReview }: SyncFailedBannerProps) {
  if (total <= 0) return null;

  const itemsLabel = total === 1 ? "1 item" : `${total} items`;

  return (
    <View style={styles.banner} testID="sync-failed-banner">
      <Ionicons
        name="alert-circle"
        size={16}
        color={Colors.error.DEFAULT}
        style={styles.icon}
      />
      <View style={styles.textWrap}>
        <Text style={styles.line} numberOfLines={1}>
          {itemsLabel} failed to sync
        </Text>
      </View>
      <TouchableOpacity
        onPress={onReview}
        style={styles.reviewButton}
        activeOpacity={0.7}
        testID="sync-failed-banner-review"
      >
        <Text style={styles.reviewText}>Review</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.error.DEFAULT + "1A",
    borderWidth: 1,
    borderColor: Colors.error.DEFAULT + "40",
    borderRadius: BorderRadius.md,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
  },
  icon: {
    flexShrink: 0,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  line: {
    fontSize: 13,
    fontWeight: "600",
    color: Colors.error.DEFAULT,
  },
  reviewButton: {
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.error.DEFAULT + "33",
  },
  reviewText: {
    fontSize: 12,
    fontWeight: "700",
    color: Colors.error.DEFAULT,
  },
});
