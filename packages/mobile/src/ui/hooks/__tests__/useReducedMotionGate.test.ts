import { renderHook } from "@testing-library/react-native";

// Per-file override of the global reanimated mock so we can flip the OS
// reduce-motion signal. `mock`-prefixed name satisfies jest's factory hoisting.
let mockReduced = false;
jest.mock("react-native-reanimated", () => ({
  useReducedMotion: () => mockReduced,
}));

import { useReducedMotionGate } from "../useReducedMotionGate";

describe("useReducedMotionGate", () => {
  afterEach(() => {
    mockReduced = false;
  });

  it("returns full-motion budgets when reduce-motion is OFF", () => {
    mockReduced = false;
    const { result } = renderHook(() => useReducedMotionGate());
    expect(result.current).toEqual({
      reduced: false,
      ringFillMs: 800,
      barFillMs: 600,
      sheetAnimation: "slide",
      pulseDots: true,
      tabAccentMs: 200,
    });
  });

  it("zeroes every duration and snaps sheets when reduce-motion is ON", () => {
    mockReduced = true;
    const { result } = renderHook(() => useReducedMotionGate());
    expect(result.current).toEqual({
      reduced: true,
      ringFillMs: 0,
      barFillMs: 0,
      sheetAnimation: "snap",
      pulseDots: false,
      tabAccentMs: 0,
    });
  });
});
