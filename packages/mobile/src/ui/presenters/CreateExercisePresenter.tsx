import { Text, View } from "@tamagui/core";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  ExerciseFormFields,
  EMPTY_NEW_EXERCISE,
  LEVELS,
  type LevelLabel,
  type NewExerciseInput,
} from "@/ui/components/exercises/ExerciseFormFields";
import {
  Btn,
  HeaderBar,
  IconBtn,
  Pill,
  toneHex,
} from "@/ui/components/foundation";
import type { PillTone } from "@/ui/components/foundation";
import { IconBack, IconCheck } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

/**
 * <CreateExercisePresenter> — full-screen "add a custom exercise" flow.
 *
 * Source: ~/Downloads/handoff/design-source/screens/create-exercise.jsx (form
 * sections + preview chip + footer), rendered full-screen rather than in a
 * BottomSheet.
 * Spec: specs/04-workout-management/design.md § <CreateExercisePresenter>
 *       requirements.md STORY-006
 *
 * **Revised 2026-06-03 (Phase 04.3):** moved off the `<BottomSheet>` to a
 * full-screen route. The prototype + 04.3 spec called for a sheet, but the
 * 8-section form needs reliable scrolling + keyboard handling, which the gorhom
 * sheet kept fighting on device (Brad's review). Full-screen matches the legacy
 * exercise-creator AND the 04.6 editor (both full-screen), reuses the same
 * <ExerciseFormFields>, and a plain ScrollView scrolls without gorhom gymnastics.
 *
 * Composes <ExerciseFormFields> (the 7 form sections) + the live PREVIEW chip,
 * with a fixed header (close + title) and a sticky Cancel/Save footer. On a
 * successful save the Save button flips to "Saved ✓" for 700ms (AC 6.5) before
 * the screen pops.
 */

/** How long the "Saved ✓" affirmation shows before the screen closes. */
export const SAVED_AFFIRMATION_MS = 700;

/** Total level → pill-tone map (derived from LEVELS) — no per-render fallback
 * branch, since `value.level` is always a valid LevelLabel. */
const LEVEL_TONE = Object.fromEntries(
  LEVELS.map((l) => [l.id, l.tone]),
) as Record<LevelLabel, PillTone>;

export type CreateExerciseProps = {
  /** Navigate back (pop the route). */
  onClose: () => void;
  /** Throws (or rejects) on failure — the screen then stays open and the
   * affirmation is suppressed; the container surfaces the error. */
  onSave: (input: NewExerciseInput) => Promise<void>;
};

export function CreateExercisePresenter({
  onClose,
  onSave,
}: CreateExerciseProps) {
  const [value, setValue] = useState<NewExerciseInput>(EMPTY_NEW_EXERCISE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Synchronous "a save is in flight (or succeeded)" guard. State can't guard a
  // double-tap: Pressable.onPress doesn't await, so a second tap queued before
  // the first `await onSave` yields would pass a state-based check (the disabled
  // re-render isn't committed yet) and submit twice — two local-* exercises +
  // two queued POSTs. The ref flips synchronously before the await; it stays set
  // through the success affirmation and resets only on a failed attempt.
  const inFlightRef = useRef(false);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  const nameEmpty = value.name.trim().length === 0;
  const saveDisabled = nameEmpty || saving || saved;

  const handleSave = useCallback(async () => {
    if (inFlightRef.current || nameEmpty) return;
    inFlightRef.current = true;
    setSaving(true);
    try {
      await onSave(value);
      setSaved(true);
      timerRef.current = setTimeout(onClose, SAVED_AFFIRMATION_MS);
    } catch {
      // Container already surfaced the failure (Alert). Keep the screen open
      // with the form intact and re-arm so the user can retry.
      inFlightRef.current = false;
    } finally {
      setSaving(false);
    }
  }, [nameEmpty, onSave, value, onClose]);

  const levelTone = LEVEL_TONE[value.level];
  const secondaries = value.secondaryMuscleLabels;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: color.$bg }}
      edges={["top", "bottom"]}
      testID="create-exercise-screen"
    >
      <HeaderBar
        eyebrow="MY EXERCISES"
        title="New exercise"
        leading={
          <IconBtn
            icon={<IconBack size={22} />}
            tone="ghost"
            onPress={onClose}
            accessibilityLabel="Back"
          />
        }
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, paddingBottom: 32, gap: 16 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          testID="create-exercise-scroll"
        >
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
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Sticky footer — Save is always reachable regardless of scroll. */}
      <View
        flexDirection="row"
        gap={10}
        paddingHorizontal={20}
        paddingTop={12}
        paddingBottom={8}
        borderTopWidth={1}
        borderColor="$border"
      >
        <View flex={1}>
          <Btn
            variant="outline"
            tone="primary"
            size="lg"
            full
            onPress={onClose}
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
    </SafeAreaView>
  );
}
