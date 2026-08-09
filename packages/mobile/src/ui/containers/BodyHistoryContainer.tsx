import { useCallback } from "react";
import { router } from "expo-router";
import { useGetBodyMeasurementHistory } from "@/ui/hooks/useGetBodyMeasurements";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { BodyHistoryPresenter } from "@/ui/presenters/BodyHistoryPresenter";

/** Cache-first past-year body history opened from the You summary cards. */
export function BodyHistoryContainer() {
  // The current endpoint intentionally caps windows at 366 days. Make that
  // product boundary explicit in the UI instead of silently showing 30 days
  // under a generic "history" title.
  const body = useGetBodyMeasurementHistory(366);
  const profile = useProfilePage();
  const refresh = body.refresh;
  const onRefresh = useCallback(() => void refresh(), [refresh]);
  const onBack = useCallback(() => router.back(), []);

  return (
    <BodyHistoryPresenter
      points={body.data ?? []}
      weightUnit={profile.payload?.profile.weightUnit ?? "kg"}
      isLoading={body.isLoading}
      isRefreshing={body.isLoading && body.data !== null}
      error={body.error}
      onBack={onBack}
      onRefresh={onRefresh}
    />
  );
}
