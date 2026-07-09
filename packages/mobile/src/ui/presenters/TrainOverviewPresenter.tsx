import { ActivityIndicator, RefreshControl, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import {
  GoalCard,
  ProgrammeCard,
  Section,
  TodaysTrainingSection,
} from "@/ui/components/composite";
import { toneHex } from "@/ui/components/foundation/tones";
import type {
  ActiveProgramme,
  TodaysTrainingItem,
} from "@/domain/models/progress";
import type { Goal } from "@/domain/models/goal";

/**
 * <TrainOverviewPresenter> — the Train tab's "Training" overview segment (M16).
 * Leads the Train hub with the athlete's plan: active programme → today's
 * training schedule → goals, keeping the Workouts/Exercises library segments
 * intact. Pure presentational; the container wires the cache-first hooks + the
 * goal sheet/commands.
 *
 * Coach attribution (Phase 11) rides through: ProgrammeCard's `coachName`, the
 * shared <TodaysTrainingSection> rows, and each coach-assigned <GoalCard>.
 * Goals show NO progress bar (decision #2). Coach-assigned goals are view-only
 * (no edit/delete); self-set goals get edit + delete + an "Add goal" CTA.
 */

export type TrainOverviewPresenterProps = {
  activeProgramme?: ActiveProgramme | null;
  todaysTraining: TodaysTrainingItem[];
  goals: Goal[];
  goalsLoading: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenWorkout: (workoutId: string) => void;
  onOpenProgramme?: () => void;
  onAddGoal: () => void;
  onEditGoal: (goal: Goal) => void;
  onDeleteGoal: (goal: Goal) => void;
  /** Injected today (YYYY-MM-DD) for deterministic due-label tests. */
  todayISO?: string;
};

export function TrainOverviewPresenter({
  activeProgramme = null,
  todaysTraining,
  goals,
  goalsLoading,
  isRefreshing,
  onRefresh,
  onOpenWorkout,
  onOpenProgramme,
  onAddGoal,
  onEditGoal,
  onDeleteGoal,
  todayISO,
}: TrainOverviewPresenterProps) {
  return (
    <ScrollView
      testID="train-overview-scroll"
      contentContainerStyle={{ paddingBottom: 140 }}
      refreshControl={
        <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
      }
    >
      <View paddingHorizontal={16} paddingTop={4} gap={16}>
        {/* Active programme — hidden when the athlete has no live plan. */}
        {activeProgramme ? (
          <View testID="train-active-programme">
            <ProgrammeCard
              programName={activeProgramme.name}
              week={activeProgramme.week}
              totalWeeks={activeProgramme.totalWeeks}
              coachName={activeProgramme.assignedByName ?? null}
              accent="primary"
              onPress={onOpenProgramme}
              testID="train-programme-card"
            />
          </View>
        ) : null}

        {/* Today's training — shared with Home; hidden when empty. */}
        <TodaysTrainingSection
          items={todaysTraining}
          onOpenWorkout={onOpenWorkout}
          todayISO={todayISO}
          testID="train-todays-training"
        />

        {/* Goals — always present (with an Add CTA + empty state) so the
            overview is never blank. */}
        <View testID="train-goals">
          <Section
            eyebrow="GOALS"
            title="Goals"
            action={
              <Text
                fontSize={12}
                color="$primary"
                onPress={onAddGoal}
                testID="train-add-goal"
              >
                Add goal
              </Text>
            }
          >
            {goalsLoading && goals.length === 0 ? (
              <View
                paddingVertical={20}
                alignItems="center"
                testID="train-goals-loading"
              >
                <ActivityIndicator
                  size="small"
                  color={toneHex("primary").base}
                />
              </View>
            ) : goals.length === 0 ? (
              <View paddingVertical={16} testID="train-goals-empty">
                <Text fontFamily="$body" fontSize={13} color="$text3">
                  No goals yet — add one to track what you’re working toward.
                </Text>
              </View>
            ) : (
              <View gap={8}>
                {goals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    onEdit={goal.isCoachAssigned ? undefined : onEditGoal}
                    onDelete={goal.isCoachAssigned ? undefined : onDeleteGoal}
                  />
                ))}
              </View>
            )}
          </Section>
        </View>
      </View>
    </ScrollView>
  );
}
