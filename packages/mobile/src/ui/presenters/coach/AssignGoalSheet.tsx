import { useCallback, useEffect, useState } from "react";
import { TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet } from "@/ui/components/foundation/BottomSheet";
import { Btn } from "@/ui/components/foundation/Btn";
import { useAssignGoalSheet } from "@/state/assign-goal-sheet";
import { useAdapters } from "@/ui/hooks/useAdapters";
import type { GoalApiError } from "@/domain/ports/api.port";

/**
 * <AssignGoalSheet> — the coach assigns a new goal to a client or edits one it
 * previously assigned (M8 Coach Phase 5). Root-mounted; opened from Client
 * Detail with the client fixed.
 *
 *  - create mode (no `editGoal`): `POST /trainers/me/clients/:id/goals` — needs
 *    a `goalTypeId` + an optional target date.
 *  - edit mode (`editGoal` set): `PUT …/goals/:goalId` with the new target date
 *    / active state. The server enforces edit-own (403 `not_assigner`); the
 *    sheet only offers edit when `assignedByCoach`, and surfaces the 403
 *    gracefully if the server disagrees.
 *
 * Fidelity note: the prototype's GoalCard has an edit pencil but no goal-edit
 * sheet body — and there is NO goal-types list endpoint anywhere in the stack
 * (backend or mobile), so create mode takes the goal-type id as a field rather
 * than a picker. Flagged in the PR body as a spec-vs-reality gap.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Map a goal write/edit failure to friendly copy. Exported for testing. */
export function assignGoalErrorCopy(
  goalCode: GoalApiError["goalCode"] | undefined,
): string {
  switch (goalCode) {
    case "not_assigner":
      return "You can only edit goals you assigned to this client.";
    case "goal_not_found":
      return "That goal no longer exists — refresh and try again.";
    case "no_fields":
      return "Change at least one field before saving.";
    default:
      return "Couldn't save the goal. Please try again.";
  }
}

export function AssignGoalSheet() {
  const open = useAssignGoalSheet((s) => s.open);
  const clientId = useAssignGoalSheet((s) => s.clientId);
  const editGoal = useAssignGoalSheet((s) => s.editGoal);
  const onSaved = useAssignGoalSheet((s) => s.onSaved);
  const closeSheet = useAssignGoalSheet((s) => s.closeSheet);

  const { api } = useAdapters();

  const isEdit = editGoal !== null;

  const [goalTypeId, setGoalTypeId] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setGoalTypeId("");
      setTargetDate("");
      setError(null);
      setSubmitting(false);
      return;
    }
    setGoalTypeId("");
    setTargetDate(editGoal?.targetDate ?? "");
    setError(null);
    setSubmitting(false);
  }, [open, editGoal]);

  const dateValid = targetDate === "" || ISO_DATE.test(targetDate);
  const createReady = isEdit || goalTypeId.trim() !== "";
  const canSave = clientId !== null && dateValid && createReady && !submitting;

  // The Save button is disabled unless `canSave` holds (client set, date
  // valid, create-mode goal-type present), so the handler trusts those
  // preconditions rather than re-validating them.
  const handleSave = useCallback(async () => {
    if (!canSave || clientId === null) return;
    setError(null);
    setSubmitting(true);
    const targetDateArg = targetDate === "" ? undefined : targetDate;

    if (isEdit && editGoal) {
      const result = await api.updateClientGoal(clientId, editGoal.goalId, {
        targetDate: targetDateArg,
      });
      setSubmitting(false);
      if (result.ok) {
        onSaved?.();
        closeSheet();
        return;
      }
      setError(assignGoalErrorCopy(result.error.goalCode));
      return;
    }

    const result = await api.assignClientGoal(clientId, {
      goalTypeId: goalTypeId.trim(),
      targetDate: targetDateArg,
    });
    setSubmitting(false);
    if (result.ok) {
      onSaved?.();
      closeSheet();
      return;
    }
    setError(assignGoalErrorCopy(result.error.goalCode));
  }, [
    api,
    canSave,
    clientId,
    isEdit,
    editGoal,
    goalTypeId,
    targetDate,
    onSaved,
    closeSheet,
  ]);

  return (
    <BottomSheet
      visible={open}
      onClose={closeSheet}
      title={isEdit ? "Edit goal" : "Assign a goal"}
      accent="trainer"
      height="default"
    >
      <View gap={16} testID="assign-goal-sheet">
        {isEdit ? (
          <View gap={4}>
            <Text
              fontFamily="$display"
              fontSize={10.5}
              fontWeight="600"
              letterSpacing={1.7}
              textTransform="uppercase"
              color="$text3"
            >
              Goal
            </Text>
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={16}
              color="$text"
              testID="assign-goal-title"
            >
              {editGoal?.title}
            </Text>
          </View>
        ) : (
          <View gap={8}>
            <Text
              fontFamily="$display"
              fontSize={10.5}
              fontWeight="600"
              letterSpacing={1.7}
              textTransform="uppercase"
              color="$text3"
            >
              Goal type
            </Text>
            <TextInput
              value={goalTypeId}
              onChangeText={setGoalTypeId}
              placeholder="Goal type id"
              placeholderTextColor="#8A8A98"
              autoCapitalize="none"
              autoCorrect={false}
              testID="assign-goal-type"
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
        )}

        <View gap={8}>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
          >
            Target date (optional)
          </Text>
          <TextInput
            value={targetDate}
            onChangeText={setTargetDate}
            placeholder="YYYY-MM-DD"
            placeholderTextColor="#8A8A98"
            autoCapitalize="none"
            autoCorrect={false}
            testID="assign-goal-target-date"
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
            testID="assign-goal-error"
          >
            {error}
          </Text>
        ) : null}

        <Btn
          variant="filled"
          tone="trainer"
          disabled={!canSave}
          onPress={handleSave}
          testID="assign-goal-submit"
        >
          {submitting
            ? isEdit
              ? "Saving…"
              : "Assigning…"
            : isEdit
              ? "Save goal"
              : "Assign goal"}
        </Btn>
      </View>
    </BottomSheet>
  );
}
