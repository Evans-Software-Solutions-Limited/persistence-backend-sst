/**
 * WorkoutRatingPresenter — post-Complete rating + workout-notes
 * capture screen.
 *
 * Ported 1:1 from
 * `persistence-mobile/components/workouts/WorkoutRatingScreen/WorkoutRatingScreen.tsx`:
 *   - SemiCircleSlider drives the 1-10 difficulty scale (legacy uses
 *     a bespoke 250-LOC top-semicircle SVG slider; ported verbatim
 *     into `@/ui/components/workouts/SemiCircleSlider`).
 *   - "← Back" text-only back button (legacy parity — V2 had a
 *     chevron + "Back" before this phase).
 *   - Difficulty band 3-4 uses `Colors.info.DEFAULT` (V2 was
 *     incorrectly using `Colors.primary.DEFAULT` before).
 *
 * Tap Submit → container fires `completeSessionCommand({ rating,
 * notes })` → routes to `/(app)/session/summary`.
 *
 * Spec: specs/05-active-session/requirements.md STORY-006 AC
 *       "Confirmation to save session"
 */

import React, { useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { color } from "@/ui/theme/tokens";
import { Spacing, Typography } from "@/ui/theme/workoutsLegacyTheme";
import { SemiCircleSlider } from "@/ui/components/workouts/SemiCircleSlider";

const MIN_RATING = 1;
const MAX_RATING = 10;

const getDifficultyMessage = (rating: number): string => {
  if (rating <= 2) return "Too Easy";
  if (rating <= 4) return "Easy";
  if (rating <= 6) return "Moderate";
  if (rating <= 8) return "Hard";
  return "Extremely Hard";
};

// 05.6: RPE band → design-system token mapping (design.md § WorkoutRating
// RPE_BAND_TONES): easy → $success, moderate → $info, hard → $warning,
// veryHard → $ember, maximal → $error. Band boundaries preserved from the
// legacy port (1-2 / 3-4 / 5-6 / 7-8 / 9-10).
const getDifficultyColor = (rating: number): string => {
  if (rating <= 2) return color.$success;
  if (rating <= 4) return color.$info;
  if (rating <= 6) return color.$warning;
  if (rating <= 8) return color.$ember;
  return color.$error;
};

export type WorkoutRatingPresenterProps = {
  isLoading?: boolean;
  initialNotes?: string;
  onSubmit: (rating: number, notes: string) => void;
  onBack: () => void;
};

export function WorkoutRatingPresenter(props: WorkoutRatingPresenterProps) {
  const [rating, setRating] = useState(MIN_RATING);
  const [notes, setNotes] = useState(props.initialNotes ?? "");
  const accent = getDifficultyColor(rating);
  const message = getDifficultyMessage(rating);

  const handleSubmit = () => {
    Keyboard.dismiss();
    props.onSubmit(rating, notes.trim());
  };

  return (
    <View style={styles.container} testID="workout-rating-screen">
      {/* "← Back" text-only back button (legacy parity — the chevron-
          icon variant V2 shipped before this phase didn't match the
          rest of the legacy back-button language). */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={props.onBack}
          style={styles.backButton}
          accessibilityLabel="Back to active session"
          testID="workout-rating-back"
        >
          <Text style={styles.backLabel}>← Back</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.congrats}>Congratulations! 🎉</Text>
          <Text style={styles.subtitle}>
            You&apos;ve completed your workout!
          </Text>

          <Text style={styles.question}>How difficult was that?</Text>

          <View
            style={styles.sliderContainer}
            onStartShouldSetResponder={() => {
              Keyboard.dismiss();
              return false;
            }}
          >
            <SemiCircleSlider
              minValue={MIN_RATING}
              maxValue={MAX_RATING}
              value={rating}
              onValueChange={(value) => {
                Keyboard.dismiss();
                setRating(value);
              }}
              activeColor={accent}
              renderLabel={(val) => (
                <View style={styles.ratingDisplay}>
                  <Text style={[styles.ratingValue, { color: accent }]}>
                    {val}
                  </Text>
                  <Text style={styles.ratingMax}>/ {MAX_RATING}</Text>
                </View>
              )}
            />
          </View>

          <View style={styles.difficultyContainer}>
            <Text
              style={[styles.difficultyMessage, { color: accent }]}
              testID="workout-rating-message"
            >
              {message}
            </Text>
          </View>

          <View style={styles.notesContainer}>
            <Text style={styles.notesLabel}>Workout Notes (Optional)</Text>
            <TextInput
              style={styles.notesInput}
              placeholder="Add any notes about your workout..."
              placeholderTextColor={color.$text4}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={6}
              textAlignVertical="top"
              editable={!props.isLoading}
              testID="workout-rating-notes"
            />
          </View>

          <TouchableOpacity
            style={[
              styles.submitButton,
              { backgroundColor: accent },
              props.isLoading && styles.submitButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={props.isLoading}
            testID="workout-rating-submit"
          >
            <Text style={styles.submitLabel}>
              {props.isLoading ? "Submitting..." : "Submit Workout"}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    backgroundColor: color.$bg,
  },
  header: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  backButton: {
    paddingVertical: Spacing.xs,
  },
  backLabel: {
    ...Typography.body1,
    color: color.$text2,
  },
  content: {
    width: "100%",
    paddingHorizontal: Spacing.lg,
    alignItems: "center",
    gap: Spacing.md,
    paddingBottom: Spacing.xl,
  },
  congrats: {
    ...Typography.h1,
    color: color.$text,
    textAlign: "center",
    paddingTop: Spacing.sm,
  },
  subtitle: {
    ...Typography.body1,
    color: color.$text2,
    textAlign: "center",
  },
  question: {
    ...Typography.h3,
    color: color.$text,
    textAlign: "center",
    marginTop: Spacing.lg,
  },
  sliderContainer: {
    width: "100%",
    alignItems: "center",
    marginVertical: Spacing.lg,
  },
  ratingDisplay: {
    flexDirection: "row",
    alignItems: "baseline",
    overflow: "visible",
    paddingVertical: 4,
  },
  ratingValue: {
    ...Typography.h1,
    fontSize: 48,
    fontWeight: "700",
    includeFontPadding: false,
    textAlignVertical: "center",
    lineHeight: 56,
    overflow: "visible",
    paddingTop: 0,
    paddingBottom: 0,
  },
  ratingMax: {
    ...Typography.h3,
    color: color.$text3,
    marginLeft: Spacing.xs,
  },
  difficultyContainer: {
    // Negative top margin pulls the difficulty caption tight against
    // the slider's label overlay (legacy parity — line 206 of
    // WorkoutRatingScreen).
    marginTop: -20,
  },
  difficultyMessage: {
    ...Typography.h3,
    fontWeight: "600",
    textAlign: "center",
  },
  notesContainer: {
    width: "100%",
    marginTop: Spacing.md,
  },
  notesLabel: {
    ...Typography.body2,
    color: color.$text3,
    marginBottom: Spacing.sm,
  },
  notesInput: {
    ...Typography.body2,
    color: color.$text,
    backgroundColor: color.$surface2,
    borderRadius: 12,
    padding: Spacing.md,
    minHeight: 100,
    borderWidth: 1,
    borderColor: color.$border,
  },
  submitButton: {
    width: "100%",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: 14,
    alignItems: "center",
    marginTop: Spacing.lg,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitLabel: {
    ...Typography.body1,
    // Dark ink on the vivid difficulty-accent fill (the new band tokens are
    // lighter than the legacy palette → light text would fail contrast).
    color: color.$bg,
    fontWeight: "700",
  },
});
