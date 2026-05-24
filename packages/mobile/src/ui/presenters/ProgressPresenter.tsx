import React from "react";
import { RefreshControl, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { FeatureGatePrompt } from "@/ui/components/subscription/FeatureGatePrompt";
import type { FeatureGatePromptProps } from "@/ui/components/subscription/FeatureGatePrompt";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/homeLegacyTheme";

/**
 * Progress tab presenter. M10.5 Wave 2 scaffolds the screen so the
 * feature-gate primitives have a real surface to render against — the
 * full progress feature (PRs over time, volume trends, body
 * measurements) lands in M4 (`specs/05-progress/`).
 *
 * Sectioned approach per the brief:
 *   1. Basic stats — workouts this month + delta vs last month. Always
 *      visible (backend-derived count; no entitlement gate).
 *   2. Advanced analytics — gated. Free users see a `FeatureGatePrompt`
 *      with the upgrade CTA; premium users see a "Coming soon"
 *      placeholder until M4 ships.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Per-screen feature-
 *       gate integration > Wave 2 Progress / Health / Profile subset
 *       · specs/05-progress/ (future detailed content)
 * Satisfies: requirements.md AC 4.6
 */

export type ProgressPresenterViewModel = {
  /** True while a cold-start dashboard fetch is in flight + cache empty. */
  isLoading: boolean;
  /** True while a background refresh is in flight. */
  isRefreshing: boolean;
  /** Non-blocking error message; null when none. */
  errorMessage: string | null;
  workoutsThisMonth: number;
  workoutsLastMonth: number;
};

export type ProgressPresenterProps = {
  viewModel: ProgressPresenterViewModel;
  /**
   * Feature-gate verdict for the Progress tab's advanced-analytics
   * section. `null` while `useMySubscription` hasn't resolved; in that
   * window the section is hidden entirely (avoids flashing a paywall
   * for a user who's actually premium).
   *
   * The container computes this via `useFeatureGate("gym_buddy")` —
   * the closest existing stub for the future `advanced_analytics`
   * feature.
   */
  analyticsGate: {
    allowed: boolean;
    gateProps: FeatureGatePromptProps;
  } | null;
  onRefresh: () => void;
};

export function ProgressPresenter({
  viewModel,
  analyticsGate,
  onRefresh,
}: ProgressPresenterProps) {
  if (viewModel.isLoading) {
    return (
      <View style={styles.loaderContainer} testID="progress-loader">
        <PLogoDrawLoader />
      </View>
    );
  }

  return (
    <View style={styles.container} testID="progress-screen">
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={viewModel.isRefreshing}
            onRefresh={onRefresh}
            tintColor={Colors.text.secondary}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Progress</Text>
        </View>

        {viewModel.errorMessage && (
          <View style={styles.errorBanner} testID="progress-error-banner">
            <Text style={styles.errorBannerText}>{viewModel.errorMessage}</Text>
          </View>
        )}

        {/* Section 1: Basic stats — always visible. */}
        <View style={styles.section} testID="progress-basic-stats">
          <Text style={styles.sectionTitle}>This Month</Text>
          <View style={styles.statCard}>
            <View style={styles.statRow}>
              <Text style={styles.statValue} testID="progress-workouts-this-month">
                {viewModel.workoutsThisMonth}
              </Text>
              <Text style={styles.statLabel}>workouts</Text>
            </View>
            <Text style={styles.statSubtext}>
              {describeDelta(
                viewModel.workoutsThisMonth,
                viewModel.workoutsLastMonth,
              )}
            </Text>
          </View>
        </View>

        {/* Section 2: Advanced analytics — gated. */}
        {analyticsGate !== null && (
          <View style={styles.section} testID="progress-advanced-analytics">
            <Text style={styles.sectionTitle}>Personal Records & Trends</Text>
            {analyticsGate.allowed ? (
              <View style={styles.placeholderCard} testID="progress-analytics-placeholder">
                <Ionicons
                  name="stats-chart-outline"
                  size={32}
                  color={Colors.primary.DEFAULT}
                />
                <Text style={styles.placeholderTitle}>Coming soon</Text>
                <Text style={styles.placeholderSubtitle}>
                  Detailed PR carousel, volume trends, and body measurement charts
                  land in milestone M4 — TODO: see specs/05-progress/.
                </Text>
              </View>
            ) : (
              <FeatureGatePrompt {...analyticsGate.gateProps} />
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function describeDelta(current: number, last: number): string {
  if (current === last) return "Same as last month";
  const diff = current - last;
  const direction = diff > 0 ? "up" : "down";
  const magnitude = Math.abs(diff);
  return `${magnitude} ${direction} from last month`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  loaderContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.background.primary,
  },
  scrollContent: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xl,
    gap: Spacing.lg,
  },
  header: {
    marginBottom: Spacing.sm,
  },
  title: {
    ...Typography.h1,
  },
  errorBanner: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.warning.light,
  },
  errorBannerText: {
    ...Typography.caption,
    color: Colors.text.primary,
  },
  section: {},
  sectionTitle: {
    ...Typography.h3,
    marginBottom: Spacing.md,
  },
  statCard: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    ...Shadows.medium,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: Spacing.sm,
  },
  statValue: {
    fontSize: 36,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  statLabel: {
    ...Typography.body1,
    color: Colors.text.secondary,
  },
  statSubtext: {
    ...Typography.caption,
    color: Colors.text.secondary,
    marginTop: Spacing.xs,
  },
  placeholderCard: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    alignItems: "center",
    gap: Spacing.sm,
    ...Shadows.medium,
  },
  placeholderTitle: {
    ...Typography.h3,
    color: Colors.text.primary,
  },
  placeholderSubtitle: {
    ...Typography.body2,
    color: Colors.text.secondary,
    textAlign: "center",
  },
});
