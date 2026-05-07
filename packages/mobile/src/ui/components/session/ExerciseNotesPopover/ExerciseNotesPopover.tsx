/**
 * ExerciseNotesPopover — per-exercise notes mid-session.
 *
 * Ported 1:1 from
 * `persistence-mobile/components/workouts/ExerciseNotesPopover`. Slide-
 * up modal with a single multiline TextInput. Save trims and persists
 * onto `SessionExercise.notes`; Cancel discards.
 *
 * Spec: specs/05-active-session/requirements.md (extension to STORY-002:
 *       per-exercise notes match legacy parity).
 */

import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";

export type ExerciseNotesPopoverProps = {
  visible: boolean;
  exerciseName: string;
  initialNotes?: string;
  onSave: (notes: string) => void;
  onCancel: () => void;
};

export function ExerciseNotesPopover({
  visible,
  exerciseName,
  initialNotes = "",
  onSave,
  onCancel,
}: ExerciseNotesPopoverProps) {
  const [notes, setNotes] = useState(initialNotes);

  useEffect(() => {
    if (visible) setNotes(initialNotes);
  }, [visible, initialNotes]);

  const handleSave = () => {
    Keyboard.dismiss();
    onSave(notes.trim());
  };

  const handleCancel = () => {
    Keyboard.dismiss();
    setNotes(initialNotes);
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleCancel}
    >
      <SafeAreaView style={styles.overlay} edges={["top", "bottom"]}>
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.container}
        >
          <View style={styles.modalContent} testID="exercise-notes-popover">
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Exercise Notes</Text>
              <TouchableOpacity
                onPress={handleCancel}
                style={styles.closeButton}
                testID="exercise-notes-cancel"
              >
                <Ionicons name="close" size={24} color={Colors.text.primary} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.scrollView}
              contentContainerStyle={styles.scrollContent}
              keyboardShouldPersistTaps="handled"
            >
              <Text style={styles.exerciseName}>{exerciseName}</Text>

              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Notes for this exercise..."
                  placeholderTextColor={Colors.text.tertiary}
                  multiline
                  textAlignVertical="top"
                  autoFocus
                  testID="exercise-notes-input"
                />
              </View>
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity
                onPress={handleSave}
                style={styles.saveButton}
                testID="exercise-notes-save"
              >
                <Text style={styles.saveLabel}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  container: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: Colors.background.primary,
    borderTopLeftRadius: BorderRadius.lg,
    borderTopRightRadius: BorderRadius.lg,
    minHeight: "60%",
    maxHeight: "85%",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  headerTitle: {
    ...Typography.h3,
    color: Colors.text.primary,
  },
  closeButton: { padding: Spacing.xs },
  scrollView: { flex: 1 },
  scrollContent: { padding: Spacing.md, gap: Spacing.md },
  exerciseName: {
    ...Typography.body1,
    color: Colors.text.secondary,
  },
  inputContainer: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.md,
    padding: Spacing.sm,
    minHeight: 160,
  },
  input: {
    ...Typography.body1,
    color: Colors.text.primary,
    minHeight: 140,
  },
  footer: {
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.surface.border,
  },
  saveButton: {
    backgroundColor: Colors.primary.DEFAULT,
    paddingVertical: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
  },
  saveLabel: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
  },
});
