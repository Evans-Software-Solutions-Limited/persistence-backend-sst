// Test the factory without jest.mocking the whole react-native module
// (which breaks the jest-expo preset). We read the real `Platform`
// object and mutate `.OS` directly for the test run, restoring it in
// afterAll. The kingstinct healthkit require is safe-mocked to a noop
// because the real module tries to load native NitroModules at
// require-time.

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
import { StubHealthAdapter } from "@/adapters/health/stub.adapter";
// eslint-disable-next-line import/first
import { createHealthAdapter } from "@/adapters/health";

describe("createHealthAdapter", () => {
  const originalOS = Platform.OS;

  function setOS(os: "ios" | "android" | "web") {
    // Platform.OS is read-only at the type level but writable in
    // practice on the jest-expo preset's jest-runtime.
    Object.defineProperty(Platform, "OS", { value: os, configurable: true });
  }

  beforeEach(() => {
    setOS("ios");
  });

  afterAll(() => {
    Object.defineProperty(Platform, "OS", {
      value: originalOS,
      configurable: true,
    });
  });

  it("picks ExpoHealthKitAdapter on iOS — device or simulator", () => {
    // Per Brad's PR #38 review: no more simulator-mock. iOS always
    // routes to the real HealthKit adapter; on simulator,
    // `isHealthDataAvailable()` returns false and tiles render the
    // existing "Health not available on this iOS build" copy.
    setOS("ios");
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
