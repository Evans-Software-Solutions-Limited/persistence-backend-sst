import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import type {
  BillingCycle,
  MySubscription,
  SubscriptionTier,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import {
  canCancelSubscription,
  isCancelledButActive,
  isFreeTier,
  isSubscriptionActive,
  isTrialing,
} from "@/domain/services/subscriptionService";
import { useCancelSubscription } from "@/ui/hooks/useCancelSubscription";
import { useCreateSubscription } from "@/ui/hooks/useCreateSubscription";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { useSubscriptionTiers } from "@/ui/hooks/useSubscriptionTiers";
import { SubscriptionManagementPresenter } from "@/ui/presenters/SubscriptionManagementPresenter";
import { SLOW_NETWORK_INDICATOR_DELAY_MS } from "@/ui/containers/SubscriptionSelectionContainer";

/**
 * M10.5 — alert copy reused across both subscription screens. Inlined
 * here (not shared) to keep the management container's import graph
 * tight; both screens use the same wording per spec.
 */
const OFFLINE_ALERT_TITLE = "You're offline";
const OFFLINE_ALERT_MESSAGE =
  "You need to be online to manage your subscription. Please reconnect and try again.";

/**
 * Subscription Management container — Phase 1 (port-1:1 from legacy
 * `persistence-mobile/app/subscription-management.tsx`) + Phase 2
 * (V2 improvements: scheduled-change surfacing, full inline tier
 * picker including user↔trainer transitions).
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 *       > Container responsibilities (Management screen)
 * Satisfies: requirements.md AC 3.1, 3.2, 3.3, 3.4, 3.5, 3.7, 3.8, 3.9, 5.6
 *
 * Behavioural contract — the legacy port that V2 lost in the first
 * pass:
 *
 *   1. The cancelled signal is `subscription.cancelledAt !== null` —
 *      NOT `paymentStatus === 'cancelled'`. V2 backend never flips
 *      `payment_status` to `'cancelled'`; it just stamps `cancelled_at`
 *      and leaves the status alone (so a cancelled-during-trial sub
 *      reads as `cancelled_at: <ts> + payment_status: 'trialing'`).
 *      Predicate is centralised in `subscriptionService.ts` —
 *      `canCancelSubscription`, `isCancelledButActive`, `isTrialing`.
 *   2. Cancel button hidden once `cancelledAt !== null` so the user
 *      can't try to cancel an already-cancelled sub (the backend
 *      would 4xx and the user wouldn't know why).
 *   3. Any tier change (upgrade or downgrade, same-track or
 *      cross-track) flows through a single `handleChangeTier`. The
 *      backend's `handleChangeOfTierNoPayment` decides whether to
 *      proration-bill immediately (upgrade) or stamp a scheduled
 *      change on `metadata.scheduled_change` (downgrade). The UI
 *      picks the confirmation copy based on price comparison.
 *   4. A scheduled change suppresses further downgrades but allows
 *      upgrades to supersede it (backend `delete newMeta.scheduled_
 *      change` then re-stamps).
 */
export function SubscriptionManagementContainer() {
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const subQuery = useMySubscription();
  const tiersQuery = useSubscriptionTiers();
  const createSubscriptionMutation = useCreateSubscription();
  const cancelSubscriptionMutation = useCancelSubscription();

  const subscriptionData: MySubscription | null = subQuery.data ?? null;
  const allTiers: SubscriptionTier[] = tiersQuery.data ?? [];

  // M10.5 — slow-network indicator. Mirrors the pattern in
  // SubscriptionSelectionContainer; same constant + threshold.
  const isStillLoading = subQuery.isLoading || tiersQuery.isLoading;
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

  const currentTier: SubscriptionTierName =
    subscriptionData?.tierName ?? "free";
  const paymentStatus = subscriptionData?.paymentStatus ?? null;
  const subscriptionEndsAt = subscriptionData?.expiresAt ?? null;
  const trialEndsAt = subscriptionData?.trialEndsAt ?? null;
  const billingCycle: BillingCycle | null =
    subscriptionData?.billingCycle ?? null;
  const cancelledAt = subscriptionData?.cancelledAt ?? null;
  const scheduledChange = subscriptionData?.scheduledChange ?? null;
  const trainerClientLimit = subscriptionData?.trainerClientLimit ?? null;

  // Predicates derived from the ported subscriptionService helpers.
  // Single source of truth — same shape legacy used.
  const hasActiveSub = isSubscriptionActive(subscriptionData);
  const trialing = isTrialing(subscriptionData);
  const cancelledStillActive = isCancelledButActive(subscriptionData);
  const onFreeTier = isFreeTier(subscriptionData);
  const canCancel = canCancelSubscription(subscriptionData);

  // Pricing snapshot for the current tier — used by `handleChangeTier`
  // to decide whether the requested change is an upgrade (immediate
  // proration) or a downgrade (scheduled at period end). Same logic
  // the backend uses internally (`handleChangeOfTierNoPayment` compares
  // newPrice > oldPrice).
  const currentTierRow = useMemo(
    () => allTiers.find((t) => t.tierName === currentTier) ?? null,
    [allTiers, currentTier],
  );

  const currentPriceForCycle = useMemo(() => {
    if (!currentTierRow) return 0;
    const cycle = billingCycle ?? "monthly";
    return cycle === "yearly"
      ? (currentTierRow.priceYearly ?? 0)
      : (currentTierRow.priceMonthly ?? 0);
  }, [currentTierRow, billingCycle]);

  /**
   * Unified tier-change handler. Replaces the legacy `handleUpgrade` +
   * `handleDowngrade` pair so the picker UI doesn't have to know
   * which direction it's going — the price comparison decides.
   *
   * Cross-track flows (user ↔ trainer) go through this path too. The
   * backend treats them as any other tier change — it compares the
   * new price to the old and routes via the upgrade or downgrade
   * proration branch accordingly.
   */
  const handleChangeTier = useCallback(
    (nextTier: SubscriptionTierName) => {
      if (!isOnline) {
        Alert.alert(OFFLINE_ALERT_TITLE, OFFLINE_ALERT_MESSAGE);
        return;
      }
      // Picker filters out the current tier + `free` upstream, so this
      // handler is only ever called with a real, different tier. No
      // defensive guards here — keeps the path lint-clean (`free` →
      // cancel routing happens by the user tapping Cancel, not the
      // picker switching to "free").

      const nextTierRow = allTiers.find((t) => t.tierName === nextTier);
      const nextPrice = !nextTierRow
        ? 0
        : (billingCycle ?? "monthly") === "yearly"
          ? (nextTierRow.priceYearly ?? 0)
          : (nextTierRow.priceMonthly ?? 0);
      const isUpgrade = nextPrice > currentPriceForCycle;
      const isCrossTrack =
        !!currentTierRow &&
        !!nextTierRow &&
        currentTierRow.isTrainerTier !== nextTierRow.isTrainerTier;

      const nextDisplayName = nextTierRow?.displayName ?? nextTier;
      const title = isCrossTrack
        ? `Switch to ${nextDisplayName}`
        : isUpgrade
          ? "Upgrade Subscription"
          : "Downgrade Subscription";
      const message = isUpgrade
        ? `Switching to ${nextDisplayName} will charge a prorated amount immediately. Continue?`
        : `Your subscription will change to ${nextDisplayName} at the end of your current billing period. You'll keep your current tier until then. Continue?`;

      Alert.alert(title, message, [
        { text: "Cancel", style: "cancel" },
        {
          text: isUpgrade ? "Upgrade" : "Confirm",
          onPress: async () => {
            try {
              const response = await createSubscriptionMutation.mutateAsync({
                tierName: nextTier,
                billingCycle: billingCycle ?? "monthly",
                useTrial: false,
              });
              if (isUpgrade) {
                Alert.alert("Success", `You're now on ${nextDisplayName}.`);
              } else {
                const effectiveDate = response.effectiveAt
                  ? new Date(response.effectiveAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
                  : "the end of your current billing period";
                Alert.alert(
                  "Scheduled",
                  `Your subscription will change to ${nextDisplayName} on ${effectiveDate}.`,
                );
              }
            } catch (err) {
              Alert.alert("Error", (err as { message: string }).message);
            }
          },
        },
      ]);
    },
    [
      isOnline,
      allTiers,
      billingCycle,
      currentPriceForCycle,
      currentTierRow,
      createSubscriptionMutation,
    ],
  );

  const handleCancel = useCallback(() => {
    if (!subscriptionData?.subscriptionId) return;
    if (!isOnline) {
      Alert.alert(OFFLINE_ALERT_TITLE, OFFLINE_ALERT_MESSAGE);
      return;
    }
    // Idempotency guard — legacy did this in the presenter (hid the
    // button); we also defend in the handler for robustness.
    if (cancelledAt) return;

    const cancelMessage = trialing
      ? "Cancel your trial to avoid being charged when it ends. You'll continue to have access until your trial period ends. Continue?"
      : "Your subscription will end at the end of your current billing period. You'll continue to have access until then. Continue?";

    Alert.alert("Cancel Subscription", cancelMessage, [
      { text: "Keep Subscription", style: "cancel" },
      {
        text: "Cancel",
        style: "destructive",
        onPress: async () => {
          try {
            const response = await cancelSubscriptionMutation.mutateAsync({
              subscriptionId: subscriptionData.subscriptionId!,
              input: {},
            });
            const endDate = new Date(
              response.subscriptionEndsAt,
            ).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            });
            Alert.alert(
              "Subscription Cancelled",
              trialing
                ? `Your trial will end on ${endDate}. You won't be charged. You'll continue to have access until then.`
                : `Your subscription will end on ${endDate}. You'll continue to have access until then.`,
            );
          } catch (err) {
            Alert.alert("Error", (err as { message: string }).message);
          }
        },
      },
    ]);
  }, [
    subscriptionData,
    trialing,
    cancelledAt,
    cancelSubscriptionMutation,
    isOnline,
  ]);

  // The picker hides the user's current tier (no point switching to
  // self) AND `free` (cancelling is the path to free, not a tier
  // switch). When a scheduled change is pending, downgrades are
  // hidden too — only upgrades can supersede a scheduled change per
  // the backend's `delete newMeta.scheduled_change` flow.
  const pickerTiers = useMemo(() => {
    return allTiers
      .filter((t) => t.tierName !== "free")
      .filter((t) => t.tierName !== currentTier)
      .filter((t) => {
        if (!scheduledChange) return true;
        const cycle = billingCycle ?? "monthly";
        const tierPrice =
          cycle === "yearly" ? (t.priceYearly ?? 0) : (t.priceMonthly ?? 0);
        return tierPrice > currentPriceForCycle;
      });
  }, [
    allTiers,
    currentTier,
    scheduledChange,
    billingCycle,
    currentPriceForCycle,
  ]);

  return (
    <SubscriptionManagementPresenter
      currentTier={currentTier}
      currentTierDisplayName={
        currentTierRow?.displayName ?? subscriptionData?.tierDisplayName ?? null
      }
      paymentStatus={paymentStatus}
      cancelledAt={cancelledAt}
      scheduledChange={scheduledChange}
      hasActiveSub={hasActiveSub}
      isTrialingState={trialing}
      isCancelledButActive={cancelledStillActive}
      onFreeTier={onFreeTier}
      subscriptionEndsAt={subscriptionEndsAt}
      trialEndsAt={trialEndsAt}
      billingCycle={billingCycle}
      trainerClientLimit={trainerClientLimit}
      pickerTiers={pickerTiers}
      isLoading={isStillLoading}
      isChangingTier={createSubscriptionMutation.isPending}
      isCancelling={cancelSubscriptionMutation.isPending}
      canCancel={canCancel}
      hasScheduledChange={scheduledChange !== null}
      isOffline={!isOnline}
      isSlowLoading={isSlowLoading}
      onChangeTier={handleChangeTier}
      onCancel={handleCancel}
      onBack={() => router.back()}
    />
  );
}
