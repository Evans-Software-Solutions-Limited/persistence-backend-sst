import { Text, View } from "@tamagui/core";

import { IconBtn, Pill, RepRange, Stepper } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconLayers, IconTrash } from "@/ui/components/icons";

/**
 * <ExerciseConfigCard> — v3 restyle onto the foundation kit + prototype
 * (~/Downloads/handoff/design-source/screens/workout-creator.jsx
 * `ExerciseConfigCard` + `Stepper` + `RepRange`), VISUAL LAYER ONLY:
 * every prop, testID, and piece of business logic below is unchanged from
 * the pre-restyle version (CLUSTER6_BRIEF #4a).
 *
 * Kept as-is (not a prototype feature — no data/callback exists for it in
 * this app's model, so it's out of scope for a visual-only restyle):
 *  - No drag handle / reorder (no reorder logic in `useWorkoutForm`).
 *  - No per-card "ungroup" / "superset with exercise above" affordance (no
 *    `onUnlink`/`onLinkUp`/`canLinkUp` prop exists on this component —
 *    grouping is only set via the AddExercisePopover "add as superset" flow).
 *  - The "Inherited from superset" hint renders TWICE (once under Sets, once
 *    under Rest) rather than the prototype's single merged line — this
 *    matches the existing, tested copy/structure (brief: keep this exact
 *    string).
 */

interface ExerciseConfigCardProps {
  readonly exercise: any; // Using any to match the original
  readonly index: number;
  readonly onRemove: () => void;
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
}: ExerciseConfigCardProps) {
  const isInSuperset =
    isSupersetStart ||
    isSupersetEnd ||
    (exercise.superset_group !== undefined && exercise.superset_group !== null);
  const shouldDisableSharedFields = isInSuperset && !isSupersetStart;

  // `Stepper`/`RepRange` each own their own text buffer internally (synced
  // from the numeric value passed in), so this component no longer needs the
  // pre-restyle local useState/useEffect pair to avoid a 0-flash while
  // typing — see Stepper.tsx's doc comment for the full rationale. Commit
  // (parse + the empty→0 sentinel + the shared-field guard) still happens
  // only on blur, matching the pre-restyle behaviour exactly.
  const commitSets = (text: string) => {
    const num = parseInt(text, 10);
    if (!Number.isNaN(num) && text !== "" && !shouldDisableSharedFields) {
      onConfigChange("target_sets", num);
    } else if (text === "" && !shouldDisableSharedFields) {
      onConfigChange("target_sets", 0);
    }
  };
  const commitRepsMin = (text: string) => {
    const num = parseInt(text, 10);
    if (!Number.isNaN(num) && text !== "") {
      onConfigChange("target_reps_min", num);
    } else if (text === "") {
      onConfigChange("target_reps_min", 0);
    }
  };
  const commitRepsMax = (text: string) => {
    const num = parseInt(text, 10);
    if (!Number.isNaN(num) && text !== "") {
      onConfigChange("target_reps_max", num);
    } else if (text === "") {
      onConfigChange("target_reps_max", 0);
    }
  };
  const commitRest = (text: string) => {
    const num = parseInt(text, 10);
    if (!Number.isNaN(num) && text !== "" && !shouldDisableSharedFields) {
      onConfigChange("rest_seconds", num);
    } else if (text === "" && !shouldDisableSharedFields) {
      onConfigChange("rest_seconds", 0);
    }
  };

  // Non-lead superset members display the LEAD's shared sets/rest. Guard the
  // lead deref + fall back to the member's own values (mirrors the pre-restyle
  // component) so a card rendered without a lead can never crash.
  const setsVal = shouldDisableSharedFields
    ? (supersetLeadExercise?.target_sets ?? exercise.target_sets)
    : exercise.target_sets;
  const restVal = shouldDisableSharedFields
    ? (supersetLeadExercise?.rest_seconds ?? exercise.rest_seconds)
    : exercise.rest_seconds;

  // `onType` fires on every keystroke; the buffer that provides is owned
  // internally by Stepper/RepRange, so there's nothing to do here — commit
  // happens in `onBlur` above.
  const noop = () => {};

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
        borderColor="$border"
        borderWidth={1}
        borderLeftWidth={isInSuperset ? 3 : 1}
        borderLeftColor={isInSuperset ? "$primary" : "$border"}
        borderRadius={isInSuperset ? 12 : 14}
        padding={12}
      >
        <View flexDirection="row" alignItems="center" gap={9} marginBottom={11}>
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
          <Text
            flex={1}
            fontFamily="$display"
            fontWeight="600"
            fontSize={14.5}
            color="$text"
            numberOfLines={1}
          >
            {exercise.exercise_name}
          </Text>
          <IconBtn
            icon={<IconTrash size={16} />}
            tone="ghost"
            onPress={onRemove}
            accessibilityLabel="Remove exercise"
            testID="remove-button"
          />
        </View>

        <View flexDirection="row" gap={8} alignItems="flex-start">
          <View flex={1}>
            <Stepper
              label="SETS"
              value={setsVal}
              disabled={shouldDisableSharedFields}
              onDec={() =>
                onConfigChange(
                  "target_sets",
                  Math.max(1, exercise.target_sets - 1),
                )
              }
              onInc={() =>
                onConfigChange("target_sets", exercise.target_sets + 1)
              }
              onType={noop}
              onBlur={commitSets}
              testID="sets-input"
            />
            {shouldDisableSharedFields && (
              <Text
                fontFamily="$body"
                fontSize={9.5}
                color="$text4"
                textAlign="center"
                marginTop={4}
              >
                Inherited from superset
              </Text>
            )}
          </View>

          <RepRange
            min={exercise.target_reps_min}
            max={exercise.target_reps_max}
            onMin={noop}
            onMax={noop}
            onMinBlur={commitRepsMin}
            onMaxBlur={commitRepsMax}
            minTestID="reps-min-input"
            maxTestID="reps-max-input"
          />

          <View flex={1}>
            <Stepper
              label="REST"
              unit="s"
              value={restVal}
              disabled={shouldDisableSharedFields}
              onDec={() =>
                onConfigChange(
                  "rest_seconds",
                  Math.max(0, exercise.rest_seconds - 15),
                )
              }
              onInc={() =>
                onConfigChange("rest_seconds", exercise.rest_seconds + 15)
              }
              onType={noop}
              onBlur={commitRest}
              testID="rest-input"
            />
            {shouldDisableSharedFields && (
              <Text
                fontFamily="$body"
                fontSize={9.5}
                color="$text4"
                textAlign="center"
                marginTop={4}
              >
                Inherited from superset
              </Text>
            )}
          </View>
        </View>
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
