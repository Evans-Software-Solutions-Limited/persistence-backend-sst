import { Platform } from "react-native";
import Purchases from "react-native-purchases";
import { createPurchasesAdapter } from "@/providers";

const configureMock = Purchases.configure as jest.Mock;

describe("createPurchasesAdapter", () => {
  const originalOS = Platform.OS;
  const originalIosKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY;
  const originalAndroidKey = process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;

  afterEach(() => {
    Platform.OS = originalOS;
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = originalIosKey;
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = originalAndroidKey;
    jest.clearAllMocks();
  });

  it("configures Android with the Google public SDK key", () => {
    Platform.OS = "android";
    process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY = "goog_public_key";
    const adapter = createPurchasesAdapter();
    expect(adapter?.isConfigured()).toBe(true);
    expect(configureMock).toHaveBeenCalledWith({ apiKey: "goog_public_key" });
  });

  it("configures iOS with the Apple public SDK key", () => {
    Platform.OS = "ios";
    process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = "appl_public_key";
    const adapter = createPurchasesAdapter();
    expect(adapter?.isConfigured()).toBe(true);
    expect(configureMock).toHaveBeenCalledWith({ apiKey: "appl_public_key" });
  });

  it("does not construct a native adapter on web", () => {
    Platform.OS = "web";
    expect(createPurchasesAdapter()).toBeUndefined();
    expect(configureMock).not.toHaveBeenCalled();
  });
});
