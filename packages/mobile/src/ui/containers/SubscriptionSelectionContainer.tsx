import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Platform } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type {
  BillingCycle,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import {
  canCancelSubscription,
  getSubscriptionDisplayInfo,
  isCancelledButActive as isCancelledButActiveCheck,
} from "@/domain/services/subscriptionService";
import { useCancelSubscription } from "@/ui/hooks/useCancelSubscription";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { usePurchases } from "@/ui/hooks/usePurchases";
import { useSubscriptionTiers } from "@/ui/hooks/useSubscriptionTiers";
import { newIdempotencyKey } from "@/shared/utils";
import { CancelSubscriptionModal } from "@/ui/components/subscription/CancelSubscriptionModal";
import { IOSPurchaseFlowContainer } from "@/ui/containers/IOSPurchaseFlowContainer";
import { SubscriptionSelectionPresenter } from "@/ui/presenters/SubscriptionSelectionPresenter";

/**
 * Subscription Selection container. Owns data fetching, state machine,
 * and side-effects for the buy / change / reinstate / cancel flow.
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 *       > Container responsibilities (Selection screen)
 * Satisfies: requirements.md AC 1.1, 1.4, 1.9, 2.1–2.8, 3.6, 3.7, 3.8,
 *            3.9, 5.6, 6.1, 7.2, 7.4, 8.1, 8.3
 *
 * Split from legacy `persistence-mobile/app/(auth)/subscription-selection.tsx`
 * lines 638–1053. The legacy file's presenter half lives in
 * `SubscriptionSelectionPresenter.tsx`.
 */

type Role = "user" | "trainer";

/**
 * M10.5 — milliseconds before the slow-network "Still loading..."
 * indicator appears. Sibling state to the Tanstack query; the
 * underlying request continues regardless. Tunable here without
 * touching the presenter.
 *
 * Spec: design.md § Offline UX on subscription screens
 *       > 8-second slow-network UX
 */
export const SLOW_NETWORK_INDICATOR_DELAY_MS = 8000;

/**
 * M10.5 — copy used for every offline pre-flight alert across both
 * subscription screens. Centralised so the wording stays consistent.
 */
const OFFLINE_ALERT_TITLE = "You're offline";
const OFFLINE_ALERT_MESSAGE =
  "You need to be online to manage your subscription. Please reconnect and try again.";

/**
 * Public entry for the post-sign-up subscription screen. Dispatches by rail:
 * on iOS (where a RevenueCat purchases adapter is wired) the native Apple IAP
 * flow renders. Everywhere else falls through to the catalogue container below,
 * which lists tiers and can cancel but cannot purchase — the Stripe Apple Pay
 * rail it used to carry was removed in full (App Review Guideline 2.1: it
 * linked PassKit into the binary while being unreachable on iOS). Android
 * purchasing returns when Play billing is wired through RevenueCat.
 *
 * The branch condition is constant for a given mount, so the downstream hook
 * order in each child container is stable.
 *
 * Spec: specs/milestones/M12-app-store-iap/FRONTEND_BRIEF.md § Deliverable 3
 */
export function SubscriptionSelectionContainer() {
  const purchases = usePurchases();
  if (Platform.OS === "ios" && purchases !== null) {
    return <IOSPurchaseFlowContainer />;
  }
  return <SubscriptionCatalogueContainer />;
}

/**
 * Non-iOS subscription surface: a read-only tier catalogue plus cancel. There
 * is deliberately no purchase path here — see the dispatch comment above.
 */
function SubscriptionCatalogueContainer() {
  const router = useRouter();
  const isOnline = useOnlineStatus();

  // Deep-link params from upstream call sites (useFeatureGate,
  // SyncBlockedContainer, ProfileContainer.onBecomeTrainer). Inspector
  // Brad PR #73 medium-severity find — sweep #3: these were being
  // pushed by every caller but the Selection screen never read them,
  // so the "pre-applied" promise was a no-op. Now honoured:
  //   - `tier` (any SubscriptionTierName) seeds the role toggle when
  //     it's a trainer tier and pre-applies the billing cycle.
  //   - `cycle` ("monthly" | "yearly") overrides the cycle default.
  //   - `role` ("personal_trainer") seeds the role toggle (legacy
  //     `become-trainer` call site).
  const searchParams = useLocalSearchParams<{
    tier?: string;
    cycle?: string;
    role?: string;
  }>();
  const initialTierParam = searchParams.tier;
  const initialCycleParam =
    searchParams.cycle === "yearly" || searchParams.cycle === "monthly"
      ? (searchParams.cycle as BillingCycle)
      : null;
  const initialRoleParam = searchParams.role;

  const tiersQuery = useSubscriptionTiers();
  const subQuery = useMySubscription();
  const cancelSubscriptionMutation = useCancelSubscription();

  // M10.5 — slow-network "still working…" indicator. Sibling state to
  // the Tanstack query; we don't cancel or retry the underlying call,
  // just surface a UI hint after `SLOW_NETWORK_INDICATOR_DELAY_MS`.
  const isStillLoading = tiersQuery.isLoading || subQuery.isLoading;
  const [isSlowLoading, setIsSlowLoading] = useState(false);
  useEffect(() => {
    if (!isStillLoading) {
      setIsSlowLoading(false);
      return;
    }
    const timer = setTimeout(() => {
      setIsSlowLoading(true);
    }, SLOW_NETWORK_INDICATOR_DELAY_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [isStillLoading]);

  const subscriptionData = subQuery.data ?? null;
  const role = subscriptionData?.role;

  // Deep-link tier param routes to trainer role when it's a trainer tier;
  // otherwise falls through to the profile role / default. This way a
  // free user deep-linking with `?tier=individual_trainer` lands on the
  // trainer toggle without an extra tap.
  const tierParamImpliesTrainer =
    initialTierParam === "individual_trainer" ||
    initialTierParam === "small_business" ||
    initialTierParam === "medium_enterprise";
  const initialRole: Role =
    initialRoleParam === "personal_trainer" || tierParamImpliesTrainer
      ? "trainer"
      : role === "personal_trainer" || role === "physiotherapist"
        ? "trainer"
        : "user";

  const [billingCycle, setBillingCycle] = useState<BillingCycle>(
    initialCycleParam ?? "monthly",
  );
  const [selectedRole, setSelectedRole] = useState<Role>(initialRole);
  const [isCancellingSubscription, setIsCancellingSubscription] =
    useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);

  // Sync selectedRole when the loaded sub-data's role surfaces. Deep-
  // link role/tier params take precedence — if the user explicitly
  // asked for a trainer tier via URL, don't override on cache resolve.
  useEffect(() => {
    if (initialRoleParam === "personal_trainer" || tierParamImpliesTrainer) {
      return; // Honour the deep link.
    }
    setSelectedRole(
      role === "personal_trainer" || role === "physiotherapist"
        ? "trainer"
        : "user",
    );
  }, [role, initialRoleParam, tierParamImpliesTrainer]);

  // Default the billing cycle to the user's current sub's cycle, if any.
  // Deep-link `cycle` param takes precedence — if the user explicitly
  // requested a cycle, don't overwrite when their existing sub resolves.
  const currentBillingCycle = subscriptionData?.billingCycle ?? null;
  useEffect(() => {
    if (initialCycleParam !== null) return; // Honour the deep link.
    if (currentBillingCycle === "monthly" || currentBillingCycle === "yearly") {
      setBillingCycle(currentBillingCycle);
    }
  }, [currentBillingCycle, initialCycleParam]);

  const currentTier: SubscriptionTierName =
    subscriptionData?.tierName ?? "free";
  const subscriptionEndsAt = subscriptionData?.expiresAt ?? null;
  const canCancel = canCancelSubscription(subscriptionData);
  const isCancelledButActive = isCancelledButActiveCheck(subscriptionData);

  const tierDisplayNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of tiersQuery.data ?? []) {
      map[t.tierName] = t.displayName;
    }
    return map;
  }, [tiersQuery.data]);

  const displayInfo = useMemo(
    () => getSubscriptionDisplayInfo(subscriptionData, tierDisplayNames),
    [subscriptionData, tierDisplayNames],
  );

  // No purchase rail on this platform. The tap stays wired so the cards remain
  // interactive and the user gets a reason rather than dead pixels. The current
  // tier is excluded: `SubscriptionCard` renders a pressable CTA even when
  // `isCurrent` (it only restyles it), so without this guard a subscriber
  // tapping their own "Current Plan" would be told to go and buy it.
  const handleTierSelect = useCallback(
    (tier: SubscriptionTierName) => {
      if (tier === currentTier) return;
      Alert.alert(
        "Not available on this device",
        "Subscriptions are purchased through the App Store in the iOS app. " +
          "Open Persistence on your iPhone or iPad to subscribe.",
      );
    },
    [currentTier],
  );

  const handleConfirmCancel = useCallback(async () => {
    // M10.5 — offline pre-flight on the cancel mutation. AC 11.4.
    if (!isOnline) {
      Alert.alert(OFFLINE_ALERT_TITLE, OFFLINE_ALERT_MESSAGE);
      setShowCancelConfirm(false);
      return;
    }
    // Cancel button only renders when canCancel is true, which by
    // construction implies a paid sub with a non-null subscriptionId.
    // Non-null cast is the contract; if it ever fires nullish at
    // runtime the mutation will throw and the error path alerts.
    const subscriptionId = subscriptionData!.subscriptionId!;
    setIsCancellingSubscription(true);
    try {
      const result = await cancelSubscriptionMutation.mutateAsync({
        subscriptionId,
        input: {
          cancelImmediately: false,
          // One idempotency token per Cancel confirmation (spec 17 / Phase A).
          idempotencyKey: newIdempotencyKey("sub-cancel"),
        },
      });
      const formatted = new Date(result.subscriptionEndsAt).toLocaleDateString(
        "en-GB",
        { day: "numeric", month: "long", year: "numeric" },
      );
      Alert.alert(
        "Subscription Cancelled",
        `Your subscription will remain active until ${formatted}. You'll continue to have access to all features until then.`,
        [{ text: "OK", onPress: () => router.back() }],
      );
    } catch (err) {
      Alert.alert("Error", (err as { message: string }).message);
    } finally {
      setIsCancellingSubscription(false);
      setShowCancelConfirm(false);
    }
  }, [subscriptionData, cancelSubscriptionMutation, router, isOnline]);

  return (
    <>
      <SubscriptionSelectionPresenter
        subscriptionTiers={tiersQuery.data ?? []}
        isLoading={tiersQuery.isLoading || subQuery.isLoading}
        errorMessage={tiersQuery.error?.message ?? null}
        billingCycle={billingCycle}
        currentTier={currentTier}
        selectedRole={selectedRole}
        isTrialEligibleUser={subscriptionData?.isEligibleForUserTrial ?? false}
        isTrialEligibleTrainer={
          subscriptionData?.isEligibleForTrainerTrial ?? false
        }
        hasTrialEligibilityData={subscriptionData !== null}
        subscriptionEndsAt={subscriptionEndsAt}
        canCancel={canCancel}
        isCancelledButActive={isCancelledButActive}
        scheduledChange={
          displayInfo.hasScheduledChange && displayInfo.effectiveAt
            ? {
                nextTierDisplayName: displayInfo.nextTierDisplayName ?? "",
                effectiveAt: displayInfo.effectiveAt,
                currentTierActiveUntil: displayInfo.currentTierActiveUntil,
                currentTierDisplayName: displayInfo.currentTierDisplayName,
              }
            : null
        }
        currentTierDisplayName={displayInfo.currentTierDisplayName}
        isOffline={!isOnline}
        isSlowLoading={isSlowLoading}
        onBillingCycleChange={setBillingCycle}
        onTierSelect={handleTierSelect}
        onRoleChange={setSelectedRole}
        onBack={() => router.back()}
        onRetry={() => {
          void tiersQuery.refetch();
        }}
        onCancelSubscription={() => setShowCancelConfirm(true)}
      />

      {showCancelConfirm && (
        <CancelSubscriptionModal
          subscriptionEndsAt={subscriptionEndsAt ?? undefined}
          onConfirm={handleConfirmCancel}
          onDismiss={() => setShowCancelConfirm(false)}
          isProcessing={isCancellingSubscription}
        />
      )}
    </>
  );
}
