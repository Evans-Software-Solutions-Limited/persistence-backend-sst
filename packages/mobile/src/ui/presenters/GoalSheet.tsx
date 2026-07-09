import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  TextInput,
} from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet } from "@/ui/components/foundation/BottomSheet";
import { Btn } from "@/ui/components/foundation/Btn";
import { toneHex } from "@/ui/components/foundation/tones";
import { useGoalSheet } from "@/state/goal-sheet";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { createGoalCommand, updateGoalCommand } from "@/application/commands";
import type { GoalType } from "@/domain/ports/api.port";

/**
 * <GoalSheet> — the athlete adds a new goal or edits the target date of one it
 * set itself (M16 — Athlete Training page). Root-mounted; opened from the Train
 * overview's Goals section (coach-assigned goals are view-only and never open
 * it).
 *
 *  - create mode: pick a goal type from the `GET /goal-types` catalog (minus
 *    types already owned) + an optional target date → `createGoalCommand`
 *    (optimistic `POST /goals`).
 *  - edit mode: the goal type is fixed; edit the target date →
 *    `updateGoalCommand` (optimistic `PATCH /goals/:id`).
 *
 * Mirrors the coach <AssignGoalSheet> pattern/picker but on the athlete's own
 * primary accent and self (optimistic, cache-backed) commands.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function GoalSheet() {
  const open = useGoalSheet((s) => s.open);
  const editGoal = useGoalSheet((s) => s.editGoal);
  const takenGoalTypeIds = useGoalSheet((s) => s.takenGoalTypeIds);
  const onChanged = useGoalSheet((s) => s.onChanged);
  const closeSheet = useGoalSheet((s) => s.closeSheet);

  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

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

  // Load the goal-type catalog once per open, create mode only. A small static
  // catalog — no cache-first hook needed; a failure surfaces a retry.
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

  // A user can hold only ONE goal per type (user_goals UNIQUE), so hide types
  // already owned — the create POST would 409 otherwise.
  const availableTypes = useMemo(
    () => goalTypes.filter((gt) => !takenGoalTypeIds.includes(gt.id)),
    [goalTypes, takenGoalTypeIds],
  );

  const dateValid = targetDate === "" || ISO_DATE.test(targetDate);
  const createReady = isEdit || goalTypeId.trim() !== "";
  const canSave = userId !== null && dateValid && createReady && !submitting;

  const handleSave = useCallback(async () => {
    if (!canSave || userId === null) return;
    setError(null);
    setSubmitting(true);
    const targetDateArg = targetDate === "" ? undefined : targetDate;
    const deps = { storage, api, userId };

    if (isEdit && editGoal) {
      const result = await updateGoalCommand(deps, editGoal.goalId, {
        targetDate: targetDateArg ?? null,
      });
      setSubmitting(false);
      if (result.ok) {
        onChanged?.();
        closeSheet();
        return;
      }
      setError("Couldn't save your goal. Please try again.");
      return;
    }

    const goalType = availableTypes.find((gt) => gt.id === goalTypeId);
    if (!goalType) {
      setSubmitting(false);
      setError("Pick a goal type to continue.");
      return;
    }
    const result = await createGoalCommand(deps, {
      goalType,
      targetDate: targetDateArg,
    });
    setSubmitting(false);
    if (result.ok) {
      onChanged?.();
      closeSheet();
      return;
    }
    setError("Couldn't add your goal. Please try again.");
  }, [
    api,
    storage,
    userId,
    canSave,
    isEdit,
    editGoal,
    availableTypes,
    goalTypeId,
    targetDate,
    onChanged,
    closeSheet,
  ]);

  return (
    <BottomSheet
      visible={open}
      onClose={closeSheet}
      title={isEdit ? "Edit goal" : "Add a goal"}
      accent="primary"
      height="default"
    >
      <View gap={16} testID="goal-sheet">
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
              testID="goal-sheet-title"
            >
              {editGoal?.goalTypeName ?? "Goal"}
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
                testID="goal-sheet-types-loading"
              >
                <ActivityIndicator
                  size="small"
                  color={toneHex("primary").base}
                />
              </View>
            ) : typesError ? (
              <View gap={8} testID="goal-sheet-types-error">
                <Text fontFamily="$body" fontSize={13} color="$text3">
                  Couldn’t load goal types.
                </Text>
                <Btn
                  variant="soft"
                  tone="primary"
                  size="sm"
                  onPress={() => void loadGoalTypes()}
                  testID="goal-sheet-types-retry"
                >
                  Retry
                </Btn>
              </View>
            ) : availableTypes.length === 0 ? (
              <Text
                fontFamily="$body"
                fontSize={13}
                color="$text3"
                testID="goal-sheet-types-empty"
              >
                You already have a goal for every type.
              </Text>
            ) : (
              <ScrollView
                style={{ maxHeight: 260 }}
                keyboardShouldPersistTaps="handled"
                testID="goal-sheet-types-list"
              >
                <View gap={8}>
                  {availableTypes.map((gt) => {
                    const selected = gt.id === goalTypeId;
                    return (
                      <Pressable
                        key={gt.id}
                        onPress={() => setGoalTypeId(gt.id)}
                        testID={`goal-sheet-type-${gt.id}`}
                        accessibilityState={{ selected }}
                        style={{
                          borderRadius: 12,
                          borderWidth: 1,
                          borderColor: selected
                            ? toneHex("primary").base
                            : "#232735",
                          backgroundColor: selected
                            ? toneHex("primary").dim
                            : "#1A1D29",
                          paddingHorizontal: 14,
                          paddingVertical: 12,
                        }}
                      >
                        <Text
                          fontFamily="$display"
                          fontWeight="600"
                          fontSize={14}
                          color={selected ? "$primary" : "$text"}
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
              </ScrollView>
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
            testID="goal-sheet-target-date"
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
            testID="goal-sheet-error"
          >
            {error}
          </Text>
        ) : null}

        <Btn
          variant="filled"
          tone="primary"
          disabled={!canSave}
          onPress={handleSave}
          testID="goal-sheet-submit"
        >
          {submitting
            ? isEdit
              ? "Saving…"
              : "Adding…"
            : isEdit
              ? "Save goal"
              : "Add goal"}
        </Btn>
      </View>
    </BottomSheet>
  );
}
