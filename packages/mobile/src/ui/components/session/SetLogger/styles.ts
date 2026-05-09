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
    backgroundColor: "transparent" as const,
  },
  setNumber: {
    flex: 1,
    ...Typography.body2,
    color: Colors.text.secondary,
    fontWeight: "600" as const,
    textAlign: "center" as const,
  },
  previousContainer: {
    flex: 2,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  previousText: {
    ...Typography.body2,
    color: Colors.primary.DEFAULT,
    fontWeight: "600" as const,
    textAlign: "center" as const,
  },
  previousDisabled: {
    ...Typography.body2,
    color: Colors.text.tertiary,
    flex: 2,
    textAlign: "center" as const,
  },
  input: {
    backgroundColor: Colors.surface.secondary,
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
    width: 60,
  },
  trashContainer: {
    flex: 1,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
};
