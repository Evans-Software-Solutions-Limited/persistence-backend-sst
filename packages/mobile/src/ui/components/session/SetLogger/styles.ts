import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";

export const styles = {
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  rowCompleted: {
    backgroundColor: Colors.surface.secondary,
    opacity: 0.85,
  },
  setNumber: {
    width: 32,
    ...Typography.body2,
    color: Colors.text.secondary,
    fontWeight: "600" as const,
    textAlign: "center" as const,
  },
  previousContainer: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  previousText: {
    ...Typography.body2,
    color: Colors.primary.DEFAULT,
  },
  previousDisabled: {
    flex: 1,
    ...Typography.body2,
    color: Colors.text.tertiary,
    textAlign: "center" as const,
  },
  input: {
    backgroundColor: Colors.surface.tertiary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    ...Typography.body2,
    color: Colors.text.primary,
    textAlign: "center" as const,
  },
  weightInput: {
    width: 60,
  },
  repsInput: {
    width: 50,
  },
  rpeInput: {
    width: 50,
  },
  actionButton: {
    width: 40,
    height: 40,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  actionButtonCompleted: {
    opacity: 0.7,
  },
};
