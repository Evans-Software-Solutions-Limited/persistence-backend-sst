import { RefreshControl, ScrollView } from "react-native";
import { View } from "@tamagui/core";
import {
  ProgrammeCard,
  TodaysTrainingSection,
} from "@/ui/components/composite";
import type {
  ActiveProgramme,
  TodaysTrainingItem,
} from "@/domain/models/progress";

/**
 * <TrainOverviewPresenter> — the Train tab's "Training" overview segment (M16).
 * Leads the Train hub with the athlete's coach-assigned plan: active programme →
 * today's training schedule. Pure presentational; the container wires the
 * cache-first Home payload.
 *
 * Coach attribution (Phase 11) rides through: ProgrammeCard's `coachName` and
 * the shared <TodaysTrainingSection> rows.
 *
 * NOTE: the Goals section was hidden for launch (decision C — goals were an
 * inert, half-shipped feature); the goal components are parked for the future
 * "make goals real" spec.
 */

export type TrainOverviewPresenterProps = {
  activeProgramme?: ActiveProgramme | null;
  todaysTraining: TodaysTrainingItem[];
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
      </View>
    </ScrollView>
  );
}
