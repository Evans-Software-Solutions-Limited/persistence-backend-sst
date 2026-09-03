import { useEffect } from "react";
import { Alert } from "react-native";
import {
  bootstrapMetaAttribution,
  denyMetaAttributionConsent,
  grantMetaAttributionConsent,
  isMetaAttributionConfigured,
} from "@/application/analytics/metaAttribution";

export function useMetaAttribution(): void {
  useEffect(() => {
    let cancelled = false;
    void bootstrapMetaAttribution().then((consent) => {
      if (
        cancelled ||
        consent !== "unknown" ||
        !isMetaAttributionConfigured()
      ) {
        return;
      }
      Alert.alert(
        "Help us measure advertising",
        "Allow Meta to measure app installs using your device's advertising identifier? Persistence never sends workouts, health data, loads, names, dates of birth, free text or account IDs. You can change this later in Privacy Settings.",
        [
          {
            text: "Not now",
            style: "cancel",
            onPress: () => void denyMetaAttributionConsent(),
          },
          {
            text: "Allow",
            onPress: () => void grantMetaAttributionConsent(),
          },
        ],
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);
}
