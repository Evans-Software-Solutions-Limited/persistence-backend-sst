import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet } from "@/ui/components/foundation/BottomSheet";
import { Btn } from "@/ui/components/foundation/Btn";
import { toneHex } from "@/ui/components/foundation/tones";
import { useAssignGoalSheet } from "@/state/assign-goal-sheet";
import { useAdapters } from "@/ui/hooks/useAdapters";
import type { GoalApiError, GoalType } from "@/domain/ports/api.port";

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
 * Create mode fetches the shared `goal_types` catalog (`GET /goal-types`) on
 * open and renders it as a selectable list — the coach picks a goal type rather
 * than typing a UUID. Edit mode shows the existing goal title (goal type is
 * immutable once assigned) and only edits the target date.
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
  const [goalTypes, setGoalTypes] = useState<GoalType[]>([]);
  const [loadingTypes, setLoadingTypes] = useState(false);
  const [typesError, setTypesError] = useState(false);

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

  // Load the goal-type catalog once per open, create mode only (edit mode keeps
  // the existing goal type). Kept in the sheet — it's a small static catalog, no
  // cache-first hook needed; a failure surfaces a retry, never a blank picker.
  const loadGoalTypes = useCallback(async () => {
    setLoadingTypes(true);
    setTypesError(false);
    const result = await api.getGoalTypes();
    if (result.ok) {
      setGoalTypes(result.value);
    } else {
      setTypesError(true);
    }
    setLoadingTypes(false);
  }, [api]);

  useEffect(() => {
    if (open && !isEdit) void loadGoalTypes();
  }, [open, isEdit, loadGoalTypes]);

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
            {loadingTypes ? (
              <View
                paddingVertical={20}
                alignItems="center"
                testID="assign-goal-types-loading"
              >
                <ActivityIndicator
                  size="small"
                  color={toneHex("trainer").base}
                />
              </View>
            ) : typesError ? (
              <View gap={8} testID="assign-goal-types-error">
                <Text fontFamily="$body" fontSize={13} color="$text3">
                  Couldn’t load goal types.
                </Text>
                <Btn
                  variant="soft"
                  tone="trainer"
                  size="sm"
                  onPress={() => void loadGoalTypes()}
                  testID="assign-goal-types-retry"
                >
                  Retry
                </Btn>
              </View>
            ) : goalTypes.length === 0 ? (
              <Text
                fontFamily="$body"
                fontSize={13}
                color="$text3"
                testID="assign-goal-types-empty"
              >
                No goal types available.
              </Text>
            ) : (
              // Render the goal-type list as a plain (non-scrolling) column.
              // The enclosing <BottomSheet> already wraps its children in
              // gorhom's gesture-aware BottomSheetScrollView, so the whole
              // sheet scrolls. A nested raw RN ScrollView here fought the
              // sheet's pan-down-to-close gesture — dragging to scroll the
              // picker flicked the drawer. Letting the sheet own the single
              // scroll axis removes the conflict.
              <View gap={8} testID="assign-goal-types-list">
                {goalTypes.map((gt) => {
                  const selected = gt.id === goalTypeId;
                  return (
                    <Pressable
                      key={gt.id}
                      onPress={() => setGoalTypeId(gt.id)}
                      testID={`assign-goal-type-${gt.id}`}
                      accessibilityState={{ selected }}
                      style={{
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: selected
                          ? toneHex("trainer").base
                          : "#232735",
                        backgroundColor: selected
                          ? toneHex("trainer").dim
                          : "#1A1D29",
                        paddingHorizontal: 14,
                        paddingVertical: 12,
                      }}
                    >
                      <Text
                        fontFamily="$display"
                        fontWeight="600"
                        fontSize={14}
                        color={selected ? "$accentTrainer" : "$text"}
                      >
                        {gt.name}
                      </Text>
                      {gt.description ? (
                        <Text
                          fontFamily="$body"
                          fontSize={12}
                          color="$text3"
                          marginTop={2}
                        >
                          {gt.description}
                        </Text>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            )}
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
