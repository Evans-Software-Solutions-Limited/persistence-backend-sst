import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useGetClientBodyTrend } from "@/ui/hooks/useGetClientBodyTrend";
import { useGetClientDetail } from "@/ui/hooks/useGetClientDetail";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";
import { useAssignProgramSheet } from "@/state/assign-program-sheet";
import { useAssignWorkoutSheet } from "@/state/assign-workout-sheet";
import { useAssignGoalSheet } from "@/state/assign-goal-sheet";
import { useCoachNoteSheet } from "@/state/coach-note-sheet";
import { useSendBriefSheet } from "@/state/send-brief-sheet";
import { useSwapWorkoutSheet } from "@/state/swap-workout-sheet";
import {
  initialFromCalorieHit,
  useEditNutritionTargetsSheet,
} from "@/state/edit-nutrition-targets-sheet";
import type { ClientDetail } from "@/domain/models/clientDetail";
import type { CoachClientAssignment } from "@/domain/ports/api.port";
import {
  ClientDetailPresenter,
  initialsOf,
} from "@/ui/presenters/coach/ClientDetailPresenter";
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
  const { api, netInfo } = useAdapters();
  const online = useOnlineStatus();
  const openAssignProgram = useAssignProgramSheet((s) => s.openForClient);
  const openAssignWorkout = useAssignWorkoutSheet((s) => s.openSheet);
  const openAssignGoalCreate = useAssignGoalSheet((s) => s.openForCreate);
  const openAssignGoalEdit = useAssignGoalSheet((s) => s.openForEdit);
  const openEditTargets = useEditNutritionTargetsSheet((s) => s.openSheet);
  const openNoteCreate = useCoachNoteSheet((s) => s.openForCreate);
  const openNoteEdit = useCoachNoteSheet((s) => s.openForEdit);
  const openSendBrief = useSendBriefSheet((s) => s.openSheet);
  const openSwap = useSwapWorkoutSheet((s) => s.openSheet);

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

  // The client's OPEN assignments for the M18 Upcoming-sessions surface. Same
  // direct-read-per-visit posture as the programme above; refreshed on focus +
  // after a swap.
  const [assignments, setAssignments] = useState<CoachClientAssignment[]>([]);
  const loadAssignments = useCallback(async () => {
    if (!id) return;
    const result = await api.getClientWorkoutAssignments(id);
    if (result.ok) setAssignments(result.value);
  }, [api, id]);
  useEffect(() => {
    void loadAssignments();
  }, [loadAssignments]);

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
      void loadAssignments();
    }, [refreshDetail, refreshTrend, loadProgramme, loadAssignments]),
  );

  const refreshAll = useCallback(() => {
    void refreshDetail();
    void refreshTrend();
    void loadProgramme();
    void loadAssignments();
  }, [refreshDetail, refreshTrend, loadProgramme, loadAssignments]);

  const bodyTrend = useMemo(
    () => buildClientBodyTrend(trend.data ?? []),
    [trend.data],
  );

  // AI Client Summary (M8 Coach Phase 6, design.md § Module g). ONLINE-ONLY —
  // a direct adapter call, never the sync queue (mirrors Snap AI). The server
  // caps it at one auto-gen + one manual refresh per client per day; after
  // either, we refresh the aggregate so the card renders the cached row.
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const generateSummary = useCallback(
    async (manual: boolean) => {
      if (!id) return;
      setIsGeneratingSummary(true);
      try {
        // Ownership/entitlement/ceiling are all server-enforced; a 402/429/503
        // just leaves the card on its modules-a–f fallback (design.md §
        // Failure fallback), so we don't branch on the result here.
        await api.generateClientAiSummary(id, manual);
      } finally {
        setIsGeneratingSummary(false);
        void refreshDetail();
      }
    },
    [api, id, refreshDetail],
  );

  // Lazy trigger — fire ONCE per screen visit when the concluded day has no
  // cached summary and we're online (design.md: "generated the first time the
  // coach opens that client on/after the day rolls over"). The ref guards
  // against a re-fire when a failed generation leaves summary still null.
  const autoFiredSummary = useRef(false);
  useEffect(() => {
    autoFiredSummary.current = false;
  }, [id]);
  useEffect(() => {
    if (autoFiredSummary.current) return;
    if (!detail.data || detail.data.aiSummary.summary != null || !online)
      return;
    // `online` starts optimistically true and settles from netInfo within a
    // tick, so confirm connectivity authoritatively before spending — a
    // truly-offline open must never fire (design.md: offline shows cached, no
    // generation). On a confirmed-offline read we release the guard so a later
    // reconnect (online flips true → effect re-runs) can still fire once.
    autoFiredSummary.current = true;
    void (async () => {
      if (!(await netInfo.isConnected())) {
        autoFiredSummary.current = false;
        return;
      }
      await generateSummary(false);
    })();
  }, [detail.data, online, generateSummary, netInfo]);

  const onRegenerateSummary = useCallback(() => {
    void generateSummary(true);
  }, [generateSummary]);

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

  // Create-and-assign: open the creator in coach context carrying the client
  // id/name; the creator does the direct online create → ad-hoc assign on
  // save. The new assignment surfaces in Upcoming sessions on next refresh.
  const onCreateAssignWorkout = useCallback(() => {
    if (!id) return;
    const query = new URLSearchParams({ ctx: "coach", assignClientId: id });
    if (name) query.set("assignClientName", name);
    router.push(`/(app)/workouts/create?${query.toString()}` as never);
  }, [router, id, name]);

  const onEditTargets = useCallback(() => {
    if (!id) return;
    const client = detail.data?.client;
    openEditTargets(
      id,
      initialFromCalorieHit(
        detail.data?.calorieHit ?? null,
        client
          ? { ageYears: client.ageYears, heightCm: client.heightCm }
          : null,
      ),
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

  const onSendBrief = useCallback(() => {
    if (!id) return;
    openSendBrief(id, name);
  }, [id, openSendBrief, name]);

  const onSwapWorkout = useCallback(
    (assignment: CoachClientAssignment) => {
      if (!id) return;
      openSwap(id, assignment.assignmentId, assignment.name, refreshAll);
    },
    [id, openSwap, refreshAll],
  );

  // M18 Start-live: open the athlete active-session UI on the COACH's device in
  // withClient mode, seeded from the assignment's workout. The client ref is
  // carried as route params → ActiveSessionContainer promotes it onto the
  // useActiveWorkout pointer on start (banner + on-behalf record routing).
  const onStartSession = useCallback(
    (assignment: CoachClientAssignment) => {
      if (!id) return;
      const clientInitials =
        detail.data?.client.initials ?? (name ? initialsOf(name) : "?");
      router.push({
        pathname: "/(app)/session",
        params: {
          workoutId: assignment.workoutId,
          clientId: id,
          clientName: name ?? "",
          clientInitials,
        },
      } as never);
    },
    [id, name, detail.data, router],
  );

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
      assignments={assignments}
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
      onCreateAssignWorkout={onCreateAssignWorkout}
      onEditTargets={onEditTargets}
      onAssignGoal={onAssignGoal}
      onSendBrief={onSendBrief}
      onSwapWorkout={onSwapWorkout}
      onStartSession={onStartSession}
      onEditGoal={onEditGoal}
      onOpenProgramme={onOpenProgramme}
      onAssignProgramme={onAssignProgramme}
      onAddNote={onAddNote}
      onEditNote={onEditNote}
      isGeneratingSummary={isGeneratingSummary}
      online={online}
      onRegenerateSummary={onRegenerateSummary}
    />
  );
}
