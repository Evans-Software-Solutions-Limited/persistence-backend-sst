import type {
  CoachClientBand,
  OnboardingIntentKey,
  OnboardingPath,
  OnboardingRecommendation,
} from "@/domain/models/onboarding";
import type { SubscriptionTierName } from "@/domain/models/subscription";

const CONSUMER_RANK: Partial<Record<SubscriptionTierName, number>> = {
  free: 0,
  premium: 1,
  premium_plus: 2,
};

const COACH_RANK: Partial<Record<SubscriptionTierName, number>> = {
  individual_trainer: 0,
  start_up_coach_plus: 1,
  coach: 2,
  coach_pro: 3,
};

const INTENT_TIER: Record<OnboardingIntentKey, SubscriptionTierName> = {
  nutrition_barcode: "free",
  nutrition_photo_estimate: "premium",
  nutrition_mealprint: "premium_plus",
  training_three_workouts: "free",
  training_unlimited_workouts: "premium",
  training_loadout: "premium_plus",
};

const INTENT_REASON: Record<OnboardingIntentKey, string> = {
  nutrition_barcode: "Barcode nutrition logging",
  nutrition_photo_estimate: "Photo nutrition estimates",
  nutrition_mealprint: "Mealprint meal planning",
  training_three_workouts: "Up to three custom workouts",
  training_unlimited_workouts: "Unlimited workouts and history",
  training_loadout: "Loadout equipment-aware training",
};

function highestConsumerTier(
  intents: readonly OnboardingIntentKey[],
): SubscriptionTierName {
  let selected: SubscriptionTierName = "free";
  for (const intent of intents) {
    const candidate = INTENT_TIER[intent];
    if ((CONSUMER_RANK[candidate] ?? -1) > (CONSUMER_RANK[selected] ?? -1)) {
      selected = candidate;
    }
  }
  return selected;
}

function coachTier(
  band: CoachClientBand | null,
  intents: readonly OnboardingIntentKey[],
): SubscriptionTierName {
  if (band === "16_30") return "coach_pro";
  if (band === "6_15") return "coach";
  const wantsAdaptiveSuite = intents.some(
    (intent) =>
      intent === "nutrition_mealprint" || intent === "training_loadout",
  );
  return wantsAdaptiveSuite ? "start_up_coach_plus" : "individual_trainer";
}

function preserveCoveredCurrentTier(
  recommended: SubscriptionTierName,
  currentTier: SubscriptionTierName | null | undefined,
  path: OnboardingPath,
): SubscriptionTierName {
  if (!currentTier) return recommended;
  const ranks = path === "athlete" ? CONSUMER_RANK : COACH_RANK;
  const currentRank = ranks[currentTier];
  const recommendedRank = ranks[recommended];
  if (
    currentRank !== undefined &&
    recommendedRank !== undefined &&
    currentRank >= recommendedRank
  ) {
    return currentTier;
  }
  return recommended;
}

function resolveLiveTier(
  minimumTier: SubscriptionTierName,
  path: OnboardingPath,
  catalogue: readonly { tierName: SubscriptionTierName }[] | undefined,
): SubscriptionTierName {
  if (!catalogue) return minimumTier;
  const live = new Set(catalogue.map((tier) => tier.tierName));
  if (live.has(minimumTier)) return minimumTier;

  const ranks = path === "athlete" ? CONSUMER_RANK : COACH_RANK;
  const minimumRank = ranks[minimumTier] ?? 0;
  const next = Object.entries(ranks)
    .filter(
      ([tier, rank]) =>
        rank >= minimumRank && live.has(tier as SubscriptionTierName),
    )
    .sort((a, b) => a[1] - b[1])[0]?.[0] as SubscriptionTierName | undefined;

  // A temporarily incomplete catalogue must never recommend an unavailable
  // purchase. Free remains a valid completion path for athletes; coaches keep
  // the computed tier so the UI can show its existing store-unavailable state.
  return next ?? (path === "athlete" ? "free" : minimumTier);
}

export function recommendOnboardingPlan({
  path,
  coachClientBand,
  intentKeys,
  catalogue,
  currentTier,
}: {
  path: OnboardingPath;
  coachClientBand: CoachClientBand | null;
  intentKeys: readonly OnboardingIntentKey[];
  catalogue?: readonly { tierName: SubscriptionTierName }[];
  currentTier?: SubscriptionTierName | null;
}): OnboardingRecommendation {
  const requiredTier =
    path === "coach"
      ? coachTier(coachClientBand, intentKeys)
      : highestConsumerTier(intentKeys);
  const minimumTier = resolveLiveTier(requiredTier, path, catalogue);
  const tierName = preserveCoveredCurrentTier(minimumTier, currentTier, path);

  const reasons = intentKeys.map((intent) => INTENT_REASON[intent]);
  if (path === "coach") {
    reasons.unshift(
      coachClientBand === "16_30"
        ? "Support for up to 30 active clients"
        : coachClientBand === "6_15"
          ? "Support for up to 15 active clients"
          : "Support for up to 5 active clients",
    );
  }
  if (tierName === currentTier && tierName !== minimumTier) {
    reasons.unshift("Your current plan already covers these choices");
  }

  return { tierName, reasons };
}
