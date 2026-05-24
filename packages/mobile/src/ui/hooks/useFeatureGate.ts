import { useMemo } from "react";
import { useRouter, type Href } from "expo-router";
import type { EntitlementFeature } from "@/domain/models/entitlement";
import type {
  BillingCycle,
  MySubscription,
  SubscriptionTier,
  SubscriptionTierName,
} from "@/domain/models/subscription";
import type { FeatureGatePromptProps } from "@/ui/components/subscription/FeatureGatePrompt";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { useSubscriptionTiers } from "@/ui/hooks/useSubscriptionTiers";

/**
 * Client-side feature-gate verdict for paywalled mobile flows.
 *
 * Spec: specs/11-payments-subscriptions/design.md § Mobile feature-gate model
 * Satisfies: requirements.md AC 10.1, 10.2
 *
 * **Pure function of the cached `MySubscription`** — no network in the
 * hot path. The hook reads `useMySubscription()` (which exposes the
 * server-joined `subscription_tiers` columns embedded on the shape) and
 * `useSubscriptionTiers()` (already cached after the auth-flow Selection
 * screen renders) and returns a verdict computed entirely off cache.
 *
 * The verdict mirrors the backend's `assertEntitlement` rules (see
 * `microservices/core/src/application/entitlement/assertEntitlement.ts`
 * once the m105-backend agent lands it), but the **server is the
 * authoritative defense** — a 402 on the mutation is the actual gate.
 * The client-side verdict exists only so we can render the upgrade
 * prompt before the mutation even fires.
 *
 * Brad's explicit call: no client-side `validUntil` / grace-window /
 * clock-rollback defense. `expiresAt` is trusted as-is. AI features
 * inherently require network, so the marginal client-side abuse-defense
 * complexity isn't worth it.
 *
 * Feature → rule mapping (M10.5 scope):
 *
 * | Feature | Allowed when |
 * | --- | --- |
 * | `create_workout` | `paymentStatus IN ('active', 'trialing')` AND tier `workoutLimit === null OR workoutLimit > 0`. Brief: client cannot detect actual-count-vs-limit ('limit' reason) without a usage counter, so for M10.5 we collapse to 'tier' reason on a non-active sub. |
 * | `ai_workout` | `paymentStatus IN ('active', 'trialing')` AND `tier.aiAccess === true`. Trial users count. |
 * | `gym_buddy` | `tier.gymBuddyAccess === true`. |
 * | `unlimited_exercise_library` | Always — stub matching backend. |
 * | `trainer_clients` | `tier.isTrainerTier === true`. |
 *
 * If `useMySubscription` hasn't resolved yet (data is `undefined`) the
 * hook returns `allowed: false` with reason `'unknown'` so the consumer
 * either renders a loading state or stays defensive. Once `MySubscription`
 * loads the verdict re-computes.
 */

export type FeatureGateReason = "tier" | "limit" | "cancelled" | "unknown";

export interface FeatureGateResult {
  allowed: boolean;
  reason: FeatureGateReason;
  gateProps: FeatureGatePromptProps;
}

const ACTIVE_STATUSES = new Set<MySubscription["paymentStatus"]>([
  "active",
  "trialing",
]);

/**
 * Human-readable feature labels used in the gate prompt header. Centralised
 * here so the prompt and any future analytics emitter see the same string.
 */
const FEATURE_DISPLAY_NAMES: Record<EntitlementFeature, string> = {
  create_workout: "Custom workouts beyond your monthly limit",
  ai_workout: "AI Workouts",
  gym_buddy: "Gym Buddy access",
  unlimited_exercise_library: "Unlimited exercise library",
  trainer_clients: "Trainer client management",
};

/**
 * Default upgrade-target chain for the user (non-trainer) track. The
 * mapping is intentionally a simple parent → next-tier link; the gate
 * component doesn't try to be clever about cross-track upgrades. Free
 * climbs to Basic, Basic to Premium, Premium is terminal.
 *
 * Trainer tiers are terminal in this map (upgradeTo === null). A trainer
 * already on a paid tier who hits a feature gate should hit Contact
 * support, not be funnelled to a user-track upgrade. The selection
 * screen itself handles cross-track changes; the gate just nudges to
 * the *next* user-track tier.
 */
const USER_UPGRADE_CHAIN: Partial<
  Record<SubscriptionTierName, SubscriptionTierName>
> = {
  free: "basic",
  basic: "premium",
};

function resolveUpgradeTarget(
  currentTier: SubscriptionTierName,
): SubscriptionTierName | null {
  return USER_UPGRADE_CHAIN[currentTier] ?? null;
}

function findTier(
  tiers: readonly SubscriptionTier[] | undefined,
  tierName: SubscriptionTierName | null,
): SubscriptionTier | undefined {
  if (!tiers || tierName === null) return undefined;
  return tiers.find((t) => t.tierName === tierName);
}

/**
 * Compute the verdict for a single feature against a single subscription
 * shape. Pure — pulled out of the hook so unit tests can exercise the
 * branch tree without the React-Query wrapping.
 *
 * Returns `allowed: true` (with a sentinel reason `"tier"`) on the happy
 * path; the gate component never reads `reason` when `allowed === true`,
 * so the value is unused. Consumers check `allowed` first.
 */
export function computeFeatureGateVerdict(
  feature: EntitlementFeature,
  subscription: MySubscription,
): { allowed: boolean; reason: FeatureGateReason } {
  const isActive = ACTIVE_STATUSES.has(subscription.paymentStatus);
  const isCancelled = subscription.paymentStatus === "cancelled";

  switch (feature) {
    case "create_workout": {
      // Unlimited (workoutLimit === null) or non-zero limit + active sub.
      if (!isActive) {
        return {
          allowed: false,
          reason: isCancelled ? "cancelled" : "tier",
        };
      }
      const limit = subscription.workoutLimit;
      const allowed = limit === null || limit > 0;
      return { allowed, reason: allowed ? "tier" : "tier" };
    }
    case "ai_workout": {
      if (!isActive) {
        return {
          allowed: false,
          reason: isCancelled ? "cancelled" : "tier",
        };
      }
      const allowed = subscription.aiAccess === true;
      return { allowed, reason: "tier" };
    }
    case "gym_buddy": {
      const allowed = subscription.gymBuddyAccess === true;
      return { allowed, reason: allowed ? "tier" : "tier" };
    }
    case "unlimited_exercise_library": {
      // Backend stub: always allowed. Mirror exactly.
      return { allowed: true, reason: "tier" };
    }
    case "trainer_clients": {
      const allowed = subscription.isTrainerTier === true;
      return { allowed, reason: "tier" };
    }
  }
}

/**
 * React hook surface: feature-gate verdict + ready-to-render prompt
 * props for the current signed-in user.
 *
 * The `onUpgrade` callback pushes to `/(auth)/subscription-selection`
 * with the upgrade target tier + the user's current billing cycle
 * (defaulting to `monthly` when no current cycle exists, e.g. free
 * users) pre-applied via query params, satisfying AC 10.2's "tap
 * routes to Selection with target pre-selected".
 */
export function useFeatureGate(feature: EntitlementFeature): FeatureGateResult {
  const subQuery = useMySubscription();
  const tiersQuery = useSubscriptionTiers();
  const router = useRouter();

  return useMemo<FeatureGateResult>(() => {
    const subscription = subQuery.data ?? null;
    const tiers = tiersQuery.data;

    // No cached sub yet — defensive deny with reason 'unknown'. Consumers
    // typically gate render on `subQuery.isSuccess` upstream; this branch
    // exists so the hook never returns an `allowed: true` based on a
    // missing cache.
    if (subscription === null) {
      const fallbackProps: FeatureGatePromptProps = {
        feature,
        featureDisplayName: FEATURE_DISPLAY_NAMES[feature],
        currentTier: "free",
        upgradeTo: "basic",
        upgradePriceMonthly: null,
        onUpgrade: () => {
          router.push(
            "/(auth)/subscription-selection?tier=basic&cycle=monthly" as Href,
          );
        },
      };
      return {
        allowed: false,
        reason: "unknown",
        gateProps: fallbackProps,
      };
    }

    const { allowed, reason } = computeFeatureGateVerdict(
      feature,
      subscription,
    );

    const upgradeTo = resolveUpgradeTarget(subscription.tierName);
    const upgradeTier = findTier(tiers, upgradeTo);
    const billingCycle: BillingCycle = subscription.billingCycle ?? "monthly";

    const gateProps: FeatureGatePromptProps = {
      feature,
      featureDisplayName: FEATURE_DISPLAY_NAMES[feature],
      currentTier: subscription.tierName,
      upgradeTo,
      upgradePriceMonthly: upgradeTier?.priceMonthly ?? null,
      onUpgrade: () => {
        if (upgradeTo === null) return;
        router.push(
          `/(auth)/subscription-selection?tier=${upgradeTo}&cycle=${billingCycle}` as Href,
        );
      },
    };

    return { allowed, reason, gateProps };
  }, [feature, subQuery.data, tiersQuery.data, router]);
}
