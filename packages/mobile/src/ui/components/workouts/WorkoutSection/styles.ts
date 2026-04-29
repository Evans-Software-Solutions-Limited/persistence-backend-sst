import { Colors, Spacing, Typography } from "@/ui/theme/workoutsLegacyTheme";

export const styles = {
  section: {
    marginBottom: Spacing.lg,
  },
  sectionHeader: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    marginBottom: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  sectionHeaderContent: {
    flex: 1,
  },
  sectionTitle: {
    ...Typography.h3,
    marginBottom: Spacing.xs,
  },
  sectionSubtitle: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
  loadingContainer: {
    alignItems: "center" as const,
    paddingVertical: Spacing.xl,
  },
  loadingText: {
    ...Typography.body2,
    marginTop: Spacing.md,
    color: Colors.text.secondary,
  },
  emptyContainer: {
    alignItems: "center" as const,
    paddingVertical: Spacing.xl,
  },
  emptyTitle: {
    ...Typography.h3,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  emptyMessage: {
    ...Typography.body2,
    textAlign: "center" as const,
    color: Colors.text.secondary,
  },
};
