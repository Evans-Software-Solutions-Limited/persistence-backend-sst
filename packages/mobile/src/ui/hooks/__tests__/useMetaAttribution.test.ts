import { renderHook, waitFor } from "@testing-library/react-native";
import { Alert, AppState, Platform } from "react-native";
import {
  bootstrapMetaAttribution,
  grantMetaAttributionConsent,
  isMetaAttributionConfigured,
} from "@/application/analytics/metaAttribution";
import { useMetaAttribution } from "../useMetaAttribution";

jest.mock("@/application/analytics/metaAttribution", () => ({
  bootstrapMetaAttribution: jest.fn(),
  grantMetaAttributionConsent: jest.fn(async () => true),
  isMetaAttributionConfigured: jest.fn(),
}));

/** Drives AppState so the "must be active" rule can be exercised. */
function mockAppState(initial: "active" | "inactive" | "background") {
  const listeners: Array<(s: string) => void> = [];
  const remove = jest.fn();
  const originalState = AppState.currentState;
  Object.defineProperty(AppState, "currentState", {
    value: initial,
    configurable: true,
    writable: true,
  });
  restoreAppState = () => {
    Object.defineProperty(AppState, "currentState", {
      value: originalState,
      configurable: true,
      writable: true,
    });
  };
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event: string, handler: (s: never) => void) => {
      const listener = handler as (s: string) => void;
      listeners.push(listener);
      // Real RN detaches on remove(); a mock that does not would let a
      // handler fire after removal and hide double-invocation bugs.
      return {
        remove: () => {
          remove();
          const at = listeners.indexOf(listener);
          if (at >= 0) listeners.splice(at, 1);
        },
      } as never;
    });
  return {
    remove,
    // Snapshot before dispatch: iterating the live array means a handler that
    // removes itself also prevents its own second invocation, which would let
    // the once-guard in the hook be deleted with every test still passing.
    become: (state: string) => [...listeners].forEach((l) => l(state)),
    // Deliver one state change to every listener registered at THIS moment,
    // twice, without honouring removal in between — the only way to exercise
    // the hook's own idempotency rather than AppState's removal semantics.
    becomeTwiceIgnoringRemoval: (state: string) => {
      const snapshot = [...listeners];
      snapshot.forEach((l) => l(state));
      snapshot.forEach((l) => l(state));
    },
    listenerCount: () => listeners.length,
  };
}

let restoreAppState: (() => void) | undefined;

describe("useMetaAttribution", () => {
  afterEach(() => {
    // defineProperty is not undone by restoreAllMocks — leaking currentState
    // across tests would make later ones pass for the wrong reason.
    restoreAppState?.();
    restoreAppState = undefined;
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    (bootstrapMetaAttribution as jest.Mock).mockResolvedValue("unknown");
    (isMetaAttributionConfigured as jest.Mock).mockReturnValue(true);
    (grantMetaAttributionConsent as jest.Mock).mockResolvedValue(true);
    jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  });

  // The reason build 49 was rejected under Guideline 5.1.2(i): a custom
  // Alert asked for tracking permission before ATT, and declining it meant
  // ATT never ran. No app-authored prompt may exist on this path.
  it("shows no app-authored prompt and goes straight to the system ATT request", async () => {
    const appState = mockAppState("active");
    renderHook(() => useMetaAttribution());

    await waitFor(() =>
      expect(grantMetaAttributionConsent).toHaveBeenCalledTimes(1),
    );
    expect(Alert.alert).not.toHaveBeenCalled();
    // Already active: nothing should be subscribed at all.
    expect(appState.listenerCount()).toBe(0);
  });

  // ATT presents nothing unless the app is active, and resolves the status
  // unchanged — which would silently burn the single chance to ask.
  it("waits for the app to become active before requesting", async () => {
    const appState = mockAppState("inactive");
    renderHook(() => useMetaAttribution());

    await waitFor(() => expect(appState.listenerCount()).toBe(1));
    expect(grantMetaAttributionConsent).not.toHaveBeenCalled();

    appState.become("background");
    expect(grantMetaAttributionConsent).not.toHaveBeenCalled();

    appState.become("active");
    expect(grantMetaAttributionConsent).toHaveBeenCalledTimes(1);
    expect(appState.remove).toHaveBeenCalled();
  });

  it("requests only once even when two active events land before removal", async () => {
    const appState = mockAppState("inactive");
    renderHook(() => useMetaAttribution());

    await waitFor(() => expect(appState.listenerCount()).toBe(1));
    // Deliberately ignores the handler's self-removal, so the hook's own
    // `requested` guard is the ONLY thing that can prevent a second request.
    // Delete that guard and this test fails.
    appState.becomeTwiceIgnoringRemoval("active");

    expect(grantMetaAttributionConsent).toHaveBeenCalledTimes(1);
  });

  it.each(["granted", "denied"])(
    "never re-asks when consent is already %s",
    async (consent) => {
      const appState = mockAppState("active");
      (bootstrapMetaAttribution as jest.Mock).mockResolvedValue(consent);
      renderHook(() => useMetaAttribution());

      await waitFor(() =>
        expect(bootstrapMetaAttribution).toHaveBeenCalledTimes(1),
      );
      expect(grantMetaAttributionConsent).not.toHaveBeenCalled();
      expect(appState.listenerCount()).toBe(0);
      expect(Alert.alert).not.toHaveBeenCalled();
    },
  );

  it("is silent when Meta native configuration is absent", async () => {
    mockAppState("active");
    (isMetaAttributionConfigured as jest.Mock).mockReturnValue(false);
    renderHook(() => useMetaAttribution());

    await waitFor(() =>
      expect(bootstrapMetaAttribution).toHaveBeenCalledTimes(1),
    );
    expect(grantMetaAttributionConsent).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it("does not request after unmount, and detaches its listener", async () => {
    const appState = mockAppState("inactive");
    const { unmount } = renderHook(() => useMetaAttribution());

    await waitFor(() => expect(appState.listenerCount()).toBe(1));
    unmount();
    expect(appState.remove).toHaveBeenCalled();

    appState.become("active");
    expect(grantMetaAttributionConsent).not.toHaveBeenCalled();
  });

  // Regression guard. Removing the custom alert made ATT the consent
  // mechanism — but `activateMetaAttribution()` has NO permission gate on
  // Android, so auto-requesting there would enable Meta measurement with no
  // consent at all. Android must opt in from Privacy Settings only.
  it("never auto-enables on Android, where there is no ATT to consent through", async () => {
    const appState = mockAppState("active");
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "android",
    });

    renderHook(() => useMetaAttribution());

    await waitFor(() =>
      expect(bootstrapMetaAttribution).toHaveBeenCalledTimes(1),
    );
    expect(grantMetaAttributionConsent).not.toHaveBeenCalled();
    expect(appState.listenerCount()).toBe(0);
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
