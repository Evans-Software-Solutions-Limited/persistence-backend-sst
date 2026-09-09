import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import {
  getTrackingPermissionsAsync,
  requestTrackingPermissionsAsync,
} from "expo-tracking-transparency";
import { Platform } from "react-native";
import { AppEventsLogger, Settings } from "react-native-fbsdk-next";
import {
  canRequestSystemTracking,
  bootstrapMetaAttribution,
  denyMetaAttributionConsent,
  grantMetaAttributionConsent,
  resetMetaAttributionForTests,
} from "../metaAttribution";

jest.mock("expo-tracking-transparency", () => ({
  requestTrackingPermissionsAsync: jest.fn(),
  getTrackingPermissionsAsync: jest.fn(),
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
    await expect(grantMetaAttributionConsent()).resolves.toBe("activated");
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
    await expect(grantMetaAttributionConsent()).resolves.toBe("declined");
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

    await expect(grantMetaAttributionConsent()).resolves.toBe("declined");
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
  });

  it("fails closed when affirmative consent cannot be persisted", async () => {
    (AsyncStorage.setItem as jest.Mock)
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockRejectedValueOnce(new Error("denial storage unavailable"));

    await expect(grantMetaAttributionConsent()).resolves.toBe("failed");
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
    expect(Settings.setAdvertiserIDCollectionEnabled).toHaveBeenCalledWith(
      false,
    );
  });

  it("restores denied when native initialization fails", async () => {
    (Settings.initializeSDK as jest.Mock).mockImplementationOnce(() => {
      throw new Error("native init failed");
    });
    await expect(grantMetaAttributionConsent()).resolves.toBe("failed");
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

    await expect(grantMetaAttributionConsent()).resolves.toBe("failed");
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith(
      "persistence.meta-attribution-consent.v1",
      "denied",
    );
  });

  it("can grant again after withdrawal and durably re-enables attribution", async () => {
    await expect(grantMetaAttributionConsent()).resolves.toBe("activated");
    await denyMetaAttributionConsent();
    jest.clearAllMocks();
    (requestTrackingPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: true,
    });

    await expect(grantMetaAttributionConsent()).resolves.toBe("activated");

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

    await expect(grantMetaAttributionConsent()).resolves.toBe("activated");

    expect(requestTrackingPermissionsAsync).not.toHaveBeenCalled();
    expect(Settings.setAdvertiserTrackingEnabled).not.toHaveBeenCalled();
    expect(Settings.initializeSDK).toHaveBeenCalledTimes(1);
  });

  it("is idempotent after the SDK has initialized", async () => {
    await expect(grantMetaAttributionConsent()).resolves.toBe("activated");
    await expect(grantMetaAttributionConsent()).resolves.toBe("activated");

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

    await expect(Promise.all([first, second])).resolves.toEqual([
      "activated",
      "activated",
    ]);
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

    await expect(grant).resolves.toBe("failed");
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

    await expect(grant).resolves.toBe("failed");
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

    await expect(grant).resolves.toBe("failed");
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
    await expect(grant).resolves.toBe("activated");
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
    await expect(queuedGrant).resolves.toBe("failed");
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
    await expect(grant).resolves.toBe("failed");
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

  // Unreachable by construction — the hook checks `isMetaAttributionConfigured`
  // first and the Settings row is hidden when unavailable — so this reports
  // "failed" (it did not activate, and it was not the user declining) rather
  // than earning a fourth outcome.
  it("is a silent no-op when native Meta configuration is absent", async () => {
    extra.metaConfigured = false;
    await expect(grantMetaAttributionConsent()).resolves.toBe("failed");
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

/**
 * `canRequestSystemTracking` exists so a user-facing control can tell
 * "iOS will show the dialog" from "iOS will show nothing" — the latter being
 * unavoidable after the one prompt per install has been answered.
 */
describe("canRequestSystemTracking", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  });

  it("is true only while undetermined and still askable", async () => {
    (getTrackingPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "undetermined",
      canAskAgain: true,
    });
    await expect(canRequestSystemTracking()).resolves.toBe(true);
  });

  it.each([
    ["denied", true],
    ["granted", true],
    ["restricted", true],
    ["undetermined", false],
  ])(
    "is false for status %s with canAskAgain %s",
    async (status, canAskAgain) => {
      (getTrackingPermissionsAsync as jest.Mock).mockResolvedValue({
        status,
        canAskAgain,
      });
      await expect(canRequestSystemTracking()).resolves.toBe(false);
    },
  );

  it("is false when the native module throws rather than claiming a prompt", async () => {
    (getTrackingPermissionsAsync as jest.Mock).mockRejectedValue(
      new Error("no native module"),
    );
    await expect(canRequestSystemTracking()).resolves.toBe(false);
  });

  it("is vacuously true off iOS, where ATT does not exist", async () => {
    Object.defineProperty(Platform, "OS", {
      configurable: true,
      value: "android",
    });
    await expect(canRequestSystemTracking()).resolves.toBe(true);
    expect(getTrackingPermissionsAsync).not.toHaveBeenCalled();
  });
});

/**
 * Regression: `bootstrapMetaAttribution` runs on mount with no AppState gate,
 * so it can request ATT while the app is inactive — where iOS presents nothing
 * and resolves the status unchanged. Writing "denied" off that non-answer
 * permanently opts out a user who had previously consented and never declined.
 */
describe("a non-answer from ATT is never recorded as a decline", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMetaAttributionForTests();
    Object.defineProperty(Platform, "OS", { configurable: true, value: "ios" });
  });

  it("leaves a stored grant intact when iOS presented nothing", async () => {
    // Restored-from-backup shape: consent persisted, ATT authorisation did not.
    (requestTrackingPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: false,
      status: "undetermined",
      canAskAgain: true,
    });
    (getTrackingPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "undetermined",
      canAskAgain: true,
    });

    await expect(grantMetaAttributionConsent()).resolves.toBe("failed");

    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(
      expect.stringContaining("meta-attribution-consent"),
      "denied",
    );
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
  });

  it("still records a real in-dialog decline", async () => {
    (requestTrackingPermissionsAsync as jest.Mock).mockResolvedValue({
      granted: false,
      status: "denied",
      canAskAgain: false,
    });
    (getTrackingPermissionsAsync as jest.Mock).mockResolvedValue({
      status: "denied",
      canAskAgain: false,
    });

    await expect(grantMetaAttributionConsent()).resolves.toBe("declined");

    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      expect.stringContaining("meta-attribution-consent"),
      "denied",
    );
    expect(Settings.initializeSDK).not.toHaveBeenCalled();
  });
});
