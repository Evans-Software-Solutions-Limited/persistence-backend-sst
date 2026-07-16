import React, { useMemo } from "react";
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
  MySubscription,
  SubscriptionTier,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import type { PaymentsPort } from "@/domain/ports/payments.port";
import { CurrentSubscriptionStatusCard } from "@/ui/components/subscription/CurrentSubscriptionStatusCard";
import { OfflineBanner } from "@/ui/components/subscription/OfflineBanner";
import { PaymentMethodForm } from "@/ui/components/subscription/PaymentMethodForm";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import { SubscriptionCard } from "@/ui/components/subscription/SubscriptionCard";
import { TrainerSubscriptionCard } from "@/ui/components/subscription/TrainerSubscriptionCard";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
} from "@/ui/theme/subscriptionLegacyTheme";

/**
 * Pure presenter for the Subscription Selection screen. Ported 1:1
 * from legacy `persistence-mobile/app/(auth)/subscription-selection.tsx`
 * lines 79–564 (the presenter half — the file's container half
 * starts at line 638 and is split out into
 * `SubscriptionSelectionContainer.tsx`).
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 *       > Container responsibilities (Selection screen)
 * Satisfies: requirements.md AC 1.1–1.9, 2.1, 2.6, 2.7, 2.9, 3.6, 3.7,
 *            6.1, 6.2, 6.3, 6.4, 7.3
 *
 * Pure — no hooks beyond `useMemo` for derived view models, no side
 * effects. All state arrives via props; all interactions delegate to
 * container-owned callbacks.
 */

type Role = "user" | "trainer";

export interface SubscriptionSelectionPresenterProps {
  subscriptionTiers: SubscriptionTier[];
  isLoading: boolean;
  errorMessage: string | null;

  // Tier-related state
  billingCycle: BillingCycle;
  currentTier: SubscriptionTierName;
  selectedRole: Role;

  // Trial eligibility
  isTrialEligibleUser: boolean;
  isTrialEligibleTrainer: boolean;
  hasTrialEligibilityData: boolean;

  // Subscription status
  subscriptionEndsAt: string | null;
  canCancel: boolean;
  isCancelledButActive: boolean;
  scheduledChange: {
    nextTierDisplayName: string;
    effectiveAt: string;
    currentTierActiveUntil: string | null;
    currentTierDisplayName: string;
  } | null;
  currentTierDisplayName: string;

  // Offline + slow-network UX (M10.5)
  isOffline: boolean;
  isSlowLoading: boolean;

  // Payment-form state
  selectedTierForPayment: SubscriptionTierName | null;
  isProcessingSubscription: boolean;
  /** Pence — drives the Apple Pay sheet amount + recurringAmount. */
  paymentFormProps: {
    amount: number;
    currency: string;
    trialDuration: number | null;
    isTrialEligible: boolean;
    recurringAmount: number;
  } | null;
  payments: PaymentsPort;

  // Callbacks (container)
  onBillingCycleChange: (cycle: BillingCycle) => void;
  onTierSelect: (tier: SubscriptionTierName) => void;
  onRoleChange: (role: Role) => void;
  onBack: () => void;
  onRetry: () => void;
  onCancelSubscription: () => void;
  onPaymentMethodReady: (paymentMethodId: string) => void;
  onPaymentMethodError: (error: string) => void;
}

export function SubscriptionSelectionPresenter(
  props: SubscriptionSelectionPresenterProps,
) {
  const {
    subscriptionTiers,
    isLoading,
    errorMessage,
    billingCycle,
    currentTier,
    selectedRole,
    isTrialEligibleUser,
    isTrialEligibleTrainer,
    hasTrialEligibilityData,
    subscriptionEndsAt,
    canCancel,
    isCancelledButActive,
    scheduledChange,
    currentTierDisplayName,
    isOffline,
    isSlowLoading,
    selectedTierForPayment,
    isProcessingSubscription,
    paymentFormProps,
    payments,
    onBillingCycleChange,
    onTierSelect,
    onRoleChange,
    onBack,
    onRetry,
    onCancelSubscription,
    onPaymentMethodReady,
    onPaymentMethodError,
  } = props;

  // User-tier cards: premium only (Basic was dropped in the tier
  // simplification — see migration 20260526120000_simplify_tier_model
  // and CLAUDE.md "Migration intent").
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
          disabled={!!selectedTierForPayment || isProcessingSubscription}
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
    selectedTierForPayment,
    isProcessingSubscription,
    onTierSelect,
  ]);

  // Trainer-tier cards: post tier-simplification, one tier per
  // business size (Standard variants dropped, `_pro` suffix removed).
  // TrainerSubscriptionCard still expects a `proTier` slot — wire the
  // single surviving tier in via that slot and pass `standardTier: null`
  // so the component renders as a single-tier card. M11 may revisit
  // the component shape; for now the legacy props are preserved for
  // backwards compatibility.
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
            disabled={!!selectedTierForPayment || isProcessingSubscription}
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
    selectedTierForPayment,
    isProcessingSubscription,
    onTierSelect,
  ]);

  if (isLoading) {
    return (
      <SafeAreaView
        style={styles.safeArea}
        testID="subscription-selection-loading"
      >
        <View style={styles.loadingContainer}>
          <PLogoDrawLoader />
          <Text style={styles.loadingText}>
            Loading subscription options...
          </Text>
          {isSlowLoading && (
            <Text
              style={styles.slowLoadingText}
              testID="subscription-selection-slow-loading"
            >
              Still loading subscription information...
            </Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (errorMessage) {
    return (
      <SafeAreaView
        style={styles.safeArea}
        testID="subscription-selection-error"
      >
        <View style={styles.errorContainer}>
          <Ionicons name="warning" size={48} color={Colors.error.DEFAULT} />
          <Text style={styles.errorTitle}>
            Failed to Load Subscription Options
          </Text>
          <Text style={styles.errorMessage}>{errorMessage}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={onRetry}
            testID="subscription-selection-retry"
          >
            <Text style={styles.retryButtonText}>Retry</Text>
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
          disabled={!!selectedTierForPayment || isProcessingSubscription}
          testID="subscription-selection-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={Colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choose your plan</Text>
        <View style={styles.headerSpacer} />
      </View>

      {isOffline && <OfflineBanner />}

      {isProcessingSubscription && (
        <View
          style={styles.processingOverlay}
          testID="subscription-selection-processing"
        >
          <View style={styles.processingContainer}>
            <PLogoDrawLoader />
            <Text style={styles.processingText}>
              Processing subscription...
            </Text>
            <Text style={styles.processingSubtext}>Please wait</Text>
          </View>
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
        >
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
              scheduledChange={scheduledChange}
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

          <View
            style={[
              styles.subscriptionOptions,
              isOffline && styles.disabledOpacity,
            ]}
          >
            {selectedRole === "trainer" ? (
              <>
                <Text style={styles.trainerDescriptionText}>
                  The AI Buddy gives your clients the ability to enhance their
                  training experience with you, giving them support of needing
                  to swap exercises out or ask any generic questions about their
                  program.
                </Text>
                {trainerTierCards.length > 0 ? (
                  <View style={styles.tierCards}>{trainerTierCards}</View>
                ) : (
                  <View style={styles.emptyStateContainer}>
                    <Text style={styles.emptyStateText}>
                      No trainer subscription tiers available. Please check
                      backend configuration.
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <View style={styles.tierCards}>{userTierCards}</View>
            )}
          </View>

          {currentTier !== "free" && canCancel && !isCancelledButActive && (
            <View style={styles.cancelSubscriptionContainer}>
              <TouchableOpacity
                style={[
                  styles.cancelButtonTrainerCard,
                  isOffline && styles.disabledOpacity,
                ]}
                onPress={onCancelSubscription}
                disabled={!!selectedTierForPayment || isProcessingSubscription}
                testID="cancel-subscription-button"
              >
                <Ionicons
                  name="close-circle"
                  size={16}
                  color={Colors.error.DEFAULT}
                />
                <Text style={styles.cancelButtonText}>Cancel Subscription</Text>
              </TouchableOpacity>
            </View>
          )}

          {selectedTierForPayment && paymentFormProps && (
            <PaymentMethodForm
              amount={paymentFormProps.amount}
              currency={paymentFormProps.currency}
              billingCycle={billingCycle}
              onPaymentMethodReady={onPaymentMethodReady}
              onError={onPaymentMethodError}
              trialDuration={paymentFormProps.trialDuration}
              isTrialEligible={paymentFormProps.isTrialEligible}
              recurringAmount={paymentFormProps.recurringAmount}
              isProcessing={isProcessingSubscription}
              shouldTrigger
              payments={payments}
            />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Feature-list builder. Ported 1:1 from legacy lines 119–172.
 * Trainer tiers + user tiers compute slightly different rows; the
 * container passes `isTrainer` based on the card type that's being
 * rendered.
 */
export function getFeaturesList(
  tier: SubscriptionTier,
  isTrainer: boolean = false,
): string[] {
  const features: string[] = [];

  if (isTrainer) {
    if (tier.trainerClientLimit) {
      features.push(`${tier.trainerClientLimit} client slots`);
    }
    if (tier.analyticsAccess) {
      features.push("Analytics & Reporting");
    }
    if (tier.exportAccess) {
      features.push("Data Export");
    }
    if (tier.features.ai_buddy || tier.tierName.endsWith("_pro")) {
      features.push("AI Buddy Included");
    }
    return features;
  }

  // User tier features
  if (tier.features.workouts === "unlimited" || tier.workoutLimit === null) {
    features.push("Unlimited workouts");
  } else if (typeof tier.features.workouts === "number") {
    features.push(`${tier.features.workouts} workouts per month`);
  } else if (tier.workoutLimit !== null) {
    features.push(`${tier.workoutLimit} workouts per month`);
  }

  if (tier.features.progress) features.push("Progress tracking");

  if (tier.features.ai || tier.aiAccess) {
    // Post tier-simplification: Premium gets a quota (6/mo); trainer
    // tiers get "AI workout generation" + the AI Buddy. Basic dropped.
    if (tier.tierName === "premium") {
      features.push("6 AI workouts per month");
    } else {
      features.push("AI workout generation");
    }
  }

  if (tier.features.gym_buddy || tier.tierName === "premium") {
    features.push(
      "Reps Gym Buddy - there to buddy you on your fitness journey",
    );
  }

  return features;
}

/**
 * Trial-eligibility + duration derivation for a tier selection.
 *
 * Mirrors legacy lines 499–537 + 754–796 (shared by the presenter's
 * PaymentMethodForm prop builder and the container's
 * createSubscription dispatch). Exported pure for unit-tests.
 *
 * Reinstating a cancelled-but-still-in-trial subscription preserves
 * the remaining trial days; everything else falls back to the
 * tier-specific eligibility flags from `MySubscription`.
 */
export function deriveTrialEligibility(args: {
  tierName: SubscriptionTierName;
  isReinstatingCurrentTier: boolean;
  subscription: Pick<MySubscription, "trialEndsAt" | "paymentStatus"> | null;
  isTrialEligibleUser: boolean;
  isTrialEligibleTrainer: boolean;
}): { isTrialEligible: boolean; trialDuration: number | null } {
  const {
    tierName,
    isReinstatingCurrentTier,
    subscription,
    isTrialEligibleUser,
    isTrialEligibleTrainer,
  } = args;

  const hasTrialEndDate = !!subscription?.trialEndsAt;
  const isPaymentStatusTrialing = subscription?.paymentStatus === "trialing";
  const isInTrialPeriod =
    hasTrialEndDate &&
    new Date(subscription!.trialEndsAt!) > new Date() &&
    isPaymentStatusTrialing;

  if (
    isReinstatingCurrentTier &&
    isInTrialPeriod &&
    subscription?.trialEndsAt
  ) {
    const trialEndDate = new Date(subscription.trialEndsAt);
    const now = new Date();
    const remainingDays = Math.ceil(
      (trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    const remainingPositive = remainingDays > 0;
    return {
      isTrialEligible: remainingPositive,
      trialDuration: remainingPositive ? remainingDays : null,
    };
  }

  if (tierName === "premium") {
    return {
      isTrialEligible: isTrialEligibleUser,
      trialDuration: isTrialEligibleUser ? 7 : null,
    };
  }
  // Post tier-simplification: any trainer tier gets the 14-day trial
  // (was `_pro` suffix-checked when Standard trainer tiers existed).
  const trainerTiers: ReadonlySet<SubscriptionTierName> = new Set([
    "individual_trainer",
    "small_business",
    "medium_enterprise",
  ]);
  if (trainerTiers.has(tierName)) {
    return {
      isTrialEligible: isTrialEligibleTrainer,
      trialDuration: isTrialEligibleTrainer ? 14 : null,
    };
  }
  return { isTrialEligible: false, trialDuration: null };
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
  processingSubtext: {
    color: Colors.text.secondary,
    fontSize: 14,
    marginTop: Spacing.xs,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: Spacing.lg,
    gap: Spacing.md,
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
  retryButton: {
    backgroundColor: Colors.primary.DEFAULT,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    marginTop: Spacing.md,
  },
  retryButtonText: {
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
  },
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
  roleToggleButtonActive: {
    backgroundColor: Colors.primary.DEFAULT,
  },
  roleToggleText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text.secondary,
  },
  roleToggleTextActive: {
    color: Colors.text.inverse,
  },
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
  billingToggleSavings: {
    color: Colors.primary.DEFAULT,
    fontWeight: "700",
  },
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
  subscriptionOptions: {
    marginTop: Spacing.md,
  },
  tierCards: {
    gap: Spacing.md,
  },
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
  cancelSubscriptionContainer: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.lg,
    alignItems: "center",
  },
  cancelButtonTrainerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Colors.error.DEFAULT,
    borderRadius: BorderRadius.md,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.error.DEFAULT,
  },
  // M10.5 — applied conditionally on tier cards + cancel CTA when
  // `isOffline`. Cards remain tappable so the container can surface an
  // explanatory alert; the opacity is purely visual feedback.
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
