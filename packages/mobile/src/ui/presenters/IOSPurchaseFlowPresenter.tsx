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
import { color } from "@/ui/theme/tokens";

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

  /** Whether the current Apple Account is intro-eligible for THIS tier's
   * product on the shown cycle (RevenueCat's real answer). Per-tier so a
   * banner only shows on a tile whose own product grants a trial. */
  isTierTrialEligible: (tier: SubscriptionTierName) => boolean;
  /** Free-trial length (days) advertised on every tile — derived ONLY from the
   * product's real Apple intro offer. `null` when no real offer is surfaced;
   * the tile then shows NO trial banner (we never guess a duration). */
  trialDurationDays: number | null;
  hasTrialEligibilityData: boolean;

  /** Tiers whose ANNUAL plan shows "Contact Sales" instead of an IAP button
   * (too large for IAP — handled B2B). Only applies on the yearly cycle. */
  contactSalesTiers: ReadonlySet<SubscriptionTierName>;
  onContactSales: (tier: SubscriptionTierName) => void;

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
    isTierTrialEligible,
    trialDurationDays,
    hasTrialEligibilityData,
    contactSalesTiers,
    onContactSales,
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
        hasTrialEligibilityData &&
        trialDurationDays !== null &&
        isTierTrialEligible("premium") &&
        !isPremiumCurrent;
      cards.push(
        <SubscriptionCard
          key={premium.tierName}
          tier={premium}
          billingCycle={billingCycle}
          isCurrent={isPremiumCurrent}
          showTrialBanner={showPremiumTrial}
          trialBannerText={
            trialDurationDays !== null
              ? `${trialDurationDays}-day free trial`
              : undefined
          }
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
    isTierTrialEligible,
    trialDurationDays,
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
        // This tier's annual plan is sold via sales, not IAP → show a
        // "Contact Sales" CTA instead of a purchase button (and no trial).
        const isContactSales =
          billingCycle === "yearly" && contactSalesTiers.has(baseName);
        const showTrialBanner =
          hasTrialEligibilityData &&
          trialDurationDays !== null &&
          isTierTrialEligible(baseName) &&
          !isCurrent &&
          !isContactSales;
        cards.push(
          <TrainerSubscriptionCard
            key={baseName}
            standardTier={null}
            proTier={tier}
            billingCycle={billingCycle}
            isStandardCurrent={false}
            isProCurrent={isCurrent}
            showProTrialBanner={showTrialBanner}
            trialBannerText={
              trialDurationDays !== null
                ? `${trialDurationDays}-day free trial`
                : undefined
            }
            contactSalesMode={isContactSales}
            onContactSales={() => onContactSales(baseName)}
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
    isTierTrialEligible,
    trialDurationDays,
    contactSalesTiers,
    onContactSales,
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
          <Ionicons name="warning" size={48} color={color.$error} />
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
      <StatusBar barStyle="light-content" backgroundColor={color.$bg} />

      <View style={styles.headerContainer}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          disabled={isProcessing || isRestoring}
          testID="ios-purchase-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={color.$text} />
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
          disabled={isProcessing || isRestoring || isUnavailable}
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
            <Ionicons name="open-outline" size={16} color={color.$text2} />
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
  safeArea: { flex: 1, backgroundColor: color.$bg },
  centeredContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    gap: 16,
  },
  loadingText: {
    color: color.$text,
    fontSize: 16,
    marginTop: 16,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: color.$text,
    textAlign: "center",
  },
  errorMessage: {
    fontSize: 14,
    color: color.$text2,
    textAlign: "center",
  },
  primaryButton: {
    backgroundColor: color.$primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 16,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: color.$bg,
  },
  headerContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 24,
    paddingVertical: 16,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.$surface,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 1,
    borderColor: color.$surface3,
  },
  headerTitle: { fontSize: 20, fontWeight: "600", color: color.$text },
  headerSpacer: { width: 40 },
  scrollView: { flex: 1, paddingHorizontal: 24 },
  processingOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.$bg + "E6",
    zIndex: 1000,
    justifyContent: "center",
    alignItems: "center",
  },
  processingContainer: {
    backgroundColor: color.$surface,
    borderRadius: 16,
    padding: 32,
    alignItems: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
    minWidth: 200,
  },
  processingText: {
    color: color.$text,
    fontSize: 16,
    fontWeight: "600",
    marginTop: 16,
    textAlign: "center",
  },
  noticeCard: {
    backgroundColor: color.$surface,
    borderRadius: 12,
    padding: 16,
    marginTop: 16,
    borderWidth: 1,
    borderColor: color.$surface3,
  },
  noticeText: { fontSize: 14, color: color.$text2 },
  roleToggleContainer: {
    flexDirection: "row",
    backgroundColor: color.$surface,
    borderRadius: 16,
    padding: 4,
    marginTop: 16,
  },
  roleToggleButton: {
    flex: 1,
    paddingVertical: 16,
    alignItems: "center",
    borderRadius: 12,
  },
  roleToggleButtonActive: { backgroundColor: color.$primary },
  roleToggleText: {
    fontSize: 14,
    fontWeight: "600",
    color: color.$text2,
  },
  roleToggleTextActive: { color: color.$bg },
  billingToggleContainer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    marginTop: 24,
    marginBottom: 16,
  },
  billingToggleLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: color.$text,
  },
  billingToggleSavings: { color: color.$primary, fontWeight: "700" },
  billingToggle: {
    width: 52,
    height: 28,
    backgroundColor: color.$surface2,
    borderRadius: 14,
    padding: 2,
    justifyContent: "center",
  },
  billingToggleThumb: {
    width: 24,
    height: 24,
    backgroundColor: color.$primary,
    borderRadius: 12,
  },
  subscriptionOptions: { marginTop: 16 },
  tierCards: { gap: 16 },
  trainerDescriptionText: {
    fontSize: 14,
    color: color.$text2,
    lineHeight: 20,
    marginBottom: 16,
  },
  emptyStateContainer: {
    backgroundColor: color.$surface,
    borderRadius: 16,
    padding: 24,
    alignItems: "center",
  },
  emptyStateText: {
    fontSize: 14,
    color: color.$text2,
    textAlign: "center",
  },
  restoreButton: {
    marginTop: 24,
    paddingVertical: 16,
    alignItems: "center",
  },
  restoreButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: color.$primary,
  },
  manageButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 16,
    marginBottom: 24,
  },
  manageButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: color.$text2,
  },
  footnote: {
    fontSize: 12,
    color: color.$text2,
    textAlign: "center",
    marginBottom: 32,
  },
});
