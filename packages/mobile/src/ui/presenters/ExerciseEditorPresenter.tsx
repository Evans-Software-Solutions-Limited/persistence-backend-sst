import { Text, View } from "@tamagui/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  ExerciseFormFields,
  EMPTY_NEW_EXERCISE,
  toFormInput,
  type NewExerciseInput,
} from "@/ui/components/exercises/ExerciseFormFields";
import { Btn, HeaderBar, IconBtn } from "@/ui/components/foundation";
import {
  IconAlert,
  IconBack,
  IconCheck,
  IconLock,
} from "@/ui/components/icons";
import type { Exercise } from "@/domain/models/exercise";
import type { ApiError } from "@/shared/errors";
import { color } from "@/ui/theme/tokens";

/**
 * <ExerciseEditorPresenter> — full-screen "edit a custom exercise" flow.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-008 (AC 8.1–8.4)
 *       design.md § <ExerciseEditorPresenter>
 *
 * Structurally mirrors <CreateExercisePresenter>: composes the shared
 * <ExerciseFormFields> in a keyboard-safe ScrollView with a sticky Cancel/Save
 * footer and the same in-flight + close-once guards. Differences: the form is
 * seeded from the loaded exercise (via `toFormInput`), the name field does NOT
 * auto-focus (the form opens populated), and there's no live PREVIEW chip.
 *
 * Owner-only (AC 8.4): a non-owner reaching this route (e.g. a deep link —
 * the Edit affordance is owner-gated upstream) sees a read-only notice instead
 * of the form, so no edit can be attempted.
 */

/** How long the "Saved ✓" affirmation shows before the screen closes. */
export const SAVED_AFFIRMATION_MS = 700;

export type ExerciseEditorProps = {
  exercise: Exercise | null;
  isLoading: boolean;
  error: ApiError | null;
  /** Owner of the exercise — non-owners get the read-only notice (AC 8.4). */
  isOwner: boolean;
  /** Navigate back (pop the route). */
  onClose: () => void;
  /** Throws/rejects on failure — the screen stays open and the affirmation is
   * suppressed; the container surfaces the error. */
  onSave: (value: NewExerciseInput) => Promise<void>;
  /** Retry the initial load after an error. */
  onRetry: () => void;
};

export function ExerciseEditorPresenter({
  exercise,
  isLoading,
  error,
  isOwner,
  onClose,
  onSave,
  onRetry,
}: ExerciseEditorProps) {
  const [value, setValue] = useState<NewExerciseInput>(EMPTY_NEW_EXERCISE);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Synchronous double-submit guard — see CreateExercisePresenter for the full
  // rationale (Pressable.onPress doesn't await, so a state-based check can't
  // block a second tap queued before the first await yields).
  const inFlightRef = useRef(false);
  const closedRef = useRef(false);

  // Seed the form once the exercise loads. Keyed on id so a different exercise
  // re-seeds, but typing isn't clobbered by re-renders of the same exercise.
  const seededIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!exercise) return;
    if (seededIdRef.current === exercise.id) return;
    seededIdRef.current = exercise.id;
    setValue(toFormInput(exercise));
  }, [exercise]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const handleClose = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    clearTimer();
    onClose();
  }, [clearTimer, onClose]);

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
      timerRef.current = setTimeout(handleClose, SAVED_AFFIRMATION_MS);
    } catch {
      // Container surfaced the failure (Alert). Keep the screen open and
      // re-arm so the user can retry.
      inFlightRef.current = false;
    } finally {
      setSaving(false);
    }
  }, [nameEmpty, onSave, value, handleClose]);

  const back = (
    <IconBtn
      icon={<IconBack size={22} />}
      tone="ghost"
      onPress={handleClose}
      accessibilityLabel="Back"
    />
  );

  // Non-owner — read-only notice, no form.
  if (exercise && !isOwner) {
    return (
      <SafeAreaView
        style={{ flex: 1, backgroundColor: color.$bg }}
        edges={["top", "bottom"]}
        testID="exercise-editor-screen"
      >
        <HeaderBar title="Edit exercise" leading={back} />
        <View
          flex={1}
          alignItems="center"
          justifyContent="center"
          paddingHorizontal={32}
          gap={10}
          testID="exercise-editor-readonly"
        >
          <IconLock size={24} color={color.$text3} />
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={16}
            color="$text"
          >
            Read-only
          </Text>
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$text3"
            textAlign="center"
          >
            You can only edit exercises you created.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: color.$bg }}
      edges={["top", "bottom"]}
      testID="exercise-editor-screen"
    >
      <HeaderBar title="Edit exercise" leading={back} />

      {isLoading && !exercise ? (
        <View
          flex={1}
          alignItems="center"
          justifyContent="center"
          gap={10}
          testID="exercise-editor-loading"
        >
          <Text fontFamily="$body" fontSize={13} color="$text3">
            Loading exercise…
          </Text>
        </View>
      ) : error && !exercise ? (
        <View
          flex={1}
          alignItems="center"
          justifyContent="center"
          paddingHorizontal={32}
          gap={10}
          testID="exercise-editor-error"
        >
          <IconAlert size={24} color={color.$ember} />
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={16}
            color="$text"
          >
            Couldn’t load exercise
          </Text>
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$text3"
            textAlign="center"
          >
            {error.message}
          </Text>
          <Btn
            variant="outline"
            tone="primary"
            size="sm"
            onPress={onRetry}
            testID="exercise-editor-retry"
          >
            Try again
          </Btn>
        </View>
      ) : exercise ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 20, paddingBottom: 32, gap: 16 }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            testID="exercise-editor-scroll"
          >
            <ExerciseFormFields
              value={value}
              onChange={setValue}
              autoFocus={false}
              showsPhoto
            />
          </ScrollView>

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
                onPress={handleClose}
                testID="exercise-editor-cancel"
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
                testID="exercise-editor-save"
              >
                {saved ? "Saved ✓" : "Save changes"}
              </Btn>
            </View>
          </View>
        </KeyboardAvoidingView>
      ) : (
        <View
          flex={1}
          alignItems="center"
          justifyContent="center"
          paddingHorizontal={32}
          gap={8}
          testID="exercise-editor-empty"
        >
          <IconAlert size={24} color={color.$text3} />
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={16}
            color="$text"
          >
            Exercise not found
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}
