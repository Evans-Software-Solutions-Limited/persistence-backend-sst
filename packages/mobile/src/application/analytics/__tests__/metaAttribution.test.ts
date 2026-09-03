import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { requestTrackingPermissionsAsync } from "expo-tracking-transparency";
import { Platform } from "react-native";
import { AppEventsLogger, Settings } from "react-native-fbsdk-next";
import {
  bootstrapMetaAttribution,
  denyMetaAttributionConsent,
  grantMetaAttributionConsent,
  resetMetaAttributionForTests,
} from "../metaAttribution";

jest.mock("expo-tracking-transparency", () => ({
  requestTrackingPermissionsAsync: jest.fn(),
}));
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { metaConfigured: true } } },
}));
jest.mock("react-native-fbsdk-next", () => ({
  Settings: {
    initializeSDK: jest.fn(),
    setAdvertiserTrackingEnabled: jest.fn(async () => true),
    setAdvertiserIDCollectionEnabled: jest.fn(),
    setAutoLogAppEventsEnabled: jest.fn(),
  },
  AppEventsLogger: { logEvent: jest.fn() },
}));

const extra = Constants.expoConfig!.extra!;

describe("Meta attribution consent gate", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetMetaAttributionForTests();
    await AsyncStorage.clear();
    extra.metaConfigured = true;
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
    (requestTrackingPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
    });
  });

  it("does not initialize before an affirmative decision", async () => {
    await expect(bootstrapMetaAttribution()).resolves.toBe("unknown");
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
  });

  it("treats unreadable consent storage as unknown", async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );

    await expect(bootstrapMetaAttribution()).resolves.toBe("unknown");
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
  });

  it("initializes install attribution only after consent and iOS ATT", async () => {
    await expect(grantMetaAttributionConsent()).resolves.toBe(true);
    expect(requestTrackingPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(Settings.setAdvertiserTrackingEnabled).toHaveBeenCalledWith(true);
    expect(Settings.setAdvertiserIDCollectionEnabled).toHaveBeenCalledWith(
      true,
    );
    expect(Settings.setAutoLogAppEventsEnabled).toHaveBeenCalledWith(false);
    expect(Settings.initializeSDK).toHaveBeenCalledTimes(1);
    expect(AppEventsLogger.logEvent).toHaveBeenCalledWith(
      "fb_mobile_activate_app",
    );
  });

  it("does not initialize when ATT is denied", async () => {
    (requestTrackingPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: false,
    });
    await expect(grantMetaAttributionConsent()).resolves.toBe(false);
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
    expect(AppEventsLogger.logEvent).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "persistence.meta-attribution-consent.v1",
      "denied",
    );
  });

  it("fails closed when a denied ATT decision cannot be persisted", async () => {
    (requestTrackingPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: false,
    });
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );

    await expect(grantMetaAttributionConsent()).resolves.toBe(false);
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
  });

  it("fails closed when affirmative consent cannot be persisted", async () => {
    (AsyncStorage.setItem as jest.Mock)
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockRejectedValueOnce(new Error("denial storage unavailable"));

    await expect(grantMetaAttributionConsent()).resolves.toBe(false);
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
    expect(Settings.setAdvertiserIDCollectionEnabled).toHaveBeenCalledWith(
      false,
    );
  });

  it("restores denied when native initialization fails", async () => {
    (Settings.initializeSDK as jest.Mock).mockImplementationOnce(() => {
      throw new Error("native init failed");
    });
    await expect(grantMetaAttributionConsent()).resolves.toBe(false);
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
      "persistence.meta-attribution-consent.v1",
      "denied",
    );
    expect(AppEventsLogger.logEvent).not.toHaveBeenCalled();
    expect(Settings.setAdvertiserIDCollectionEnabled).toHaveBeenLastCalledWith(
      false,
    );
    expect(Settings.setAdvertiserTrackingEnabled).toHaveBeenLastCalledWith(
      false,
    );
  });

  it("stays denied when both initialization and native rollback fail", async () => {
    (Settings.initializeSDK as jest.Mock).mockImplementationOnce(() => {
      throw new Error("native init failed");
    });
    (Settings.setAutoLogAppEventsEnabled as jest.Mock)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("native rollback failed");
      });

    await expect(grantMetaAttributionConsent()).resolves.toBe(false);
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
      "persistence.meta-attribution-consent.v1",
      "denied",
    );
  });

  it("can grant again after withdrawal and durably re-enables attribution", async () => {
    await expect(grantMetaAttributionConsent()).resolves.toBe(true);
    await denyMetaAttributionConsent();
    jest.clearAllMocks();
    (requestTrackingPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
    });

    await expect(grantMetaAttributionConsent()).resolves.toBe(true);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "persistence.meta-attribution-consent.v1",
      "granted",
    );
    expect(Settings.setAdvertiserTrackingEnabled).toHaveBeenCalledWith(true);
    expect(Settings.setAdvertiserIDCollectionEnabled).toHaveBeenCalledWith(
      true,
    );
    expect(Settings.setAutoLogAppEventsEnabled).toHaveBeenCalledWith(false);
    expect(Settings.initializeSDK).toHaveBeenCalledTimes(1);
    expect(AppEventsLogger.logEvent).toHaveBeenCalledWith(
      "fb_mobile_activate_app",
    );
  });

  it("initializes without requesting ATT on Android", async () => {
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "android",
    });

    await expect(grantMetaAttributionConsent()).resolves.toBe(true);

    expect(requestTrackingPermissionsAsync).not.toHaveBeenCalled();
    expect(Settings.setAdvertiserTrackingEnabled).not.toHaveBeenCalled();
    expect(Settings.initializeSDK).toHaveBeenCalledTimes(1);
  });

  it("is idempotent after the SDK has initialized", async () => {
    await expect(grantMetaAttributionConsent()).resolves.toBe(true);
    await expect(grantMetaAttributionConsent()).resolves.toBe(true);

    expect(Settings.initializeSDK).toHaveBeenCalledTimes(1);
    expect(AppEventsLogger.logEvent).toHaveBeenCalledTimes(1);
  });

  it("shares one activation when concurrent grants race", async () => {
    let resolvePermission!: (value: { granted: boolean }) => void;
    (requestTrackingPermissionsAsync as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePermission = resolve;
      }),
    );

    const first = grantMetaAttributionConsent();
    const second = grantMetaAttributionConsent();
    resolvePermission({ granted: true });

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(Settings.initializeSDK).toHaveBeenCalledTimes(1);
    expect(AppEventsLogger.logEvent).toHaveBeenCalledTimes(1);
  });

  it("lets withdrawal cancel an in-flight grant before any activation", async () => {
    let resolvePermission!: (value: { granted: boolean }) => void;
    (requestTrackingPermissionsAsync as jest.Mock).mockReturnValueOnce(
      new Promise((resolve) => {
        resolvePermission = resolve;
      }),
    );

    const grant = grantMetaAttributionConsent();
    const revoke = denyMetaAttributionConsent();
    resolvePermission({ granted: true });

    await expect(grant).resolves.toBe(false);
    await expect(revoke).resolves.toBe(true);
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
    expect(AppEventsLogger.logEvent).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
      "persistence.meta-attribution-consent.v1",
      "denied",
    );
  });

  it("cancels an in-flight grant after its durable grant write", async () => {
    let resolveGrantWrite!: () => void;
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveGrantWrite = resolve;
        }),
    );

    const grant = grantMetaAttributionConsent();
    await Promise.resolve();
    await Promise.resolve();
    const revoke = denyMetaAttributionConsent();
    resolveGrantWrite();

    await expect(grant).resolves.toBe(false);
    await expect(revoke).resolves.toBe(true);
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
      "persistence.meta-attribution-consent.v1",
      "denied",
    );
  });

  it("cancels an in-flight grant after the iOS tracking flag await", async () => {
    let resolveTrackingFlag!: () => void;
    (Settings.setAdvertiserTrackingEnabled as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveTrackingFlag = resolve;
        }),
    );

    const grant = grantMetaAttributionConsent();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const revoke = denyMetaAttributionConsent();
    resolveTrackingFlag();

    await expect(grant).resolves.toBe(false);
    await expect(revoke).resolves.toBe(true);
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
    expect(AppEventsLogger.logEvent).not.toHaveBeenCalled();
  });

  it("queues a re-grant behind an in-flight withdrawal", async () => {
    let resolveWithdrawal: (() => void) | undefined;
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWithdrawal = resolve;
        }),
    );

    const revoke = denyMetaAttributionConsent();
    const grant = grantMetaAttributionConsent();
    while (!resolveWithdrawal) await Promise.resolve();
    resolveWithdrawal();

    await expect(revoke).resolves.toBe(true);
    await expect(grant).resolves.toBe(true);
    expect(Settings.initializeSDK).toHaveBeenCalledTimes(1);
    expect(AppEventsLogger.logEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps the final withdrawal when it supersedes a queued re-grant", async () => {
    let resolveWithdrawal: (() => void) | undefined;
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWithdrawal = resolve;
        }),
    );

    const firstWithdrawal = denyMetaAttributionConsent();
    const queuedGrant = grantMetaAttributionConsent();
    const finalWithdrawal = denyMetaAttributionConsent();
    while (!resolveWithdrawal) await Promise.resolve();
    resolveWithdrawal();

    await expect(firstWithdrawal).resolves.toBe(true);
    await expect(queuedGrant).resolves.toBe(false);
    await expect(finalWithdrawal).resolves.toBe(true);
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
      "persistence.meta-attribution-consent.v1",
      "denied",
    );
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
    expect(AppEventsLogger.logEvent).not.toHaveBeenCalled();
  });

  it("does not re-grant when the preceding withdrawal fails", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );

    const revoke = denyMetaAttributionConsent();
    const grant = grantMetaAttributionConsent();

    await expect(revoke).resolves.toBe(false);
    await expect(grant).resolves.toBe(false);
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
  });

  it("shares one in-flight withdrawal", async () => {
    let resolveWithdrawal: (() => void) | undefined;
    (AsyncStorage.setItem as jest.Mock).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWithdrawal = resolve;
        }),
    );

    const first = denyMetaAttributionConsent();
    const second = denyMetaAttributionConsent();
    while (!resolveWithdrawal) await Promise.resolve();
    resolveWithdrawal();

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
  });

  it("restores a durable grant during bootstrap", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce("granted");

    await expect(bootstrapMetaAttribution()).resolves.toBe("granted");
    expect(Settings.initializeSDK).toHaveBeenCalledTimes(1);
  });

  it("does not restore a stale bootstrap grant after a withdrawal", async () => {
    let resolveConsentRead!: (value: string) => void;
    (AsyncStorage.getItem as jest.Mock).mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveConsentRead = resolve;
      }),
    );

    const bootstrap = bootstrapMetaAttribution();
    await Promise.resolve();
    const withdrawal = denyMetaAttributionConsent();
    resolveConsentRead("granted");

    await expect(withdrawal).resolves.toBe(true);
    await expect(bootstrap).resolves.toBe("denied");
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
      "persistence.meta-attribution-consent.v1",
      "denied",
    );
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
    expect(AppEventsLogger.logEvent).not.toHaveBeenCalled();
  });

  it("is a silent no-op when native Meta configuration is absent", async () => {
    extra.metaConfigured = false;
    await expect(grantMetaAttributionConsent()).resolves.toBe(false);
    expect(requestTrackingPermissionsAsync).not.toHaveBeenCalled();
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
    expect(AppEventsLogger.logEvent).not.toHaveBeenCalled();
  });

  it("disables future collection after consent is withdrawn", async () => {
    await expect(denyMetaAttributionConsent()).resolves.toBe(true);
    expect(Settings.setAutoLogAppEventsEnabled).toHaveBeenCalledWith(false);
    expect(Settings.setAdvertiserIDCollectionEnabled).toHaveBeenCalledWith(
      false,
    );
    expect(Settings.setAdvertiserTrackingEnabled).toHaveBeenCalledWith(false);
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "persistence.meta-attribution-consent.v1",
      "denied",
    );
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
  });

  it("persists withdrawal without touching the native SDK when unconfigured", async () => {
    extra.metaConfigured = false;

    await expect(denyMetaAttributionConsent()).resolves.toBe(true);

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "persistence.meta-attribution-consent.v1",
      "denied",
    );
    expect(Settings.setAdvertiserIDCollectionEnabled).not.toHaveBeenCalled();
  });

  it("disables Android collection without calling the iOS tracking flag", async () => {
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "android",
    });

    await expect(denyMetaAttributionConsent()).resolves.toBe(true);

    expect(Settings.setAdvertiserIDCollectionEnabled).toHaveBeenCalledWith(
      false,
    );
    expect(Settings.setAdvertiserTrackingEnabled).not.toHaveBeenCalled();
  });

  it("removes a stale grant when persisting explicit denial fails", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );

    await expect(denyMetaAttributionConsent()).resolves.toBe(true);

    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(
      "persistence.meta-attribution-consent.v1",
    );
  });

  it("reports withdrawal failure when neither denial nor removal persists", async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );
    (AsyncStorage.removeItem as jest.Mock).mockRejectedValueOnce(
      new Error("storage unavailable"),
    );

    await expect(denyMetaAttributionConsent()).resolves.toBe(false);
  });

  it("reports withdrawal failure when native collection cannot be disabled", async () => {
    (Settings.setAdvertiserIDCollectionEnabled as jest.Mock).mockImplementation(
      () => {
        throw new Error("native unavailable");
      },
    );

    await expect(denyMetaAttributionConsent()).resolves.toBe(false);
  });
});
