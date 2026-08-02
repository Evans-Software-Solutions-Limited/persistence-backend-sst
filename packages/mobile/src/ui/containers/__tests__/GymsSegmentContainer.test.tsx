import React from "react";
import { act, fireEvent } from "@testing-library/react-native";
import { GymsSegmentContainer } from "@/ui/containers/GymsSegmentContainer";
import { renderWithTheme } from "../../../../__tests__/test-utils";

jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: jest.fn(), back: jest.fn() },
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

const mockGate = jest.fn();
jest.mock("@/ui/hooks/useLoadoutGate", () => ({
  __esModule: true,
  useLoadoutGate: () => mockGate(),
}));

/**
 * `SavedGymsContainer` is stubbed so "did the real list mount?" is a single
 * assertion rather than a whole adapter harness — and so the NOT-mounted case is
 * provable, which is the half that matters. Design § 5.2 forbids a preview of
 * real output, and `useSavedGyms` fetches on mount, so not mounting is the
 * enforcement: if this stub renders for an unentitled user, that user's device
 * issued `GET /saved-gyms`.
 */
const mockSavedGymsMounted = jest.fn();
jest.mock("@/ui/containers/SavedGymsContainer", () => {
  const { Text } = require("react-native");
  const React_ = require("react");
  return {
    __esModule: true,
    SavedGymsContainer: () => {
      mockSavedGymsMounted();
      return React_.createElement(Text, { testID: "saved-gyms-stub" }, "list");
    },
  };
});

const onUpgrade = jest.fn();

function gate(overrides: { allowed?: boolean; isResolved?: boolean } = {}) {
  mockGate.mockReturnValue({
    allowed: overrides.allowed ?? false,
    isResolved: overrides.isResolved ?? true,
    upgradePriceMonthly: null,
    onUpgrade,
  });
}

describe("GymsSegmentContainer", () => {
  beforeEach(() => jest.clearAllMocks());

  /**
   * ⚠ The state the gate's boolean does NOT have, and the reason this container
   * exists. `computeLoadoutVerdict` denies a null subscription by design, so
   * during the cold-start `/subscriptions/me` round trip a paying Premium+ user
   * is indistinguishable from a free one. `WorkoutDetailContainer` handles that
   * by doing nothing on tap; a TAB has no tap to swallow, so an unguarded
   * segment would show the paywall to a subscriber on every single cold launch.
   */
  it("shows a pending state, NOT the upsell, while the entitlement resolves", () => {
    gate({ allowed: false, isResolved: false });
    const { getByTestId, queryByTestId } = renderWithTheme(
      <GymsSegmentContainer />,
    );

    getByTestId("gyms-segment-pending");
    expect(queryByTestId("gyms-locked")).toBeNull();
    expect(queryByTestId("saved-gyms-stub")).toBeNull();
  });

  it("pitches when locked and never mounts the list", () => {
    gate({ allowed: false, isResolved: true });
    const { getByTestId, queryByTestId } = renderWithTheme(
      <GymsSegmentContainer />,
    );

    getByTestId("gyms-locked");
    // Not "rendered and hidden" — never mounted, so no `GET /saved-gyms`.
    expect(queryByTestId("saved-gyms-stub")).toBeNull();
    expect(mockSavedGymsMounted).not.toHaveBeenCalled();
  });

  it("offers no way to create or manage a gym when locked — locked is not a taster", () => {
    gate({ allowed: false, isResolved: true });
    const { queryByTestId } = renderWithTheme(<GymsSegmentContainer />);

    expect(queryByTestId("saved-gyms-create")).toBeNull();
    expect(queryByTestId("saved-gyms-empty")).toBeNull();
    expect(queryByTestId("saved-gym-new-editor")).toBeNull();
  });

  /**
   * ⚠ `isResolved` covers a REJECTED query but not a HUNG one:
   * `getMySubscription` has no client-side timeout, and a half-open socket never
   * rejects, so React Query's retry never fires either. Unguarded that spins this
   * tab forever — and because the segment persists to disk, an entitled user
   * whose last segment was Gyms lands back on the frozen spinner every relaunch.
   */
  it("offers a retry once the entitlement check has plainly hung", () => {
    jest.useFakeTimers();
    try {
      gate({ allowed: false, isResolved: false });
      const { getByTestId, queryByTestId } = renderWithTheme(
        <GymsSegmentContainer />,
      );

      getByTestId("gyms-segment-pending");
      act(() => {
        jest.advanceTimersByTime(8000);
      });

      getByTestId("gyms-segment-stalled");
      getByTestId("gyms-segment-retry");
      // ⚠ NOT the upsell. Falling through to locked on a network hang would be
      // the exact mistake the pending state exists to prevent.
      expect(queryByTestId("gyms-locked")).toBeNull();
      expect(mockSavedGymsMounted).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it("does not stall when the check resolves inside the window", () => {
    jest.useFakeTimers();
    try {
      gate({ allowed: true, isResolved: true });
      const { getByTestId, queryByTestId } = renderWithTheme(
        <GymsSegmentContainer />,
      );
      act(() => {
        jest.advanceTimersByTime(30_000);
      });
      getByTestId("saved-gyms-stub");
      expect(queryByTestId("gyms-segment-stalled")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("routes a locked user to the paywall", () => {
    gate({ allowed: false, isResolved: true });
    const { getByTestId } = renderWithTheme(<GymsSegmentContainer />);

    fireEvent.press(getByTestId("gyms-locked-upgrade"));
    expect(onUpgrade).toHaveBeenCalled();
  });

  it("mounts the real list once entitled", () => {
    gate({ allowed: true, isResolved: true });
    const { getByTestId, queryByTestId } = renderWithTheme(
      <GymsSegmentContainer />,
    );

    getByTestId("saved-gyms-stub");
    expect(queryByTestId("gyms-locked")).toBeNull();
    expect(queryByTestId("gyms-segment-pending")).toBeNull();
  });
});
