import { Text, View } from "@tamagui/core";
import type { ReactNode } from "react";
import { Pressable, TextInput } from "react-native";

import { toneTokens } from "@/ui/components/foundation";
import { IconCamera, IconCheck } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

import {
  EQUIPMENT_OPTIONS,
  LEVELS,
  MUSCLES,
  type MuscleLabel,
  type NewExerciseInput,
} from "./exerciseForm";

/**
 * <ExerciseFormFields> — the shared, controlled field set for creating /
 * editing a custom exercise. Composed by <CreateExercisePresenter>
 * (04.3) and, from 04.6, the full-screen <ExerciseEditorPresenter>.
 *
 * Source: ~/Downloads/handoff/design-source/screens/create-exercise.jsx:51-169
 * Spec: specs/04-workout-management/design.md § <ExerciseEditorPresenter>
 *       (ExerciseFormFields contract) + § <CreateExercisePresenter>
 *
 * Renders, top to bottom: Name, optional Photo placeholder, Primary muscle
 * (radio), Secondary muscles (multi-select, excludes the primary), Equipment
 * (radio, gold tone), Level (3-col radio grid, per-tier tone), Instructions.
 * The PREVIEW chip and the Cancel/Save footer are NOT here — those are
 * sheet/editor chrome owned by the composing presenter.
 *
 * Controlled: the composing presenter owns the `NewExerciseInput` state and
 * passes `value` + `onChange`. `react-hook-form` is intentionally not used —
 * it's not a dependency of `packages/mobile`, and the design's value/onChange
 * contract keeps the field set portable between the sheet and the full-screen
 * editor (revised 2026-06-02, Phase 04.3).
 */

/** Pressable feedback — dim to 0.85 while pressed. Extracted so both press
 * branches are unit-testable (avoids the recurring branch-coverage miss). */
export const formChipPressStyle = ({ pressed }: { pressed: boolean }) => ({
  opacity: pressed ? 0.85 : 1,
});

export type ExerciseFormFieldsProps = {
  value: NewExerciseInput;
  onChange: (next: NewExerciseInput) => void;
  /** Sheet shows the compact photo placeholder; the editor can hide it. */
  showsPhoto?: boolean;
  testID?: string;
};

export function ExerciseFormFields({
  value,
  onChange,
  showsPhoto = true,
  testID,
}: ExerciseFormFieldsProps) {
  const setPrimary = (label: MuscleLabel) => {
    // Dropping the new primary from the secondary set keeps the two pickers
    // mutually exclusive (the prototype filters the primary out of the
    // secondary row, so a stale selection would otherwise linger in state).
    onChange({
      ...value,
      primaryMuscleLabel: label,
      secondaryMuscleLabels: value.secondaryMuscleLabels.filter(
        (m) => m !== label,
      ),
    });
  };

  const toggleSecondary = (label: MuscleLabel) => {
    const active = value.secondaryMuscleLabels.includes(label);
    onChange({
      ...value,
      secondaryMuscleLabels: active
        ? value.secondaryMuscleLabels.filter((m) => m !== label)
        : [...value.secondaryMuscleLabels, label],
    });
  };

  return (
    <View gap={16} testID={testID}>
      {/* Name */}
      <View>
        <FieldLabel required>NAME</FieldLabel>
        <TextInput
          value={value.name}
          onChangeText={(name) => onChange({ ...value, name })}
          placeholder="e.g. Incline Dumbbell Press"
          placeholderTextColor={color.$text3}
          autoFocus
          style={{
            width: "100%",
            backgroundColor: color.$surface2,
            borderWidth: 1,
            borderColor: color.$border,
            borderRadius: 10,
            paddingHorizontal: 14,
            paddingVertical: 12,
            color: color.$text,
            fontSize: 14,
          }}
          testID="exercise-form-name"
        />
      </View>

      {/* Photo (optional placeholder) */}
      {showsPhoto ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add photo or video URL"
          style={formChipPressStyle}
          testID="exercise-form-photo"
        >
          <View
            aspectRatio={16 / 7}
            borderRadius={14}
            borderWidth={1.5}
            borderColor="$border3"
            backgroundColor="$surface2"
            alignItems="center"
            justifyContent="center"
            gap={6}
            // Dashed isn't a Tamagui style prop name; set it through the RN
            // style escape hatch so the placeholder reads as a drop target.
            style={{ borderStyle: "dashed" }}
          >
            <IconCamera size={22} color={color.$text3} />
            <Text fontSize={11.5} fontWeight="500" color="$text3">
              Add photo or video URL (optional)
            </Text>
          </View>
        </Pressable>
      ) : null}

      {/* Primary muscle */}
      <View>
        <FieldLabel>PRIMARY MUSCLE</FieldLabel>
        <View flexDirection="row" flexWrap="wrap" gap={6}>
          {MUSCLES.map((m) => {
            const active = value.primaryMuscleLabel === m;
            return (
              <Pressable
                key={m}
                onPress={() => setPrimary(m)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={formChipPressStyle}
                testID={`exercise-form-primary-${m}`}
              >
                <View
                  height={32}
                  paddingHorizontal={14}
                  borderRadius={9999}
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor={active ? "$primary" : "$surface2"}
                  borderWidth={1}
                  borderColor={active ? "$primary" : "$border"}
                >
                  <Text
                    fontFamily="$display"
                    fontWeight="600"
                    fontSize={12.5}
                    color={active ? "$primaryInk" : "$text2"}
                  >
                    {m}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Secondary muscles — all muscles except the primary */}
      <View>
        <FieldLabel hint="· tap to add">SECONDARY</FieldLabel>
        <View flexDirection="row" flexWrap="wrap" gap={6}>
          {MUSCLES.filter((m) => m !== value.primaryMuscleLabel).map((m) => {
            const active = value.secondaryMuscleLabels.includes(m);
            return (
              <Pressable
                key={m}
                onPress={() => toggleSecondary(m)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={formChipPressStyle}
                testID={`exercise-form-secondary-${m}`}
              >
                <View
                  height={30}
                  paddingHorizontal={12}
                  borderRadius={9999}
                  flexDirection="row"
                  alignItems="center"
                  gap={4}
                  backgroundColor={active ? "$primaryDim" : "$surface2"}
                  borderWidth={1}
                  borderColor={active ? "$primary" : "$border"}
                >
                  {active ? (
                    <IconCheck
                      size={10}
                      strokeWidth={3}
                      color={color.$primary}
                    />
                  ) : null}
                  <Text
                    fontFamily="$display"
                    fontWeight="500"
                    fontSize={12}
                    color={active ? "$primary" : "$text3"}
                  >
                    {m}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Equipment — radio, gold tone when selected */}
      <View>
        <FieldLabel>EQUIPMENT</FieldLabel>
        <View flexDirection="row" flexWrap="wrap" gap={6}>
          {EQUIPMENT_OPTIONS.map((e) => {
            const active = value.equipmentLabel === e;
            return (
              <Pressable
                key={e}
                onPress={() => onChange({ ...value, equipmentLabel: e })}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={formChipPressStyle}
                testID={`exercise-form-equipment-${e}`}
              >
                <View
                  height={30}
                  paddingHorizontal={12}
                  borderRadius={9999}
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor={active ? "$goldDim" : "$surface2"}
                  borderWidth={1}
                  borderColor={active ? "$gold" : "$border"}
                >
                  <Text
                    fontFamily="$display"
                    fontWeight="600"
                    fontSize={12}
                    color={active ? "$gold" : "$text2"}
                  >
                    {e}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Level — 3-col radio grid, per-tier tone */}
      <View>
        <FieldLabel>LEVEL</FieldLabel>
        <View flexDirection="row" gap={6}>
          {LEVELS.map((l) => {
            const active = value.level === l.id;
            const tone = toneTokens(l.tone);
            return (
              <Pressable
                key={l.id}
                onPress={() => onChange({ ...value, level: l.id })}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                style={levelPressStyle}
                testID={`exercise-form-level-${l.id}`}
              >
                <View
                  paddingVertical={10}
                  paddingHorizontal={6}
                  borderRadius={10}
                  alignItems="center"
                  justifyContent="center"
                  backgroundColor={active ? tone.dim : "$surface2"}
                  borderWidth={1}
                  borderColor={active ? tone.base : "$border"}
                >
                  <Text
                    fontFamily="$display"
                    fontWeight="600"
                    fontSize={12.5}
                    color={active ? tone.base : "$text2"}
                  >
                    {l.id}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Instructions */}
      <View>
        <FieldLabel hint="· optional">NOTES &amp; INSTRUCTIONS</FieldLabel>
        <TextInput
          value={value.instructions}
          onChangeText={(instructions) => onChange({ ...value, instructions })}
          placeholder="Form cues, depth, tempo, common mistakes..."
          placeholderTextColor={color.$text3}
          multiline
          style={{
            width: "100%",
            minHeight: 88,
            textAlignVertical: "top",
            backgroundColor: color.$surface2,
            borderWidth: 1,
            borderColor: color.$border,
            borderRadius: 10,
            paddingHorizontal: 12,
            paddingVertical: 10,
            color: color.$text,
            fontSize: 13,
            lineHeight: 20,
          }}
          testID="exercise-form-instructions"
        />
      </View>
    </View>
  );
}

/** Level chips fill their grid column equally — flex:1 each. Exported so
 * both press branches are unit-testable (avoids the branch-coverage miss). */
export const levelPressStyle = ({ pressed }: { pressed: boolean }) => ({
  opacity: pressed ? 0.85 : 1,
  flex: 1,
});

type FieldLabelProps = {
  children: ReactNode;
  required?: boolean;
  hint?: string;
};

/** Eyebrow label above each field (`create-exercise.jsx` `.p-eyebrow`). */
function FieldLabel({ children, required, hint }: FieldLabelProps) {
  return (
    <Text
      fontFamily="$display"
      fontSize={10.5}
      fontWeight="600"
      letterSpacing={1.7}
      textTransform="uppercase"
      color="$text3"
      marginBottom={8}
    >
      {children}
      {required ? (
        <Text color="$ember" fontWeight="600">
          {" *"}
        </Text>
      ) : null}
      {hint ? (
        <Text
          color="$text4"
          fontWeight="500"
          fontSize={10.5}
          textTransform="none"
          letterSpacing={0}
        >
          {` ${hint}`}
        </Text>
      ) : null}
    </Text>
  );
}
