import { useCallback, useMemo } from "react";
import { Alert } from "react-native";
import { useRouter } from "expo-router";
import { useGetHome } from "@/ui/hooks/useGetHome";
import { useGetGoals } from "@/ui/hooks/useGetGoals";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useGoalSheet } from "@/state/goal-sheet";
import { deleteGoalCommand } from "@/application/commands";
import { TrainOverviewPresenter } from "@/ui/presenters/TrainOverviewPresenter";
import type { Goal } from "@/domain/models/goal";

/**
 * <TrainOverviewContainer> — the Train hub's "Training" segment (M16). Wires the
 * cache-first Home payload (active programme + today's training) and the
 * cache-first goals list into <TrainOverviewPresenter>, plus the root-mounted
 * <GoalSheet> (create/edit) and the optimistic delete command.
 *
 * Reuses `useGetHome` (both Home and Train read the same cached payload) rather
 * than a bespoke endpoint. Goal mutations follow the optimistic + `reload()`
 * pattern (the #173 lesson): the command writes the cache, the container
 * re-reads it so the list re-renders before the network reconciles.
 */
export function TrainOverviewContainer() {
  const router = useRouter();
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const home = useGetHome();
  const goalsState = useGetGoals();
  const openForCreate = useGoalSheet((s) => s.openForCreate);
  const openForEdit = useGoalSheet((s) => s.openForEdit);

  const goals = useMemo(() => goalsState.data ?? [], [goalsState.data]);
  const reloadGoals = goalsState.reload;
  const refreshHome = home.refresh;
  const refreshGoals = goalsState.refresh;

  const goalsLoading =
    goalsState.data === null &&
    (goalsState.isRefreshing ||
      (goalsState.isStale && goalsState.error === null));

  const onRefresh = useCallback(() => {
    void Promise.all([refreshHome(), refreshGoals()]);
  }, [refreshHome, refreshGoals]);

  const onOpenWorkout = useCallback(
    (workoutId: string) => {
      router.push(`/(app)/workouts/${workoutId}` as never);
    },
    [router],
  );

  const onAddGoal = useCallback(() => {
    // A user can hold one goal per type (user_goals UNIQUE) — exclude the types
    // already owned (self OR coach-assigned) from the create picker.
    openForCreate(
      goals.map((g) => g.goalTypeId),
      reloadGoals,
    );
  }, [openForCreate, goals, reloadGoals]);

  const onEditGoal = useCallback(
    (goal: Goal) => {
      openForEdit(
        {
          goalId: goal.id,
          goalTypeName: goal.goalTypeName,
          targetDate: goal.targetDate,
        },
        reloadGoals,
      );
    },
    [openForEdit, reloadGoals],
  );

  const onDeleteGoal = useCallback(
    (goal: Goal) => {
      if (userId === null) return;
      Alert.alert(
        "Delete goal",
        `Delete “${goal.goalTypeName ?? "this goal"}”? This can't be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => {
              const p = deleteGoalCommand({ storage, api, userId }, goal.id);
              // Reflect the optimistic removal immediately (cache written
              // synchronously before the command awaits), then reconcile /
              // revert once the network resolves.
              reloadGoals();
              void p.then(() => reloadGoals());
            },
          },
        ],
      );
    },
    [userId, storage, api, reloadGoals],
  );

  return (
    <TrainOverviewPresenter
      activeProgramme={home.data?.activeProgramme ?? null}
      todaysTraining={home.data?.todaysTraining ?? []}
      goals={goals}
      goalsLoading={goalsLoading}
      isRefreshing={home.isRefreshing || goalsState.isRefreshing}
      onRefresh={onRefresh}
      onOpenWorkout={onOpenWorkout}
      onAddGoal={onAddGoal}
      onEditGoal={onEditGoal}
      onDeleteGoal={onDeleteGoal}
    />
  );
}
