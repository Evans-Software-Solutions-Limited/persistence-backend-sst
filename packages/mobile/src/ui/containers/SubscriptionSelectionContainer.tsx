import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import type {
  BillingCycle,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import {
  canCancelSubscription,
  getSubscriptionDisplayInfo,
  isCancelledButActive as isCancelledButActiveCheck,
} from "@/domain/services/subscriptionService";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useCancelSubscription } from "@/ui/hooks/useCancelSubscription";
import { useCreateSubscription } from "@/ui/hooks/useCreateSubscription";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { useSubscriptionTiers } from "@/ui/hooks/useSubscriptionTiers";
import { newIdempotencyKey } from "@/shared/utils";
import { CancelSubscriptionModal } from "@/ui/components/subscription/CancelSubscriptionModal";
import { USER_CANCELLED_ERROR } from "@/ui/components/subscription/PaymentMethodForm";
import {
  deriveTrialEligibility,
  SubscriptionSelectionPresenter,
} from "@/ui/presenters/SubscriptionSelectionPresenter";

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
const OFFLINE_3DS_MESSAGE =
  "You need to be online to complete payment verification. Your subscription is on hold.";
const OFFLINE_3DS_LOST_MESSAGE =
  "Connection lost during payment verification. Please try again.";

export function SubscriptionSelectionContainer() {
  const router = useRouter();
  const { payments, netInfo } = useAdapters();
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
  const createSubscriptionMutation = useCreateSubscription();
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
  const [selectedTierForPayment, setSelectedTierForPayment] =
    useState<SubscriptionTierName | null>(null);
  const [isProcessingSubscription, setIsProcessingSubscription] =
    useState(false);
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

  // Reset selectedTier on role-toggle change — prevents an in-flight
  // sheet on the wrong role surface.
  useEffect(() => {
    setSelectedTierForPayment(null);
  }, [selectedRole]);

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

  const handleTierSelect = useCallback(
    (tier: SubscriptionTierName) => {
      // Current tier with no changes pending — no-op.
      const effectiveCurrentCycle = currentBillingCycle ?? "monthly";
      const billingCycleChanged = billingCycle !== effectiveCurrentCycle;
      if (
        tier === currentTier &&
        !isCancelledButActive &&
        !billingCycleChanged
      ) {
        return;
      }
      // Free tier is never buyable.
      const tierData = tiersQuery.data?.find((t) => t.tierName === tier);
      if (!tierData || tierData.tierName === "free") return;
      // Yearly cycle requested but this tier has no yearly Stripe price
      // configured. Refuse the tap with a user-readable alert instead of
      // mounting PaymentMethodForm — otherwise the Apple Pay sheet
      // renders £0 and the backend errors out after the biometric tap
      // with "Stripe price id not configured" (Inspector Brad PR #71
      // medium-severity find — sweep #1).
      if (billingCycle === "yearly" && tierData.priceYearly === null) {
        Alert.alert(
          "Yearly not available",
          `${tierData.displayName} isn't available on a yearly plan yet. Switch to Monthly to subscribe.`,
        );
        return;
      }
      // M10.5 — offline pre-flight. MUST fire BEFORE
      // setSelectedTierForPayment so the PaymentMethodForm doesn't
      // mount + auto-trigger Apple Pay against a doomed network call.
      // AC 11.2 + AC 11.4.
      if (!isOnline) {
        Alert.alert(OFFLINE_ALERT_TITLE, OFFLINE_ALERT_MESSAGE);
        return;
      }
      // Prevent duplicates.
      if (isProcessingSubscription) return;
      setSelectedTierForPayment(tier);
    },
    [
      currentTier,
      isCancelledButActive,
      billingCycle,
      currentBillingCycle,
      tiersQuery.data,
      isProcessingSubscription,
      isOnline,
    ],
  );

  const handlePaymentMethodReady = useCallback(
    async (paymentMethodId: string) => {
      if (isProcessingSubscription) return;
      const tierToProcess = selectedTierForPayment;
      if (!tierToProcess) return;

      const isReinstatingCurrentTier =
        isCancelledButActive && tierToProcess === currentTier;

      const { isTrialEligible } = deriveTrialEligibility({
        tierName: tierToProcess,
        isReinstatingCurrentTier,
        subscription: subscriptionData,
        isTrialEligibleUser: subscriptionData?.isEligibleForUserTrial ?? false,
        isTrialEligibleTrainer:
          subscriptionData?.isEligibleForTrainerTrial ?? false,
      });

      setIsProcessingSubscription(true);
      setSelectedTierForPayment(null);

      try {
        const response = await createSubscriptionMutation.mutateAsync({
          tierName: tierToProcess,
          billingCycle,
          paymentMethodId,
          useTrial: isTrialEligible,
          // One idempotency token per Subscribe attempt (this Apple Pay
          // authorisation). The backend keys every outbound Stripe call off
          // it, so a transport retry of this exact submission can't create a
          // second subscription / charge (spec 17 / Phase A).
          idempotencyKey: newIdempotencyKey("sub-create"),
        });

        // 3DS branch — present the challenge sheet, wait for the
        // webhook to commit payment_status server-side. Subscription
        // query is invalidated by the mutation's onSuccess; the
        // /(auth)/success screen refetches on mount.
        if (response.requiresAction && response.clientSecret) {
          // M10.5 — pre-flight: if the user dropped offline between
          // `createSubscription` returning + 3DS confirmation, don't
          // mount the challenge sheet (it'd fail mid-flow). AC 11.5.
          //
          // We read directly from `netInfo.isConnected()` here rather
          // than the React-state-based `isOnline` value — the user
          // may have flipped network state during the in-flight
          // mutation, and the captured closure value is stale by the
          // time this branch runs (Brad's "stale state in async
          // handlers" caveat in the brief).
          const stillOnline = await netInfo.isConnected();
          if (!stillOnline) {
            Alert.alert(OFFLINE_ALERT_TITLE, OFFLINE_3DS_MESSAGE);
            setIsProcessingSubscription(false);
            return;
          }
          try {
            const result = await payments.confirm3DS(response.clientSecret);
            if (!result.ok) {
              Alert.alert(
                "Payment Authentication Failed",
                result.error.message,
                [{ text: "OK" }],
              );
              setIsProcessingSubscription(false);
              return;
            }
          } catch {
            // M10.5 — mid-3DS network drop. The Stripe SDK can throw
            // (vs. resolve `result.ok=false`) when the device loses
            // connectivity during the challenge. Treat any thrown
            // error here as a recoverable connection drop and reset
            // local state so the user can retry. AC 11.5.
            Alert.alert(OFFLINE_ALERT_TITLE, OFFLINE_3DS_LOST_MESSAGE);
            setIsProcessingSubscription(false);
            return;
          }
        }

        // Build the list of alerts to show before navigating. Both
        // `response.scheduled` (downgrade) AND `response.isTrial` can
        // be true on the same response (e.g. trial-using trainer-Pro
        // downgrade). Firing both Alert.alert calls synchronously and
        // then calling router.push immediately swallows the second
        // alert and tears down the container before the user has
        // dismissed either (Inspector Brad PR #71 medium-severity find
        // — sweep #1). Chain via onPress instead; navigate only from
        // the final dismissal.
        const alertsToShow: { title: string; message: string }[] = [];

        if (response.scheduled && response.effectiveAt) {
          const formatted = new Date(response.effectiveAt).toLocaleDateString(
            "en-GB",
            { day: "numeric", month: "long", year: "numeric" },
          );
          alertsToShow.push({
            title: "Change Scheduled",
            message: `${
              response.changeType === "downgrade" ? "Downgrade" : "Change"
            } scheduled for ${formatted}. Your current plan will remain active until then.`,
          });
        }

        if (response.isTrial && response.trialEndsAt) {
          const formatted = new Date(response.trialEndsAt).toLocaleDateString(
            "en-GB",
            { day: "numeric", month: "long", year: "numeric" },
          );
          alertsToShow.push({
            title: "Trial Started!",
            message: `Your trial subscription is active. Your trial ends on ${formatted}.`,
          });
        }

        const navigateToSuccess = () => {
          // Cast required until `.expo/types/router.d.ts` regenerates
          // on first `expo start` after the new routes landed (see M0
          // SMOKE_TEST.md § Known-acceptable failures).
          router.push("/(auth)/success" as Href);
          setIsProcessingSubscription(false);
        };

        if (alertsToShow.length === 0) {
          navigateToSuccess();
        } else {
          const showAlertAt = (idx: number) => {
            if (idx >= alertsToShow.length) {
              navigateToSuccess();
              return;
            }
            Alert.alert(alertsToShow[idx].title, alertsToShow[idx].message, [
              { text: "OK", onPress: () => showAlertAt(idx + 1) },
            ]);
          };
          showAlertAt(0);
        }
      } catch (err) {
        Alert.alert(
          "Subscription Error",
          (err as { message: string }).message,
          [{ text: "OK" }],
        );
        setIsProcessingSubscription(false);
      }
    },
    [
      isProcessingSubscription,
      selectedTierForPayment,
      isCancelledButActive,
      currentTier,
      subscriptionData,
      billingCycle,
      createSubscriptionMutation,
      payments,
      router,
      netInfo,
    ],
  );

  const handlePaymentMethodError = useCallback((error: string) => {
    // USER_CANCELLED sentinel is suppressed; everything else surfaces
    // via an alert (legacy parity AC 2.7).
    if (error !== USER_CANCELLED_ERROR) {
      Alert.alert("Payment Method Error", error);
    }
    setSelectedTierForPayment(null);
  }, []);

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

  // PaymentMethodForm prop builder. Mirrors legacy lines 482–559.
  const paymentFormProps = useMemo(() => {
    if (!selectedTierForPayment) return null;
    const tierData = tiersQuery.data?.find(
      (t) => t.tierName === selectedTierForPayment,
    );
    if (!tierData) return null;

    const subscriptionAmountInPounds =
      billingCycle === "yearly"
        ? (tierData.priceYearly ?? 0)
        : tierData.priceMonthly;
    const subscriptionAmount = Math.round(subscriptionAmountInPounds * 100);

    const isReinstatingCurrentTier =
      isCancelledButActive && selectedTierForPayment === currentTier;

    const { isTrialEligible, trialDuration } = deriveTrialEligibility({
      tierName: selectedTierForPayment,
      isReinstatingCurrentTier,
      subscription: subscriptionData,
      isTrialEligibleUser: subscriptionData?.isEligibleForUserTrial ?? false,
      isTrialEligibleTrainer:
        subscriptionData?.isEligibleForTrainerTrial ?? false,
    });

    const immediateAmount =
      isTrialEligible && trialDuration ? 0 : subscriptionAmount;
    const recurringAmount = subscriptionAmount;

    return {
      amount: immediateAmount,
      currency: "gbp",
      trialDuration,
      isTrialEligible,
      recurringAmount,
    };
  }, [
    selectedTierForPayment,
    tiersQuery.data,
    billingCycle,
    isCancelledButActive,
    currentTier,
    subscriptionData,
  ]);

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
        selectedTierForPayment={selectedTierForPayment}
        isProcessingSubscription={isProcessingSubscription}
        paymentFormProps={paymentFormProps}
        payments={payments}
        onBillingCycleChange={setBillingCycle}
        onTierSelect={handleTierSelect}
        onRoleChange={setSelectedRole}
        onBack={() => router.back()}
        onRetry={() => {
          void tiersQuery.refetch();
        }}
        onCancelSubscription={() => setShowCancelConfirm(true)}
        onPaymentMethodReady={handlePaymentMethodReady}
        onPaymentMethodError={handlePaymentMethodError}
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
