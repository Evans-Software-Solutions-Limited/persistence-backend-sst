import { useCallback, useEffect, useRef } from "react";
import { router } from "expo-router";
import { useGetBodyMeasurementHistory } from "@/ui/hooks/useGetBodyMeasurements";
import { useProfilePage } from "@/ui/hooks/useProfilePage";
import { BodyHistoryPresenter } from "@/ui/presenters/BodyHistoryPresenter";
import { useHomeSheets } from "@/state/home-sheets";
import { useAdapters } from "@/ui/hooks/useAdapters";

export type BodyHistoryMetric = "weight" | "bodyFat";

/** Cache-first past-year body history opened from the You summary cards. */
export function BodyHistoryContainer({
  metric = "weight",
}: {
  metric?: BodyHistoryMetric;
}) {
  // The current endpoint intentionally caps windows at 366 days. Make that
  // product boundary explicit in the UI instead of silently showing 30 days
  // under a generic "history" title.
  const body = useGetBodyMeasurementHistory(366);
  const { api } = useAdapters();
  const profile = useProfilePage();
  const refresh = body.refresh;
  const onRefresh = useCallback(() => void refresh(), [refresh]);
  const onBack = useCallback(() => router.back(), []);
  const openMeasurement = useHomeSheets((s) => s.openWeighIn);
  const measurementsRev = useHomeSheets((s) => s.measurementsRev);
  const initialMeasurementsRev = useRef(measurementsRev);
  const onLog = useCallback(
    () => openMeasurement(metric, "history"),
    [openMeasurement, metric],
  );

  useEffect(() => {
    void api.trackAnalyticsEvent({
      name:
        metric === "weight"
          ? "weight_history_opened"
          : "body_fat_history_opened",
    });
  }, [api, metric]);

  useEffect(() => {
    if (measurementsRev === initialMeasurementsRev.current) return;
    void refresh();
  }, [measurementsRev, refresh]);

  return (
    <BodyHistoryPresenter
      points={body.data ?? []}
      weightUnit={profile.payload?.profile.weightUnit ?? "kg"}
      isLoading={body.isLoading}
      isRefreshing={body.isLoading && body.data !== null}
      error={body.error}
      onBack={onBack}
      onRefresh={onRefresh}
      metric={metric}
      onLog={onLog}
    />
  );
}
