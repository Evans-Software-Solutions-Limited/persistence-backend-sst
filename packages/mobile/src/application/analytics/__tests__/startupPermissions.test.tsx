import { act, renderHook } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, Platform, type AppStateStatus } from "react-native";
import {
  getTrackingPermissionsAsync,
  requestTrackingPermissionsAsync,
} from "expo-tracking-transparency";
import { Settings } from "react-native-fbsdk-next";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { ExpoNotificationsAdapter } from "@/adapters/notifications/expo-notifications.adapter";
import * as Notifications from "expo-notifications";
import { useNotificationPermissions } from "@/ui/hooks/useNotificationPermissions";
import { useMetaAttribution } from "@/ui/hooks/useMetaAttribution";
import {
  grantMetaAttributionConsent,
  denyMetaAttributionConsent,
  getMetaAttributionConsent,
  resetMetaAttributionForTests,
} from "@/application/analytics/metaAttribution";

jest.mock("@/ui/hooks/useAdapters", () => ({ useAdapters: jest.fn() }));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { metaConfigured: true } } },
}));
jest.mock("expo-tracking-transparency", () => ({
  getTrackingPermissionsAsync: jest.fn(),
  requestTrackingPermissionsAsync: jest.fn(),
}));

jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
}));

const key = "persistence.meta-attribution-consent.v1";
const undetermined = {
  granted: false,
  status: "undetermined",
  canAskAgain: true,
};
let listeners: Set<(state: AppStateStatus) => void>;
let stored: Map<string, string>;
const originalState = AppState.currentState;
const originalOS = Platform.OS;

function become(state: AppStateStatus) {
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    value: state,
  });
  [...listeners].forEach((listener) => listener(state));
}

beforeEach(async () => {
  jest.restoreAllMocks();
  jest.useFakeTimers();
  jest.clearAllMocks();
  resetMetaAttributionForTests();
  stored = new Map();
  (AsyncStorage.getItem as jest.Mock).mockImplementation(
    async (name: string) => stored.get(name) ?? null,
  );
  (AsyncStorage.setItem as jest.Mock).mockImplementation(
    async (name: string, value: string) => {
      stored.set(name, value);
    },
  );
  (AsyncStorage.removeItem as jest.Mock).mockImplementation(
    async (name: string) => {
      stored.delete(name);
    },
  );
  listeners = new Set();
  Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  become("active");
  jest
    .spyOn(AppState, "addEventListener")
    .mockImplementation((_event, listener) => {
      listeners.add(listener);
      return {
        remove: () => {
          listeners.delete(listener);
        },
      };
    });
  (getTrackingPermissionsAsync as jest.Mock).mockResolvedValue(undetermined);
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({
    status: "undetermined",
  });
  (requestTrackingPermissionsAsync as jest.Mock).mockResolvedValue(
    undetermined,
  );
});

afterEach(async () => {
  resetMetaAttributionForTests();
  await act(async () => {
    await jest.runOnlyPendingTimersAsync();
  });
  Object.defineProperty(AppState, "currentState", {
    configurable: true,
    value: originalState,
  });
  Object.defineProperty(Platform, "OS", {
    configurable: true,
    value: originalOS,
  });
  jest.restoreAllMocks();
  jest.useRealTimers();
});

async function advance(ms = 500) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

it("serializes real notification and ATT startup paths, then recovers a suppressed ATT request", async () => {
  let finishNotifications!: (result: unknown) => void;
  let releaseConsentRead!: (value: null) => void;
  let consentReadPending = true;
  (AsyncStorage.getItem as jest.Mock).mockImplementation((name: string) =>
    name === key && consentReadPending
      ? new Promise((resolve) => {
          releaseConsentRead = resolve;
        })
      : Promise.resolve(stored.get(name) ?? null),
  );
  (Notifications.requestPermissionsAsync as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishNotifications = resolve;
      }),
  );
  (useAdapters as jest.Mock).mockReturnValue({
    notifications: new ExpoNotificationsAdapter(),
  });
  (requestTrackingPermissionsAsync as jest.Mock)
    .mockResolvedValueOnce(undetermined)
    .mockResolvedValueOnce({ status: "granted", granted: true });
  const hook = renderHook(() => {
    useNotificationPermissions(true);
    useMetaAttribution();
  });
  await advance();
  expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  await act(async () => {
    consentReadPending = false;
    releaseConsentRead(null);
  });
  await advance();
  expect(requestTrackingPermissionsAsync).not.toHaveBeenCalled();
  expect(Settings.initializeSDK).not.toHaveBeenCalled();
  await act(async () => {
    become("inactive");
    finishNotifications({ status: "granted" });
  });
  await advance();
  expect(requestTrackingPermissionsAsync).not.toHaveBeenCalled();
  await act(async () => {
    become("active");
  });
  await advance(300);
  expect(requestTrackingPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(Settings.initializeSDK).not.toHaveBeenCalled();
  await advance(300);
  expect(requestTrackingPermissionsAsync).toHaveBeenCalledTimes(2);
  expect(Settings.initializeSDK).toHaveBeenCalledTimes(1);
  expect(await getMetaAttributionConsent()).toBe("granted");
  hook.unmount();
});

it("bounds unanswered ATT retries to three and leaves tracking disabled", async () => {
  const hook = renderHook(() => useMetaAttribution());
  await advance(1500);
  expect(requestTrackingPermissionsAsync).toHaveBeenCalledTimes(3);
  expect(await getMetaAttributionConsent()).toBe("unknown");
  await act(async () => {
    become("inactive");
    become("active");
  });
  await advance(1500);
  expect(requestTrackingPermissionsAsync).toHaveBeenCalledTimes(3);
  expect(Settings.initializeSDK).not.toHaveBeenCalled();
  hook.unmount();
});

it("leaves a native exception retryable on the next mount instead of persisting denial", async () => {
  (requestTrackingPermissionsAsync as jest.Mock).mockRejectedValueOnce(
    new Error("native request failed"),
  );
  const first = renderHook(() => useMetaAttribution());
  await advance();
  expect(await getMetaAttributionConsent()).toBe("unknown");
  expect(Settings.initializeSDK).not.toHaveBeenCalled();
  first.unmount();
  resetMetaAttributionForTests();
  (requestTrackingPermissionsAsync as jest.Mock).mockResolvedValueOnce({
    status: "granted",
    granted: true,
  });
  const next = renderHook(() => useMetaAttribution());
  await advance();
  expect(await getMetaAttributionConsent()).toBe("granted");
  expect(requestTrackingPermissionsAsync).toHaveBeenCalledTimes(2);
  expect(Settings.initializeSDK).toHaveBeenCalledTimes(1);
  next.unmount();
});

it("waits for active state when restoring a saved grant", async () => {
  await AsyncStorage.setItem(key, "granted");
  become("inactive");
  (requestTrackingPermissionsAsync as jest.Mock).mockResolvedValueOnce({
    status: "granted",
    granted: true,
  });
  const hook = renderHook(() => useMetaAttribution());
  await advance();
  expect(requestTrackingPermissionsAsync).not.toHaveBeenCalled();
  await act(async () => {
    become("active");
  });
  await advance();
  expect(requestTrackingPermissionsAsync).toHaveBeenCalledTimes(1);
  expect(Settings.initializeSDK).toHaveBeenCalledTimes(1);
  hook.unmount();
});

it("withdraws promptly while a grant is waiting for foreground, without presenting ATT later", async () => {
  become("background");
  const grant = grantMetaAttributionConsent();
  await advance();
  await expect(denyMetaAttributionConsent()).resolves.toBe(true);
  await expect(grant).resolves.toBe("failed");
  await act(async () => {
    become("active");
  });
  await advance();
  expect(requestTrackingPermissionsAsync).not.toHaveBeenCalled();
  expect(Settings.initializeSDK).not.toHaveBeenCalled();
  expect(await getMetaAttributionConsent()).toBe("denied");
});
