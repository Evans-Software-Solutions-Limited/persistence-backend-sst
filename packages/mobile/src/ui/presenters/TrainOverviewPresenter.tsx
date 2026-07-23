import { RefreshControl, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import {
  ProgrammeCard,
  TodaysTrainingSection,
} from "@/ui/components/composite";
import { Card } from "@/ui/components/foundation";
import { toneTokens } from "@/ui/components/foundation/tones";
import type {
  ActiveProgramme,
  TodaysTrainingItem,
} from "@/domain/models/progress";
import {
  HABIT_CATEGORY_META,
  formatTarget,
  type HabitConfig,
} from "@/domain/models/habit-config";

/**
 * <TrainOverviewPresenter> — the Train tab's "Training" overview segment (M16).
 * Leads the Train hub with the athlete's coach-assigned plan: active programme →
 * today's training schedule → your daily/weekly targets.
 *
 * Pure presentational; the container wires the cache-first Home payload + habit
 * configs.
 */

export type TrainOverviewPresenterProps = {
  activeProgramme?: ActiveProgramme | null;
  todaysTraining: TodaysTrainingItem[];
  /** Enabled habits the athlete should aim for — informative targets display. */
  habits?: HabitConfig[];
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenWorkout: (workoutId: string) => void;
  onOpenProgramme?: () => void;
  /** Injected today (YYYY-MM-DD) for deterministic due-label tests. */
  todayISO?: string;
};

export function TrainOverviewPresenter({
  activeProgramme = null,
  todaysTraining,
  habits = [],
  isRefreshing,
  onRefresh,
  onOpenWorkout,
  onOpenProgramme,
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

        {/* Your Targets — the informative sheet of what the coach has set. */}
        {habits.length > 0 ? (
          <Card pad={0} radius={16} testID="train-targets-card">
            <View padding={16} paddingBottom={12}>
              <Text
                fontFamily="$display"
                fontWeight="700"
                fontSize={18}
                color="$text"
              >
                Your targets
              </Text>
              <Text
                fontFamily="$body"
                fontSize={12.5}
                color="$text3"
                marginTop={4}
              >
                What your coach has set for you to aim for each week.
              </Text>
            </View>
            {habits.map((h) => (
              <HabitTargetRow key={h.category} habit={h} />
            ))}
          </Card>
        ) : null}
      </View>
    </ScrollView>
  );
}

// ── HabitTargetRow ─────────────────────────────────────────────────────────────

function HabitTargetRow({ habit }: { habit: HabitConfig }) {
  const meta = HABIT_CATEGORY_META[habit.category];
  const tone = toneTokens(meta.tone);
  const freqLabel =
    habit.category === "gym"
      ? `${formatTarget(habit.category, habit.targetValue)}× / week`
      : habit.daysPerWeek
        ? `${habit.daysPerWeek} days / week`
        : "";
  const targetLabel =
    habit.category === "gym"
      ? ""
      : `${formatTarget(habit.category, habit.targetValue)} ${habit.unit}`;

  return (
    <View
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      paddingHorizontal={16}
      paddingVertical={12}
      borderTopWidth={1}
      borderColor="$border"
      testID={`train-target-${habit.category}`}
    >
      {/* Left: tone dot + label + target */}
      <View flexDirection="row" alignItems="center" gap={10} flex={1}>
        <View
          width={10}
          height={10}
          borderRadius={5}
          backgroundColor={tone.base}
        />
        <View>
          <Text
            fontFamily="$display"
            fontSize={14}
            fontWeight="600"
            color="$text"
          >
            {meta.name}
          </Text>
          {targetLabel ? (
            <Text fontFamily="$mono" fontSize={12} color="$text2" marginTop={1}>
              {targetLabel}
            </Text>
          ) : null}
        </View>
      </View>
      {/* Right: frequency */}
      {freqLabel ? (
        <Text fontFamily="$body" fontSize={11.5} color="$text3">
          {freqLabel}
        </Text>
      ) : null}
    </View>
  );
}
