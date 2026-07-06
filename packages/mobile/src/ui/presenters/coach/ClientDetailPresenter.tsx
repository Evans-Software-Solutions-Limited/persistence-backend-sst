import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { Btn, HeaderBar, IconBtn } from "@/ui/components/foundation";
import { ProgrammeCard, Section } from "@/ui/components/composite";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconBack, IconPlus } from "@/ui/components/icons";
import {
  BodyTrendPresenter,
  type TrendData,
} from "@/ui/presenters/BodyTrendPresenter";
import type { ActiveProgramme } from "@/domain/models/progress";

/**
 * <ClientDetailPresenter> — interim Client Detail slice (10-trainer-features
 * 10.9.3): client body trend + the Log-weight action. The full 5-tab screen
 * (Overview / Workouts / Nutrition / Notes / Settings, per design.md
 * § Frontend — Client Detail) is a later slice; this replaces the bare
 * ComingSoon stub with the one read surface that's wired today, reusing the
 * athlete-side <BodyTrendPresenter> unchanged.
 */

export type ClientDetailProps = {
  clientName: string | null;
  bodyTrend: { weight: TrendData & { unit: "kg" | "lb" }; bodyFat: TrendData };
  /** The client's live programme, or null (specs/19-programs AC 4.5). */
  activeProgramme: ActiveProgramme | null;
  /** True until the first trend fetch resolves. */
  isLoading: boolean;
  error: string | null;
  onLogWeight: () => void;
  onBack: () => void;
  /** Open the client's habit-setup screen (18-habit-setup coach view). */
  onManageHabits: () => void;
  /** Tap the ProgrammeCard → open the programme editor. */
  onOpenProgramme: () => void;
  /** Open the assign-programme sheet (client-anchored). */
  onAssignProgramme: () => void;
  /** Open the ad-hoc assign-workout sheet (STORY-006). */
  onAssignWorkout: () => void;
};

export function ClientDetailPresenter({
  clientName,
  bodyTrend,
  activeProgramme,
  isLoading,
  error,
  onLogWeight,
  onBack,
  onManageHabits,
  onOpenProgramme,
  onAssignProgramme,
  onAssignWorkout,
}: ClientDetailProps) {
  const insets = useSafeAreaInsets();
  const hasData =
    bodyTrend.weight.series.length > 0 || bodyTrend.bodyFat.series.length > 0;

  return (
    <View flex={1} paddingTop={insets.top} testID="client-detail">
      <HeaderBar
        eyebrow="COACHING"
        title={clientName ?? "Client"}
        leading={
          <IconBtn
            icon={<IconBack size={20} />}
            tone="neutral"
            onPress={onBack}
            accessibilityLabel="Back"
          />
        }
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, gap: 20 }}
      >
        <Section eyebrow="BODY" title="Trend" testID="client-detail-body">
          <BodyTrendPresenter
            weight={bodyTrend.weight}
            bodyFat={bodyTrend.bodyFat}
            testID="client-detail-body-trend"
          />
          {!isLoading && !error && !hasData ? (
            <Text
              fontSize={13}
              color="$text3"
              marginTop={10}
              testID="client-detail-empty"
            >
              No measurements in the last 30 days — log a weight to start the
              trend.
            </Text>
          ) : null}
          {error ? (
            <Text
              fontSize={13}
              color="$error"
              marginTop={10}
              testID="client-detail-error"
            >
              {error}
            </Text>
          ) : null}
        </Section>

        <Section
          eyebrow="PROGRAMME"
          title="Training plan"
          testID="client-detail-programme"
        >
          {activeProgramme ? (
            <View gap={12}>
              <ProgrammeCard
                programName={activeProgramme.name}
                week={activeProgramme.week}
                totalWeeks={activeProgramme.totalWeeks}
                accent="trainer"
                onPress={onOpenProgramme}
                testID="client-detail-programme-card"
              />
              <Btn
                variant="ghost"
                tone="trainer"
                onPress={onAssignWorkout}
                testID="client-detail-assign-workout"
              >
                Assign a one-off workout
              </Btn>
            </View>
          ) : (
            <View gap={10}>
              <Text fontSize={13} color="$text3">
                No active programme — assign one to schedule this client&rsquo;s
                training.
              </Text>
              <Btn
                variant="soft"
                tone="trainer"
                onPress={onAssignProgramme}
                testID="client-detail-assign-programme"
              >
                Assign programme
              </Btn>
              <Btn
                variant="ghost"
                tone="trainer"
                onPress={onAssignWorkout}
                testID="client-detail-assign-workout"
              >
                Assign a one-off workout
              </Btn>
            </View>
          )}
        </Section>

        <Section
          eyebrow="HABITS"
          title="Daily habits"
          testID="client-detail-habits"
        >
          <Btn
            variant="soft"
            tone="trainer"
            onPress={onManageHabits}
            testID="client-detail-manage-habits"
          >
            Manage habits
          </Btn>
        </Section>

        <Text fontSize={12} color="$text3">
          Notes and session history arrive in a later slice.
        </Text>
      </ScrollView>

      <View
        paddingHorizontal={20}
        paddingTop={12}
        paddingBottom={insets.bottom + 20}
      >
        <Btn
          full
          variant="filled"
          tone="trainer"
          icon={<IconPlus size={16} color={toneHex("trainer").ink} />}
          onPress={onLogWeight}
          testID="client-detail-log-weight"
        >
          Log weight
        </Btn>
      </View>
    </View>
  );
}
