import { WorkoutLimitLockedContainer } from "../../src/ui/containers/WorkoutLimitLockedContainer";

/**
 * Free-tier over-limit RECORD lock — resolution screen.
 *
 * Reached from a start-workout entry point (`WorkoutsListContainer`,
 * `WorkoutDetailContainer`) whose `useWorkoutTotalCapGate` verdict is
 * over-limit, or from the sync-blocked banner when a queued record's
 * server verdict carries reason `'workout_limit_exceeded'`.
 */
export default function WorkoutLimitLockedScreen() {
  return <WorkoutLimitLockedContainer />;
}
