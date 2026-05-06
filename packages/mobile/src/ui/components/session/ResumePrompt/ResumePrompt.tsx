/**
 * ResumePrompt — top-level overlay rendered in `(app)/_layout.tsx`
 * when an in-progress session is found at app launch. (M3, Story-008.)
 *
 * Continue → routes to `/(app)/session?sessionId=<id>` (resume in
 * place; the screen reads from SQLite on mount).
 * Discard → fires `cancelSessionCommand`; prompt dismisses.
 *
 * Implemented as a Modal with a custom backdrop rather than a native
 * route so it overlays whatever tab the user lands on at launch.
 *
 * Spec: specs/05-active-session/requirements.md STORY-008
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 9
 */

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Modal, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import type { WorkoutSession } from "@/domain/models/session";

export type ResumePromptProps = {
  session: WorkoutSession | null;
  onContinue: () => void;
  onDiscard: () => void;
  onDismiss: () => void;
};

export function ResumePrompt(props: ResumePromptProps) {
  const visible = props.session != null;
  if (!visible) return null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={props.onDismiss}
      testID="resume-prompt"
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconRow}>
            <View style={styles.iconCircle}>
              <Ionicons
                name="play-circle"
                size={32}
                color={Colors.primary.DEFAULT}
              />
            </View>
          </View>
          <Text style={styles.title}>Continue {props.session?.name}?</Text>
          <Text style={styles.body}>
            You have an unfinished workout. Pick up where you left off, or
            discard it (logged sets stay in your history).
          </Text>
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton]}
              onPress={props.onDiscard}
              testID="resume-prompt-discard"
            >
              <Text style={styles.secondaryLabel}>Discard</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton]}
              onPress={props.onContinue}
              testID="resume-prompt-continue"
            >
              <Text style={styles.primaryLabel}>Continue</Text>
              <Ionicons
                name="arrow-forward"
                size={18}
                color={Colors.text.primary}
              />
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: Spacing.lg,
  },
  card: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    width: "100%",
    maxWidth: 360,
    gap: Spacing.md,
  },
  iconRow: {
    alignItems: "center",
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: BorderRadius.full,
    backgroundColor: Colors.surface.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...Typography.h3,
    color: Colors.text.primary,
    textAlign: "center",
  },
  body: {
    ...Typography.body2,
    color: Colors.text.secondary,
    textAlign: "center",
  },
  actions: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  button: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.sm,
    borderRadius: BorderRadius.md,
    gap: Spacing.xs,
  },
  primaryButton: {
    backgroundColor: Colors.primary.DEFAULT,
    flex: 2,
  },
  primaryLabel: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
  },
  secondaryButton: {
    backgroundColor: Colors.surface.tertiary,
  },
  secondaryLabel: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
});
