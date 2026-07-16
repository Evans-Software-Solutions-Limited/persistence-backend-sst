import React, { useMemo } from "react";
import {
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
  SubscriptionTier,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import { CurrentSubscriptionStatusCard } from "@/ui/components/subscription/CurrentSubscriptionStatusCard";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import { SubscriptionCard } from "@/ui/components/subscription/SubscriptionCard";
import { TrainerSubscriptionCard } from "@/ui/components/subscription/TrainerSubscriptionCard";
import { getFeaturesList } from "@/ui/presenters/SubscriptionSelectionPresenter";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
} from "@/ui/theme/subscriptionLegacyTheme";

/**
 * Pure presenter for the iOS RevenueCat purchase flow (M12, iOS rail).
 *
 * Spec: specs/milestones/M12-app-store-iap/FRONTEND_BRIEF.md § Deliverables 3–6
 *
 * Renders the SAME plan cards + role/billing toggles as
 * `SubscriptionSelectionPresenter` (fidelity guard — no restyle), but the
 * purchase mechanism is native Apple IAP via RevenueCat, NOT Stripe. There is
 * deliberately **no Stripe / Apple Pay path reachable here** (Apple §3.1.1):
 * tapping a tile drives `onTierSelect`, which the container routes to
 * `Purchases.purchasePackage`. Adds Restore Purchases + "Manage in App Store"
 * affordances Apple requires for IAP.
 *
 * §3.1.1 copy review: no "subscribe on our website", no external-purchase
 * steering — every CTA is an in-app Apple purchase or an Apple-managed link.
 */

type Role = "user" | "trainer";

export interface IOSPurchaseFlowPresenterProps {
  subscriptionTiers: SubscriptionTier[];
  isLoading: boolean;
  errorMessage: string | null;
  /** RevenueCat not configured (missing dev SDK key) → inline unavailable. */
  isUnavailable: boolean;

  billingCycle: BillingCycle;
  currentTier: SubscriptionTierName;
  selectedRole: Role;

  /** Tiers with at least one purchasable Apple product in the offering. */
  purchasableTiers: ReadonlySet<SubscriptionTierName>;

  isTrialEligibleUser: boolean;
  isTrialEligibleTrainer: boolean;
  hasTrialEligibilityData: boolean;

  subscriptionEndsAt: string | null;
  isCancelledButActive: boolean;
  currentTierDisplayName: string;

  isProcessing: boolean;
  isRestoring: boolean;

  onBillingCycleChange: (cycle: BillingCycle) => void;
  onTierSelect: (tier: SubscriptionTierName) => void;
  onRoleChange: (role: Role) => void;
  onBack: () => void;
  onRetry: () => void;
  onRestore: () => void;
  onManageInAppStore: () => void;
}

export function IOSPurchaseFlowPresenter(props: IOSPurchaseFlowPresenterProps) {
  const {
    subscriptionTiers,
    isLoading,
    errorMessage,
    isUnavailable,
    billingCycle,
    currentTier,
    selectedRole,
    purchasableTiers,
    isTrialEligibleUser,
    isTrialEligibleTrainer,
    hasTrialEligibilityData,
    subscriptionEndsAt,
    isCancelledButActive,
    currentTierDisplayName,
    isProcessing,
    isRestoring,
    onBillingCycleChange,
    onTierSelect,
    onRoleChange,
    onBack,
    onRetry,
    onRestore,
    onManageInAppStore,
  } = props;

  const userTierCards = useMemo(() => {
    const premium = subscriptionTiers.find((t) => t.tierName === "premium");
    const cards: React.ReactElement[] = [];
    if (premium) {
      const isPremiumCurrent = currentTier === "premium";
      const showPremiumTrial =
        hasTrialEligibilityData && isTrialEligibleUser && !isPremiumCurrent;
      cards.push(
        <SubscriptionCard
          key={premium.tierName}
          tier={premium}
          billingCycle={billingCycle}
          isCurrent={isPremiumCurrent}
          showTrialBanner={showPremiumTrial}
          trialBannerText="7-day free trial"
          onPress={() => onTierSelect("premium")}
          disabled={isProcessing || isRestoring}
          getFeaturesList={getFeaturesList}
          isTrainer={false}
        />,
      );
    }
    return cards;
  }, [
    subscriptionTiers,
    billingCycle,
    currentTier,
    hasTrialEligibilityData,
    isTrialEligibleUser,
    isProcessing,
    isRestoring,
    onTierSelect,
  ]);

  const trainerTierCards = useMemo(() => {
    const baseNames: SubscriptionTierName[] = [
      "individual_trainer",
      "small_business",
      "medium_enterprise",
    ];
    const cards: React.ReactElement[] = [];
    for (const baseName of baseNames) {
      const tier = subscriptionTiers.find((t) => t.tierName === baseName);
      if (tier) {
        const isCurrent = currentTier === tier.tierName;
        const showTrialBanner =
          hasTrialEligibilityData && isTrialEligibleTrainer && !isCurrent;
        cards.push(
          <TrainerSubscriptionCard
            key={baseName}
            standardTier={null}
            proTier={tier}
            billingCycle={billingCycle}
            isStandardCurrent={false}
            isProCurrent={isCurrent}
            showProTrialBanner={showTrialBanner}
            trialBannerText="14-day free trial"
            onStandardPress={() => {}}
            onProPress={() => onTierSelect(tier.tierName)}
            disabled={isProcessing || isRestoring}
          />,
        );
      }
    }
    return cards;
  }, [
    subscriptionTiers,
    billingCycle,
    currentTier,
    hasTrialEligibilityData,
    isTrialEligibleTrainer,
    isProcessing,
    isRestoring,
    onTierSelect,
  ]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} testID="ios-purchase-loading">
        <View style={styles.centeredContainer}>
          <PLogoDrawLoader />
          <Text style={styles.loadingText}>Loading plans...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (errorMessage) {
    return (
      <SafeAreaView style={styles.safeArea} testID="ios-purchase-error">
        <View style={styles.centeredContainer}>
          <Ionicons name="warning" size={48} color={Colors.error.DEFAULT} />
          <Text style={styles.errorTitle}>Couldn&apos;t load plans</Text>
          <Text style={styles.errorMessage}>{errorMessage}</Text>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={onRetry}
            testID="ios-purchase-retry"
          >
            <Text style={styles.primaryButtonText}>Retry</Text>
          </TouchableOpacity>
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

      <View style={styles.headerContainer}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          disabled={isProcessing || isRestoring}
          testID="ios-purchase-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choose your plan</Text>
        <View style={styles.headerSpacer} />
      </View>

      {isProcessing && (
        <View style={styles.processingOverlay} testID="ios-purchase-processing">
          <View style={styles.processingContainer}>
            <PLogoDrawLoader />
            <Text style={styles.processingText}>Completing purchase...</Text>
          </View>
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
      >
        {isUnavailable && (
          <View style={styles.noticeCard} testID="ios-purchase-unavailable">
            <Text style={styles.noticeText}>
              In-app purchases aren&apos;t available right now. Please try again
              later.
            </Text>
          </View>
        )}

        <View style={styles.roleToggleContainer}>
          <TouchableOpacity
            style={[
              styles.roleToggleButton,
              selectedRole === "user" && styles.roleToggleButtonActive,
            ]}
            onPress={() => onRoleChange("user")}
            testID="role-toggle-user"
          >
            <Text
              style={[
                styles.roleToggleText,
                selectedRole === "user" && styles.roleToggleTextActive,
              ]}
            >
              I&apos;m a User
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.roleToggleButton,
              selectedRole === "trainer" && styles.roleToggleButtonActive,
            ]}
            onPress={() => onRoleChange("trainer")}
            testID="role-toggle-trainer"
          >
            <Text
              style={[
                styles.roleToggleText,
                selectedRole === "trainer" && styles.roleToggleTextActive,
              ]}
            >
              I&apos;m a Trainer
            </Text>
          </TouchableOpacity>
        </View>

        {currentTier !== "free" && (
          <CurrentSubscriptionStatusCard
            currentTierDisplayName={currentTierDisplayName}
            isCancelledButActive={isCancelledButActive}
            subscriptionEndsAt={subscriptionEndsAt}
            scheduledChange={null}
          />
        )}

        <View style={styles.billingToggleContainer}>
          <Text style={styles.billingToggleLabel}>Monthly</Text>
          <TouchableOpacity
            style={styles.billingToggle}
            onPress={() =>
              onBillingCycleChange(
                billingCycle === "monthly" ? "yearly" : "monthly",
              )
            }
            testID="billing-cycle-toggle"
            accessibilityRole="switch"
            accessibilityLabel="Billing cycle"
            accessibilityState={{ checked: billingCycle === "yearly" }}
          >
            <View
              style={[
                styles.billingToggleThumb,
                {
                  transform: [
                    { translateX: billingCycle === "yearly" ? 24 : 0 },
                  ],
                },
              ]}
            />
          </TouchableOpacity>
          <Text style={styles.billingToggleLabel}>
            Yearly <Text style={styles.billingToggleSavings}>(Save 20%)</Text>
          </Text>
        </View>

        <View style={styles.subscriptionOptions}>
          {selectedRole === "trainer" ? (
            <>
              <Text style={styles.trainerDescriptionText}>
                The AI Buddy gives your clients the ability to enhance their
                training experience with you, giving them support of needing to
                swap exercises out or ask any generic questions about their
                program.
              </Text>
              {trainerTierCards.length > 0 ? (
                <View style={styles.tierCards}>{trainerTierCards}</View>
              ) : (
                <View style={styles.emptyStateContainer}>
                  <Text style={styles.emptyStateText}>
                    No trainer plans available right now.
                  </Text>
                </View>
              )}
            </>
          ) : (
            <View style={styles.tierCards}>{userTierCards}</View>
          )}
        </View>

        <TouchableOpacity
          style={styles.restoreButton}
          onPress={onRestore}
          disabled={isProcessing || isRestoring}
          testID="ios-purchase-restore"
        >
          <Text style={styles.restoreButtonText}>
            {isRestoring ? "Restoring..." : "Restore Purchases"}
          </Text>
        </TouchableOpacity>

        {currentTier !== "free" && (
          <TouchableOpacity
            style={styles.manageButton}
            onPress={onManageInAppStore}
            disabled={isProcessing || isRestoring}
            testID="ios-purchase-manage"
          >
            <Ionicons
              name="open-outline"
              size={16}
              color={Colors.text.secondary}
            />
            <Text style={styles.manageButtonText}>Manage in App Store</Text>
          </TouchableOpacity>
        )}

        {/* Tiers without an Apple product yet surface a neutral note (no
            external-purchase steering — Apple §3.1.1). */}
        {selectedRole === "trainer" &&
          trainerTierCards.length > 0 &&
          purchasableTiers.size === 0 && (
            <Text style={styles.footnote} testID="ios-purchase-tier-note">
              Some plans aren&apos;t available for in-app purchase yet.
            </Text>
          )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background.primary },
  centeredContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  loadingText: {
    color: Colors.text.primary,
    fontSize: 16,
    marginTop: Spacing.md,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: Colors.text.primary,
    textAlign: "center",
  },
  errorMessage: {
    fontSize: 14,
    color: Colors.text.secondary,
    textAlign: "center",
  },
  primaryButton: {
    backgroundColor: Colors.primary.DEFAULT,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.md,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: Colors.text.inverse,
  },
  headerContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
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
  headerTitle: { fontSize: 20, fontWeight: "600", color: Colors.text.primary },
  headerSpacer: { width: 40 },
  scrollView: { flex: 1, paddingHorizontal: Spacing.lg },
  processingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.background.primary + "E6",
    zIndex: 1000,
    justifyContent: "center",
    alignItems: "center",
  },
  processingContainer: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xl,
    alignItems: "center",
    ...Shadows.large,
    minWidth: 200,
  },
  processingText: {
    color: Colors.text.primary,
    fontSize: 16,
    fontWeight: "600",
    marginTop: Spacing.md,
    textAlign: "center",
  },
  noticeCard: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginTop: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  noticeText: { fontSize: 14, color: Colors.text.secondary },
  roleToggleContainer: {
    flexDirection: "row",
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.xs,
    marginTop: Spacing.md,
  },
  roleToggleButton: {
    flex: 1,
    paddingVertical: Spacing.md,
    alignItems: "center",
    borderRadius: BorderRadius.md,
  },
  roleToggleButtonActive: { backgroundColor: Colors.primary.DEFAULT },
  roleToggleText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  roleToggleTextActive: { color: Colors.text.inverse },
  billingToggleContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.md,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
  },
  billingToggleLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  billingToggleSavings: { color: Colors.primary.DEFAULT, fontWeight: "700" },
  billingToggle: {
    width: 52,
    height: 28,
    backgroundColor: Colors.surface.secondary,
    borderRadius: 14,
    padding: 2,
    justifyContent: "center",
  },
  billingToggleThumb: {
    width: 24,
    height: 24,
    backgroundColor: Colors.primary.DEFAULT,
    borderRadius: 12,
  },
  subscriptionOptions: { marginTop: Spacing.md },
  tierCards: { gap: Spacing.md },
  trainerDescriptionText: {
    fontSize: 14,
    color: Colors.text.secondary,
    lineHeight: 20,
    marginBottom: Spacing.md,
  },
  emptyStateContainer: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 14,
    color: Colors.text.secondary,
    textAlign: "center",
  },
  restoreButton: {
    marginTop: Spacing.lg,
    paddingVertical: Spacing.md,
    alignItems: "center",
  },
  restoreButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.primary.DEFAULT,
  },
  manageButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    marginBottom: Spacing.lg,
  },
  manageButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  footnote: {
    fontSize: 12,
    color: Colors.text.secondary,
    textAlign: "center",
    marginBottom: Spacing.xl,
  },
});
