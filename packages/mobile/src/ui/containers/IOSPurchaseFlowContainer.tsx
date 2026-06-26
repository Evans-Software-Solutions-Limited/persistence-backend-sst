import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import type {
  BillingCycle,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import {
  getSubscriptionDisplayInfo,
  isCancelledButActive as isCancelledButActiveCheck,
} from "@/domain/services/subscriptionService";
import {
  findPackageForTier,
  purchasableTiers as derivePurchasableTiers,
} from "@/domain/services/purchaseOfferings";
import { usePurchases } from "@/ui/hooks/usePurchases";
import { usePurchaseOfferings } from "@/ui/hooks/usePurchaseOfferings";
import { usePurchasePackage } from "@/ui/hooks/usePurchasePackage";
import { useRestorePurchases } from "@/ui/hooks/useRestorePurchases";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { useSubscriptionTiers } from "@/ui/hooks/useSubscriptionTiers";
import { IOSPurchaseFlowPresenter } from "@/ui/presenters/IOSPurchaseFlowPresenter";

/**
 * iOS RevenueCat purchase-flow container (M12, iOS rail).
 *
 * Spec: specs/milestones/M12-app-store-iap/FRONTEND_BRIEF.md § Deliverables 3–6
 *
 * Owns offering fetch + purchase / restore dispatch + the Apple-managed
 * "Manage in App Store" link. Reuses the same tier catalog + current-sub
 * shape as the Stripe Selection container so entitlement + coach-mode behave
 * identically — only the purchase mechanism differs (Apple IAP, no Stripe).
 *
 * Mounted by `SubscriptionSelectionContainer` when `Platform.OS === "ios"`
 * AND a purchases adapter is present.
 */

/** Apple's account-level subscription management page (IAP can't be cancelled in-app). */
export const APP_STORE_SUBSCRIPTIONS_URL =
  "https://apps.apple.com/account/subscriptions";

type Role = "user" | "trainer";

export function IOSPurchaseFlowContainer() {
  const router = useRouter();
  const purchases = usePurchases();

  const searchParams = useLocalSearchParams<{
    tier?: string;
    cycle?: string;
    role?: string;
  }>();
  const initialCycleParam =
    searchParams.cycle === "yearly" || searchParams.cycle === "monthly"
      ? (searchParams.cycle as BillingCycle)
      : null;
  const initialRoleParam = searchParams.role;
  const tierParamImpliesTrainer =
    searchParams.tier === "individual_trainer" ||
    searchParams.tier === "small_business" ||
    searchParams.tier === "medium_enterprise";

  const tiersQuery = useSubscriptionTiers();
  const subQuery = useMySubscription();
  const offeringsQuery = usePurchaseOfferings();
  const purchaseMutation = usePurchasePackage();
  const restoreMutation = useRestorePurchases();

  const subscriptionData = subQuery.data ?? null;
  const role = subscriptionData?.role;

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
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    if (initialRoleParam === "personal_trainer" || tierParamImpliesTrainer) {
      return;
    }
    setSelectedRole(
      role === "personal_trainer" || role === "physiotherapist"
        ? "trainer"
        : "user",
    );
  }, [role, initialRoleParam, tierParamImpliesTrainer]);

  const currentBillingCycle = subscriptionData?.billingCycle ?? null;
  useEffect(() => {
    if (initialCycleParam !== null) return;
    if (currentBillingCycle === "monthly" || currentBillingCycle === "yearly") {
      setBillingCycle(currentBillingCycle);
    }
  }, [currentBillingCycle, initialCycleParam]);

  const currentTier: SubscriptionTierName =
    subscriptionData?.tierName ?? "free";
  const isCancelledButActive = isCancelledButActiveCheck(subscriptionData);

  const packages = useMemo(
    () => offeringsQuery.data ?? [],
    [offeringsQuery.data],
  );
  const purchasableTiers = useMemo(
    () => derivePurchasableTiers(packages),
    [packages],
  );

  const tierDisplayNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const t of tiersQuery.data ?? []) map[t.tierName] = t.displayName;
    return map;
  }, [tiersQuery.data]);

  const displayInfo = useMemo(
    () => getSubscriptionDisplayInfo(subscriptionData, tierDisplayNames),
    [subscriptionData, tierDisplayNames],
  );

  const handleTierSelect = useCallback(
    async (tier: SubscriptionTierName) => {
      if (isProcessing || purchases === null) return;
      if (tier === "free") return;

      const pkg = findPackageForTier(packages, tier, billingCycle);
      if (pkg === null) {
        const cycleLabel = billingCycle === "yearly" ? "yearly" : "monthly";
        Alert.alert(
          "Not available",
          `This plan isn't available for in-app purchase on a ${cycleLabel} basis yet. Please check back soon.`,
        );
        return;
      }

      setIsProcessing(true);
      try {
        const result = await purchaseMutation.mutateAsync(pkg.packageId);
        // result is the active-entitlement snapshot; server truth lands via
        // the RC webhook and useMySubscription reconciles. Navigate to the
        // shared success screen exactly as the Stripe path does.
        void result;
        router.push("/(auth)/success" as Href);
      } catch (err) {
        const error = err as { kind?: string; message?: string };
        // User dismissed the native sheet — silent (no alert), matching the
        // Stripe cancel parity.
        if (error.kind !== "cancelled") {
          Alert.alert(
            "Purchase Error",
            error.message ?? "Something went wrong. Please try again.",
          );
        }
      } finally {
        setIsProcessing(false);
      }
    },
    [isProcessing, purchases, packages, billingCycle, purchaseMutation, router],
  );

  const handleRestore = useCallback(async () => {
    if (isProcessing || restoreMutation.isPending) return;
    try {
      const entitlements = await restoreMutation.mutateAsync();
      if (entitlements.length > 0) {
        Alert.alert(
          "Purchases Restored",
          "Your subscription has been restored.",
        );
      } else {
        Alert.alert(
          "Nothing to Restore",
          "We couldn't find any previous purchases for this Apple ID.",
        );
      }
    } catch (err) {
      const error = err as { message?: string };
      Alert.alert(
        "Restore Failed",
        error.message ?? "Couldn't restore purchases. Please try again.",
      );
    }
  }, [isProcessing, restoreMutation]);

  const handleManageInAppStore = useCallback(() => {
    void Linking.openURL(APP_STORE_SUBSCRIPTIONS_URL);
  }, []);

  return (
    <IOSPurchaseFlowPresenter
      subscriptionTiers={tiersQuery.data ?? []}
      isLoading={
        tiersQuery.isLoading || subQuery.isLoading || offeringsQuery.isLoading
      }
      errorMessage={tiersQuery.error?.message ?? null}
      isUnavailable={purchases !== null && !purchases.isConfigured()}
      billingCycle={billingCycle}
      currentTier={currentTier}
      selectedRole={selectedRole}
      purchasableTiers={purchasableTiers}
      isTrialEligibleUser={subscriptionData?.isEligibleForUserTrial ?? false}
      isTrialEligibleTrainer={
        subscriptionData?.isEligibleForTrainerTrial ?? false
      }
      hasTrialEligibilityData={subscriptionData !== null}
      subscriptionEndsAt={subscriptionData?.expiresAt ?? null}
      isCancelledButActive={isCancelledButActive}
      currentTierDisplayName={displayInfo.currentTierDisplayName}
      isProcessing={isProcessing}
      isRestoring={restoreMutation.isPending}
      onBillingCycleChange={setBillingCycle}
      onTierSelect={(tier) => void handleTierSelect(tier)}
      onRoleChange={setSelectedRole}
      onBack={() => router.back()}
      onRetry={() => {
        void tiersQuery.refetch();
        void offeringsQuery.refetch();
      }}
      onRestore={() => void handleRestore()}
      onManageInAppStore={handleManageInAppStore}
    />
  );
}
