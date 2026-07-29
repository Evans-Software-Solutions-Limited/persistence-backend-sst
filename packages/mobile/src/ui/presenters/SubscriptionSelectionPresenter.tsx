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
import { DEFAULT_TRIAL_DAYS } from "@/domain/models/subscription";
import type {
  BillingCycle,
  SubscriptionTier,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import { CurrentSubscriptionStatusCard } from "@/ui/components/subscription/CurrentSubscriptionStatusCard";
import { OfflineBanner } from "@/ui/components/subscription/OfflineBanner";
import { PLogoDrawLoader } from "@/ui/components/PLogoDrawLoader";
import { TRAINER_TIER_NAMES } from "@/domain/services/subscriptionService";
import { SubscriptionCard } from "@/ui/components/subscription/SubscriptionCard";
import { SubscriptionLegalFooter } from "@/ui/components/subscription/SubscriptionLegalFooter";
import { TrainerSubscriptionCard } from "@/ui/components/subscription/TrainerSubscriptionCard";
import { color } from "@/ui/theme/tokens";

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

  // Callbacks (container)
  onBillingCycleChange: (cycle: BillingCycle) => void;
  onTierSelect: (tier: SubscriptionTierName) => void;
  onRoleChange: (role: Role) => void;
  onBack: () => void;
  onRetry: () => void;
  onCancelSubscription: () => void;
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
    onBillingCycleChange,
    onTierSelect,
    onRoleChange,
    onBack,
    onRetry,
    onCancelSubscription,
  } = props;

  // User-tier cards: catalog-driven, not a hardcoded "premium" lookup —
  // M19-P0 added a second consumer tier (`premium_plus`) above Premium.
  // Non-trainer, non-free rows, cheapest first (ascending `priceMonthly`
  // — the catalog's own ordering signal, so no separate mobile-side
  // tier-rank map to keep in sync). Basic was dropped in the earlier tier
  // simplification — see migration 20260526120000_simplify_tier_model
  // and CLAUDE.md "Migration intent".
  // A user can hold a tier that isn't in the rendered catalog — e.g. a
  // RevenueCat promotional grant of a tier still seeded is_active=false
  // pre-launch. No card is then marked current, so without this guard the
  // remaining cards render as buyable "free trial"s and a comped user can
  // be nudged onto a WORSE tier than the one they were given. Suppress
  // trial banners in that state; they are not genuinely trial-eligible.
  //
  // Hoisted above BOTH memos: the trainer loop resolves three fixed tier
  // names out of the catalog and has exactly the same hole if a trainer
  // tier is ever held while inactive — which is now a supported state.
  const holdsUnlistedPaidTier =
    currentTier !== "free" &&
    !subscriptionTiers.some((t) => t.tierName === currentTier);

  const userTierCards = useMemo(() => {
    const consumerTiers = subscriptionTiers
      .filter(
        (t) =>
          !t.isTrainerTier &&
          t.tierName !== "free" &&
          // Belt-and-braces: `mapTierRowToWire` coerces a NULL
          // `is_trainer_tier` to false, so a trainer row with the flag
          // unset would fall into this consumer filter AND still be
          // picked up by the trainer section's explicit allow-list —
          // rendering the same tier twice. Exclude the allow-list here.
          !TRAINER_TIER_NAMES.has(t.tierName),
      )
      // Cheapest first. Secondary sort on tierName so two same-priced
      // tiers have a stable order — `listActive` orders by price_monthly
      // with no tiebreak, so Postgres row order is otherwise arbitrary.
      .sort(
        (a, b) =>
          a.priceMonthly - b.priceMonthly ||
          a.tierName.localeCompare(b.tierName),
      );
    const cards: React.ReactElement[] = [];

    for (const tier of consumerTiers) {
      const isTierCurrent = currentTier === tier.tierName;
      const showTrial =
        hasTrialEligibilityData &&
        isTrialEligibleUser &&
        !isTierCurrent &&
        !holdsUnlistedPaidTier;
      cards.push(
        <SubscriptionCard
          key={tier.tierName}
          tier={tier}
          billingCycle={billingCycle}
          isCurrent={isTierCurrent}
          showTrialBanner={showTrial}
          trialBannerText={`${DEFAULT_TRIAL_DAYS}-day free trial`}
          onPress={() => onTierSelect(tier.tierName)}
          getFeaturesList={getFeaturesList}
          isTrainer={false}
        />,
      );
    }

    return cards;
  }, [
    holdsUnlistedPaidTier,
    subscriptionTiers,
    billingCycle,
    currentTier,
    hasTrialEligibilityData,
    isTrialEligibleUser,
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
          hasTrialEligibilityData &&
          isTrialEligibleTrainer &&
          !isCurrent &&
          !holdsUnlistedPaidTier;

        cards.push(
          <TrainerSubscriptionCard
            key={baseName}
            standardTier={null}
            proTier={tier}
            billingCycle={billingCycle}
            isStandardCurrent={false}
            isProCurrent={isCurrent}
            showProTrialBanner={showTrialBanner}
            trialBannerText={`${DEFAULT_TRIAL_DAYS}-day free trial`}
            onStandardPress={() => {}}
            onProPress={() => onTierSelect(tier.tierName)}
          />,
        );
      }
    }

    return cards;
  }, [
    holdsUnlistedPaidTier,
    subscriptionTiers,
    billingCycle,
    currentTier,
    hasTrialEligibilityData,
    isTrialEligibleTrainer,
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
          <Ionicons name="warning" size={48} color={color.$error} />
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
      <StatusBar barStyle="light-content" backgroundColor={color.$bg} />

      <View style={styles.headerContainer}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={onBack}
          testID="subscription-selection-back"
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="arrow-back" size={24} color={color.$text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Choose your plan</Text>
        <View style={styles.headerSpacer} />
      </View>

      {isOffline && <OfflineBanner />}

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
              Yearly{" "}
              {/* Was "(Save 20%)" — overstated. Every seeded annual price is
                  10x monthly (£12.99 -> £129.99, £29.99 -> £299.99,
                  £14.99 -> £149.99, £75 -> £750, £300 -> £3000), i.e. 16.7%
                  off, not 20%. "2 months free" is exact for every tier and
                  matches the marketing site. Brad, 2026-07-25. */}
              <Text style={styles.billingToggleSavings}>(2 months free)</Text>
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
                testID="cancel-subscription-button"
              >
                <Ionicons name="close-circle" size={16} color={color.$error} />
                <Text style={styles.cancelButtonText}>Cancel Subscription</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Apple §3.1.2 / Play parity. `rail="store"` (not "card"): the card
              rail is gone, so nothing here charges a payment method, and any
              subscription the user holds was bought through platform IAP and is
              managed in store settings. Naming the card rail would be untrue. */}
          <SubscriptionLegalFooter rail="store" />
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
    // "Analytics & Reporting" and "Data Export" used to be pushed here off
    // tier.analyticsAccess / tier.exportAccess. Removed 2026-07-25 (Brad):
    // neither feature is built, and nothing in the app or backend gates an
    // analytics screen or an export path on those flags.
    //
    // NOTE: this `isTrainer` branch is currently UNREACHABLE at runtime —
    // both presenters render trainer tiers via TrainerSubscriptionCard,
    // which does not take getFeaturesList, and pass isTrainer={false} to
    // SubscriptionCard. The user-visible coach claim lived in
    // TrainerSubscriptionCard and was removed there too. Kept in sync so
    // this branch doesn't reintroduce the claim if it is ever wired up.
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

  // Brad, 2026-07-25: the only unshipped features we advertise are Loadout
  // and Mealprint. The old rows here were "N AI workouts per month" and
  // "Reps Gym Buddy…" — there is NO workout-generation path anywhere in
  // application/workouts, and `gym_buddy` is an explicit entitlement stub
  // (assertEntitlement returns { allowed: true } with no backend surface
  // and no UI). Both are gone.
  //
  // What ai_access actually unlocks TODAY is Snap AI: nutrition logging
  // from a photo or free text (M9.5, shipped). That is the honest Premium
  // differentiator, so it takes their place.
  if (tier.features.ai || tier.aiAccess) {
    features.push("AI nutrition logging from a photo or free text");
  }

  // The adaptive suite — Premium+'s entire reason to exist (M19-P0).
  // Catalog-driven off the `features` JSONB rather than a tier-name check,
  // so the copy follows whatever the catalog says a tier includes. Without
  // these two rows the £29.99 card renders bullets identical to the £12.99
  // one, i.e. it sells nothing.
  if (tier.features.loadout) {
    features.push("Loadout - adapt any workout to the equipment you have");
  }
  if (tier.features.mealprint) {
    features.push("Mealprint - AI meal planning around your targets");
  }

  return features;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: color.$bg,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  loadingText: {
    color: color.$text,
    fontSize: 16,
    marginTop: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    gap: 16,
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
  retryButton: {
    backgroundColor: color.$primary,
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    marginTop: 16,
  },
  retryButtonText: {
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
  headerTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: color.$text,
  },
  headerSpacer: {
    width: 40,
  },
  container: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
    paddingHorizontal: 24,
  },
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
  roleToggleButtonActive: {
    backgroundColor: color.$primary,
  },
  roleToggleText: {
    fontSize: 14,
    fontWeight: "600",
    color: color.$text2,
  },
  roleToggleTextActive: {
    color: color.$bg,
  },
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
  billingToggleSavings: {
    color: color.$primary,
    fontWeight: "700",
  },
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
  subscriptionOptions: {
    marginTop: 16,
  },
  tierCards: {
    gap: 16,
  },
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
  cancelSubscriptionContainer: {
    marginTop: 24,
    marginBottom: 24,
    alignItems: "center",
  },
  cancelButtonTrainerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 16,
    paddingHorizontal: 24,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: color.$error,
    borderRadius: 12,
  },
  cancelButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: color.$error,
  },
  // M10.5 — applied conditionally on tier cards + cancel CTA when
  // `isOffline`. Cards remain tappable so the container can surface an
  // explanatory alert; the opacity is purely visual feedback.
  disabledOpacity: {
    opacity: 0.5,
  },
  slowLoadingText: {
    color: color.$text2,
    fontSize: 13,
    fontStyle: "italic",
    marginTop: 8,
    textAlign: "center",
  },
});
