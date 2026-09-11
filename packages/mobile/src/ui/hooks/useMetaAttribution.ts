import { useEffect } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import {
  bootstrapMetaAttribution,
  grantMetaAttributionConsent,
  isMetaAttributionConfigured,
} from "@/application/analytics/metaAttribution";

/**
 * First-launch consent for optional Meta install/open measurement.
 *
 * **The permission request is the system App Tracking Transparency dialog and
 * nothing else.** App Review rejected 1.1.2 (49) under Guideline 5.1.2(i)
 * because this hook previously showed an app-authored `Alert.alert`
 * ("Allow Meta to measure app installs…?" / "Not now" / "Allow") *before*
 * ATT. Two things were wrong with that: a custom prompt may not itself collect
 * tracking permission, and anyone who chose "Not now" never reached ATT at
 * all — so from the outside the app simply did not use the framework.
 *
 * There must therefore be **no app-authored prompt on this path**. Do not
 * reintroduce a pre-prompt here, not even a purely explanatory one: the
 * rationale belongs in `NSUserTrackingUsageDescription` (set from
 * `iosUserTrackingPermission` in `app.config.ts`), which is the copy iOS
 * renders inside the system dialog. `grantMetaAttributionConsent()` calls
 * `requestTrackingPermissionsAsync()` and stores the answer, so a denial is
 * recorded durably and this never asks twice.
 *
 * The service serializes ATT with notification requests and waits for a stable
 * active state for every native call, including saved-grant restoration. It
 * retries an undetermined response at most twice; it never retries a refusal.
 * This hook starts one bounded activation per mount, not one native ATT call.
 */
export function useMetaAttribution(): void {
  useEffect(() => {
    let cancelled = false;
    let requested = false;
    let unsubscribe: (() => void) | undefined;

    // Start only one activation per mount; native retries belong to the service.
    const request = () => {
      if (cancelled || requested) return;
      requested = true;
      void grantMetaAttributionConsent();
    };

    const requestOnceActive = () => {
      if (cancelled) return;
      if (AppState.currentState === "active") {
        request();
        return;
      }
      const subscription = AppState.addEventListener(
        "change",
        (state: AppStateStatus) => {
          if (cancelled || state !== "active") return;
          subscription.remove();
          unsubscribe = undefined;
          request();
        },
      );
      unsubscribe = () => subscription.remove();
    };

    void bootstrapMetaAttribution().then((consent) => {
      // "granted" already attempted restoration inside bootstrap; "denied" is the
      // user's settled answer and must never be re-asked outside Settings.
      if (cancelled || consent !== "unknown") return;
      if (!isMetaAttributionConfigured()) return;
      // iOS ONLY, and this gate is load-bearing. ATT is the consent mechanism
      // and Android has no equivalent, so `activateMetaAttribution()` has no
      // permission check on Android at all — it stores "granted", enables the
      // advertiser ID, initializes the SDK and logs the activation event
      // outright. Auto-requesting here on Android would therefore turn Meta
      // measurement on with NO user consent, which the custom alert this
      // change removed had been (lawfully) providing. Android opts in
      // explicitly via Privacy Settings instead; until then consent stays
      // "unknown" and the SDK is never initialized.
      if (Platform.OS !== "ios") return;
      requestOnceActive();
    });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
}
