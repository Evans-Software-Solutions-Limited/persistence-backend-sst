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
  limitCard: {
    backgroundColor: "rgba(255, 183, 77, 0.15)", // Low opacity warning background
    borderRadius: BorderRadius.md,
    padding: Spacing.lg,
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: Spacing.md,
    borderWidth: 2,
    borderColor: Colors.warning.DEFAULT,
  },
  limitContent: {
    flex: 1,
  },
  limitTitle: {
    ...Typography.h4,
    color: Colors.text.primary,
    fontWeight: "700" as const,
    marginBottom: Spacing.xs,
  },
  limitMessage: {
    ...Typography.body2,
    color: Colors.text.primary,
    marginBottom: Spacing.md,
  },
  upgradeButton: {
    backgroundColor: Colors.warning.DEFAULT,
    borderRadius: BorderRadius.sm,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    alignSelf: "flex-start" as const,
  },
  upgradeButtonText: {
    ...Typography.body2,
    color: Colors.text.primary,
    fontWeight: "600" as const,
  },
};
