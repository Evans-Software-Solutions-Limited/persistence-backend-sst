import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { requestTrackingPermissionsAsync } from "expo-tracking-transparency";
import { Platform } from "react-native";
import { AppEventsLogger, Settings } from "react-native-fbsdk-next";

export type MetaAttributionConsent = "unknown" | "granted" | "denied";

const CONSENT_KEY = "persistence.meta-attribution-consent.v1";
let initialized = false;
let grantInFlight: Promise<boolean> | null = null;
let revocationInFlight: Promise<boolean> | null = null;
let consentGeneration = 0;

export function isMetaAttributionConfigured(): boolean {
  return Constants.expoConfig?.extra?.metaConfigured === true;
}

export async function getMetaAttributionConsent(): Promise<MetaAttributionConsent> {
  const stored = await AsyncStorage.getItem(CONSENT_KEY).catch(() => null);
  return stored === "granted" || stored === "denied" ? stored : "unknown";
}

/**
 * Starts Meta install/activation measurement only after affirmative consent.
 * This deliberately exposes no generic event logger: purchase/subscription
 * events remain RevenueCat-webhook authoritative, and health/workout/load/DOB,
 * names, free text and internal identifiers cannot enter this integration.
 */
export function grantMetaAttributionConsent(): Promise<boolean> {
  if (!isMetaAttributionConfigured() || initialized) {
    return Promise.resolve(initialized);
  }
  if (revocationInFlight) {
    return revocationInFlight.then((revoked) =>
      revoked ? grantMetaAttributionConsent() : false,
    );
  }
  if (grantInFlight) return grantInFlight;
  const generation = consentGeneration;
  grantInFlight = activateMetaAttribution(generation).finally(() => {
    grantInFlight = null;
  });
  return grantInFlight;
}

async function activateMetaAttribution(generation: number): Promise<boolean> {
  try {
    if (Platform.OS === "ios") {
      const permission = await requestTrackingPermissionsAsync();
      if (generation !== consentGeneration) return false;
      if (!permission.granted) {
        await AsyncStorage.setItem(CONSENT_KEY, "denied").catch(
          () => undefined,
        );
        return false;
      }
    }
    // A durable affirmative record must exist before any transmission. If
    // storage is unavailable, fail closed and leave the SDK uninitialized.
    await AsyncStorage.setItem(CONSENT_KEY, "granted");
    if (generation !== consentGeneration) return false;
    if (Platform.OS === "ios") {
      await Settings.setAdvertiserTrackingEnabled(true);
      if (generation !== consentGeneration) return false;
    }
    Settings.setAdvertiserIDCollectionEnabled(true);
    // Keep Meta automatic events disabled: the native SDK can otherwise log
    // IAP/subscription activity and conflict with RevenueCat's authoritative
    // webhook events. This exact, parameter-free allowlisted event supplies
    // first-open/install attribution without exposing arbitrary payloads.
    Settings.setAutoLogAppEventsEnabled(false);
    Settings.initializeSDK();
    AppEventsLogger.logEvent("fb_mobile_activate_app");
    initialized = true;
    return true;
  } catch {
    initialized = false;
    try {
      Settings.setAutoLogAppEventsEnabled(false);
      Settings.setAdvertiserIDCollectionEnabled(false);
      if (Platform.OS === "ios") {
        await Settings.setAdvertiserTrackingEnabled(false);
      }
    } catch {
      // Best-effort rollback: the optional native bridge may itself be absent.
    }
    await AsyncStorage.setItem(CONSENT_KEY, "denied").catch(() => undefined);
    // Attribution is optional and must never affect app startup or usability.
    return false;
  }
}

export async function denyMetaAttributionConsent(): Promise<boolean> {
  if (revocationInFlight) return revocationInFlight;
  consentGeneration += 1;
  initialized = false;
  const pendingGrant = grantInFlight;
  revocationInFlight = revokeMetaAttribution(pendingGrant).finally(() => {
    revocationInFlight = null;
  });
  return revocationInFlight;
}

async function revokeMetaAttribution(
  pendingGrant: Promise<boolean> | null,
): Promise<boolean> {
  // Let any invalidated activation finish its current native await before the
  // final disable/write, so it cannot resume and overwrite this withdrawal.
  await pendingGrant;
  let nativeDisabled = true;
  if (isMetaAttributionConfigured()) {
    try {
      Settings.setAutoLogAppEventsEnabled(false);
      Settings.setAdvertiserIDCollectionEnabled(false);
      if (Platform.OS === "ios") {
        await Settings.setAdvertiserTrackingEnabled(false);
      }
    } catch {
      nativeDisabled = false;
    }
  }

  // Never leave a stale durable `granted` value behind. If writing the
  // explicit denial fails, removing the record safely degrades to `unknown`
  // on next launch rather than silently re-enabling attribution.
  let durablyRevoked = true;
  try {
    await AsyncStorage.setItem(CONSENT_KEY, "denied");
  } catch {
    try {
      await AsyncStorage.removeItem(CONSENT_KEY);
    } catch {
      durablyRevoked = false;
    }
  }
  return nativeDisabled && durablyRevoked;
}

export async function bootstrapMetaAttribution(): Promise<MetaAttributionConsent> {
  const consent = await getMetaAttributionConsent();
  if (consent === "granted") await grantMetaAttributionConsent();
  return consent;
}

/** Test-only reset for the module-lifetime idempotency guard. */
export function resetMetaAttributionForTests(): void {
  initialized = false;
  grantInFlight = null;
  revocationInFlight = null;
  consentGeneration = 0;
}
