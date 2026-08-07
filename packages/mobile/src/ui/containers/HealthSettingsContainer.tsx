import { useCallback, useState } from "react";
import { Linking, Platform } from "react-native";
import { useRouter } from "expo-router";

import { useHealthSync } from "@/state/health-sync";
import { useHealthData } from "@/ui/hooks/useHealthData";
import { HealthSettingsPresenter } from "@/ui/presenters/HealthSettingsPresenter";

/**
 * <HealthSettingsContainer> — wires the Apple Health connect screen to the
 * HealthPort via useHealthData(). Reached from the ProfileDrawer
 * "Health & integrations" row.
 *
 * `onConnect` calls `requestPermissions()` which presents the native HealthKit
 * authorization sheet and immediately reads once granted. Granting here lights
 * up the Home activity rings: HomeContainer overlays the same `stepsToday`
 * onto the MOVE ring on its next focus.
 *
 * Spec: specs/07-health-integration/requirements.md STORY-001/003
 */
export function HealthSettingsContainer() {
  const router = useRouter();
  const health = useHealthData();
  const [isRequesting, setIsRequesting] = useState(false);

  const onConnect = useCallback(async () => {
    if (isRequesting) return;
    setIsRequesting(true);
    try {
      await health.requestPermissions();
      // Signal Home to force-refresh its own HealthKit instance on next
      // focus so the activity rings reflect the just-granted data without
      // waiting out the 5-min rate-limit window.
      useHealthSync.getState().markConnected();
    } finally {
      setIsRequesting(false);
    }
  }, [health, isRequesting]);

  const onBack = useCallback(() => router.back(), [router]);
  const onInstallHealthConnect = useCallback(() => {
    void Linking.openURL(
      "https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata",
    );
  }, []);

  return (
    <HealthSettingsPresenter
      provider={Platform.OS === "android" ? "health_connect" : "apple_health"}
      isAvailable={health.isAvailable}
      permissionStatus={health.permissionStatus}
      isReading={health.isReading}
      isRequesting={isRequesting}
      stepsToday={health.stepsToday}
      heartRateLatest={health.heartRateLatest}
      onConnect={onConnect}
      onInstallProvider={onInstallHealthConnect}
      onBack={onBack}
    />
  );
}
