import type { OnboardingState } from "@/domain/models/onboarding";

export type OnboardingRolloutConfig = {
  enabled: boolean;
  activatedAt: string | null;
};

export function onboardingRolloutFromEnv(
  enabled = process.env.EXPO_PUBLIC_ONBOARDING_V1_ENABLED,
  activatedAt = process.env.EXPO_PUBLIC_ONBOARDING_V1_ACTIVATED_AT,
): OnboardingRolloutConfig {
  const parsed = activatedAt ? Date.parse(activatedAt) : Number.NaN;
  return {
    // Explicit opt-in. Missing/malformed production configuration is safe-off.
    enabled: enabled === "true" && Number.isFinite(parsed),
    activatedAt: Number.isFinite(parsed)
      ? new Date(parsed).toISOString()
      : null,
  };
}

export function shouldAutoShowOnboarding({
  createdAt,
  state,
  rollout = onboardingRolloutFromEnv(),
}: {
  createdAt: string | null | undefined;
  state: OnboardingState | null;
  rollout?: OnboardingRolloutConfig;
}): boolean {
  if (!rollout.enabled || rollout.activatedAt === null || !createdAt) {
    return false;
  }
  const created = Date.parse(createdAt);
  const activation = Date.parse(rollout.activatedAt);
  if (!Number.isFinite(created) || created < activation) return false;
  return state === null || state.status === "in_progress";
}
