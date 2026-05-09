import { Colors, Spacing, Typography } from "@/ui/theme/workoutsLegacyTheme";

// Mirrors persistence-mobile/components/workouts/ActiveWorkoutScreen
// styles.header / .timerSection / .timer / .workoutName (336-360).
// Flush row, no background or border — sits inside the screen's
// content padding rather than as a top-bar.
export const styles = {
  container: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    paddingBottom: Spacing.sm,
  },
  workoutName: {
    ...Typography.h3,
    color: Colors.text.primary,
    textAlign: "center" as const,
    flexShrink: 1,
  },
  timerSection: {
    flexDirection: "row" as const,
    gap: Spacing.sm,
    justifyContent: "center" as const,
    alignItems: "center" as const,
  },
  timer: {
    ...Typography.h3,
    color: Colors.text.primary,
    fontWeight: "700" as const,
  },
};
