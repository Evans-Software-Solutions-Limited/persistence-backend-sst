import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import {
  getTrackingPermissionsAsync,
  requestTrackingPermissionsAsync,
} from "expo-tracking-transparency";
import { Platform } from "react-native";
import { runNativePermissionRequest } from "@/lib/nativePermissionQueue";
import { AppEventsLogger, Settings } from "react-native-fbsdk-next";

export type MetaAttributionConsent = "unknown" | "granted" | "denied";

/**
 * Why an activation attempt ended the way it did.
 *
 * A bare boolean conflated "the user declined ATT" with "the user allowed ATT
 * and then a storage/native step threw". Callers that show UI need those apart:
 * the first is the user's answer and needs no error, the second is a real
 * failure — and inferring it afterwards from the permission status is
 * impossible, because both leave ATT determined.
 */
export type MetaGrantOutcome = "activated" | "declined" | "pending" | "failed";

const CONSENT_KEY = "persistence.meta-attribution-consent.v1";
let initialized = false;
let grantInFlight: Promise<MetaGrantOutcome> | null = null;
let grantAbort: AbortController | null = null;
let revocationInFlight: Promise<boolean> | null = null;
let consentGeneration = 0;

export function isMetaAttributionConfigured(): boolean {
  return Constants.expoConfig?.extra?.metaConfigured === true;
}

/**
 * Can the system App Tracking Transparency dialog still be shown?
 *
 * iOS presents it once per install: after the user answers, or when
 * "Allow Apps to Request to Track" is off device-wide, `request…Async()`
 * returns the settled status and presents NOTHING. Callers that offer a
 * user-facing control need to tell that apart from a transient failure, so
 * they can point the user at iOS Settings instead of silently doing nothing.
 *
 * Non-iOS has no ATT, so the answer is vacuously true.
 */
export async function canRequestSystemTracking(): Promise<boolean> {
  if (Platform.OS !== "ios") return true;
  try {
    const { status, canAskAgain } = await getTrackingPermissionsAsync();
    return status === "undetermined" && canAskAgain;
  } catch {
    // The optional native module may be absent; treat as not-askable rather
    // than claiming a prompt is available that will never appear.
    return false;
  }
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
export function grantMetaAttributionConsent(): Promise<MetaGrantOutcome> {
  return grantMetaAttributionConsentForGeneration(consentGeneration);
}

function grantMetaAttributionConsentForGeneration(
  requestedGeneration: number,
): Promise<MetaGrantOutcome> {
  if (!isMetaAttributionConfigured() || initialized) {
    return Promise.resolve(initialized ? "activated" : "failed");
  }
  if (revocationInFlight) {
    return revocationInFlight.then((revoked) =>
      revoked && requestedGeneration === consentGeneration
        ? grantMetaAttributionConsentForGeneration(requestedGeneration)
        : "failed",
    );
  }
  if (requestedGeneration !== consentGeneration) {
    return Promise.resolve("failed");
  }
  if (grantInFlight) return grantInFlight;
  grantAbort = new AbortController();
  grantInFlight = activateMetaAttribution(
    requestedGeneration,
    grantAbort.signal,
  ).finally(() => {
    grantInFlight = null;
    grantAbort = null;
  });
  return grantInFlight;
}

async function activateMetaAttribution(
  generation: number,
  signal: AbortSignal,
): Promise<MetaGrantOutcome> {
  try {
    if (Platform.OS === "ios") {
      // iOS drops ATT while another permission is pending. Every attempt joins
      // the same queue as notifications and waits for a stable active state.
      // A non-answer may retry, but a real refusal must never be re-prompted.
      let permission = await runNativePermissionRequest(
        requestTrackingPermissionsAsync,
        signal,
      );
      for (
        let attempt = 1;
        permission.status === "undetermined" && attempt < 3;
        attempt += 1
      ) {
        permission = await runNativePermissionRequest(
          requestTrackingPermissionsAsync,
          signal,
        );
      }
      if (generation !== consentGeneration) return "failed";
      if (!permission.granted) {
        if (permission.status === "undetermined") return "pending";
        // Use the response itself. A failed second status read is not consent.
        if (permission.status !== "denied") return "failed";
        await AsyncStorage.setItem(CONSENT_KEY, "denied").catch(
          () => undefined,
        );
        // The user's answer, not an error. Everything after this point is.
        return "declined";
      }
    }
    // A durable affirmative record must exist before any transmission. If
    // storage is unavailable, fail closed and leave the SDK uninitialized.
    await AsyncStorage.setItem(CONSENT_KEY, "granted");
    if (generation !== consentGeneration) return "failed";
    if (Platform.OS === "ios") {
      await Settings.setAdvertiserTrackingEnabled(true);
      if (generation !== consentGeneration) return "failed";
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
    return "activated";
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
    // An exception is not the user's refusal. Preserve their previous choice;
    // an unanswered request stays unknown and a granted request can recover on
    // a later launch. The SDK remains disabled until activation succeeds.
    return "failed";
  }
}

export async function denyMetaAttributionConsent(): Promise<boolean> {
  consentGeneration += 1;
  grantAbort?.abort();
  initialized = false;
  if (revocationInFlight) return revocationInFlight;
  const pendingGrant = grantInFlight;
  revocationInFlight = revokeMetaAttribution(pendingGrant).finally(() => {
    revocationInFlight = null;
  });
  return revocationInFlight;
}

async function revokeMetaAttribution(
  // Only awaited, never inspected — the outcome of an activation this
  // withdrawal has already invalidated is irrelevant.
  pendingGrant: Promise<MetaGrantOutcome> | null,
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
  const requestedGeneration = consentGeneration;
  const consent = await getMetaAttributionConsent();
  // A withdrawal that lands while storage is being read supersedes that
  // snapshot, even if the delayed read returns the old durable grant.
  if (requestedGeneration !== consentGeneration) return "denied";
  if (consent === "granted") {
    await grantMetaAttributionConsentForGeneration(requestedGeneration);
  }
  return consent;
}

/** Test-only reset for the module-lifetime idempotency guard. */
export function resetMetaAttributionForTests(): void {
  grantAbort?.abort();
  grantAbort = null;
  initialized = false;
  grantInFlight = null;
  revocationInFlight = null;
  consentGeneration = 0;
}
