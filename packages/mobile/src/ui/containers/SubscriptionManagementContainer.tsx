import React, { useCallback, useEffect, useState } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import type {
  SubscriptionStatus,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import { useCancelSubscription } from "@/ui/hooks/useCancelSubscription";
import { useCreateSubscription } from "@/ui/hooks/useCreateSubscription";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
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
 * Subscription Management container. Owns the upgrade / downgrade /
 * cancel flow for user tiers (basic ↔ premium).
 *
 * Spec: specs/11-payments-subscriptions/design.md § UI structure
 *       > Container responsibilities (Management screen)
 * Satisfies: requirements.md AC 3.1, 3.2, 3.3, 3.4, 3.5, 3.8, 3.9, 5.6
 *
 * Trainer tier changes route via Selection (AC 3.8) — Management only
 * exposes upgrade/downgrade between `basic` and `premium`. Calls
 * createSubscription WITHOUT a paymentMethodId (M10 change-of-tier
 * path; backend reuses the customer's default payment method).
 *
 * Split from legacy `persistence-mobile/app/subscription-management.tsx`
 * lines 255–415.
 */
export function SubscriptionManagementContainer() {
  const router = useRouter();
  const isOnline = useOnlineStatus();
  const subQuery = useMySubscription();
  const createSubscriptionMutation = useCreateSubscription();
  const cancelSubscriptionMutation = useCancelSubscription();

  const subscriptionData = subQuery.data ?? null;

  // M10.5 — slow-network indicator. Mirrors the pattern in
  // SubscriptionSelectionContainer; same constant + threshold.
  const isStillLoading = subQuery.isLoading;
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
  const paymentStatus: SubscriptionStatus | null =
    subscriptionData?.paymentStatus ?? null;
  const subscriptionEndsAt = subscriptionData?.expiresAt ?? null;
  const trialEndsAt = subscriptionData?.trialEndsAt ?? null;
  const billingCycle = subscriptionData?.billingCycle ?? null;

  // Both active and cancelled subs use expiresAt for the date row.
  // Legacy distinguished the labels in the presenter; we pass the
  // same ISO string through and let the presenter handle wording.
  const displayBillingDate = subscriptionEndsAt;

  const canUpgrade = currentTier === "basic";
  const canDowngrade = currentTier === "premium";
  const canCancel =
    currentTier !== "free" &&
    (paymentStatus === "active" || paymentStatus === "trialing");

  const handleUpgrade = useCallback(
    (tier: SubscriptionTierName) => {
      // M10.5 — offline pre-flight. AC 11.2 + 11.4.
      if (!isOnline) {
        Alert.alert(OFFLINE_ALERT_TITLE, OFFLINE_ALERT_MESSAGE);
        return;
      }
      Alert.alert(
        "Upgrade Subscription",
        "You will be charged a prorated amount immediately. Continue?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Upgrade",
            onPress: async () => {
              try {
                await createSubscriptionMutation.mutateAsync({
                  tierName: tier,
                  billingCycle: billingCycle ?? "monthly",
                  useTrial: false,
                });
                Alert.alert("Success", "Your subscription has been upgraded!");
              } catch (err) {
                // The hook re-throws ApiError directly; ApiError.message
                // is always a string per the domain types.
                Alert.alert("Error", (err as { message: string }).message);
              }
            },
          },
        ],
      );
    },
    [createSubscriptionMutation, billingCycle, isOnline],
  );

  const handleDowngrade = useCallback(
    (tier: SubscriptionTierName) => {
      // M10.5 — offline pre-flight. AC 11.2 + 11.4.
      if (!isOnline) {
        Alert.alert(OFFLINE_ALERT_TITLE, OFFLINE_ALERT_MESSAGE);
        return;
      }
      Alert.alert(
        "Downgrade Subscription",
        "Your subscription will change at the end of your current billing period. Continue?",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Downgrade",
            onPress: async () => {
              try {
                const response = await createSubscriptionMutation.mutateAsync({
                  tierName: tier,
                  billingCycle: billingCycle ?? "monthly",
                  useTrial: false,
                });
                const effectiveDate = response.effectiveAt
                  ? new Date(response.effectiveAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
                  : "the end of your current billing period";
                Alert.alert(
                  "Success",
                  `Your subscription will change to Basic on ${effectiveDate}`,
                );
              } catch (err) {
                Alert.alert("Error", (err as { message: string }).message);
              }
            },
          },
        ],
      );
    },
    [createSubscriptionMutation, billingCycle, isOnline],
  );

  const handleCancel = useCallback(() => {
    if (!subscriptionData?.subscriptionId) return;
    // M10.5 — offline pre-flight. AC 11.2 + 11.4.
    if (!isOnline) {
      Alert.alert(OFFLINE_ALERT_TITLE, OFFLINE_ALERT_MESSAGE);
      return;
    }
    const isTrialing = paymentStatus === "trialing";
    const cancelMessage = isTrialing
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
              isTrialing
                ? `Your trial will end on ${endDate}. You won't be charged. You'll continue to have access until then.`
                : `Your subscription will end on ${endDate}. You'll continue to have access until then.`,
            );
          } catch (err) {
            Alert.alert("Error", (err as { message: string }).message);
          }
        },
      },
    ]);
  }, [subscriptionData, paymentStatus, cancelSubscriptionMutation, isOnline]);

  return (
    <SubscriptionManagementPresenter
      currentTier={currentTier}
      paymentStatus={paymentStatus}
      nextBillingDate={subscriptionEndsAt}
      subscriptionEndsAt={subscriptionEndsAt}
      trialEndsAt={trialEndsAt}
      billingCycle={billingCycle}
      displayBillingDate={displayBillingDate}
      trainerClientLimit={subscriptionData?.trainerClientLimit ?? null}
      isLoading={subQuery.isLoading}
      isUpgrading={createSubscriptionMutation.isPending}
      isDowngrading={createSubscriptionMutation.isPending}
      isCancelling={cancelSubscriptionMutation.isPending}
      canUpgrade={canUpgrade}
      canDowngrade={canDowngrade}
      canCancel={canCancel}
      isOffline={!isOnline}
      isSlowLoading={isSlowLoading}
      onUpgrade={handleUpgrade}
      onDowngrade={handleDowngrade}
      onCancel={handleCancel}
      onBack={() => router.back()}
    />
  );
}
