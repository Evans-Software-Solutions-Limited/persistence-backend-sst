import { ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { WorkoutCarouselCard } from "@/ui/components/composite/WorkoutCarouselCard";

/**
 * <WorkoutCarouselPresenter> — Home "TODAY" workouts carousel (home.jsx:181
 * `WorkoutCarousel`). Horizontal scroll of the signed-off
 * <WorkoutCarouselCard> (260pt tiles, first promoted). Pure; the container
 * maps `useWorkouts().mine` → items and wires navigation.
 */

export type WorkoutCarouselItem = {
  id: string;
  title: string;
  mins: number;
  sub: string;
  chips: string[];
};

export type WorkoutCarouselProps = {
  workouts: WorkoutCarouselItem[];
  isLoading?: boolean;
  onOpenWorkout: (id: string) => void;
  testID?: string;
};

export function WorkoutCarouselPresenter({
  workouts,
  isLoading = false,
  onOpenWorkout,
  testID = "workout-carousel",
}: WorkoutCarouselProps) {
  // Cold-start with no cache → a single skeleton tile (the card owns its
  // skeleton variant per 04 STORY-004 AC 4.6).
  if (isLoading && workouts.length === 0) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 12, paddingRight: 4 }}
        testID={`${testID}-loading`}
      >
        <WorkoutCarouselCard
          title=""
          mins={0}
          sub=""
          chips={[]}
          loading
          testID={`${testID}-skeleton`}
        />
      </ScrollView>
    );
  }

  if (workouts.length === 0) {
    return (
      <View testID={`${testID}-empty`} paddingVertical={18} alignItems="center">
        <Text fontFamily="$body" fontSize={13} color="$text3">
          No workouts yet — create one to get started.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 12, paddingRight: 4 }}
      testID={testID}
    >
      {workouts.map((w, i) => (
        <WorkoutCarouselCard
          key={w.id}
          title={w.title}
          mins={w.mins}
          sub={w.sub}
          chips={w.chips}
          primary={i === 0}
          onPress={() => onOpenWorkout(w.id)}
          testID={`${testID}-card-${i}`}
        />
      ))}
    </ScrollView>
  );
}
