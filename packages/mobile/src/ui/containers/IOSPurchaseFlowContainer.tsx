import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Alert, Linking, Platform } from "react-native";
import {
  SUBSCRIPTION_CATALOG,
  type CatalogTierId,
  type TierPricing,
} from "@persistence/subscription-catalog";
import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import {
  type BillingCycle,
  type SubscriptionTierName,
} from "@/domain/models/subscription";
import {
  getSubscriptionDisplayInfo,
  isCancelledButActive as isCancelledButActiveCheck,
  TRAINER_TIER_NAMES,
} from "@/domain/services/subscriptionService";
import {
  findPackageForTier,
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
import type { SubscriptionRailScreen } from "@/ui/presenters/IOSPurchaseFlowPresenter";

/**
 * Native RevenueCat purchase-flow container (App Store + Google Play rails).
 *
 * Spec: specs/milestones/M12-app-store-iap/FRONTEND_BRIEF.md § Deliverables 3–6
 *
 * Owns offering fetch + purchase / restore dispatch + store-managed
 * subscription links. Reuses the same tier catalog + current-sub
 * shape as the Stripe Selection container so entitlement + coach-mode behave
 * identically — only the purchase mechanism differs (native IAP, no Stripe).
 *
 * Mounted by `SubscriptionSelectionContainer` when a native purchases adapter
 * is present.
 */

/** Apple's account-level subscription management page (IAP can't be cancelled in-app). */
export const APP_STORE_SUBSCRIPTIONS_URL =
  "https://apps.apple.com/account/subscriptions";
export const PLAY_STORE_SUBSCRIPTIONS_URL =
  "https://play.google.com/store/account/subscriptions?package=com.bradleyevans96.persistence";

/**
 * Coach tiers with NO annual IAP product, hidden on the yearly cycle.
 *
 * ⚠ Spec-29 Phase 2 (2026-08-05): EMPTY. The retired `small_business` /
 * `medium_enterprise` tiers were the only monthly-only ones; every tier on the
 * new coach ladder (`individual_trainer` / `start_up_coach_plus` / `coach` /
 * `coach_pro`) has both a monthly and an annual IAP product, so none are hidden
 * on the yearly cycle. Kept as a (now empty) set rather than deleted so the
 * paywall's `monthlyOnlyTiers.has(...)` guard stays wired for any future
 * monthly-only tier without a signature change.
 */
export const MONTHLY_ONLY_TIERS: ReadonlySet<SubscriptionTierName> = new Set(
  [],
);

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
  // Derived from the catalog's trainer-tier set (not a hardcoded literal list)
  // so it can never drift when the coach ladder changes — spec-29 Phase 2.
  const tierParamImpliesTrainer = TRAINER_TIER_NAMES.has(
    searchParams.tier as SubscriptionTierName,
  );

  const tiersQuery = useSubscriptionTiers();
  const subQuery = useMySubscription();
  const refetchSubscription = subQuery.refetch;
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
  const [processingPhase, setProcessingPhase] = useState<
    "purchasing" | "activating" | null
  >(null);
  const navigationCoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const isProcessing = processingPhase !== null;
  const hasExplicitPlanRoute = Boolean(
    searchParams.tier || searchParams.cycle || searchParams.role,
  );

  useEffect(
    () => () => {
      if (navigationCoverTimerRef.current !== null) {
        clearTimeout(navigationCoverTimerRef.current);
      }
    },
    [],
  );
  const [screen, setScreen] = useState<SubscriptionRailScreen>(
    hasExplicitPlanRoute ? "plans" : "persona",
  );
  const [screenChosen, setScreenChosen] = useState(hasExplicitPlanRoute);
  // Which screen the "plans" screen was entered FROM, so Back returns there
  // rather than a hardcoded "persona". Set on each transition into "plans".
  // Default "persona" preserves the pre-existing back path for a new user and
  // for a deep link into plans (both correctly back into the chooser); the
  // Manage → change-plan path overrides it to "manage" so an existing
  // subscriber backs out to their subscription screen instead of the
  // "How will you use Persistence?" chooser — a screen that was never part of
  // their journey and shows nothing selected.
  const [plansOrigin, setPlansOrigin] = useState<"persona" | "manage">(
    "persona",
  );

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

  const currentBillingCycle = useMemo(() => {
    const reportedCycle = subscriptionData?.billingCycle ?? null;
    if (
      reportedCycle === null ||
      subscriptionData === null ||
      subscriptionData.expiresAt === null
    ) {
      return null;
    }

    const startsAt = Date.parse(subscriptionData.startsAt);
    const expiresAt = Date.parse(subscriptionData.expiresAt);
    const periodMs = expiresAt - startsAt;
    // RevenueCat sandbox periods and introductory trials are compressed, so
    // the backend's period-length heuristic cannot distinguish monthly from
    // annual there. Do not present a cadence as authoritative until the
    // observed period is long enough to represent a real paid month.
    const minimumReliablePeriodMs = 20 * 24 * 60 * 60 * 1000;
    if (!Number.isFinite(periodMs) || periodMs < minimumReliablePeriodMs) {
      return null;
    }
    return reportedCycle;
  }, [subscriptionData]);
  useEffect(() => {
    if (initialCycleParam !== null) return;
    if (currentBillingCycle === "monthly" || currentBillingCycle === "yearly") {
      setBillingCycle(currentBillingCycle);
    }
  }, [currentBillingCycle, initialCycleParam]);

  const currentTier: SubscriptionTierName =
    subscriptionData?.tierName ?? "free";
  const isCancelledButActive = isCancelledButActiveCheck(subscriptionData);

  useEffect(() => {
    if (screenChosen || subQuery.isLoading || subscriptionData === null) return;
    setScreen(currentTier === "free" ? "persona" : "manage");
  }, [currentTier, screenChosen, subQuery.isLoading, subscriptionData]);

  const packages = useMemo(
    () => offeringsQuery.data ?? [],
    [offeringsQuery.data],
  );
  const purchasableTiers = useMemo(
    () =>
      derivePurchasableTiers(
        packages.filter((pkg) => pkg.billingCycle === billingCycle),
      ),
    [packages, billingCycle],
  );
  const tierPricing = useMemo(() => {
    const pricing: Partial<Record<CatalogTierId, TierPricing>> = {};
    const catalogIds = new Set<string>(
      SUBSCRIPTION_CATALOG.map((tier) => tier.id),
    );

    // StoreKit (through RevenueCat) is the only price source for native IAP.
    // The API catalog is GBP-denominated; using it as a display fallback can
    // mix `£` with the customer's real App Store currency. Product id ->
    // tier/cadence mapping is the join.
    for (const pkg of packages) {
      if (pkg.tier === null || !catalogIds.has(pkg.tier)) continue;
      const id = pkg.tier as CatalogTierId;
      const current = pricing[id] ?? { monthly: null, annual: null };
      pricing[id] =
        pkg.billingCycle === "yearly"
          ? {
              ...current,
              annual: pkg.price,
              annualSource: "store",
              annualLabel: pkg.priceString,
              ...(pkg.pricePerMonthString === null
                ? {}
                : {
                    annualMonthlyEquivalentLabel: pkg.pricePerMonthString,
                  }),
            }
          : {
              ...current,
              monthly: pkg.price,
              monthlySource: "store",
              monthlyLabel: pkg.priceString,
            };
    }

    return pricing;
  }, [packages]);
  // Trial length advertised on EACH card — derived ONLY from THAT tier's own
  // product's Apple introductory offer, on the shown billing cycle. `null`
  // when the product surfaces no real free-trial offer (offer missing/
  // unapproved in App Store Connect, or not yet synced) → that card shows NO
  // trial banner rather than guess a duration. Per-tier (NOT one global value
  // across all cards): otherwise the first product with any offer stamped its
  // duration on every card — e.g. a premium product with a 1-week offer would
  // wrongly render a trainer product's 2-week offer, or vice-versa. Mirrors
  // isTierTrialEligible's per-tier shape.
  const tierTrialDays = useCallback(
    (tier: SubscriptionTierName): number | null => {
      const pkg = findPackageForTier(packages, tier, billingCycle);
      return pkg?.introTrialDays != null && pkg.introTrialDays > 0
        ? pkg.introTrialDays
        : null;
    },
    [packages, billingCycle],
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
  const introEligibilityQuery = useIntroEligibility(
    Platform.OS === "ios" ? productIds : [],
  );
  const introEligibility = introEligibilityQuery.data ?? null;
  // Per-tier (per the CURRENT cycle's product), so each card's banner reflects
  // its OWN product's eligibility — not an OR across tiers, which could show a
  // trial banner on a tier whose product grants none. Memoised so the
  // presenter's card useMemos stay stable.
  const isTierTrialEligible = useCallback(
    (tier: SubscriptionTierName): boolean => {
      if (Platform.OS === "android") return tierTrialDays(tier) !== null;
      if (introEligibility === null) return false;
      const pkg = findPackageForTier(packages, tier, billingCycle);
      return pkg !== null && (introEligibility[pkg.productId] ?? false);
    },
    [introEligibility, packages, billingCycle, tierTrialDays],
  );
  const hasTrialEligibilityData =
    Platform.OS === "android"
      ? !offeringsQuery.isLoading
      : introEligibility !== null;

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

      setProcessingPhase("purchasing");
      let navigationStarted = false;
      try {
        const result = await purchaseMutation.mutateAsync(pkg.packageId);
        setProcessingPhase("activating");
        // `result` is RevenueCat's ACTIVE entitlement snapshot after Apple's
        // sheet closes. It may still contain the old tier when Apple schedules
        // a downgrade for the next renewal, so the tapped tile is not itself
        // proof that access changed. Force a server-side reconcile and only
        // announce activation when BOTH RevenueCat and the backend confirm the
        // requested tier. This prevents a success-screen flash followed by
        // locked features or an apparently unselected current plan.
        const purchasedTierIsActive = result.some(
          (entitlement) => entitlement.tier === tier,
        );
        let syncedTier: SubscriptionTierName | null = null;
        try {
          const synced = await syncMutation.mutateAsync();
          syncedTier = synced.tierName;
        } catch {
          // Handled below. Never announce unlocked access until the server has
          // confirmed the tier that RevenueCat reports as active.
        }

        if (!purchasedTierIsActive) {
          await refetchSubscription();
          if (syncedTier !== null && syncedTier !== tier) {
            Alert.alert(
              "Plan Change Pending",
              "Your existing plan is still active while the store confirms this change. Your access will update automatically once confirmation completes.",
            );
          } else if (syncedTier === tier) {
            Alert.alert(
              "Purchase Confirmed",
              "Your plan is active on our server, but this device is still refreshing its store access. Please keep Persistence open and try again shortly.",
            );
          } else {
            Alert.alert(
              "Activation Pending",
              "Your purchase completed, but we couldn't confirm the active plan yet. Please keep Persistence open and try again shortly.",
            );
          }
          setScreen("manage");
          setScreenChosen(true);
          return;
        }

        if (syncedTier !== tier) {
          await refetchSubscription();
          Alert.alert(
            "Purchase Confirmed",
            "Apple confirmed your purchase, but we haven't finished activating the plan yet. Please keep the app open and try again shortly.",
          );
          return;
        }
        router.push(`/(auth)/success?tier=${tier}` as Href);
        navigationStarted = true;
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
        if (navigationStarted) {
          // Keep the activation cover mounted through the navigation
          // transition so the paywall cannot flash back into an interactive
          // state after Apple's sheet closes.
          navigationCoverTimerRef.current = setTimeout(() => {
            navigationCoverTimerRef.current = null;
            setProcessingPhase(null);
          }, 750);
        } else {
          setProcessingPhase(null);
        }
      }
    },
    [
      isProcessing,
      purchases,
      packages,
      billingCycle,
      purchaseMutation,
      syncMutation,
      refetchSubscription,
      router,
    ],
  );

  const handlePersonaSelect = useCallback((nextRole: Role) => {
    setSelectedRole(nextRole);
    setBillingCycle(nextRole === "trainer" ? "monthly" : "yearly");
    setPlansOrigin("persona");
    setScreen("plans");
    setScreenChosen(true);
  }, []);

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
          `We couldn't confirm an active subscription for this ${Platform.OS === "android" ? "Google Play account" : "Apple ID"}. If you believe this is an error, contact support.`,
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

  const handleManageInAppStore = useCallback(async () => {
    const fallbackUrl =
      Platform.OS === "android"
        ? PLAY_STORE_SUBSCRIPTIONS_URL
        : APP_STORE_SUBSCRIPTIONS_URL;
    if (purchases === null || !purchases.isConfigured()) {
      await Linking.openURL(fallbackUrl);
      return;
    }
    const result = await purchases.getManagementUrl();
    await Linking.openURL(
      result.ok && result.value ? result.value : fallbackUrl,
    );
  }, [purchases]);

  return (
    <IOSPurchaseFlowPresenter
      tierPricing={tierPricing}
      isLoading={
        tiersQuery.isLoading || subQuery.isLoading || offeringsQuery.isFetching
      }
      errorMessage={
        offeringsQuery.error?.message ?? tiersQuery.error?.message ?? null
      }
      isUnavailable={purchases !== null && !purchases.isConfigured()}
      billingCycle={billingCycle}
      currentBillingCycle={currentBillingCycle}
      currentTier={currentTier}
      selectedRole={selectedRole}
      purchasableTiers={purchasableTiers}
      isTierTrialEligible={isTierTrialEligible}
      tierTrialDays={tierTrialDays}
      hasTrialEligibilityData={hasTrialEligibilityData}
      monthlyOnlyTiers={MONTHLY_ONLY_TIERS}
      subscriptionEndsAt={subscriptionData?.expiresAt ?? null}
      isCancelledButActive={isCancelledButActive}
      currentTierDisplayName={displayInfo.currentTierDisplayName}
      isProcessing={isProcessing}
      processingPhase={processingPhase}
      isRestoring={restoreMutation.isPending || syncMutation.isPending}
      screen={screen}
      onBillingCycleChange={setBillingCycle}
      onTierSelect={(tier) => void handleTierSelect(tier)}
      onRoleChange={setSelectedRole}
      onPersonaSelect={handlePersonaSelect}
      onChangePlan={() => {
        setPlansOrigin("manage");
        setScreen("plans");
        setScreenChosen(true);
      }}
      onContinueFree={() => router.push("/(auth)/success?tier=free" as Href)}
      onBack={() => {
        if (screen === "plans") {
          // Return to whichever screen opened plans — Manage for an existing
          // subscriber (change-plan), the persona chooser otherwise.
          setScreen(plansOrigin);
          setScreenChosen(true);
          return;
        }
        router.back();
      }}
      onRetry={() => {
        void tiersQuery.refetch();
        void offeringsQuery.refetch();
        void introEligibilityQuery.refetch();
      }}
      onRestore={() => void handleRestore()}
      onManageInAppStore={() => void handleManageInAppStore()}
    />
  );
}
