import { Colors, Spacing, Typography } from "@/ui/theme/workoutsLegacyTheme";

export const styles = {
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: Spacing.xs,
    paddingVertical: Spacing.xs,
    paddingHorizontal: Spacing.sm,
  },
  text: {
    ...Typography.caption,
    color: Colors.text.secondary,
  },
};
