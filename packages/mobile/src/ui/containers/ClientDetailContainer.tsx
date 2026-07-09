import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useGetClientBodyTrend } from "@/ui/hooks/useGetClientBodyTrend";
import { useGetClientDetail } from "@/ui/hooks/useGetClientDetail";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAssignProgramSheet } from "@/state/assign-program-sheet";
import { useAssignWorkoutSheet } from "@/state/assign-workout-sheet";
import { useAssignGoalSheet } from "@/state/assign-goal-sheet";
import { useCoachNoteSheet } from "@/state/coach-note-sheet";
import {
  initialFromCalorieHit,
  useEditNutritionTargetsSheet,
} from "@/state/edit-nutrition-targets-sheet";
import type { ClientDetail } from "@/domain/models/clientDetail";
import { ClientDetailPresenter } from "@/ui/presenters/coach/ClientDetailPresenter";
import type { ActiveProgramme, BodyTrendPoint } from "@/domain/models/progress";
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
 * <ClientDetailContainer> — the full Client Detail screen (M8 Coach Phase 5).
 * Fetches THREE things and composes them into the single-scroll presenter:
 *   1. the aggregate (`useGetClientDetail`, cache-first),
 *   2. the client's body trend (`useGetClientBodyTrend`, #146),
 *   3. the client's active programme (`getClientActiveProgramme`, #166).
 * The aggregate deliberately does NOT fold in the programme (avoid churn); the
 * container fetches it directly, refreshing all three on re-focus + after an
 * assign / weight-log / sheet submit.
 */
export function ClientDetailContainer() {
  const router = useRouter();
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const detail = useGetClientDetail(id);
  const trend = useGetClientBodyTrend(id);
  const { api } = useAdapters();
  const openAssignProgram = useAssignProgramSheet((s) => s.openForClient);
  const openAssignWorkout = useAssignWorkoutSheet((s) => s.openSheet);
  const openAssignGoalCreate = useAssignGoalSheet((s) => s.openForCreate);
  const openAssignGoalEdit = useAssignGoalSheet((s) => s.openForEdit);
  const openEditTargets = useEditNutritionTargetsSheet((s) => s.openSheet);
  const openNoteCreate = useCoachNoteSheet((s) => s.openForCreate);
  const openNoteEdit = useCoachNoteSheet((s) => s.openForEdit);

  // The client's live programme for the ProgrammeCard + LiveSessionCTA
  // (specs/19-programs AC 4.5). Fetched directly (no cached-resource hook — a
  // single derived read per screen visit); refreshed on re-focus + after an
  // assign.
  const [activeProgramme, setActiveProgramme] =
    useState<ActiveProgramme | null>(null);
  const loadProgramme = useCallback(async () => {
    if (!id) return;
    const result = await api.getClientActiveProgramme(id);
    if (result.ok) setActiveProgramme(result.value);
  }, [api, id]);
  useEffect(() => {
    void loadProgramme();
  }, [loadProgramme]);

  // Refresh on re-focus (returning from Log weight / Manage habits) — skip the
  // initial focus, which coincides with the hooks' own mount fetches.
  const firstFocus = useRef(true);
  const refreshDetail = detail.refresh;
  const refreshTrend = trend.refresh;
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void refreshDetail();
      void refreshTrend();
      void loadProgramme();
    }, [refreshDetail, refreshTrend, loadProgramme]),
  );

  const refreshAll = useCallback(() => {
    void refreshDetail();
    void refreshTrend();
    void loadProgramme();
  }, [refreshDetail, refreshTrend, loadProgramme]);

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

  const onManageHabits = useCallback(() => {
    if (!id) return;
    router.push({
      pathname: "/(app)/clients/[id]/habits",
      params: { id, ...(name ? { name } : {}) },
    } as never);
  }, [router, id, name]);

  const onOpenProgramme = useCallback(() => {
    if (!activeProgramme) return;
    router.push(`/(app)/programs/${activeProgramme.programId}` as never);
  }, [router, activeProgramme]);

  const onAssignProgramme = useCallback(() => {
    if (!id) return;
    openAssignProgram(id, () => void loadProgramme());
  }, [id, openAssignProgram, loadProgramme]);

  const onAssignWorkout = useCallback(() => {
    if (!id) return;
    openAssignWorkout(id, refreshAll);
  }, [id, openAssignWorkout, refreshAll]);

  const onEditTargets = useCallback(() => {
    if (!id) return;
    openEditTargets(
      id,
      initialFromCalorieHit(detail.data?.calorieHit ?? null),
      refreshAll,
    );
  }, [id, openEditTargets, detail.data, refreshAll]);

  const onAssignGoal = useCallback(() => {
    if (!id) return;
    openAssignGoalCreate(id, refreshAll);
  }, [id, openAssignGoalCreate, refreshAll]);

  const onEditGoal = useCallback(() => {
    const goal = detail.data?.goal;
    if (!id || !goal) return;
    openAssignGoalEdit(
      id,
      {
        goalId: goal.id,
        title: goal.title,
        targetDate: goal.targetDate,
      },
      refreshAll,
    );
  }, [id, detail.data, openAssignGoalEdit, refreshAll]);

  const onAddNote = useCallback(() => {
    if (!id) return;
    openNoteCreate(id, refreshAll);
  }, [id, openNoteCreate, refreshAll]);

  const onEditNote = useCallback(
    (note: ClientDetail["notes"][number]) => {
      if (!id) return;
      openNoteEdit(id, { noteId: note.id, content: note.content }, refreshAll);
    },
    [id, openNoteEdit, refreshAll],
  );

  return (
    <ClientDetailPresenter
      detail={detail.data}
      clientName={name ?? null}
      bodyTrend={bodyTrend}
      activeProgramme={activeProgramme}
      isLoading={
        detail.data === null && (detail.isRefreshing || trend.isLoading)
      }
      isRefreshing={detail.isRefreshing}
      error={detail.error}
      onRefresh={refreshAll}
      onBack={onBack}
      onLogWeight={onLogWeight}
      onManageHabits={onManageHabits}
      onAssignWorkout={onAssignWorkout}
      onEditTargets={onEditTargets}
      onAssignGoal={onAssignGoal}
      onEditGoal={onEditGoal}
      onOpenProgramme={onOpenProgramme}
      onAssignProgramme={onAssignProgramme}
      onAddNote={onAddNote}
      onEditNote={onEditNote}
    />
  );
}
