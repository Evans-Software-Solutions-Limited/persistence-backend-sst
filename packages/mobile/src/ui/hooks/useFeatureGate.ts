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
 * | `ai_access` | Same rule as `ai_workout` — `paymentStatus IN ('active', 'trialing')` AND `tier.aiAccess === true`. M9.5 Tier B nutrition AI (photo/free-text estimation); a separate feature key from `ai_workout` but identical gate logic (specs/13-nutrition-tracking/design.md § Revised 2026-07-03). |
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
 * Mirror the server's `isExpiresInFuture` helper from
 * `microservices/core/src/application/entitlement/assertEntitlement.ts`.
 * Used to detect "cancelled-but-still-paid-through" subs — the user
 * paid through `expires_at` and the server treats them as entitled
 * until that date. The client gate must agree, otherwise the user sees
 * a paywall on screens they've already paid for.
 */
function isExpiresAtInFuture(expiresAt: string | null): boolean {
  if (expiresAt === null) return false;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return false;
  return t > Date.now();
}

/**
 * Human-readable feature labels used in the gate prompt header. Centralised
 * here so the prompt and any future analytics emitter see the same string.
 */
const FEATURE_DISPLAY_NAMES: Record<EntitlementFeature, string> = {
  create_workout: "Custom workouts beyond your monthly limit",
  ai_workout: "AI Workouts",
  ai_access: "AI photo & text food logging",
  gym_buddy: "Gym Buddy access",
  unlimited_exercise_library: "Unlimited exercise library",
  trainer_clients: "Trainer client management",
};

/**
 * Default upgrade-target chain for the user (non-trainer) track. The
 * mapping is intentionally a simple parent → next-tier link; the gate
 * component doesn't try to be clever about cross-track upgrades for
 * user-track features. Post tier-simplification: free → premium.
 *
 * Trainer tiers are terminal in this map (upgradeTo === null) for
 * USER-track features. Trainer-track features (trainer_clients) use
 * the trainer-track target instead — see `resolveUpgradeTarget`.
 */
const USER_UPGRADE_CHAIN: Partial<
  Record<SubscriptionTierName, SubscriptionTierName>
> = {
  free: "premium",
};

/**
 * Set of tier names that already satisfy any trainer-only feature. A
 * user already on one of these doesn't get a CTA back to the trainer
 * track (they'd just see the same paywall after switching).
 */
const TRAINER_TIER_NAMES: ReadonlySet<SubscriptionTierName> = new Set([
  "individual_trainer",
  "small_business",
  "medium_enterprise",
]);

/**
 * Pick the upgrade target for a denied gate. Feature-aware so trainer-
 * only features (e.g. `trainer_clients`) point at the cheapest trainer
 * tier rather than the user-track next step.
 *
 * Inspector Brad PR #73 high-severity find — sweep #3: without this,
 * a free user hitting `trainer_clients` saw "Upgrade to Premium",
 * paid for Premium, returned to the same paywall (because Premium
 * has `isTrainerTier: false`). Trainer-only features now route to
 * `individual_trainer` (cheapest trainer tier, £14.99/mo).
 */
function resolveUpgradeTarget(
  currentTier: SubscriptionTierName,
  feature: EntitlementFeature,
): SubscriptionTierName | null {
  if (feature === "trainer_clients") {
    // Already on a trainer tier? Shouldn't hit the gate; defensively
    // return null so the prompt falls back to its "no upgrade target"
    // copy rather than suggesting a sideways switch.
    if (TRAINER_TIER_NAMES.has(currentTier)) return null;
    return "individual_trainer";
  }
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
  // Mirror the server's `classifySubscriptionStatus` rule: cancelled
  // with `expires_at` in the future is still entitled — the user paid
  // through that date. The server allows their mutations during this
  // window; the client gate MUST agree, otherwise the user sees a
  // paywall on screens they've already paid for (Inspector Brad PR
  // #72 low-severity find — sweep #2).
  const isCancelledButStillPaidThrough =
    isCancelled && isExpiresAtInFuture(subscription.expiresAt);
  const isEntitled = isActive || isCancelledButStillPaidThrough;

  switch (feature) {
    case "create_workout": {
      // Unlimited (workoutLimit === null) or non-zero limit + entitled sub.
      if (!isEntitled) {
        return {
          allowed: false,
          reason: isCancelled ? "cancelled" : "tier",
        };
      }
      const limit = subscription.workoutLimit;
      const allowed = limit === null || limit > 0;
      // Reason is always "tier" — the over-cap case isn't observable
      // client-side without a real counter; server-side `assertEntitlement`
      // is the only path that can return `"limit"`. Mobile renders the
      // gate; the prompt shows the upgrade path regardless of the exact
      // tier-vs-limit distinction (Inspector Brad PR #72 low-severity find
      // — sweep #1: dropping the no-op ternary).
      return { allowed, reason: "tier" };
    }
    case "ai_workout":
    case "ai_access": {
      if (!isEntitled) {
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
      return { allowed, reason: "tier" };
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
 * Client-slot seat verdict for the coach Clients surface. Mirrors the backend
 * `trainer_clients` cap (`assertEntitlement` / `trainerSeats`): active-client
 * count vs `MySubscription.trainerClientLimit`, with cancelled/expired trainers
 * reverting to free rules (no slots) and a NULL limit meaning unlimited.
 *
 * This is DELIBERATELY separate from `useFeatureGate('trainer_clients')`, which
 * stays a boolean `isTrainerTier` gate: that verdict gates the WHOLE Clients
 * screen, so making it count-based would lock an at-cap trainer OUT of their
 * roster. The seat verdict instead drives the in-roster "N of M slots used"
 * line + the disabled invite + the "no seats" warning, leaving the screen
 * reachable.
 */
export interface ClientSeatVerdict {
  /** Active (human) clients currently occupying seats. */
  used: number;
  /** Tier cap; `null` = unlimited (or unknown before the sub cache loads). */
  limit: number | null;
  /** At/over the cap — disable the invite affordance + show the warning. */
  atCap: boolean;
  /** Whether a seat is available for a new invite. */
  hasSeats: boolean;
}

const TRAINER_TIER_LADDER: Record<
  SubscriptionTierName,
  SubscriptionTierName | null
> = {
  free: "individual_trainer",
  premium: "individual_trainer",
  individual_trainer: "small_business",
  small_business: "medium_enterprise",
  medium_enterprise: null,
};

/**
 * The next trainer tier up (for the at-cap "change subscription" CTA). Mirrors
 * the backend `nextTrainerTierUp`: non-trainer → cheapest trainer tier;
 * `medium_enterprise` (top) → no higher cap to upsell.
 */
export function nextTrainerTierUp(
  tier: SubscriptionTierName,
): SubscriptionTierName | null {
  return TRAINER_TIER_LADDER[tier] ?? null;
}

/**
 * Compute the client-seat verdict from the cached subscription + the trainer's
 * active-client count. Pure — exported for unit testing. Returns a
 * seats-available verdict while the sub cache is unresolved (`null`) so the
 * warning never flashes before the real cap is known.
 */
export function computeClientSeatVerdict(
  subscription: MySubscription | null,
  activeClientCount: number,
): ClientSeatVerdict {
  if (subscription === null) {
    return {
      used: activeClientCount,
      limit: null,
      atCap: false,
      hasSeats: true,
    };
  }

  // Mirror the server: cancelled-but-still-paid-through stays entitled; any
  // other non-active status reverts to free rules → no client slots.
  const isEntitled =
    ACTIVE_STATUSES.has(subscription.paymentStatus) ||
    (subscription.paymentStatus === "cancelled" &&
      isExpiresAtInFuture(subscription.expiresAt));
  if (!isEntitled) {
    // Lapsed sub reverts to free rules → no slots. Report `limit: null` so the
    // surface shows ONLY the no-seats warning, not a contradictory
    // "0 of 3 slots used" line reflecting the now-defunct tier.
    return {
      used: activeClientCount,
      limit: null,
      atCap: true,
      hasSeats: false,
    };
  }

  const limit = subscription.trainerClientLimit;
  if (limit === null) {
    // Unlimited trainer tier.
    return {
      used: activeClientCount,
      limit: null,
      atCap: false,
      hasSeats: true,
    };
  }

  const atCap = activeClientCount >= limit;
  return { used: activeClientCount, limit, atCap, hasSeats: !atCap };
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
      // Defensive fallback for the pre-cache window. Feature-aware so
      // a trainer-only feature deny routes to a trainer tier even
      // before the sub query resolves.
      const fallbackUpgradeTo = resolveUpgradeTarget("free", feature);
      const fallbackProps: FeatureGatePromptProps = {
        feature,
        featureDisplayName: FEATURE_DISPLAY_NAMES[feature],
        currentTier: "free",
        upgradeTo: fallbackUpgradeTo,
        upgradePriceMonthly: null,
        onUpgrade: () => {
          if (fallbackUpgradeTo === null) return;
          router.push(
            `/(auth)/subscription-selection?tier=${fallbackUpgradeTo}&cycle=monthly` as Href,
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

    const upgradeTo = resolveUpgradeTarget(subscription.tierName, feature);
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
