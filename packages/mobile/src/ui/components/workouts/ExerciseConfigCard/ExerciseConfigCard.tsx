import { Text, View } from "@tamagui/core";
import type { ReactNode } from "react";
import { Pressable } from "react-native";

import { IconBtn, Pill } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import {
  IconChevronD,
  IconChevronUp,
  IconLayers,
  IconMinus,
  IconPlus,
  IconTrash,
  IconX,
} from "@/ui/components/icons";
import {
  MAX_SETS,
  MAX_SET_REPS,
  prescriptionSummary,
  rangeLabel,
} from "@/domain/services/setTargets.service";

/**
 * <ExerciseConfigCard> — one exercise in Create / Edit workout, with the
 * shared set editor (PER-139, canvas C5f; the same editor the coach uses
 * through `?ctx=coach`).
 *
 * Expanded: Set 1, 2, 3… each with its own reps stepper (− 10 +), then Add
 * set, "Same reps for all" and Rest. Collapsed: "3 sets · 12, 10, 10". The
 * prescription has no weight; last time's weights show as a hint only.
 *
 * An exercise saved with only the old range (`set_reps` null) shows its
 * range on every set ("8–12") and is left exactly as saved until a set's
 * reps change, which turns it into per-set reps (the reducer's job).
 *
 * Supersets: the set count and rest are shared, so a member after the lead
 * shows the lead's rest, can't add or remove sets, and reads "Inherited from
 * superset"; each member still sets its own reps per set.
 *
 * The header (number, name, remove) and the superset pill/connector are the
 * pre-PER-139 card unchanged.
 */

interface ExerciseConfigCardProps {
  readonly exercise: any; // the form row (`WorkoutFormExercise`)
  readonly index: number;
  readonly onRemove: () => void;
  /** Rest (and any other single field): `("rest_seconds", 90)`. */
  readonly onConfigChange: (field: string, value: number) => void;
  readonly isSupersetStart?: boolean;
  readonly isSupersetEnd?: boolean;
  readonly supersetGroupNumber?: number;
  /**
   * Display letter (A/B/C…) for the superset group, assigned by the parent in
   * appearance order so the badge matches the detail screen's centred pill.
   * Falls back to the raw group number if absent.
   */
  readonly supersetLetter?: string;

  readonly supersetLeadExercise?: any;
  /** Expanded shows the set editor; collapsed shows the summary line. */
  readonly expanded?: boolean;
  readonly onToggleExpanded?: () => void;
  readonly onSetReps?: (setIndex: number, reps: number) => void;
  readonly onAddSet?: () => void;
  readonly onRemoveSet?: (setIndex: number) => void;
  readonly onSameRepsForAll?: () => void;
  /** "Last time 92.5 kg × 8, 6, 6, 5", or nothing for a first time. */
  readonly lastTimeHint?: string | null;
  /** Save's message for this exercise (sets or reps out of range). */
  readonly error?: string | null;
}

const REST_STEP_SECONDS = 15;

/** 150 → "2:30". */
export function formatRest(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function ExerciseConfigCard({
  exercise,
  index,
  onRemove,
  onConfigChange,
  isSupersetStart = false,
  isSupersetEnd = false,
  supersetGroupNumber,
  supersetLetter,
  supersetLeadExercise,
  expanded = true,
  onToggleExpanded,
  onSetReps,
  onAddSet,
  onRemoveSet,
  onSameRepsForAll,
  lastTimeHint,
  error,
}: ExerciseConfigCardProps) {
  const isInSuperset =
    isSupersetStart ||
    isSupersetEnd ||
    (exercise.superset_group !== undefined && exercise.superset_group !== null);
  const shouldDisableSharedFields = isInSuperset && !isSupersetStart;

  const setReps: number[] | null = Array.isArray(exercise.set_reps)
    ? exercise.set_reps
    : null;
  const setCount = setReps
    ? setReps.length
    : Math.max(1, Number(exercise.target_sets) || 1);
  const restVal: number = shouldDisableSharedFields
    ? (supersetLeadExercise?.rest_seconds ?? exercise.rest_seconds)
    : exercise.rest_seconds;
  const summary = prescriptionSummary({
    setReps,
    targetSets: setCount,
    targetRepsMin: exercise.target_reps_min,
    targetRepsMax: exercise.target_reps_max,
  });
  const name: string = exercise.exercise_name;

  /** The value a set's stepper moves from (an old range steps from its top). */
  const repsAt = (i: number): number =>
    setReps?.[i] ?? (Number(exercise.target_reps_max) || 0);

  return (
    <View>
      {/* Superset indicator — centred letter pill on a connector line
          (matches the detail screen). */}
      {isInSuperset && isSupersetStart && (
        <View
          flexDirection="row"
          alignItems="center"
          gap={8}
          paddingHorizontal={6}
          marginBottom={7}
        >
          <View
            flex={1}
            height={2}
            backgroundColor="$primary"
            opacity={0.5}
            borderRadius={2}
          />
          <View flexDirection="row" alignItems="center" gap={4}>
            <IconLayers
              size={10}
              strokeWidth={2.5}
              color={toneHex("primary").base}
            />
            <Pill tone="primary" size="xs" filled>
              {`SUPERSET ${supersetLetter ?? supersetGroupNumber}`}
            </Pill>
          </View>
          <View
            flex={1}
            height={2}
            backgroundColor="$primary"
            opacity={0.5}
            borderRadius={2}
          />
        </View>
      )}

      {/* Exercise Card */}
      <View
        backgroundColor="$surface"
        borderColor={error ? "$error" : "$border"}
        borderWidth={1}
        borderLeftWidth={isInSuperset ? 3 : 1}
        borderLeftColor={
          isInSuperset ? "$primary" : error ? "$error" : "$border"
        }
        borderRadius={isInSuperset ? 12 : 14}
        padding={12}
      >
        <View
          flexDirection="row"
          alignItems="center"
          gap={9}
          marginBottom={expanded ? 10 : 0}
        >
          <View
            minWidth={22}
            height={22}
            borderRadius={6}
            paddingHorizontal={5}
            backgroundColor={isInSuperset ? "$primary" : "$surface3"}
            alignItems="center"
            justifyContent="center"
          >
            <Text
              fontFamily="$mono"
              fontWeight="700"
              fontSize={12}
              color={isInSuperset ? "$primaryInk" : "$text2"}
            >
              {index + 1}
            </Text>
          </View>
          <Pressable
            style={{ flex: 1 }}
            onPress={onToggleExpanded}
            disabled={!onToggleExpanded}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={`${name}, ${summary}`}
            accessibilityHint={
              expanded ? "Hides the sets" : "Shows the sets to edit"
            }
            testID="exercise-header"
          >
            <Text
              fontFamily="$display"
              fontWeight="600"
              fontSize={14.5}
              color="$text"
              numberOfLines={1}
            >
              {name}
            </Text>
            {!expanded ? (
              <Text
                fontFamily="$mono"
                fontSize={12}
                color="$text3"
                marginTop={2}
                numberOfLines={1}
                testID="set-summary"
              >
                {summary}
              </Text>
            ) : null}
          </Pressable>
          {onToggleExpanded ? (
            <IconBtn
              icon={
                expanded ? (
                  <IconChevronUp size={16} />
                ) : (
                  <IconChevronD size={16} />
                )
              }
              tone="ghost"
              onPress={onToggleExpanded}
              accessibilityLabel={
                expanded ? `Collapse ${name}` : `Expand ${name}`
              }
              testID="toggle-button"
            />
          ) : null}
          <IconBtn
            icon={<IconTrash size={16} />}
            tone="ghost"
            onPress={onRemove}
            accessibilityLabel="Remove exercise"
            testID="remove-button"
          />
        </View>

        {expanded ? (
          <View gap={6}>
            {lastTimeHint ? (
              <Text
                fontFamily="$body"
                fontSize={12}
                color="$text3"
                marginBottom={2}
                testID="last-time-hint"
              >
                {lastTimeHint}
              </Text>
            ) : null}

            {Array.from({ length: setCount }, (_, i) => {
              const value = repsAt(i);
              return (
                <View
                  key={i}
                  flexDirection="row"
                  alignItems="center"
                  gap={8}
                  backgroundColor="$surface3"
                  borderRadius={10}
                  paddingVertical={4}
                  paddingLeft={10}
                  paddingRight={4}
                  testID={`set-row-${i}`}
                >
                  <Text
                    fontFamily="$mono"
                    fontWeight="600"
                    fontSize={12.5}
                    color="$text2"
                    width={44}
                  >
                    {`Set ${i + 1}`}
                  </Text>
                  <Text
                    fontFamily="$body"
                    fontSize={12}
                    color="$text3"
                    flex={1}
                  >
                    Reps
                  </Text>
                  <IconBtn
                    icon={<IconMinus size={12} strokeWidth={2.5} />}
                    tone="neutral"
                    size={30}
                    disabled={value <= 1}
                    onPress={() => onSetReps?.(i, value - 1)}
                    accessibilityLabel={`Fewer reps, set ${i + 1}`}
                    testID={`set-${i}-dec`}
                  />
                  <Text
                    fontFamily="$mono"
                    fontWeight="700"
                    fontSize={15}
                    color="$text"
                    minWidth={40}
                    textAlign="center"
                    testID={`set-${i}-reps`}
                  >
                    {setReps
                      ? String(setReps[i])
                      : rangeLabel(
                          exercise.target_reps_min,
                          exercise.target_reps_max,
                        )}
                  </Text>
                  <IconBtn
                    icon={<IconPlus size={12} strokeWidth={2.5} />}
                    tone="neutral"
                    size={30}
                    disabled={value >= MAX_SET_REPS}
                    onPress={() => onSetReps?.(i, value + 1)}
                    accessibilityLabel={`More reps, set ${i + 1}`}
                    testID={`set-${i}-inc`}
                  />
                  {setCount > 1 && !shouldDisableSharedFields ? (
                    <IconBtn
                      icon={<IconX size={12} strokeWidth={2.5} />}
                      tone="ghost"
                      size={30}
                      onPress={() => onRemoveSet?.(i)}
                      accessibilityLabel={`Remove set ${i + 1}`}
                      testID={`set-${i}-remove`}
                    />
                  ) : null}
                </View>
              );
            })}

            <View
              flexDirection="row"
              alignItems="center"
              gap={8}
              marginTop={2}
              flexWrap="wrap"
            >
              <Chip
                label="Add set"
                icon={
                  <IconPlus
                    size={12}
                    strokeWidth={2.5}
                    color={toneHex("primary").base}
                  />
                }
                disabled={shouldDisableSharedFields || setCount >= MAX_SETS}
                onPress={onAddSet}
                testID="add-set"
              />
              <Chip
                label="Same reps for all"
                disabled={setCount < 2}
                onPress={onSameRepsForAll}
                testID="same-reps"
              />
              <View flex={1} />
              <View
                flexDirection="row"
                alignItems="center"
                gap={4}
                opacity={shouldDisableSharedFields ? 0.55 : 1}
              >
                <Text fontFamily="$body" fontSize={12} color="$text3">
                  Rest
                </Text>
                <IconBtn
                  icon={<IconMinus size={11} strokeWidth={2.5} />}
                  tone="neutral"
                  size={26}
                  disabled={shouldDisableSharedFields || restVal <= 0}
                  onPress={() =>
                    onConfigChange(
                      "rest_seconds",
                      Math.max(0, exercise.rest_seconds - REST_STEP_SECONDS),
                    )
                  }
                  accessibilityLabel="Less rest"
                  testID="rest-dec"
                />
                <Text
                  fontFamily="$mono"
                  fontWeight="600"
                  fontSize={13}
                  color="$text"
                  minWidth={34}
                  textAlign="center"
                  testID="rest-value"
                >
                  {formatRest(restVal)}
                </Text>
                <IconBtn
                  icon={<IconPlus size={11} strokeWidth={2.5} />}
                  tone="neutral"
                  size={26}
                  disabled={shouldDisableSharedFields}
                  onPress={() =>
                    onConfigChange(
                      "rest_seconds",
                      exercise.rest_seconds + REST_STEP_SECONDS,
                    )
                  }
                  accessibilityLabel="More rest"
                  testID="rest-inc"
                />
              </View>
            </View>

            {shouldDisableSharedFields ? (
              <Text
                fontFamily="$body"
                fontSize={9.5}
                color="$text4"
                textAlign="right"
              >
                Inherited from superset
              </Text>
            ) : null}
          </View>
        ) : null}

        {error ? (
          <Text
            fontFamily="$body"
            fontSize={12}
            color="$error"
            marginTop={6}
            testID="exercise-error"
          >
            {error}
          </Text>
        ) : null}
      </View>

      {/* Superset connector line below - only for the last item */}
      {isInSuperset && isSupersetEnd && (
        <View
          height={2}
          backgroundColor="$primary"
          opacity={0.5}
          borderRadius={2}
          marginTop={8}
          marginHorizontal={6}
        />
      )}
    </View>
  );
}

/** A small pill button (canvas `.chip`): Add set, Same reps for all. */
function Chip({
  label,
  icon,
  disabled = false,
  onPress,
  testID,
}: {
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={label}
      testID={testID}
      hitSlop={6}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={5}
        height={30}
        paddingHorizontal={11}
        borderRadius={9999}
        borderWidth={1}
        borderColor="$border"
        backgroundColor="$surface3"
        opacity={disabled ? 0.45 : 1}
      >
        {icon}
        <Text
          fontFamily="$display"
          fontWeight="600"
          fontSize={12}
          color="$text2"
        >
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
