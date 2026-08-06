import { WorkoutLimitLockedPresenter } from "@/ui/presenters/WorkoutLimitLockedPresenter";
import { useWorkoutTotalCapGate } from "@/ui/hooks/useWorkoutTotalCapGate";

/**
 * Container for `/(app)/workout-limit-locked`.
 *
 * Reads the SAME live gate the start-workout entry points consult
 * (`useWorkoutTotalCapGate`) so this screen's copy always reflects the
 * user's CURRENT count — if they delete a workout on another screen and
 * come back, or upgrade, the numbers here update on next focus. There's no
 * separate "unlocked" state to render: once the gate resolves not-over-limit,
 * the entry points simply stop routing here — this screen doesn't need to
 * self-dismiss.
 */
export function WorkoutLimitLockedContainer() {
  const gate = useWorkoutTotalCapGate();

  return (
    <WorkoutLimitLockedPresenter
      used={gate.used}
      limit={gate.limit ?? 3}
      onGoToWorkouts={gate.onGoToWorkouts}
      onUpgrade={gate.onUpgrade}
    />
  );
}
