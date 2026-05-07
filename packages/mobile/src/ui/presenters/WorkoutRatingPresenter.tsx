/**
 * WorkoutRatingPresenter — post-Complete rating + workout-notes
 * capture screen, ported from
 * `persistence-mobile/components/workouts/WorkoutRatingScreen` with a
 * V2 simplification: legacy used a bespoke 250-LOC SemiCircleSlider
 * for the 1-10 scale; we render a horizontal row of 10 segmented
 * buttons. Same data model (`difficultyRanking: 1-10`), same notes
 * field, same difficulty-tinted accent colour.
 *
 * Tap Submit → container fires `completeSessionCommand({ rating,
 * notes })` → routes to `/(app)/session/summary`.
 *
 * Spec: specs/05-active-session/requirements.md STORY-006 AC
 *       "Confirmation to save session"
 */

import { Ionicons } from "@expo/vector-icons";
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
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";

const MIN_RATING = 1;
const MAX_RATING = 10;

const getDifficultyMessage = (rating: number): string => {
  if (rating <= 2) return "Too Easy";
  if (rating <= 4) return "Easy";
  if (rating <= 6) return "Moderate";
  if (rating <= 8) return "Hard";
  return "Extremely Hard";
};

const getDifficultyColor = (rating: number): string => {
  if (rating <= 2) return Colors.success.DEFAULT;
  if (rating <= 4) return Colors.primary.DEFAULT;
  if (rating <= 6) return Colors.warning.DEFAULT;
  if (rating <= 8) return Colors.warning.dark;
  return Colors.error.DEFAULT;
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
      <View style={styles.header}>
        <TouchableOpacity
          onPress={props.onBack}
          style={styles.backButton}
          accessibilityLabel="Back to active session"
          testID="workout-rating-back"
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text.primary} />
          <Text style={styles.backLabel}>Back</Text>
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
            style={styles.ratingRow}
            onStartShouldSetResponder={() => {
              Keyboard.dismiss();
              return false;
            }}
          >
            {Array.from({ length: MAX_RATING }, (_, i) => i + 1).map((n) => {
              const selected = n === rating;
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => {
                    Keyboard.dismiss();
                    setRating(n);
                  }}
                  style={[
                    styles.ratingButton,
                    selected && {
                      backgroundColor: accent,
                      borderColor: accent,
                    },
                  ]}
                  testID={`workout-rating-${n}`}
                  accessibilityLabel={`Rate ${n} out of ${MAX_RATING}`}
                >
                  <Text
                    style={[
                      styles.ratingButtonText,
                      selected && styles.ratingButtonTextSelected,
                    ]}
                  >
                    {n}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text
            style={[styles.difficultyMessage, { color: accent }]}
            testID="workout-rating-message"
          >
            {message}
          </Text>

          <View style={styles.notesContainer}>
            <Text style={styles.notesLabel}>Workout Notes (Optional)</Text>
            <TextInput
              style={styles.notesInput}
              placeholder="Add any notes about your workout..."
              placeholderTextColor={Colors.text.tertiary}
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
    backgroundColor: Colors.background.primary,
  },
  header: {
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.md,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.xs,
    gap: Spacing.xs,
  },
  backLabel: {
    ...Typography.body1,
    color: Colors.text.primary,
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
    color: Colors.text.primary,
    textAlign: "center",
    paddingTop: Spacing.sm,
  },
  subtitle: {
    ...Typography.body1,
    color: Colors.text.secondary,
    textAlign: "center",
  },
  question: {
    ...Typography.h3,
    color: Colors.text.primary,
    textAlign: "center",
    marginTop: Spacing.lg,
  },
  ratingRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
  },
  ratingButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    backgroundColor: Colors.surface.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  ratingButtonText: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
  },
  ratingButtonTextSelected: {
    color: Colors.text.primary,
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
    color: Colors.text.secondary,
    marginBottom: Spacing.sm,
  },
  notesInput: {
    ...Typography.body2,
    color: Colors.text.primary,
    backgroundColor: Colors.surface.secondary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    minHeight: 100,
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  submitButton: {
    width: "100%",
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    marginTop: Spacing.lg,
  },
  submitButtonDisabled: {
    opacity: 0.6,
  },
  submitLabel: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
  },
});
