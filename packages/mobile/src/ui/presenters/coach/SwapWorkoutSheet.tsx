import { useCallback, useEffect, useState } from "react";
import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet } from "@/ui/components/foundation/BottomSheet";
import { Btn } from "@/ui/components/foundation/Btn";
import { IconCheck } from "@/ui/components/icons";
import { useSwapWorkoutSheet } from "@/state/swap-workout-sheet";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * <SwapWorkoutSheet> — coach replaces the workout on an open assignment (M18).
 * Root-mounted; opened from a Client Detail Upcoming-sessions row. The coach
 * picks one of their own (or a public) workouts → `api.swapClientWorkoutAssignment`
 * (`PATCH .../workout-assignments/:id`). Online-direct, like the other coach
 * writes. Mirrors <AssignWorkoutSheet>'s picker.
 */

/** Map a swap failure code to friendly copy. Exported for testing. */
export function swapWorkoutErrorCopy(programCode: string | undefined): string {
  switch (programCode) {
    case "invalid_workout":
      return "That workout must be your own or a public one.";
    case "same_workout":
      return "That's the workout already assigned — pick a different one.";
    case "not_swappable":
      return "This session can no longer be swapped (already started or done).";
    case "not_found":
      return "That assignment no longer exists.";
    case "not_your_client":
      return "You can only swap workouts for your active clients.";
    default:
      return "Couldn't swap the workout. Please try again.";
  }
}

export function SwapWorkoutSheet() {
  const open = useSwapWorkoutSheet((s) => s.open);
  const clientId = useSwapWorkoutSheet((s) => s.clientId);
  const assignmentId = useSwapWorkoutSheet((s) => s.assignmentId);
  const currentName = useSwapWorkoutSheet((s) => s.currentName);
  const onSwapped = useSwapWorkoutSheet((s) => s.onSwapped);
  const closeSheet = useSwapWorkoutSheet((s) => s.closeSheet);

  const { api } = useAdapters();

  const [workouts, setWorkouts] = useState<{ id: string; name: string }[]>([]);
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setWorkoutId(null);
      setError(null);
      setSubmitting(false);
      return;
    }
    let alive = true;
    void (async () => {
      const result = await api.getWorkouts({ type: "mine" });
      if (alive && result.ok) {
        setWorkouts(
          result.value.workouts.map((w) => ({ id: w.id, name: w.name })),
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, api]);

  const canSwap =
    clientId !== null &&
    assignmentId !== null &&
    workoutId !== null &&
    !submitting;

  const handleSwap = useCallback(async () => {
    if (clientId === null || assignmentId === null || workoutId === null)
      return;
    setError(null);
    setSubmitting(true);
    const result = await api.swapClientWorkoutAssignment(
      clientId,
      assignmentId,
      { workoutId },
    );
    setSubmitting(false);
    if (result.ok) {
      onSwapped?.();
      closeSheet();
      return;
    }
    setError(swapWorkoutErrorCopy(result.error.programCode));
  }, [api, clientId, assignmentId, workoutId, onSwapped, closeSheet]);

  return (
    <BottomSheet
      visible={open}
      onClose={closeSheet}
      title="Swap workout"
      accent="trainer"
      height="default"
    >
      <View gap={16} testID="swap-workout-sheet">
        {currentName ? (
          <Text fontFamily="$body" fontSize={13} color="$text3">
            Replacing <Text color="$text">{currentName}</Text> with:
          </Text>
        ) : null}

        <View gap={8}>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
          >
            Workout
          </Text>
          {workouts.length === 0 ? (
            <Text fontFamily="$body" fontSize={13} color="$text3">
              No workouts to swap in — create one from the Train tab first.
            </Text>
          ) : (
            workouts.map((w) => {
              const selected = w.id === workoutId;
              return (
                <Pressable
                  key={w.id}
                  onPress={() => setWorkoutId(w.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  testID={`swap-workout-${w.id}`}
                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                >
                  <View
                    flexDirection="row"
                    alignItems="center"
                    gap={12}
                    padding={12}
                    borderRadius={12}
                    borderWidth={1}
                    borderColor={selected ? "$accentTrainer" : "$border"}
                    backgroundColor={
                      selected ? "$accentTrainerDim" : "$surface2"
                    }
                  >
                    <Text
                      flex={1}
                      fontFamily="$display"
                      fontWeight="600"
                      fontSize={14}
                      color="$text"
                      numberOfLines={1}
                    >
                      {w.name}
                    </Text>
                    {selected ? <IconCheck size={16} color="#A78BFA" /> : null}
                  </View>
                </Pressable>
              );
            })
          )}
        </View>

        {error ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$error"
            testID="swap-workout-error"
          >
            {error}
          </Text>
        ) : null}

        <Btn
          variant="filled"
          tone="trainer"
          disabled={!canSwap}
          onPress={handleSwap}
          testID="swap-workout-submit"
        >
          {submitting ? "Swapping…" : "Swap workout"}
        </Btn>
      </View>
    </BottomSheet>
  );
}
