import AsyncStorage from "@react-native-async-storage/async-storage";

import { useUserMode } from "../user-mode";

/**
 * useUserMode slice tests.
 *
 * Spec: specs/14-navigation/design.md § Testing strategy > useUserMode slice
 * Closes: specs/14-navigation/requirements.md STORY-009 AC 9.1
 */

const mockGetItem = AsyncStorage.getItem as jest.Mock;
const mockSetItem = AsyncStorage.setItem as jest.Mock;

// Reset the singleton store + the AsyncStorage mock before each test so the
// slices are exercised from their documented default state.
beforeEach(() => {
  useUserMode.setState({
    mode: "athlete",
    isTrainerEligible: false,
    isEligibilityKnown: false,
  });
  mockGetItem.mockReset();
  mockSetItem.mockReset();
  mockGetItem.mockResolvedValue(null);
  mockSetItem.mockResolvedValue(undefined);
});

describe("useUserMode", () => {
  it("defaults to athlete mode, not eligible, eligibility unknown", () => {
    const s = useUserMode.getState();
    expect(s.mode).toBe("athlete");
    expect(s.isTrainerEligible).toBe(false);
    expect(s.isEligibilityKnown).toBe(false);
  });

  it("switchTo('coach') updates mode + persists when eligible", async () => {
    useUserMode.setState({ isTrainerEligible: true });
    await useUserMode.getState().switchTo("coach");

    expect(useUserMode.getState().mode).toBe("coach");
    expect(mockSetItem).toHaveBeenCalledWith("persistence.userMode", "coach");
  });

  it("switchTo('coach') is a no-op + warns when not eligible", async () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    await useUserMode.getState().switchTo("coach");

    expect(useUserMode.getState().mode).toBe("athlete");
    expect(mockSetItem).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("switchTo(coach) called when not eligible"),
    );
    warn.mockRestore();
  });

  it("switchTo('athlete') always succeeds + persists", async () => {
    useUserMode.setState({ isTrainerEligible: true, mode: "coach" });
    await useUserMode.getState().switchTo("athlete");

    expect(useUserMode.getState().mode).toBe("athlete");
    expect(mockSetItem).toHaveBeenCalledWith("persistence.userMode", "athlete");
  });

  it("setEligibility(true) records eligibility + marks it known", () => {
    useUserMode.getState().setEligibility(true);
    const s = useUserMode.getState();
    expect(s.isTrainerEligible).toBe(true);
    expect(s.isEligibilityKnown).toBe(true);
  });

  it("setEligibility(false) while in coach mode forces fall-back to athlete", () => {
    useUserMode.setState({ isTrainerEligible: true, mode: "coach" });
    useUserMode.getState().setEligibility(false);

    const s = useUserMode.getState();
    expect(s.mode).toBe("athlete");
    expect(s.isTrainerEligible).toBe(false);
    expect(mockSetItem).toHaveBeenCalledWith("persistence.userMode", "athlete");
  });

  it("setEligibility(false) while already in athlete mode does not persist", () => {
    useUserMode.getState().setEligibility(false);

    expect(useUserMode.getState().mode).toBe("athlete");
    expect(mockSetItem).not.toHaveBeenCalled();
  });

  it("setEligibility forced fall-back swallows a failed persist", async () => {
    // The forced athlete write is fire-and-forget with a .catch; a rejected
    // setItem must not throw out of the synchronous setEligibility call.
    useUserMode.setState({ isTrainerEligible: true, mode: "coach" });
    mockSetItem.mockRejectedValueOnce(new Error("disk gone"));

    expect(() => useUserMode.getState().setEligibility(false)).not.toThrow();
    expect(useUserMode.getState().mode).toBe("athlete");
    // Let the rejected promise settle so the .catch handler runs.
    await Promise.resolve();
  });

  it("rehydrate restores a valid persisted mode", async () => {
    mockGetItem.mockResolvedValueOnce("coach");
    await useUserMode.getState().rehydrate();

    expect(useUserMode.getState().mode).toBe("coach");
  });

  it("rehydrate ignores an invalid persisted value, keeping the default", async () => {
    mockGetItem.mockResolvedValueOnce("nonsense");
    await useUserMode.getState().rehydrate();

    expect(useUserMode.getState().mode).toBe("athlete");
  });

  it("rehydrate keeps the default when nothing is persisted", async () => {
    mockGetItem.mockResolvedValueOnce(null);
    await useUserMode.getState().rehydrate();

    expect(useUserMode.getState().mode).toBe("athlete");
  });

  it("rehydrate does NOT consult eligibility (restores coach even when not yet eligible)", async () => {
    // Cold-launch race: persisted mode resolves before the subscription
    // network call, so isTrainerEligible is still the default false. The
    // slice must restore coach verbatim and let the watchdog enforce later.
    mockGetItem.mockResolvedValueOnce("coach");
    await useUserMode.getState().rehydrate();

    expect(useUserMode.getState().mode).toBe("coach");
    expect(useUserMode.getState().isTrainerEligible).toBe(false);
  });

  it("rehydrate swallows AsyncStorage errors + keeps the default", async () => {
    const warn = jest
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    mockGetItem.mockRejectedValueOnce(new Error("disk gone"));
    await useUserMode.getState().rehydrate();

    expect(useUserMode.getState().mode).toBe("athlete");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("rehydrate failed"),
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
