import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";

export const styles = {
  container: {
    marginBottom: Spacing.lg,
  },
  primaryButton: {
    backgroundColor: Colors.primary.DEFAULT,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    marginBottom: Spacing.sm,
  },
  secondaryButton: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: Colors.primary.DEFAULT,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    marginBottom: Spacing.sm,
  },
  disabledButton: {
    backgroundColor: Colors.surface.tertiary,
    opacity: 0.6,
  },
  buttonText: {
    ...Typography.button,
    color: Colors.text.primary,
    marginLeft: Spacing.sm,
  },
  secondaryButtonText: {
    color: Colors.primary.DEFAULT,
  },
};
