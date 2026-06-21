import { useCallback, useState } from "react";
import { useRouter } from "expo-router";

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
    } finally {
      setIsRequesting(false);
    }
  }, [health, isRequesting]);

  const onBack = useCallback(() => router.back(), [router]);

  return (
    <HealthSettingsPresenter
      isAvailable={health.isAvailable}
      permissionStatus={health.permissionStatus}
      isReading={health.isReading}
      isRequesting={isRequesting}
      stepsToday={health.stepsToday}
      onConnect={onConnect}
      onBack={onBack}
    />
  );
}
