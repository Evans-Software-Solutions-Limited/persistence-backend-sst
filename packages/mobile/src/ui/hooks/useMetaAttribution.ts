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
 * ⚠ ATT is only presented while the app is **active**. Requested during launch
 * — or while `inactive`/`background` — iOS presents nothing and resolves with
 * the status unchanged, which is indistinguishable from the user declining and
 * would burn the one chance to ask. So the request waits for the first
 * `active` state rather than firing on mount.
 */
export function useMetaAttribution(): void {
  useEffect(() => {
    let cancelled = false;
    let requested = false;
    let unsubscribe: (() => void) | undefined;

    // Asking is idempotent downstream, but keep "exactly once" provable here
    // rather than inherited from AppState subscription-removal semantics.
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
      // "granted" already re-initialized inside bootstrap; "denied" is the
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
