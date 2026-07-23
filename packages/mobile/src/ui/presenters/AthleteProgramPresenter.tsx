import { Pressable, RefreshControl, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { ProgrammeCard } from "@/ui/components/composite";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import {
  IconBack,
  IconChevronR,
  IconClock,
  IconDumbbell,
} from "@/ui/components/icons";
import type { AthleteProgramDetail } from "@/domain/models/program";
import type { ApiError } from "@/shared/errors";

/**
 * <AthleteProgramPresenter> — read-only athlete view of an assigned programme
 * (specs/19-programs — athlete view). Shows the programme summary (name +
 * week progress) and the full ordered list of workouts in the plan; tapping a
 * workout opens it (where the athlete can start the session). A programme is
 * just a multi-workout plan, so this is the athlete's window into everything
 * it contains.
 *
 * Pure presentational; the container wires the direct fetch.
 */

export type AthleteProgramPresenterProps = {
  program: AthleteProgramDetail | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: ApiError | null;
  onRefresh: () => void;
  onBack: () => void;
  /** Open a workout in the plan (workout detail → start session). */
  onOpenWorkout: (workoutId: string) => void;
};

export function AthleteProgramPresenter({
  program,
  isLoading,
  isRefreshing,
  error,
  onRefresh,
  onBack,
  onOpenWorkout,
}: AthleteProgramPresenterProps) {
  const insets = useSafeAreaInsets();

  if (isLoading && program === null) {
    return (
      <View
        flex={1}
        alignItems="center"
        justifyContent="center"
        testID="athlete-program-loader"
      >
        <PLogoDrawLoader />
      </View>
    );
  }
  if (error && program === null) {
    return (
      <View flex={1} paddingTop={insets.top} testID="athlete-program-error">
        <BackRow onBack={onBack} />
        <ErrorState
          message="Couldn't load this programme."
          onRetry={onRefresh}
        />
      </View>
    );
  }

  return (
    <View flex={1} paddingTop={insets.top} testID="athlete-program">
      <BackRow onBack={onBack} />
      <ScrollView
        testID="athlete-program-scroll"
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        <View paddingHorizontal={16} gap={16}>
          {program ? (
            <ProgrammeCard
              programName={program.name}
              week={program.week}
              totalWeeks={program.durationWeeks}
              accent="primary"
              testID="athlete-program-card"
            />
          ) : null}

          {program?.description ? (
            <Text
              fontFamily="$body"
              fontSize={13.5}
              lineHeight={20}
              color="$text2"
              testID="athlete-program-description"
            >
              {program.description}
            </Text>
          ) : null}

          <View>
            <Text
              fontFamily="$display"
              fontSize={10.5}
              fontWeight="600"
              letterSpacing={1.7}
              textTransform="uppercase"
              color="$text3"
              marginBottom={10}
              paddingHorizontal={2}
            >
              Workouts in this plan
            </Text>

            {program && program.workouts.length > 0 ? (
              <Card pad={0} radius={16} testID="athlete-program-workouts">
                {program.workouts.map((w, i) => (
                  <Pressable
                    key={w.id}
                    onPress={() => onOpenWorkout(w.workoutId)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${w.name}`}
                    testID={`athlete-program-workout-${w.workoutId}`}
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                  >
                    <View
                      flexDirection="row"
                      alignItems="center"
                      gap={12}
                      paddingHorizontal={16}
                      paddingVertical={14}
                      borderTopWidth={i === 0 ? 0 : 1}
                      borderColor="$border"
                    >
                      <IconDumbbell size={18} color={toneHex("primary").base} />
                      <View flex={1}>
                        <Text
                          fontFamily="$display"
                          fontWeight="600"
                          fontSize={15}
                          color="$text"
                          numberOfLines={1}
                        >
                          {w.name}
                        </Text>
                        {w.estimatedDurationMinutes != null ? (
                          <View
                            flexDirection="row"
                            alignItems="center"
                            gap={4}
                            marginTop={2}
                          >
                            <IconClock size={11} color="#8A8A98" />
                            <Text
                              fontFamily="$body"
                              fontSize={11.5}
                              color="$text3"
                            >
                              {`${w.estimatedDurationMinutes} min`}
                            </Text>
                          </View>
                        ) : null}
                      </View>
                      <IconChevronR size={18} color="#8A8A98" />
                    </View>
                  </Pressable>
                ))}
              </Card>
            ) : (
              <Card pad={16} radius={16}>
                <Text
                  fontFamily="$body"
                  fontSize={13}
                  color="$text3"
                  testID="athlete-program-empty"
                >
                  This programme has no workouts yet.
                </Text>
              </Card>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

function BackRow({ onBack }: { onBack: () => void }) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      paddingHorizontal={16}
      paddingTop={8}
      paddingBottom={12}
    >
      <Pressable
        onPress={onBack}
        accessibilityRole="button"
        accessibilityLabel="Back"
        testID="athlete-program-back"
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <View flexDirection="row" alignItems="center" gap={4} padding={6}>
          <IconBack size={18} color="#C2C2CE" />
          <Text fontFamily="$body" fontSize={13.5} color="$text2">
            Back
          </Text>
        </View>
      </Pressable>
    </View>
  );
}
