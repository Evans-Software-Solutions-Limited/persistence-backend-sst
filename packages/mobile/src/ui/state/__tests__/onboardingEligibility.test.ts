import { shouldAutoShowOnboarding } from "../onboardingEligibility";
import type { OnboardingState } from "@/domain/models/onboarding";

const state = (status: OnboardingState["status"]): OnboardingState => ({
  userId: "user-1",
  version: 1,
  currentPage: "welcome",
  completedPages: [],
  skippedPages: [],
  status,
  path: "athlete",
  coachClientBand: null,
  intentKeys: [],
  completedAt: status === "completed" ? "2026-09-01T10:00:00Z" : null,
  dismissedAt: status === "dismissed" ? "2026-09-01T10:00:00Z" : null,
  updatedAt: "2026-09-01T10:00:00Z",
});

describe("onboarding eligibility", () => {
  it("includes an existing user with no onboarding state", () => {
    expect(
      shouldAutoShowOnboarding({
        state: null,
      }),
    ).toBe(true);
  });

  it("resumes an existing in-progress journey", () => {
    expect(
      shouldAutoShowOnboarding({
        state: state("in_progress"),
      }),
    ).toBe(true);
  });

  it.each(["completed", "dismissed"] as const)(
    "does not replay a %s journey",
    (status) => {
      expect(
        shouldAutoShowOnboarding({
          state: state(status),
        }),
      ).toBe(false);
    },
  );
});
