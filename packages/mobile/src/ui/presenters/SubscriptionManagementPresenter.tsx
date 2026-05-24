import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView } from "react-native-safe-area-context";
import type {
  BillingCycle,
  SubscriptionStatus,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import { Button } from "@/ui/components/Button";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
} from "@/ui/theme/subscriptionLegacyTheme";

/**
 * Pure presenter for the Subscription Management screen. Ported 1:1
 * from legacy `persistence-mobile/app/subscription-management.tsx`
 * lines 22–253. The container half (lines 255–415) is split into
 * `SubscriptionManagementContainer.tsx`.
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 *       > Container responsibilities (Management screen)
 * Satisfies: requirements.md AC 3.1, 3.2, 3.3, 3.4, 3.5
 *
 * Smaller surface than Selection — user tiers only (basic ↔ premium).
 * Trainer tier changes route via Selection (AC 3.8).
 */

export interface SubscriptionManagementPresenterProps {
  currentTier: SubscriptionTierName;
  paymentStatus: SubscriptionStatus | null;
  nextBillingDate: string | null;
  subscriptionEndsAt: string | null;
  trialEndsAt: string | null;
  billingCycle: BillingCycle | null;
  /** When cancelled, display the access-ends date instead of next billing. */
  displayBillingDate: string | null;
  trainerClientLimit: number | null;
  isLoading: boolean;
  isUpgrading: boolean;
  isDowngrading: boolean;
  isCancelling: boolean;
  canUpgrade: boolean;
  canDowngrade: boolean;
  canCancel: boolean;
  onUpgrade: (tier: SubscriptionTierName) => void;
  onDowngrade: (tier: SubscriptionTierName) => void;
  onCancel: () => void;
  onBack: () => void;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return "N/A";
  return new Date(dateString).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function getTierDisplayName(tierName: SubscriptionTierName): string {
  if (tierName === "free") return "Free";
  return tierName.charAt(0).toUpperCase() + tierName.slice(1);
}

export function SubscriptionManagementPresenter(
  props: SubscriptionManagementPresenterProps,
) {
  const {
    currentTier,
    paymentStatus,
    subscriptionEndsAt,
    trialEndsAt,
    billingCycle,
    displayBillingDate,
    trainerClientLimit,
    isLoading,
    isUpgrading,
    isDowngrading,
    isCancelling,
    canUpgrade,
    canDowngrade,
    canCancel,
    onUpgrade,
    onDowngrade,
    onCancel,
    onBack,
  } = props;

  if (isLoading) {
    return (
      <SafeAreaView
        style={styles.safeArea}
        testID="subscription-management-loading"
      >
        <View style={styles.loadingContainer}>
          <PLogoDrawLoader />
          <Text style={styles.loadingText}>
            Loading subscription details...
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={Colors.background.primary}
      />

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.subscriptionCard}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Current Plan</Text>
              {paymentStatus === "cancelled" && (
                <View style={styles.cancelledBadge}>
                  <Text style={styles.cancelledBadgeText}>Cancelled</Text>
                </View>
              )}
              {paymentStatus === "active" && (
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>Active</Text>
                </View>
              )}
              {paymentStatus === "trialing" && (
                <View style={styles.trialBadge}>
                  <Text style={styles.trialBadgeText}>Trial</Text>
                </View>
              )}
            </View>

            <Text style={styles.tierName}>
              {getTierDisplayName(currentTier)}
            </Text>

            {paymentStatus === "cancelled" && subscriptionEndsAt && (
              <View style={styles.infoRow}>
                <Ionicons
                  name="warning"
                  size={16}
                  color={Colors.warning.DEFAULT}
                />
                <Text style={styles.infoText}>
                  Access ends: {formatDate(subscriptionEndsAt)}
                </Text>
              </View>
            )}

            {trialEndsAt && paymentStatus !== "cancelled" && (
              <View style={styles.infoRow}>
                <Ionicons
                  name="gift"
                  size={16}
                  color={Colors.primary.DEFAULT}
                />
                <Text style={styles.infoText}>
                  Trial ends: {formatDate(trialEndsAt)}
                </Text>
              </View>
            )}

            {displayBillingDate && paymentStatus !== "cancelled" && (
              <View style={styles.infoRow}>
                <Ionicons
                  name="calendar"
                  size={16}
                  color={Colors.text.secondary}
                />
                <Text style={styles.infoText}>
                  Next billing: {formatDate(displayBillingDate)}
                </Text>
              </View>
            )}

            {billingCycle && (
              <View style={styles.infoRow}>
                <Ionicons
                  name="repeat"
                  size={16}
                  color={Colors.text.secondary}
                />
                <Text style={styles.infoText}>
                  Billing:{" "}
                  {billingCycle.charAt(0).toUpperCase() + billingCycle.slice(1)}
                </Text>
              </View>
            )}

            {trainerClientLimit !== null &&
              trainerClientLimit !== undefined && (
                <View style={styles.infoRow}>
                  <Ionicons
                    name="people"
                    size={16}
                    color={Colors.text.secondary}
                  />
                  <Text style={styles.infoText}>
                    Client slots: {trainerClientLimit}
                  </Text>
                </View>
              )}
          </View>

          {canUpgrade && (
            <View style={styles.actionCard}>
              <Text style={styles.actionTitle}>Upgrade Plan</Text>
              <Text style={styles.actionDescription}>
                Upgrade to Premium for unlimited workouts and advanced features
              </Text>
              <Button
                label="Upgrade to Premium"
                onPress={() => onUpgrade("premium")}
                isDisabled={isUpgrading}
                isLoading={isUpgrading}
                testID="management-upgrade-button"
              />
            </View>
          )}

          {canDowngrade && (
            <View style={styles.actionCard}>
              <Text style={styles.actionTitle}>Downgrade Plan</Text>
              <Text style={styles.actionDescription}>
                Your subscription will change to Basic at the end of your
                current billing period. You&apos;ll continue to have access to
                Premium features until then.
              </Text>
              <Button
                label="Downgrade to Basic"
                onPress={() => onDowngrade("basic")}
                isDisabled={isDowngrading}
                isLoading={isDowngrading}
                testID="management-downgrade-button"
              />
            </View>
          )}

          {canCancel && paymentStatus !== "cancelled" && (
            <View style={styles.actionCard}>
              <Text style={styles.actionTitle}>Cancel Subscription</Text>
              <Text style={styles.actionDescription}>
                {paymentStatus === "trialing"
                  ? "Cancel your trial to avoid being charged. You'll continue to have access until your trial period ends."
                  : "Your subscription will end at the end of your current billing period. You'll continue to have access until then."}
              </Text>
              <Button
                label="Cancel Subscription"
                onPress={onCancel}
                isDisabled={isCancelling}
                isLoading={isCancelling}
                variant="secondary"
                testID="management-cancel-button"
              />
            </View>
          )}

          {paymentStatus === "cancelled" && subscriptionEndsAt && (
            <View style={styles.actionCard}>
              <Text style={styles.actionTitle}>Subscription Cancelled</Text>
              <Text style={styles.actionDescription}>
                Your subscription has been cancelled. You&apos;ll continue to
                have access to all features until{" "}
                {formatDate(subscriptionEndsAt)}.
              </Text>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      <View style={styles.headerContainer}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          testID="subscription-management-back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Subscription Management</Text>
        <View style={styles.headerSpacer} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
  },
  loadingText: {
    color: Colors.text.primary,
    fontSize: 16,
    marginTop: Spacing.md,
  },
  headerContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    paddingTop: Spacing.lg + 8,
    backgroundColor: Colors.background.primary,
    zIndex: 10,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface.primary,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  headerSpacer: {
    width: 40,
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: 80,
  },
  subscriptionCard: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginTop: Spacing.md,
    marginBottom: Spacing.xl,
    ...Shadows.medium,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  cardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  activeBadge: {
    backgroundColor: Colors.success.DEFAULT + "20",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  activeBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.success.DEFAULT,
  },
  trialBadge: {
    backgroundColor: Colors.primary.DEFAULT + "20",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  trialBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.primary.DEFAULT,
  },
  cancelledBadge: {
    backgroundColor: Colors.error.DEFAULT + "20",
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  cancelledBadgeText: {
    fontSize: 12,
    fontWeight: "600",
    color: Colors.error.DEFAULT,
  },
  tierName: {
    fontSize: 24,
    fontWeight: "700",
    color: Colors.text.primary,
    marginBottom: Spacing.md,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: Spacing.sm,
    gap: Spacing.sm,
  },
  infoText: {
    fontSize: 14,
    color: Colors.text.secondary,
  },
  actionCard: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
    ...Shadows.medium,
  },
  actionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: Colors.text.primary,
    marginBottom: Spacing.sm,
  },
  actionDescription: {
    fontSize: 14,
    color: Colors.text.secondary,
    marginBottom: Spacing.md,
    lineHeight: 20,
  },
});
