import React, { useCallback } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import type {
  SubscriptionStatus,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import { useCancelSubscription } from "@/ui/hooks/useCancelSubscription";
import { useCreateSubscription } from "@/ui/hooks/useCreateSubscription";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { SubscriptionManagementPresenter } from "@/ui/presenters/SubscriptionManagementPresenter";

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
  const subQuery = useMySubscription();
  const createSubscriptionMutation = useCreateSubscription();
  const cancelSubscriptionMutation = useCancelSubscription();

  const subscriptionData = subQuery.data ?? null;

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
    [createSubscriptionMutation, billingCycle],
  );

  const handleDowngrade = useCallback(
    (tier: SubscriptionTierName) => {
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
    [createSubscriptionMutation, billingCycle],
  );

  const handleCancel = useCallback(() => {
    if (!subscriptionData?.subscriptionId) return;
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
  }, [subscriptionData, paymentStatus, cancelSubscriptionMutation]);

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
      onUpgrade={handleUpgrade}
      onDowngrade={handleDowngrade}
      onCancel={handleCancel}
      onBack={() => router.back()}
    />
  );
}
