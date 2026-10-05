import React from "react";
import {
  Text,
  Platform,
  AppState,
  Linking,
  type AppStateStatus,
} from "react-native";
import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { renderWithTheme } from "../../../../__tests__/test-utils";
import { AppUpdateGate } from "../AppUpdateGate";
import { readPolicy, fetchPolicy } from "@/adapters/appUpdate/loadPolicy";
import { RequiredUpdatePresenter } from "../../presenters/RequiredUpdatePresenter";
let mockNative: Record<string, unknown>;
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    expoConfig: {
      version: "99.0.0",
      ios: { bundleIdentifier: "com.bradleyevans96.persistence" },
      android: { package: "com.bradleyevans96.persistence" },
    },
  },
}));
jest.mock("expo", () => ({
  requireOptionalNativeModule: (key: string) => mockNative[key] ?? null,
}));
jest.mock("@/adapters/api", () => ({ getApiBaseUrl: () => "https://stage" }));
jest.mock("@/adapters/appUpdate/loadPolicy", () => ({
  readPolicy: jest.fn(),
  fetchPolicy: jest.fn(),
}));
jest.mock("@/ui/theme", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/ui/components/PLogoDrawLoader", () => ({
  PLogoDrawLoader: () => {
    const { Text } = jest.requireActual("react-native");
    return <Text>Checking app</Text>;
  },
}));
const initialDev = __DEV__,
  initialOS = Platform.OS;
const policy = { iosMinimumVersion: "1.1.3", androidMinimumVersion: "1.1.3" };
let foreground: (state: AppStateStatus) => void;
let remove: jest.Mock;
const show = () =>
  renderWithTheme(
    <AppUpdateGate>
      <Text>Private workout</Text>
    </AppUpdateGate>,
  );
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(global, { __DEV__: false });
  Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
  mockNative = {
    ExpoApplication: {
      nativeApplicationVersion: "1.1.3",
      applicationId: "com.bradleyevans96.persistence",
    },
    TogetherLan: {},
    TogetherNearby: {},
  };
  jest.mocked(readPolicy).mockResolvedValue(null);
  jest.mocked(fetchPolicy).mockResolvedValue(policy);
  remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, fn) => {
    foreground = fn;
    return { remove };
  });
  jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
});
afterEach(() => {
  Object.assign(global, { __DEV__: initialDev });
  Object.defineProperty(Platform, "OS", {
    value: initialOS,
    configurable: true,
  });
  jest.restoreAllMocks();
  jest.useRealTimers();
});
it("withholds application bootstrap until the release policy resolves, then allows a compatible native binary", async () => {
  let finish!: (x: typeof policy) => void;
  jest.mocked(fetchPolicy).mockReturnValue(
    new Promise((r) => {
      finish = r;
    }),
  );
  const r = show();
  expect(r.queryByText("Private workout")).toBeNull();
  expect(r.getByText("Checking app")).toBeTruthy();
  await act(async () => {});
  act(() => foreground("active"));
  expect(fetchPolicy).toHaveBeenCalledTimes(1);
  await act(async () => finish(policy));
  expect(r.getByText("Private workout")).toBeTruthy();
  r.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});
it.each(["old", "missing-native", "missing-metadata"])(
  "blocks %s release binaries without a dismiss path",
  async (kind) => {
    if (kind === "old")
      mockNative.ExpoApplication = {
        nativeApplicationVersion: "1.1.2",
        applicationId: "com.bradleyevans96.persistence",
      };
    if (kind === "missing-native") delete mockNative.TogetherNearby;
    if (kind === "missing-metadata") delete mockNative.ExpoApplication;
    const r = show();
    await waitFor(() =>
      expect(r.getByTestId("required-app-update")).toBeTruthy(),
    );
    expect(r.queryByText("Private workout")).toBeNull();
    expect(r.queryByText("Back")).toBeNull();
    fireEvent.press(r.getByText("Update app"));
    await waitFor(() =>
      expect(Linking.openURL).toHaveBeenCalledWith(
        "https://apps.apple.com/app/id6755091280",
      ),
    );
  },
);
it("keeps a cached update floor enforced offline and rechecks on foreground without trusting JS manifest version", async () => {
  jest
    .mocked(readPolicy)
    .mockResolvedValue({ ...policy, iosMinimumVersion: "2.0.0" });
  jest.mocked(fetchPolicy).mockRejectedValue(new Error("offline"));
  const r = show();
  await waitFor(() => expect(r.getByText(/Version 2.0.0/)).toBeTruthy());
  expect(r.queryByText("Private workout")).toBeNull();
  await act(async () => foreground("background"));
  expect(fetchPolicy).toHaveBeenCalledTimes(1);
  await act(async () => foreground("active"));
  expect(fetchPolicy).toHaveBeenCalledTimes(2);
});
it("allows compatible offline launches and blocks an accepted higher foreground policy", async () => {
  jest.mocked(fetchPolicy).mockRejectedValueOnce(new Error("offline"));
  const r = show();
  await waitFor(() => expect(r.getByText("Private workout")).toBeTruthy());
  jest
    .mocked(fetchPolicy)
    .mockResolvedValue({ ...policy, iosMinimumVersion: "1.2.0" });
  await act(async () => foreground("active"));
  expect(r.queryByText("Private workout")).toBeNull();
  expect(r.getByText(/Version 1.2.0/)).toBeTruthy();
});
it("bounds network waiting and abandons late responses after unmount", async () => {
  jest.useFakeTimers();
  let signal!: AbortSignal;
  jest.mocked(fetchPolicy).mockImplementation(
    (_, __, s) =>
      new Promise((_, reject) => {
        signal = s;
        s.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  const r = show();
  await act(async () => {});
  await act(async () => jest.advanceTimersByTime(3000));
  expect(signal.aborted).toBe(true);
  expect(r.getByText("Private workout")).toBeTruthy();
  act(() => foreground("active"));
  await act(async () => {});
  r.unmount();
  expect(signal.aborted).toBe(true);
  expect(remove).toHaveBeenCalledTimes(1);
});
it("supports Android and surfaces store failure with a repeatable update action", async () => {
  Object.defineProperty(Platform, "OS", {
    value: "android",
    configurable: true,
  });
  jest
    .mocked(fetchPolicy)
    .mockResolvedValue({ ...policy, androidMinimumVersion: "1.2.0" });
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error("no store"));
  const r = show();
  await waitFor(() => expect(r.getByText("Update app")).toBeTruthy());
  fireEvent.press(r.getByText("Update app"));
  await waitFor(() =>
    expect(r.getByText(/Could not open the store/)).toBeTruthy(),
  );
  expect(Linking.openURL).toHaveBeenCalledWith(
    "https://play.google.com/store/apps/details?id=com.bradleyevans96.persistence",
  );
  jest.mocked(fetchPolicy).mockResolvedValue(policy);
  fireEvent.press(r.getByText("Check again"));
  await waitFor(() => expect(r.getByText("Private workout")).toBeTruthy());
});
it("does not open a production store for internal variants and ignores late cached reads after unmount", async () => {
  mockNative.ExpoApplication = {
    nativeApplicationVersion: "1.1.2",
    applicationId: "com.bradleyevans96.persistence.staging",
  };
  const r = show();
  await waitFor(() => expect(r.getByText(/testing distribution/)).toBeTruthy());
  const controls = r.UNSAFE_getByType(RequiredUpdatePresenter).props;
  act(() => controls.onUpdate());
  expect(Linking.openURL).not.toHaveBeenCalled();
  r.unmount();
  let finish!: (v: typeof policy) => void;
  jest.mocked(readPolicy).mockReturnValue(
    new Promise((r) => {
      finish = r;
    }),
  );
  const next = show();
  next.unmount();
  const count = jest.mocked(fetchPolicy).mock.calls.length;
  await act(async () => finish(policy));
  expect(fetchPolicy).toHaveBeenCalledTimes(count);
});
it.each(["development", "web"])(
  "does not force store updates in %s",
  (kind) => {
    if (kind === "development") Object.assign(global, { __DEV__: true });
    else
      Object.defineProperty(Platform, "OS", {
        value: "web",
        configurable: true,
      });
    const r = show();
    expect(r.getByText("Private workout")).toBeTruthy();
    expect(readPolicy).not.toHaveBeenCalled();
    expect(fetchPolicy).not.toHaveBeenCalled();
  },
);

it("never lowers an accepted in-memory requirement using stale cache on an offline foreground or retry", async () => {
  jest.mocked(readPolicy).mockResolvedValue(policy);
  jest
    .mocked(fetchPolicy)
    .mockResolvedValueOnce({ ...policy, iosMinimumVersion: "2.0.0" });
  const r = show();
  await waitFor(() => expect(r.getByText(/Version 2.0.0/)).toBeTruthy());
  jest.mocked(fetchPolicy).mockRejectedValue(new Error("offline"));
  await act(async () => foreground("active"));
  expect(r.queryByText("Private workout")).toBeNull();
  fireEvent.press(r.getByText("Check again"));
  await act(async () => {});
  expect(r.getByText(/Version 2.0.0/)).toBeTruthy();
  expect(readPolicy).toHaveBeenCalledTimes(1);
});
