import { useFocusEffect } from "expo-router";
import { useCallback, useMemo } from "react";
import { useDashboard } from "@/ui/hooks/useDashboard";
import { useFeatureGate } from "@/ui/hooks/useFeatureGate";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import {
  ProgressPresenter,
  type ProgressPresenterViewModel,
} from "@/ui/presenters/ProgressPresenter";

/**
 * Progress tab container. M10.5 Wave 2 wires the feature-gate primitives
 * into a minimal sectioned scaffold so the Progress surface can render
 * the gate prompt against real data. The full M4 progress feature
 * (`specs/05-progress/`) replaces the scaffolded sections with the
 * detailed PR carousel, volume trends, and body-measurement charts.
 *
 * - Basic stats (workouts-this-month + delta) are sourced from the
 *   shared `useDashboard` cache so this tab benefits from the same
 *   cache-and-refresh path the Home tab established (zero extra
 *   network on first paint when Home has already populated the cache).
 * - Advanced analytics section is gated via `useFeatureGate("gym_buddy")`.
 *   `gym_buddy` is the closest existing stub for the missing
 *   `advanced_analytics` feature (see specs/11-payments-subscriptions/
 *   design.md § Per-screen feature-gate integration > Wave 2 Progress /
 *   Health / Profile subset).
 *
 * Spec: specs/11-payments-subscriptions/design.md § Per-screen feature-
 *       gate integration (Wave 2)
 * Satisfies: specs/11-payments-subscriptions/requirements.md AC 4.6
 */
export function ProgressContainer() {
  const dashboard = useDashboard();
  const subscriptionQuery = useMySubscription();
  const analyticsGateRaw = useFeatureGate("gym_buddy");

  // Hide the gate slot entirely while the subscription cache is
  // unresolved — otherwise a premium user could see a flash of the
  // upgrade prompt during the cold-start window before the cache
  // lands.
  const analyticsGate = useMemo(
    () =>
      subscriptionQuery.data
        ? {
            allowed: analyticsGateRaw.allowed,
            gateProps: analyticsGateRaw.gateProps,
          }
        : null,
    [
      subscriptionQuery.data,
      analyticsGateRaw.allowed,
      analyticsGateRaw.gateProps,
    ],
  );

  const refresh = dashboard.refresh;

  // Refresh-on-focus mirrors the Home tab. The hook dedupes concurrent
  // calls so re-entering the tab costs at most one GET /dashboard.
  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const onRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const viewModel = useMemo<ProgressPresenterViewModel>(() => {
    const isLoading = dashboard.payload === null && dashboard.isRefreshing;
    const errorMessage =
      dashboard.payload !== null && dashboard.error
        ? "Couldn't refresh — showing cached data."
        : null;
    return {
      isLoading,
      isRefreshing: dashboard.isRefreshing,
      errorMessage,
      workoutsThisMonth: dashboard.payload?.progress.workoutsThisMonth ?? 0,
      workoutsLastMonth: dashboard.payload?.progress.workoutsLastMonth ?? 0,
    };
  }, [dashboard.payload, dashboard.isRefreshing, dashboard.error]);

  return (
    <ProgressPresenter
      viewModel={viewModel}
      analyticsGate={analyticsGate}
      onRefresh={onRefresh}
    />
  );
}
