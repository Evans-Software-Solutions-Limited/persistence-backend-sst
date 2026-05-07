import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";

export const styles = {
  card: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.md,
    marginVertical: Spacing.sm,
  },
  cardSubstituted: {
    opacity: 0.7,
  },
  header: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  headerLeft: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: Spacing.sm,
  },
  title: {
    ...Typography.h3,
    color: Colors.text.primary,
    flexShrink: 1,
  },
  substitutedBadge: {
    backgroundColor: Colors.surface.tertiary,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  substitutedText: {
    ...Typography.caption,
    color: Colors.text.secondary,
    textTransform: "uppercase" as const,
    letterSpacing: 0.5,
  },
  actionsRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  menuButton: {
    width: 36,
    height: 36,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  addSetButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.sm,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface.secondary,
    gap: Spacing.xs,
  },
  addSetText: {
    ...Typography.button,
    color: Colors.primary.DEFAULT,
  },
};
