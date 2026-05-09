/**
 * ExerciseNotesPopover — per-exercise notes mid-session.
 *
 * Ported 1:1 from
 * `persistence-mobile/components/workouts/ExerciseNotesPopover`.
 * Slide-up drawer on the active-session screen with a Cancel + Save
 * footer (matches the legacy shape — earlier V2 dropped Cancel and
 * left only the header X). Save trims and persists onto
 * `SessionExercise.notes`; Cancel resets local state and discards.
 *
 * Drawer geometry mirrors legacy: `flex: 1`, `maxHeight: 80%`,
 * `Colors.surface.primary` bg, `borderRadius: 20`.
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
  TouchableWithoutFeedback,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Colors, Spacing, Typography } from "@/ui/theme/workoutsLegacyTheme";

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
                testID="exercise-notes-close"
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
                  style={styles.notesInput}
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Add a note about this exercise..."
                  placeholderTextColor={Colors.text.tertiary}
                  multiline
                  numberOfLines={8}
                  textAlignVertical="top"
                  autoFocus
                  returnKeyType="done"
                  onSubmitEditing={Keyboard.dismiss}
                  testID="exercise-notes-input"
                />
              </View>
            </ScrollView>

            <TouchableWithoutFeedback
              onPress={Keyboard.dismiss}
              accessible={false}
            >
              <View style={styles.actionsContainer}>
                <TouchableOpacity
                  onPress={handleCancel}
                  style={[styles.button, styles.cancelButton]}
                  activeOpacity={0.7}
                  testID="exercise-notes-cancel"
                >
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSave}
                  style={[styles.button, styles.saveButton]}
                  activeOpacity={0.7}
                  testID="exercise-notes-save"
                >
                  <Text style={styles.saveButtonText}>Save</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

// Geometry mirrors persistence-mobile/components/workouts/ExerciseNotesPopover
// — flex 1 + maxHeight 80%, surface.primary bg, literal radius 20 (matches
// legacy drawer; sits between BorderRadius.lg=16 and xl=24 in the token set).
const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "flex-end",
  },
  container: {
    flex: 1,
    justifyContent: "flex-end",
  },
  modalContent: {
    backgroundColor: Colors.surface.primary,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xl,
    paddingHorizontal: Spacing.lg,
    maxHeight: "80%",
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  headerTitle: {
    ...Typography.h3,
    color: Colors.text.primary,
    fontWeight: "600",
  },
  closeButton: { padding: Spacing.xs },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: Spacing.md },
  exerciseName: {
    ...Typography.body1,
    color: Colors.text.secondary,
    marginBottom: Spacing.md,
  },
  inputContainer: {
    flex: 1,
    marginBottom: Spacing.lg,
  },
  notesInput: {
    ...Typography.body2,
    color: Colors.text.primary,
    backgroundColor: Colors.surface.secondary,
    borderRadius: 12,
    padding: Spacing.md,
    minHeight: 150,
    maxHeight: 300,
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  actionsContainer: {
    flexDirection: "row",
    gap: Spacing.md,
  },
  button: {
    flex: 1,
    paddingVertical: Spacing.md,
    borderRadius: 12,
    alignItems: "center",
  },
  cancelButton: {
    backgroundColor: Colors.surface.secondary,
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  cancelButtonText: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
  },
  saveButton: {
    backgroundColor: Colors.primary.DEFAULT,
  },
  saveButtonText: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
  },
});
