import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { color } from "@/ui/theme/tokens";

/**
 * Free-tier over-limit RECORD lock — resolution screen.
 *
 * Pure presenter for `/(app)/workout-limit-locked`. Reached from a
 * start-workout entry point whose client-side `useWorkoutTotalCapGate`
 * verdict is over-limit, or from the sync-blocked banner when the server's
 * `evaluateWorkoutTotalCapLock` backstop denies with reason
 * `'workout_limit_exceeded'`.
 *
 * Product decision (Brad, locked): free tier = 3 workouts TOTAL. A user who
 * is OVER that total — not merely at it — is locked out of starting or
 * recording a workout until they either delete down to the limit or
 * upgrade. Never auto-deletes anything; the user chooses what to remove.
 * The lock lifts automatically once their count drops to ≤ the limit or
 * they upgrade — there's no explicit "unlock" action, the gate simply stops
 * denying on the next check.
 */

export interface WorkoutLimitLockedPresenterProps {
  /** Current TOTAL workout count. */
  used: number;
  /** Free tier's workout limit (never null when this screen is shown). */
  limit: number;
  onGoToWorkouts: () => void;
  onUpgrade: () => void;
}

export function WorkoutLimitLockedPresenter({
  used,
  limit,
  onGoToWorkouts,
  onUpgrade,
}: WorkoutLimitLockedPresenterProps) {
  const overBy = Math.max(used - limit, 0);
  const workoutNoun = used === 1 ? "workout" : "workouts";
  const removeNoun = overBy === 1 ? "workout" : "workouts";

  return (
    <View style={styles.container} testID="workout-limit-locked">
      <View style={styles.iconWrap}>
        <Ionicons name="lock-closed" size={40} color={color.$warning} />
      </View>

      <Text style={styles.title}>
        You have {used} {workoutNoun}
      </Text>

      <Text style={styles.body}>
        Free includes {limit} — remove {overBy} {removeNoun} or upgrade to keep
        them all.
      </Text>

      <TouchableOpacity
        style={styles.primaryButton}
        onPress={onUpgrade}
        activeOpacity={0.7}
        testID="workout-limit-locked-upgrade"
      >
        <Text style={styles.primaryButtonText}>Upgrade</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={onGoToWorkouts}
        activeOpacity={0.7}
        testID="workout-limit-locked-go-to-workouts"
      >
        <Text style={styles.secondaryButtonText}>Go to My Workouts</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: color.$surface2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: color.$text,
    textAlign: "center",
  },
  body: {
    fontSize: 15,
    color: color.$text2,
    textAlign: "center",
    lineHeight: 21,
    marginBottom: 12,
  },
  primaryButton: {
    alignSelf: "stretch",
    backgroundColor: color.$primary,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: color.$bg,
  },
  secondaryButton: {
    alignSelf: "stretch",
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: color.$text3,
  },
});
