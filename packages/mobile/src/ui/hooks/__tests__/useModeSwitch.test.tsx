import { act, renderHook } from "@testing-library/react-native";

/**
 * useModeSwitch tests.
 *
 * Spec: specs/14-navigation/design.md § Mode-switch animation
 * Closes: specs/14-navigation/tasks.md T-14.6.1, T-14.6.3
 * Satisfies: specs/14-navigation/requirements.md STORY-003 AC 3.7
 */

const mockNavigate = jest.fn();
jest.mock("expo-router", () => ({
  router: { navigate: (...args: unknown[]) => mockNavigate(...args) },
}));

// eslint-disable-next-line import/first
import { useDrawer } from "@/state/drawer";
// eslint-disable-next-line import/first
import { useUserMode } from "@/state/user-mode";
// eslint-disable-next-line import/first
import { equivalentTab, useModeSwitch } from "@/ui/hooks/useModeSwitch";

beforeEach(() => {
  mockNavigate.mockReset();
  useDrawer.setState({ open: true });
  useUserMode.setState({
    mode: "athlete",
    isTrainerEligible: true,
    isEligibilityKnown: true,
  });
});

describe("equivalentTab", () => {
  it("maps athlete tabs to their coach equivalents", () => {
    expect(equivalentTab("index", "coach")).toBe("index");
    expect(equivalentTab("train", "coach")).toBe("clients");
    expect(equivalentTab("fuel", "coach")).toBe("programs");
    expect(equivalentTab("you", "coach")).toBe("you");
  });

  it("maps coach tabs to their athlete equivalents", () => {
    expect(equivalentTab("index", "athlete")).toBe("index");
    expect(equivalentTab("clients", "athlete")).toBe("train");
    expect(equivalentTab("programs", "athlete")).toBe("fuel");
    expect(equivalentTab("you", "athlete")).toBe("you");
  });

  it("falls back to Home (index) for an unmapped route", () => {
    expect(equivalentTab("session", "coach")).toBe("index");
    expect(equivalentTab("whatever", "athlete")).toBe("index");
  });
});

describe("useModeSwitch", () => {
  it("switching to coach: closes drawer, sets mode, navigates to the equivalent tab", async () => {
    const { result } = renderHook(() => useModeSwitch());

    await act(async () => {
      await result.current.switchMode("coach", "train");
    });

    expect(useDrawer.getState().open).toBe(false);
    expect(useUserMode.getState().mode).toBe("coach");
    expect(mockNavigate).toHaveBeenCalledWith("/(app)/(tabs)/clients");
  });

  it("switching to athlete from a coach-only tab lands on its equivalent", async () => {
    useUserMode.setState({ mode: "coach" });
    const { result } = renderHook(() => useModeSwitch());

    await act(async () => {
      await result.current.switchMode("athlete", "programs");
    });

    expect(useUserMode.getState().mode).toBe("athlete");
    expect(mockNavigate).toHaveBeenCalledWith("/(app)/(tabs)/fuel");
  });

  it("defaults the active route to the tabs index (directory route) when none is supplied", async () => {
    const { result } = renderHook(() => useModeSwitch());

    await act(async () => {
      await result.current.switchMode("coach");
    });

    // The shared "index" tab resolves to the tabs directory route, not a
    // `/index` child (Expo Router convention; matches AuthGate / Success).
    expect(mockNavigate).toHaveBeenCalledWith("/(app)/(tabs)");
  });

  it("ineligible coach switch is a no-op: drawer stays, no navigation", async () => {
    useUserMode.setState({ isTrainerEligible: false });
    const { result } = renderHook(() => useModeSwitch());

    await act(async () => {
      await result.current.switchMode("coach", "train");
    });

    expect(useUserMode.getState().mode).toBe("athlete");
    expect(useDrawer.getState().open).toBe(true);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
