import type { OnboardingState } from "@/domain/models/onboarding";

export function shouldAutoShowOnboarding({
  state,
}: {
  state: OnboardingState | null;
}): boolean {
  return state === null || state.status === "in_progress";
}
