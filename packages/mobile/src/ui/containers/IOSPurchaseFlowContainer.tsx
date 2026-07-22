import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Linking } from "react-native";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import {
  DEFAULT_TRIAL_DAYS,
  type BillingCycle,
  type SubscriptionTierName,
} from "@/domain/models/subscription";
import {
  getSubscriptionDisplayInfo,
  isCancelledButActive as isCancelledButActiveCheck,
} from "@/domain/services/subscriptionService";
import {
  findPackageForTier,
  offeringTrialDays,
  purchasableTiers as derivePurchasableTiers,
} from "@/domain/services/purchaseOfferings";
import { usePurchases } from "@/ui/hooks/usePurchases";
import { usePurchaseOfferings } from "@/ui/hooks/usePurchaseOfferings";
import { useIntroEligibility } from "@/ui/hooks/useIntroEligibility";
import { usePurchasePackage } from "@/ui/hooks/usePurchasePackage";
import { useRestorePurchases } from "@/ui/hooks/useRestorePurchases";
import { useSyncSubscription } from "@/ui/hooks/useSyncSubscription";
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

/**
 * Business tiers whose ANNUAL plan is handled by sales, not in-app purchase:
 * the annual fee exceeds Apple's IAP price ceiling / economics, so the yearly
 * tile shows a "Contact Sales" CTA (a B2B mailto — no external purchase, Apple
 * §3.1.1-safe) instead of an IAP button. Monthly for these tiers stays IAP.
 */
export const CONTACT_SALES_ANNUAL_TIERS: ReadonlySet<SubscriptionTierName> =
  new Set(["small_business", "medium_enterprise"]);

/** Sales enquiry address for the Contact Sales CTA (matches the support address). */
export const SALES_CONTACT_EMAIL = "admin@evans-software-solutions.com";

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
  const syncMutation = useSyncSubscription();

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
  // Trial length advertised on the paywall — derived from the product's Apple
  // introductory offer, falling back to DEFAULT_TRIAL_DAYS until the offer is
  // live in App Store Connect / RevenueCat.
  const trialDurationDays = useMemo(
    () => offeringTrialDays(packages, DEFAULT_TRIAL_DAYS),
    [packages],
  );

  // Trial eligibility = Apple's real on-device answer (per Apple ID, per
  // subscription group), NOT the backend `isEligibleFor*Trial` flags. Those
  // flags are only ever set by the Stripe rail, so on iOS they'd always read
  // "eligible" and advertise a trial an already-trialed user can't get. Read
  // eligibility per product and only show the banner when RevenueCat says
  // ELIGIBLE (loading/unknown → false, so we never over-promise).
  const productIds = useMemo(
    () => packages.map((p) => p.productId),
    [packages],
  );
  const introEligibilityQuery = useIntroEligibility(productIds);
  const introEligibility = introEligibilityQuery.data ?? null;
  // Per-tier (per the CURRENT cycle's product), so each card's banner reflects
  // its OWN product's eligibility — not an OR across tiers, which could show a
  // trial banner on a tier whose product grants none. Memoised so the
  // presenter's card useMemos stay stable.
  const isTierTrialEligible = useCallback(
    (tier: SubscriptionTierName): boolean => {
      if (introEligibility === null) return false;
      const pkg = findPackageForTier(packages, tier, billingCycle);
      return pkg !== null && (introEligibility[pkg.productId] ?? false);
    },
    [introEligibility, packages, billingCycle],
  );
  const hasTrialEligibilityData = introEligibility !== null;

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
        // `result` is the active-entitlement snapshot; RevenueCat has already
        // confirmed the purchase on Apple's side at this point, so the tier
        // the user just bought (`tier`) is authoritative for the success
        // screen. The backend's `user_subscriptions` row is only updated by
        // an ASYNC RevenueCat→backend webhook, so force a server-side
        // reconcile via `syncSubscription` here to persist the entitlement +
        // invalidate the subscription/profile caches BEFORE navigating —
        // without this, coach-mode / the drawer could briefly read `free`.
        // The sync is for the DB write, NOT to override display: we always
        // route with the purchased `tier`. If sync errors (e.g. a transient
        // 502), don't block a purchase RevenueCat already reported as
        // successful — the webhook reconciles the row shortly after.
        void result;
        try {
          await syncMutation.mutateAsync();
        } catch {
          // Sync failed — proceed with the purchased tier; the purchase
          // itself already succeeded on Apple's side and the webhook will
          // reconcile the DB row.
        }
        router.push(`/(auth)/success?tier=${tier}` as Href);
      } catch (err) {
        const error = err as { kind?: string; message?: string };
        // User dismissed the native sheet — silent (no alert), matching the
        // Stripe cancel parity.
        if (error.kind === "cancelled") return;
        // Deferred purchase (Ask to Buy / SCA): not a failure. Reassure the
        // user rather than showing a "Purchase Error", and don't navigate —
        // the entitlement isn't active until the purchase is approved.
        if (error.kind === "pending") {
          Alert.alert(
            "Purchase Pending",
            "Your purchase is awaiting approval. It'll activate automatically once approved.",
          );
          return;
        }
        Alert.alert(
          "Purchase Error",
          error.message ?? "Something went wrong. Please try again.",
        );
      } finally {
        setIsProcessing(false);
      }
    },
    [
      isProcessing,
      purchases,
      packages,
      billingCycle,
      purchaseMutation,
      syncMutation,
      router,
    ],
  );

  const handleRestore = useCallback(async () => {
    if (isProcessing || restoreMutation.isPending || syncMutation.isPending) {
      return;
    }
    try {
      const entitlements = await restoreMutation.mutateAsync();
      if (entitlements.length === 0) {
        Alert.alert(
          "Nothing to Restore",
          "We couldn't find any previous purchases for this Apple ID.",
        );
        return;
      }
      // On-device RevenueCat reports entitlements, but that's not proof the
      // backend will grant access: unlike a fresh purchase (which Apple has
      // just approved), a restore can legitimately find stale/expired
      // entitlements RevenueCat still has cached, or the restore may need an
      // async RC transfer webhook to re-associate the sub to this App User ID
      // before the backend can see it. So — unlike the purchase path — we
      // gate success STRICTLY on the server confirming a paid tier here;
      // don't fall back to the on-device tier on an inconclusive/failed sync.
      try {
        const sub = await syncMutation.mutateAsync();
        if (sub.tierName !== "free") {
          router.push(`/(auth)/success?tier=${sub.tierName}` as Href);
          return;
        }
        Alert.alert(
          "Couldn't Confirm Subscription",
          "We couldn't confirm an active subscription for this Apple ID. If you believe this is an error, contact support.",
        );
      } catch {
        Alert.alert(
          "Almost There",
          "We restored your purchases on this device but couldn't confirm your plan just yet — it can take a moment. Pull to refresh or reopen the app shortly.",
        );
      }
    } catch (err) {
      const error = err as { message?: string };
      Alert.alert(
        "Restore Failed",
        error.message ?? "Couldn't restore purchases. Please try again.",
      );
    }
  }, [isProcessing, restoreMutation, syncMutation, router]);

  const handleManageInAppStore = useCallback(() => {
    void Linking.openURL(APP_STORE_SUBSCRIPTIONS_URL);
  }, []);

  const handleContactSales = useCallback(
    (tier: SubscriptionTierName) => {
      const label = tierDisplayNames[tier] ?? tier;
      const subject = `Persistence — Annual plan enquiry (${label})`;
      void Linking.openURL(
        `mailto:${SALES_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}`,
      );
    },
    [tierDisplayNames],
  );

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
      isTierTrialEligible={isTierTrialEligible}
      trialDurationDays={trialDurationDays}
      hasTrialEligibilityData={hasTrialEligibilityData}
      contactSalesTiers={CONTACT_SALES_ANNUAL_TIERS}
      onContactSales={handleContactSales}
      subscriptionEndsAt={subscriptionData?.expiresAt ?? null}
      isCancelledButActive={isCancelledButActive}
      currentTierDisplayName={displayInfo.currentTierDisplayName}
      isProcessing={isProcessing}
      isRestoring={restoreMutation.isPending || syncMutation.isPending}
      onBillingCycleChange={setBillingCycle}
      onTierSelect={(tier) => void handleTierSelect(tier)}
      onRoleChange={setSelectedRole}
      onBack={() => router.back()}
      onRetry={() => {
        void tiersQuery.refetch();
        void offeringsQuery.refetch();
        void introEligibilityQuery.refetch();
      }}
      onRestore={() => void handleRestore()}
      onManageInAppStore={handleManageInAppStore}
    />
  );
}
