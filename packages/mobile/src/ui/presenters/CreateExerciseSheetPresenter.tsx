import { Text, View } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  ExerciseFormFields,
  EMPTY_NEW_EXERCISE,
  LEVELS,
  type NewExerciseInput,
} from "@/ui/components/exercises/ExerciseFormFields";
import { Btn, BottomSheet, Pill, toneHex } from "@/ui/components/foundation";
import type { PillTone } from "@/ui/components/foundation";
import { IconCheck } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

/**
 * <CreateExerciseSheetPresenter> — the bottom-sheet flow for adding a custom
 * exercise to the user's library. Replaces V2's full-screen
 * `(app)/exercises/create.tsx`.
 *
 * Source: ~/Downloads/handoff/design-source/screens/create-exercise.jsx
 * Spec: specs/04-workout-management/design.md § <CreateExerciseSheetPresenter>
 *       requirements.md STORY-006
 *
 * Composes the shared <ExerciseFormFields> (the 7 form sections) and adds the
 * sheet chrome the form doesn't own: the live PREVIEW chip and the
 * Cancel / Save footer. On a successful save the Save button flips to
 * "Saved ✓" for 700ms (AC 6.5) before the sheet closes.
 */

/** How long the "Saved ✓" affirmation shows before the sheet closes. */
export const SAVED_AFFIRMATION_MS = 700;

export type CreateExerciseSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Throws (or rejects) on failure — the presenter then stays open and the
   * affirmation is suppressed; the container surfaces the error. */
  onSave: (input: NewExerciseInput) => Promise<void>;
};

export function CreateExerciseSheetPresenter({
  visible,
  onClose,
  onSave,
}: CreateExerciseSheetProps) {
  const [value, setValue] = useState<NewExerciseInput>(EMPTY_NEW_EXERCISE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Synchronous "a save is in flight (or succeeded)" guard. State can't guard
  // a double-tap: Pressable.onPress doesn't await, so a second tap queued
  // before the first `await onSave` yields would pass a state-based check
  // (React hasn't committed the disabled re-render yet) and submit twice —
  // two local-* exercises + two queued POSTs. The ref flips synchronously
  // before the await, so the second tap sees it set. It stays set through the
  // success affirmation and is reset only when the sheet (re)opens.
  const inFlightRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Run before paint (`useLayoutEffect`) so a reopened sheet never flashes the
  // prior "Saved ✓" state for a frame. ALWAYS clears any pending auto-close
  // timer on a `visible` change — so a lingering 700ms timer from a previous
  // save can't fire onClose on a sheet the user has since closed + reopened
  // (reachable via gorhom's pan-down-to-close). On open it also resets the
  // form + the in-flight guard. The component is mounted permanently at the
  // root layout, so this — not unmount — is the real cleanup path.
  useLayoutEffect(() => {
    clearTimer();
    if (visible) {
      setValue(EMPTY_NEW_EXERCISE);
      setSaving(false);
      setSaved(false);
      inFlightRef.current = false;
    }
  }, [visible, clearTimer]);

  // Belt-and-suspenders: clear the timer if the sheet ever does unmount.
  useEffect(() => clearTimer, [clearTimer]);

  const nameEmpty = value.name.trim().length === 0;
  const saveDisabled = nameEmpty || saving || saved;

  const handleSave = useCallback(async () => {
    if (inFlightRef.current || nameEmpty) return;
    inFlightRef.current = true;
    setSaving(true);
    try {
      await onSave(value);
      setSaved(true);
      // Leave inFlightRef set — it blocks re-taps during the affirmation
      // window too; the visible-effect resets it on the next open.
      timerRef.current = setTimeout(onClose, SAVED_AFFIRMATION_MS);
    } catch {
      // Container already surfaced the failure (Alert). Keep the sheet open
      // with the form intact and re-arm so the user can retry.
      inFlightRef.current = false;
    } finally {
      setSaving(false);
    }
  }, [nameEmpty, onSave, value, onClose]);

  // Manual close (Cancel + backdrop/pan-down) eagerly cancels a pending
  // auto-close timer before closing.
  const handleClose = useCallback(() => {
    clearTimer();
    onClose();
  }, [clearTimer, onClose]);

  const levelTone: PillTone =
    LEVELS.find((l) => l.id === value.level)?.tone ?? "neutral";
  const secondaries = value.secondaryMuscleLabels;

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title="New exercise"
      eyebrow="MY EXERCISES"
      accent="primary"
      height="tall"
      testID="create-exercise-sheet"
    >
      <View gap={16}>
        <ExerciseFormFields value={value} onChange={setValue} showsPhoto />

        {/* Live preview chip */}
        <LinearGradient
          colors={[toneHex("primary").dim, color.$surface2]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ borderRadius: 12 }}
        >
          <View
            paddingHorizontal={14}
            paddingVertical={12}
            borderRadius={12}
            borderWidth={1}
            borderColor="$primaryDim"
          >
            <Text
              fontFamily="$display"
              fontSize={10.5}
              fontWeight="600"
              letterSpacing={1.7}
              textTransform="uppercase"
              color="$primary"
              marginBottom={6}
            >
              PREVIEW
            </Text>
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={16}
              color="$text"
            >
              {value.name.trim() || "Your exercise name"}
            </Text>
            <View flexDirection="row" flexWrap="wrap" gap={5} marginTop={8}>
              <Pill tone="primary" size="xs">
                {value.primaryMuscleLabel.toUpperCase()}
              </Pill>
              <Pill tone="neutral" size="xs">
                {value.equipmentLabel.toUpperCase()}
              </Pill>
              <Pill tone={levelTone} size="xs">
                {value.level.toUpperCase()}
              </Pill>
              {secondaries.slice(0, 2).map((m) => (
                <Pill key={m} tone="neutral" size="xs">
                  {m.toUpperCase()}
                </Pill>
              ))}
              {secondaries.length > 2 ? (
                <Pill tone="neutral" size="xs">
                  {`+${secondaries.length - 2}`}
                </Pill>
              ) : null}
            </View>
          </View>
        </LinearGradient>

        {/* Footer */}
        <View flexDirection="row" gap={10} marginTop={4}>
          <View flex={1}>
            <Btn
              variant="outline"
              tone="primary"
              size="lg"
              full
              onPress={handleClose}
              testID="create-exercise-cancel"
            >
              Cancel
            </Btn>
          </View>
          <View flex={2}>
            <Btn
              variant="filled"
              tone="primary"
              size="lg"
              full
              icon={<IconCheck size={15} strokeWidth={2.5} />}
              onPress={handleSave}
              disabled={saveDisabled}
              testID="create-exercise-save"
            >
              {saved ? "Saved ✓" : "Save exercise"}
            </Btn>
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}
