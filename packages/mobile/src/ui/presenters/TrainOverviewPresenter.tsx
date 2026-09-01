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
  coaching?: {
    coachName: string;
    coachRole: string | null;
    nutritionTarget: import("@/domain/models/nutrition").NutritionTarget | null;
    activeGoal: import("@/domain/models/clientRelationship").AthleteCoachingAssignment["activeGoal"];
    visibleBriefs: import("@/domain/models/clientRelationship").AthleteCoachingAssignment["visibleBriefs"];
    assignmentLoaded: boolean;
  } | null;
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
  coaching = null,
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
        {coaching ? (
          <Card pad={16} radius={16} accent="trainer" testID="train-coach-card">
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={17}
              color="$text"
            >
              Coaching with {coaching.coachName}
            </Text>
            <Text fontFamily="$body" fontSize={12} color="$text3" marginTop={3}>
              {coaching.coachRole === "physiotherapist"
                ? "Physiotherapist"
                : "Coach"}{" "}
              · Your assigned setup
            </Text>
          </Card>
        ) : null}
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

        {coaching && todaysTraining.length === 0 ? (
          <CoachingEmpty
            title="No upcoming workouts"
            body="Your coach hasn't scheduled another workout yet."
            testID="train-workouts-empty"
          />
        ) : null}

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
        ) : coaching ? (
          <CoachingEmpty
            title="No habits assigned"
            body="Your coach hasn't set any habit targets yet."
            testID="train-habits-empty"
          />
        ) : null}

        {coaching?.nutritionTarget ? (
          <Card pad={16} radius={16} testID="train-nutrition-target">
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={17}
              color="$text"
            >
              Nutrition target
            </Text>
            <Text
              fontFamily="$mono"
              fontSize={20}
              color="$primary"
              marginTop={8}
            >
              {coaching.nutritionTarget.dailyKcal} kcal
            </Text>
            <Text fontFamily="$body" fontSize={12} color="$text3" marginTop={3}>
              {coaching.nutritionTarget.proteinG}g protein ·{" "}
              {coaching.nutritionTarget.carbsG}g carbs ·{" "}
              {coaching.nutritionTarget.fatG}g fat
            </Text>
          </Card>
        ) : coaching ? (
          <CoachingEmpty
            title="No nutrition target"
            body="Your coach hasn't set a nutrition target yet."
            testID="train-nutrition-empty"
          />
        ) : null}

        {coaching?.activeGoal ? (
          <Card pad={16} radius={16} testID="train-active-goal">
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={17}
              color="$text"
            >
              Active goal
            </Text>
            <Text fontFamily="$body" fontSize={14} color="$text2" marginTop={6}>
              {coaching.activeGoal.title}
            </Text>
          </Card>
        ) : coaching ? (
          <CoachingEmpty
            title="No active goal"
            body="Your coach hasn't assigned a goal yet."
            testID="train-goal-empty"
          />
        ) : null}

        {coaching?.visibleBriefs.length ? (
          <Card pad={0} radius={16} testID="train-visible-briefs">
            <View padding={16} paddingBottom={10}>
              <Text
                fontFamily="$display"
                fontWeight="700"
                fontSize={17}
                color="$text"
              >
                Coach briefs
              </Text>
            </View>
            {coaching.visibleBriefs.map((brief) => (
              <View
                key={brief.id}
                paddingHorizontal={16}
                paddingVertical={12}
                borderTopWidth={1}
                borderColor="$border"
              >
                {brief.title ? (
                  <Text fontFamily="$display" fontWeight="600" color="$text">
                    {brief.title}
                  </Text>
                ) : null}
                <Text
                  fontFamily="$body"
                  fontSize={13}
                  color="$text2"
                  marginTop={brief.title ? 4 : 0}
                >
                  {brief.content}
                </Text>
              </View>
            ))}
          </Card>
        ) : coaching ? (
          <CoachingEmpty
            title="No coach briefs"
            body="Messages and plan notes your coach shares will appear here."
            testID="train-briefs-empty"
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

function CoachingEmpty({
  title,
  body,
  testID,
}: {
  title: string;
  body: string;
  testID: string;
}) {
  return (
    <Card pad={16} radius={16} testID={testID}>
      <Text fontFamily="$display" fontWeight="700" fontSize={15} color="$text">
        {title}
      </Text>
      <Text fontFamily="$body" fontSize={12.5} color="$text3" marginTop={4}>
        {body}
      </Text>
    </Card>
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
