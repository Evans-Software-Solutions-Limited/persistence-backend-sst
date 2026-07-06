import { useCallback, useEffect, useState } from "react";
import { Pressable, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet } from "@/ui/components/foundation/BottomSheet";
import { Btn } from "@/ui/components/foundation/Btn";
import { IconCheck } from "@/ui/components/icons";
import { useAssignWorkoutSheet } from "@/state/assign-workout-sheet";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * <AssignWorkoutSheet> — minimal ad-hoc single-workout assignment (specs/
 * 19-programs STORY-006). Root-mounted; opened from Client Detail with the
 * client fixed. The coach picks one of their own workouts + an optional due
 * date → `api.assignWorkout` (a `workout_assignments` row, no programme
 * linkage). Direct online call, like the programme-assign flow.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Map an assign-workout failure code to friendly copy. Exported for testing. */
export function assignWorkoutErrorCopy(
  programCode: string | undefined,
): string {
  switch (programCode) {
    case "invalid_workout":
      return "That workout must be your own or a public one.";
    case "not_your_client":
      return "You can only assign workouts to your active clients.";
    default:
      return "Couldn't assign the workout. Please try again.";
  }
}

export function AssignWorkoutSheet() {
  const open = useAssignWorkoutSheet((s) => s.open);
  const clientId = useAssignWorkoutSheet((s) => s.clientId);
  const onAssigned = useAssignWorkoutSheet((s) => s.onAssigned);
  const closeSheet = useAssignWorkoutSheet((s) => s.closeSheet);

  const { api } = useAdapters();

  const [workouts, setWorkouts] = useState<{ id: string; name: string }[]>([]);
  const [workoutId, setWorkoutId] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load the coach's own workouts when the sheet opens; reset on close.
  useEffect(() => {
    if (!open) {
      setWorkoutId(null);
      setDueDate("");
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

  const dueValid = dueDate === "" || ISO_DATE.test(dueDate);
  const canAssign =
    clientId !== null && workoutId !== null && dueValid && !submitting;

  const handleAssign = useCallback(async () => {
    if (clientId === null || workoutId === null) return;
    if (dueDate !== "" && !ISO_DATE.test(dueDate)) {
      setError("Enter the due date as YYYY-MM-DD, or leave it blank.");
      return;
    }
    setError(null);
    setSubmitting(true);
    const result = await api.assignWorkout(clientId, {
      workoutId,
      dueDate: dueDate === "" ? null : dueDate,
    });
    setSubmitting(false);
    if (result.ok) {
      onAssigned?.();
      closeSheet();
      return;
    }
    setError(assignWorkoutErrorCopy(result.error.programCode));
  }, [api, clientId, workoutId, dueDate, onAssigned, closeSheet]);

  return (
    <BottomSheet
      visible={open}
      onClose={closeSheet}
      title="Assign a workout"
      accent="trainer"
      height="default"
    >
      <View gap={16} testID="assign-workout-sheet">
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
              No workouts to assign — create one from the Train tab first.
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
                  testID={`assign-workout-${w.id}`}
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

        <View gap={8}>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
          >
            Due date (optional)
          </Text>
          <TextInput
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#8A8A98"
            autoCapitalize="none"
            autoCorrect={false}
            testID="assign-workout-due"
            style={{
              height: 44,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#232735",
              backgroundColor: "#1A1D29",
              paddingHorizontal: 14,
              color: "#F4F4F8",
              fontSize: 14,
            }}
          />
        </View>

        {error ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$error"
            testID="assign-workout-error"
          >
            {error}
          </Text>
        ) : null}

        <Btn
          variant="filled"
          tone="trainer"
          disabled={!canAssign}
          onPress={handleAssign}
          testID="assign-workout-submit"
        >
          {submitting ? "Assigning…" : "Assign workout"}
        </Btn>
      </View>
    </BottomSheet>
  );
}
