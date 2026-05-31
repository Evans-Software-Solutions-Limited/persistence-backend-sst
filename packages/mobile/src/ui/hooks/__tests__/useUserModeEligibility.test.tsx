import { act, renderHook, waitFor } from "@testing-library/react-native";

import type { MySubscription } from "@/domain/models/subscription";

/**
 * useUserModeEligibility integration tests.
 *
 * Spec: specs/14-navigation/design.md § Eligibility wiring
 * Closes: specs/14-navigation/tasks.md T-14.2.3
 * Satisfies: specs/14-navigation/requirements.md STORY-003 AC 3.2, 3.3, 3.5
 */

// Drive the subscription cache by hand so each test controls the
// resolved/unresolved + trainer-tier branches.
type MockSubReturn = { data: Partial<MySubscription> | undefined };
const mockUseMySubscription = jest.fn<MockSubReturn, []>();
jest.mock("@/ui/hooks/useMySubscription", () => ({
  useMySubscription: () => mockUseMySubscription(),
}));

// eslint-disable-next-line import/first
import { useUserMode } from "@/state/user-mode";
// eslint-disable-next-line import/first
import { useUserModeEligibility } from "@/ui/hooks/useUserModeEligibility";

beforeEach(() => {
  useUserMode.setState({
    mode: "athlete",
    isTrainerEligible: false,
    isEligibilityKnown: false,
  });
  mockUseMySubscription.mockReset();
  mockUseMySubscription.mockReturnValue({ data: undefined });
});

describe("useUserModeEligibility", () => {
  it("rehydrates the persisted mode on mount", async () => {
    const rehydrate = jest.spyOn(useUserMode.getState(), "rehydrate");
    renderHook(() => useUserModeEligibility());
    await waitFor(() => expect(rehydrate).toHaveBeenCalled());
    rehydrate.mockRestore();
  });

  it("sets eligibility true once a trainer-tier subscription resolves", async () => {
    mockUseMySubscription.mockReturnValue({ data: { isTrainerTier: true } });
    renderHook(() => useUserModeEligibility());

    await waitFor(() =>
      expect(useUserMode.getState().isTrainerEligible).toBe(true),
    );
    expect(useUserMode.getState().isEligibilityKnown).toBe(true);
  });

  it("sets eligibility false for a resolved non-trainer subscription", async () => {
    mockUseMySubscription.mockReturnValue({ data: { isTrainerTier: false } });
    renderHook(() => useUserModeEligibility());

    await waitFor(() =>
      expect(useUserMode.getState().isEligibilityKnown).toBe(true),
    );
    expect(useUserMode.getState().isTrainerEligible).toBe(false);
  });

  it("leaves eligibility unknown while the subscription cache is unresolved", () => {
    mockUseMySubscription.mockReturnValue({ data: undefined });
    renderHook(() => useUserModeEligibility());

    expect(useUserMode.getState().isEligibilityKnown).toBe(false);
    expect(useUserMode.getState().isTrainerEligible).toBe(false);
  });

  it("treats a resolved subscription with missing isTrainerTier as not eligible", async () => {
    // `data` exists but isTrainerTier is absent (defensive ?? false branch).
    mockUseMySubscription.mockReturnValue({ data: { tierName: "premium" } });
    renderHook(() => useUserModeEligibility());

    await waitFor(() =>
      expect(useUserMode.getState().isEligibilityKnown).toBe(true),
    );
    expect(useUserMode.getState().isTrainerEligible).toBe(false);
  });

  it("watchdog demotes coach mode that was restored after eligibility is known-false", async () => {
    // Realistic cold-launch race: the subscription resolves non-trainer
    // FIRST (eligibility known + false), THEN rehydrate restores the
    // persisted coach mode. setEligibility already ran, so only the
    // watchdog can catch this — exercises the watchdog's switchTo path.
    mockUseMySubscription.mockReturnValue({ data: { isTrainerTier: false } });
    const { rerender } = renderHook(() => useUserModeEligibility());
    await waitFor(() =>
      expect(useUserMode.getState().isEligibilityKnown).toBe(true),
    );

    // rehydrate lands coach mode after eligibility was already known false.
    act(() => {
      useUserMode.setState({ mode: "coach" });
    });
    rerender({});

    await waitFor(() => expect(useUserMode.getState().mode).toBe("athlete"));
  });

  it("forces coach → athlete when a trainer downgrades (isTrainerTier true → false)", async () => {
    // Start: trainer in coach mode.
    mockUseMySubscription.mockReturnValue({ data: { isTrainerTier: true } });
    const { rerender } = renderHook(() => useUserModeEligibility());
    await waitFor(() =>
      expect(useUserMode.getState().isTrainerEligible).toBe(true),
    );
    // Simulate the user having switched into coach mode.
    act(() => {
      useUserMode.setState({ mode: "coach" });
    });

    // Downgrade: subscription cache flips to non-trainer.
    mockUseMySubscription.mockReturnValue({ data: { isTrainerTier: false } });
    rerender({});

    await waitFor(() => expect(useUserMode.getState().mode).toBe("athlete"));
    expect(useUserMode.getState().isTrainerEligible).toBe(false);
  });

  it("does not demote a legitimate trainer before the network resolves", async () => {
    // Cold-launch order: rehydrate restored coach mode, but the
    // subscription cache hasn't resolved yet (data undefined). The
    // watchdog must NOT fire because eligibility is still unknown.
    useUserMode.setState({ mode: "coach" });
    mockUseMySubscription.mockReturnValue({ data: undefined });

    renderHook(() => useUserModeEligibility());
    // Give effects a chance to run.
    await Promise.resolve();

    expect(useUserMode.getState().mode).toBe("coach");
  });
});
