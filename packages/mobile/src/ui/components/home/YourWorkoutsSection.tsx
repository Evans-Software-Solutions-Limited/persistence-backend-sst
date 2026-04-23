import React from "react";
import {
  Dimensions,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Carousel from "react-native-reanimated-carousel";
import { Colors, Spacing, Typography } from "@/ui/theme/homeLegacyTheme";
import { WorkoutCard, type WorkoutCardWorkout } from "./WorkoutCard";

/**
 * Horizontal parallax workout carousel. Ported verbatim from
 * `persistence-mobile/components/home/YourWorkoutsSection/` — same
 * react-native-reanimated-carousel setup, same parallax mode, same
 * sizing rules. Only the theme import + WorkoutCard import were
 * swapped.
 */

interface YourWorkoutsSectionProps {
  readonly workouts: readonly WorkoutCardWorkout[];
  readonly currentUserId?: string;
  readonly onWorkoutPress: (workoutId: string) => void;
  readonly onWorkoutStart: (workoutId: string) => void;
  readonly onWorkoutEdit?: (workoutId: string) => void;
  readonly onWorkoutDelete?: (workoutId: string) => void;
  readonly onViewAllPress: () => void;
}

export function YourWorkoutsSection({
  workouts,
  currentUserId,
  onWorkoutPress,
  onWorkoutStart,
  onWorkoutEdit,
  onWorkoutDelete,
  onViewAllPress,
}: YourWorkoutsSectionProps) {
  const screenWidth = Dimensions.get("window").width;
  const cardWidth = screenWidth * 0.85; // 85% of screen width
  const itemWidth = cardWidth + Spacing.md; // Add spacing between cards
  // Fixed height that matches typical WorkoutCard content (title,
  // description, metadata, actions).
  const carouselHeight = 200;

  if (workouts.length === 0) {
    return null;
  }

  return (
    <View style={styles.container} testID="your-workouts-section">
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>Your Workouts</Text>
        <TouchableOpacity
          onPress={onViewAllPress}
          testID="your-workouts-view-all"
        >
          <Text style={styles.viewAllText}>View All</Text>
        </TouchableOpacity>
      </View>
      <Carousel
        width={itemWidth}
        height={carouselHeight}
        data={[...workouts]}
        renderItem={({ item }) => (
          <View style={styles.carouselItem}>
            <WorkoutCard
              workout={item}
              onPress={() => onWorkoutPress(item.id)}
              onStart={() => onWorkoutStart(item.id)}
              onEdit={onWorkoutEdit ? () => onWorkoutEdit(item.id) : undefined}
              onDelete={
                onWorkoutDelete ? () => onWorkoutDelete(item.id) : undefined
              }
              currentUserId={currentUserId}
            />
          </View>
        )}
        style={styles.carousel}
        snapEnabled
        pagingEnabled
        mode="parallax"
        modeConfig={{
          parallaxScrollingScale: 0.9,
          parallaxScrollingOffset: 50,
        }}
        scrollAnimationDuration={500}
        onConfigurePanGesture={(gesture) => {
          gesture.activeOffsetX([-10, 10]);
          gesture.failOffsetY([-5, 5]);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  sectionTitle: {
    ...Typography.h3,
  },
  viewAllText: {
    ...Typography.body2,
    color: Colors.primary.DEFAULT,
  },
  carousel: {
    width: "100%",
  },
  carouselItem: {
    paddingHorizontal: Spacing.xs,
  },
});
