import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";

export const styles = {
  pill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface.tertiary,
  },
  pillDone: {
    backgroundColor: Colors.success.DEFAULT,
  },
  text: {
    ...Typography.caption,
    color: Colors.text.secondary,
    fontWeight: "600" as const,
  },
  textDone: {
    color: Colors.text.primary,
  },
};
