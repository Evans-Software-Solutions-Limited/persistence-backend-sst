import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  exerciseConfigCard: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    ...Shadows.medium,
  },
  exerciseConfigHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: Spacing.md,
  },
  exerciseConfigTitle: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
  },
  exerciseConfigNumber: {
    ...Typography.h3,
    color: Colors.primary.DEFAULT,
    marginRight: Spacing.sm,
    minWidth: 24,
  },
  exerciseConfigName: {
    ...Typography.h3,
    flex: 1,
  },
  removeExerciseButton: {
    padding: Spacing.sm,
  },
  exerciseConfigFields: {
    flexDirection: "row",
    gap: Spacing.sm,
  },
  configField: {
    flex: 1,
  },
  configFieldLabel: {
    ...Typography.caption,
    color: Colors.text.secondary,
    marginBottom: Spacing.xs,
  },
  configFieldInput: {
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.sm,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    ...Typography.body2,
    color: Colors.text.primary,
    textAlign: "center",
  },
});
