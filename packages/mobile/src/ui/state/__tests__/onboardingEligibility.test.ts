import {
  onboardingRolloutFromEnv,
  shouldAutoShowOnboarding,
} from "../onboardingEligibility";
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

describe("onboarding rollout eligibility", () => {
  const rollout = { enabled: true, activatedAt: "2026-09-01T00:00:00.000Z" };

  it("defaults safely off when the flag or activation timestamp is absent", () => {
    expect(onboardingRolloutFromEnv(undefined, undefined)).toEqual({
      enabled: false,
      activatedAt: null,
    });
    expect(onboardingRolloutFromEnv("true", "not-a-date").enabled).toBe(false);
  });

  it("includes a user created exactly at activation", () => {
    expect(
      shouldAutoShowOnboarding({
        createdAt: "2026-09-01T00:00:00.000Z",
        state: state("in_progress"),
        rollout,
      }),
    ).toBe(true);
  });

  it("does not backfill users created before activation", () => {
    expect(
      shouldAutoShowOnboarding({
        createdAt: "2026-08-31T23:59:59.999Z",
        state: null,
        rollout,
      }),
    ).toBe(false);
  });

  it.each(["completed", "dismissed"] as const)(
    "does not replay a %s journey",
    (status) => {
      expect(
        shouldAutoShowOnboarding({
          createdAt: "2026-09-01T00:00:01.000Z",
          state: state(status),
          rollout,
        }),
      ).toBe(false);
    },
  );
});
