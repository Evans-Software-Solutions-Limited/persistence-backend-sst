import { Ionicons } from "@expo/vector-icons";
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
import { SafeAreaView } from "react-native-safe-area-context";
import type {
  BillingCycle,
  ScheduledChange,
  SubscriptionStatus,
  SubscriptionTier,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import { Button } from "@/ui/components/Button";
import { OfflineBanner } from "@/ui/components/subscription/OfflineBanner";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
} from "@/ui/theme/subscriptionLegacyTheme";

/**
 * Phase 1 + Phase 2 Subscription Management presenter.
 *
 * Phase 1 — faithful port of legacy `persistence-mobile/app/
 * subscription-management.tsx`:
 *   - Status badge (Active / Trial / Cancelled)
 *   - Cancelled notice card
 *   - Access-ends row when cancelled
 *   - Cancel button hidden when already cancelled
 *
 * Phase 2 — V2 improvements beyond legacy:
 *   - Scheduled-change card (legacy hardcoded `hasScheduledChange:
 *     false`; V2 backend exposes it on `metadata.scheduled_change`)
 *   - Full inline tier picker covering all tiers (legacy was
 *     basic↔premium only). Lets a user upgrade to a trainer tier or
 *     a trainer downgrade to a user tier without round-tripping
 *     through the Selection screen.
 *
 * The boolean predicates (`hasActiveSub`, `isTrialingState`,
 * `isCancelledButActive`, `onFreeTier`, `canCancel`) are computed in
 * the container from `subscriptionService.ts` — single source of
 * truth, mirrors the legacy `subscriptionUtils.ts` pattern. The
 * presenter never re-derives them from `paymentStatus` because V2's
 * backend never flips `payment_status` to `'cancelled'` (the signal
 * is `cancelledAt !== null`).
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 * Satisfies: requirements.md AC 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9
 */

export interface SubscriptionManagementPresenterProps {
  currentTier: SubscriptionTierName;
  /** Pre-resolved display string for the current tier (falls back to tier name). */
  currentTierDisplayName: string | null;
  paymentStatus: SubscriptionStatus | null;
  cancelledAt: string | null;
  scheduledChange: ScheduledChange | null;
  /** Derived from `subscriptionService.isSubscriptionActive`. */
  hasActiveSub: boolean;
  /** Derived from `subscriptionService.isTrialing`. */
  isTrialingState: boolean;
  /** Derived from `subscriptionService.isCancelledButActive`. */
  isCancelledButActive: boolean;
  /** Derived from `subscriptionService.isFreeTier`. */
  onFreeTier: boolean;
  subscriptionEndsAt: string | null;
  trialEndsAt: string | null;
  billingCycle: BillingCycle | null;
  trainerClientLimit: number | null;
  /**
   * Tiers shown in the picker. Container filters out the current tier
   * and `free`; when a scheduled change is pending, only upgrades are
   * offered (downgrades require waiting for the scheduled change to
   * resolve or upgrading to supersede it).
   */
  pickerTiers: SubscriptionTier[];
  isLoading: boolean;
  isChangingTier: boolean;
  isCancelling: boolean;
  /** Derived from `subscriptionService.canCancelSubscription`. */
  canCancel: boolean;
  /** True when `scheduledChange !== null`. */
  hasScheduledChange: boolean;
  isOffline: boolean;
  isSlowLoading: boolean;
  onChangeTier: (tier: SubscriptionTierName) => void;
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

function formatPrice(amount: number, cycle: BillingCycle): string {
  const suffix = cycle === "yearly" ? "/year" : "/month";
  return `£${amount.toFixed(2)}${suffix}`;
}

export function SubscriptionManagementPresenter(
  props: SubscriptionManagementPresenterProps,
) {
  const {
    currentTier,
    currentTierDisplayName,
    cancelledAt,
    scheduledChange,
    hasActiveSub,
    isTrialingState,
    isCancelledButActive,
    onFreeTier,
    subscriptionEndsAt,
    trialEndsAt,
    billingCycle,
    trainerClientLimit,
    pickerTiers,
    isLoading,
    isChangingTier,
    isCancelling,
    canCancel,
    hasScheduledChange,
    isOffline,
    isSlowLoading,
    onChangeTier,
    onCancel,
    onBack,
  } = props;

  // Status badge selection — exactly one rendered at a time. Priority:
  //   1. Cancelled (when `cancelledAt !== null`)
  //   2. Trial (when status is trialing AND not cancelled)
  //   3. Active (when active AND not cancelled AND not trialing)
  //   4. Free (no badge — user is on free tier or no sub)
  // Mirrors legacy's badge precedence except that the cancelled
  // signal moved from `paymentStatus === 'cancelled'` to
  // `cancelledAt !== null`.
  const showCancelledBadge = cancelledAt !== null;
  const showTrialBadge = !showCancelledBadge && isTrialingState;
  const showActiveBadge =
    !showCancelledBadge && !showTrialBadge && hasActiveSub;

  const displayedTierName = currentTierDisplayName ?? currentTier;
  const cycle = billingCycle ?? "monthly";

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
          {isSlowLoading && (
            <Text
              style={styles.slowLoadingText}
              testID="subscription-management-slow-loading"
            >
              Still loading subscription information...
            </Text>
          )}
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
          {isOffline && <OfflineBanner />}

          {/* Current plan card — always rendered */}
          <View
            style={styles.subscriptionCard}
            testID="management-current-card"
          >
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Current Plan</Text>
              {showCancelledBadge && (
                <View
                  style={styles.cancelledBadge}
                  testID="management-badge-cancelled"
                >
                  <Text style={styles.cancelledBadgeText}>Cancelled</Text>
                </View>
              )}
              {showTrialBadge && (
                <View style={styles.trialBadge} testID="management-badge-trial">
                  <Text style={styles.trialBadgeText}>Trial</Text>
                </View>
              )}
              {showActiveBadge && (
                <View
                  style={styles.activeBadge}
                  testID="management-badge-active"
                >
                  <Text style={styles.activeBadgeText}>Active</Text>
                </View>
              )}
            </View>

            <Text style={styles.tierName}>{displayedTierName}</Text>

            {/* Access-ends date — only when cancelled-but-still-active */}
            {isCancelledButActive && subscriptionEndsAt && (
              <View style={styles.infoRow}>
                <Ionicons
                  name="warning"
                  size={16}
                  color={Colors.warning.DEFAULT}
                />
                <Text
                  style={styles.infoText}
                  testID="management-access-ends-row"
                >
                  Access ends: {formatDate(subscriptionEndsAt)}
                </Text>
              </View>
            )}

            {/* Trial end — only when trialing and not cancelled */}
            {trialEndsAt && !showCancelledBadge && (
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

            {/* Next billing — only when active and not cancelled */}
            {subscriptionEndsAt && !showCancelledBadge && (
              <View style={styles.infoRow}>
                <Ionicons
                  name="calendar"
                  size={16}
                  color={Colors.text.secondary}
                />
                <Text style={styles.infoText}>
                  Next billing: {formatDate(subscriptionEndsAt)}
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

            {trainerClientLimit !== null && (
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

          {/* Scheduled-change card — V2 addition, not in legacy. Shows
              when the user has a downgrade queued for period end. */}
          {scheduledChange && (
            <View style={styles.actionCard} testID="management-scheduled-card">
              <View style={styles.scheduledHeader}>
                <Ionicons
                  name="time"
                  size={18}
                  color={Colors.primary.DEFAULT}
                />
                <Text style={styles.actionTitle}>Plan Change Scheduled</Text>
              </View>
              <Text style={styles.actionDescription}>
                Your plan will change to{" "}
                {scheduledChange.nextDisplayName ??
                  scheduledChange.nextTierName}{" "}
                on {formatDate(scheduledChange.effectiveAt)}. You&apos;ll keep
                your current plan until then.
              </Text>
            </View>
          )}

          {/* Tier picker — Phase 2 addition. Replaces legacy's hardcoded
              Upgrade/Downgrade pair. Hidden entirely when on free tier
              (free users should go through Selection for the full
              role-toggle UX) or when cancelled (no plan changes
              accepted while in the cancelled-but-still-active window). */}
          {!onFreeTier && !cancelledAt && pickerTiers.length > 0 && (
            <View
              style={[styles.actionCard, isOffline && styles.disabledOpacity]}
              testID="management-picker-card"
            >
              <Text style={styles.actionTitle}>Change Plan</Text>
              <Text style={styles.actionDescription}>
                {hasScheduledChange
                  ? "You have a scheduled change pending. Upgrade to apply immediately and replace the scheduled change."
                  : "Switch to a different plan. Upgrades take effect immediately; downgrades take effect at the end of your current billing period."}
              </Text>
              <View style={styles.pickerList}>
                {pickerTiers.map((tier) => {
                  const price =
                    cycle === "yearly"
                      ? (tier.priceYearly ?? 0)
                      : (tier.priceMonthly ?? 0);
                  return (
                    <View
                      key={tier.tierName}
                      style={styles.pickerRow}
                      testID={`management-picker-row-${tier.tierName}`}
                    >
                      <View style={styles.pickerRowText}>
                        <Text style={styles.pickerTierName}>
                          {tier.displayName}
                        </Text>
                        <Text style={styles.pickerTierPrice}>
                          {formatPrice(price, cycle)}
                        </Text>
                      </View>
                      <Button
                        label="Switch"
                        onPress={() => onChangeTier(tier.tierName)}
                        isDisabled={isChangingTier}
                        isLoading={isChangingTier}
                        variant="secondary"
                        testID={`management-picker-switch-${tier.tierName}`}
                      />
                    </View>
                  );
                })}
              </View>
            </View>
          )}

          {/* Cancel section — hidden when already cancelled (legacy
              parity) and when on free tier. */}
          {canCancel && !cancelledAt && (
            <View
              style={[styles.actionCard, isOffline && styles.disabledOpacity]}
              testID="management-cancel-card"
            >
              <Text style={styles.actionTitle}>Cancel Subscription</Text>
              <Text style={styles.actionDescription}>
                {isTrialingState
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

          {/* Cancelled notice — replaces the cancel CTA when in the
              cancelled-but-still-active window. Legacy parity. */}
          {cancelledAt && subscriptionEndsAt && (
            <View
              style={styles.actionCard}
              testID="management-cancelled-notice"
            >
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
  scheduledHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
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
  // Picker layout
  pickerList: {
    gap: Spacing.sm,
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.surface.border,
    gap: Spacing.md,
  },
  pickerRowText: {
    flex: 1,
  },
  pickerTierName: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  pickerTierPrice: {
    fontSize: 13,
    color: Colors.text.secondary,
    marginTop: 2,
  },
  // M10.5 — applied conditionally on action cards when `isOffline`.
  disabledOpacity: {
    opacity: 0.5,
  },
  slowLoadingText: {
    color: Colors.text.secondary,
    fontSize: 13,
    fontStyle: "italic",
    marginTop: Spacing.sm,
    textAlign: "center",
  },
});
