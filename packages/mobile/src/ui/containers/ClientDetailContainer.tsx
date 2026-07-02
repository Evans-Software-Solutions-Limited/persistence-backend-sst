import { useCallback, useMemo, useRef } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useGetClientBodyTrend } from "@/ui/hooks/useGetClientBodyTrend";
import { ClientDetailPresenter } from "@/ui/presenters/coach/ClientDetailPresenter";
import type { BodyTrendPoint } from "@/domain/models/progress";
import type { TrendData } from "@/ui/presenters/BodyTrendPresenter";

/**
 * Build the <BodyTrendPresenter> props from a trend series — the same
 * series/delta shaping YouContainer does for the athlete's own trend, minus
 * the HealthKit merge (the coach reads the client's SERVER data only; the
 * client's device is what pushes HealthKit readings up).
 */
export function buildClientBodyTrend(pts: BodyTrendPoint[]): {
  weight: TrendData & { unit: "kg" | "lb" };
  bodyFat: TrendData;
} {
  const weightSeries = pts
    .map((p) => p.weightKg)
    .filter((w): w is number => w != null);
  const fatSeries = pts
    .map((p) => p.bodyFat)
    .filter((f): f is number => f != null);
  const delta = (s: number[]) => (s.length > 1 ? s[s.length - 1] - s[0] : 0);
  return {
    weight: {
      current: weightSeries[weightSeries.length - 1] ?? null,
      delta: delta(weightSeries),
      series: weightSeries,
      unit: "kg" as const,
    },
    bodyFat: {
      current: fatSeries[fatSeries.length - 1] ?? null,
      delta: delta(fatSeries),
      series: fatSeries,
    },
  };
}

/**
 * <ClientDetailContainer> — interim Client Detail (10-trainer-features
 * 10.9.3): fetches the client's body trend and wires the Log-weight action.
 * Re-fetches on re-focus so a weight logged via the Log-weight screen shows
 * up the moment the coach pops back.
 */
export function ClientDetailContainer() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const trend = useGetClientBodyTrend(id);

  // Refresh on re-focus (returning from Log weight) — skip the initial focus,
  // which coincides with the hook's own mount fetch.
  const firstFocus = useRef(true);
  const refresh = trend.refresh;
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void refresh();
    }, [refresh]),
  );

  const bodyTrend = useMemo(
    () => buildClientBodyTrend(trend.data ?? []),
    [trend.data],
  );

  const onLogWeight = useCallback(() => {
    if (!id) return;
    router.push({
      pathname: "/(app)/clients/[id]/log-weight",
      params: { id, ...(name ? { name } : {}) },
    } as never);
  }, [router, id, name]);

  const onBack = useCallback(() => {
    if (router.canGoBack()) router.back();
  }, [router]);

  return (
    <ClientDetailPresenter
      clientName={name ?? null}
      bodyTrend={bodyTrend}
      isLoading={trend.isLoading}
      error={trend.error ? "Couldn't load this client's trend." : null}
      onLogWeight={onLogWeight}
      onBack={onBack}
    />
  );
}
