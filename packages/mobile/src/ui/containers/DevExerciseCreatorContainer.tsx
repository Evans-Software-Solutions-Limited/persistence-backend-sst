import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert, ScrollView } from "react-native";
import { View } from "@tamagui/core";
import { createExerciseCommand } from "@/application/commands/create-exercise.command";
import {
  EQUIPMENT_LABELS,
  EQUIPMENT_TYPES,
  EXERCISE_CATEGORIES,
  EXERCISE_DIFFICULTIES,
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  type EquipmentType,
  type ExerciseCategory,
  type ExerciseDifficulty,
  type MuscleGroup,
} from "@/domain/models/exercise";
import { Button, Column, Input, Row, Text } from "@/ui/components";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * __DEV__-gated minimal creator for M0 smoke-testing (AC 7.18).
 *
 * Fields: name (required, trimmed, 2–100 chars) + single primary muscle
 * + single equipment + category/difficulty defaults. Submission fires
 * `createExerciseCommand`, which saves to the local cache with a
 * `local-*` id AND enqueues a POST /exercises mutation for the sync
 * engine.
 *
 * This is NOT the real creator. The real creator ships in M5 with the
 * ExerciseCreatorContainer + Presenter from Phases 5–6. This
 * intentionally avoids container/presenter split since it's throwaway
 * code slated for replacement.
 *
 * A simple `__DEV__` gate at the screen level keeps this out of
 * production bundles (Metro tree-shakes the branch when __DEV__ is
 * false in release builds).
 */
export function DevExerciseCreatorContainer() {
  const router = useRouter();
  const { storage } = useAdapters();

  const [name, setName] = useState("");
  const [muscle, setMuscle] = useState<MuscleGroup>("chest");
  const [equipment, setEquipment] = useState<EquipmentType>("barbell");
  const [category, setCategory] = useState<ExerciseCategory>("strength");
  const [difficulty, setDifficulty] = useState<ExerciseDifficulty>("beginner");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const trimmedName = name.trim();
  const canSubmit =
    trimmedName.length >= 2 && trimmedName.length <= 100 && !isSubmitting;

  const onSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      const result = createExerciseCommand(
        {
          storage,
          generateId: () =>
            Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
          // userId is placeholder here — the real creator in M5 will pull
          // from the auth adapter. For the smoke-test path the value only
          // matters as a display-side marker ("created by me"); the
          // backend ignores it on POST (uses JWT sub).
          userId: "dev-user",
        },
        {
          name: trimmedName,
          category,
          difficulty,
          primaryMuscleGroups: [muscle],
          equipment: [equipment],
        },
      );
      if (!result.ok) {
        const firstField = Object.entries(result.error.fields)[0];
        const message = firstField
          ? `${firstField[0]}: ${firstField[1]}`
          : "Invalid input";
        Alert.alert("Invalid input", message);
        return;
      }
      router.back();
    } finally {
      setIsSubmitting(false);
    }
  }, [
    canSubmit,
    storage,
    router,
    trimmedName,
    muscle,
    equipment,
    category,
    difficulty,
  ]);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 16, gap: 20 }}
      testID="dev-exercise-creator"
    >
      <Column gap="sm">
        <Text variant="label" secondary>
          NAME
        </Text>
        <Input
          placeholder="e.g. Test Lift"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          testID="dev-creator-name"
        />
        <Text variant="bodySmall" color="$colorSecondary">
          2–100 characters. Will ship to the backend verbatim.
        </Text>
      </Column>

      <SelectRow<MuscleGroup>
        label="PRIMARY MUSCLE"
        options={MUSCLE_GROUPS}
        selected={muscle}
        onSelect={setMuscle}
        displayFor={(key) => MUSCLE_GROUP_LABELS[key]}
        testID="dev-creator-muscle"
      />

      <SelectRow<EquipmentType>
        label="EQUIPMENT"
        options={EQUIPMENT_TYPES}
        selected={equipment}
        onSelect={setEquipment}
        displayFor={(key) => EQUIPMENT_LABELS[key]}
        testID="dev-creator-equipment"
      />

      <SelectRow<ExerciseCategory>
        label="CATEGORY"
        options={EXERCISE_CATEGORIES}
        selected={category}
        onSelect={setCategory}
        displayFor={(key) => key}
        testID="dev-creator-category"
      />

      <SelectRow<ExerciseDifficulty>
        label="DIFFICULTY"
        options={EXERCISE_DIFFICULTIES}
        selected={difficulty}
        onSelect={setDifficulty}
        displayFor={(key) => key}
        testID="dev-creator-difficulty"
      />

      <Button
        label={isSubmitting ? "Creating..." : "Create exercise"}
        onPress={onSubmit}
        isDisabled={!canSubmit}
        fullWidth
        testID="dev-creator-submit"
      />

      <Text variant="bodySmall" color="$colorSecondary" align="center">
        M0 smoke-test creator. Replaced by M5&apos;s full form.
      </Text>
    </ScrollView>
  );
}

type SelectRowProps<T extends string> = {
  label: string;
  options: readonly T[];
  selected: T;
  onSelect: (value: T) => void;
  displayFor: (value: T) => string;
  testID: string;
};

function SelectRow<T extends string>({
  label,
  options,
  selected,
  onSelect,
  displayFor,
  testID,
}: SelectRowProps<T>) {
  return (
    <Column gap="sm">
      <Text variant="label" secondary>
        {label}
      </Text>
      <Row gap="sm" wrap>
        {options.map((option) => {
          const isActive = option === selected;
          return (
            <View
              key={option}
              onPress={() => onSelect(option)}
              paddingHorizontal="$md"
              paddingVertical="$xs"
              borderRadius="$full"
              borderWidth={1}
              borderColor={isActive ? "$primary" : "$borderColor"}
              backgroundColor={isActive ? "$primary" : "transparent"}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              testID={`${testID}-${option}`}
            >
              <Text
                variant="bodySmall"
                color={isActive ? "$colorInverse" : "$color"}
              >
                {displayFor(option)}
              </Text>
            </View>
          );
        })}
      </Row>
    </Column>
  );
}
