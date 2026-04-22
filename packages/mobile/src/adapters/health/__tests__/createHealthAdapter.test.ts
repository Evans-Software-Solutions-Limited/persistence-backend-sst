// Test the factory without jest.mocking the whole react-native module
// (which breaks the jest-expo preset). We read the real `Platform`
// object and mutate `.OS` directly for the test run, restoring it in
// afterAll. `expo-device` is safe to full-mock because it has no
// internal RN dependencies. The kingstinct healthkit require is
// safe-mocked to a noop because the real module tries to load native
// NitroModules at require-time.

const mockExpoDevice = { isDevice: true };
jest.mock("expo-device", () => mockExpoDevice);
jest.mock("@kingstinct/react-native-healthkit", () => ({
  isHealthDataAvailable: () => false,
  requestAuthorization: async () => false,
  authorizationStatusFor: () => 0,
  queryStatisticsForQuantity: async () => null,
  getMostRecentQuantitySample: async () => null,
}));

// eslint-disable-next-line import/first
import { Platform } from "react-native";
// eslint-disable-next-line import/first
import { ExpoHealthKitAdapter } from "@/adapters/health/expo-healthkit.adapter";
// eslint-disable-next-line import/first
import { AndroidStubHealthAdapter } from "@/adapters/health/android-stub.adapter";
// eslint-disable-next-line import/first
import { SimulatorMockHealthAdapter } from "@/adapters/health/simulator-mock.adapter";
// eslint-disable-next-line import/first
import { StubHealthAdapter } from "@/adapters/health/stub.adapter";
// eslint-disable-next-line import/first
import { createHealthAdapter } from "@/adapters/health";

declare const global: { __DEV__?: boolean } & Record<string, unknown>;

describe("createHealthAdapter", () => {
  const originalOS = Platform.OS;
  const originalDev = global.__DEV__;

  function setOS(os: "ios" | "android" | "web") {
    // Platform.OS is read-only at the type level but writable in
    // practice on the jest-expo preset's jest-runtime.
    Object.defineProperty(Platform, "OS", { value: os, configurable: true });
  }

  beforeEach(() => {
    setOS("ios");
    mockExpoDevice.isDevice = true;
    global.__DEV__ = false;
  });

  afterAll(() => {
    Object.defineProperty(Platform, "OS", {
      value: originalOS,
      configurable: true,
    });
    global.__DEV__ = originalDev;
  });

  it("picks ExpoHealthKitAdapter on real iOS device", () => {
    setOS("ios");
    mockExpoDevice.isDevice = true;
    global.__DEV__ = false;
    const adapter = createHealthAdapter();
    expect(adapter).toBeInstanceOf(ExpoHealthKitAdapter);
  });

  it("picks SimulatorMockHealthAdapter on iOS simulator in dev mode", () => {
    setOS("ios");
    mockExpoDevice.isDevice = false;
    global.__DEV__ = true;
    const adapter = createHealthAdapter();
    expect(adapter).toBeInstanceOf(SimulatorMockHealthAdapter);
  });

  it("picks ExpoHealthKitAdapter on iOS simulator in production mode", () => {
    // In prod the `__DEV__` gate closes, so even a simulator build hits
    // the real HealthKit adapter (which reports unavailable safely).
    setOS("ios");
    mockExpoDevice.isDevice = false;
    global.__DEV__ = false;
    const adapter = createHealthAdapter();
    expect(adapter).toBeInstanceOf(ExpoHealthKitAdapter);
  });

  it("picks AndroidStubHealthAdapter on Android", () => {
    setOS("android");
    const adapter = createHealthAdapter();
    expect(adapter).toBeInstanceOf(AndroidStubHealthAdapter);
  });

  it("falls back to StubHealthAdapter on web / unknown platforms", () => {
    setOS("web");
    const adapter = createHealthAdapter();
    expect(adapter).toBeInstanceOf(StubHealthAdapter);
  });
});
