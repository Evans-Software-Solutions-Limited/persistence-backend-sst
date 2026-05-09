import { Colors, Spacing, Typography } from "@/ui/theme/workoutsLegacyTheme";

export const styles = {
  container: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
    backgroundColor: Colors.surface.primary,
  },
  closeButton: {
    width: 36,
    height: 36,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  center: {
    flex: 1,
    alignItems: "center" as const,
  },
  spacer: {
    width: 36,
  },
  name: {
    ...Typography.h3,
    color: Colors.text.primary,
  },
  subtitle: {
    ...Typography.caption,
    color: Colors.text.secondary,
    marginTop: 2,
  },
};
