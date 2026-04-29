import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";

export const styles = {
  // Workout Card
  workoutCard: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.sm,
    ...Shadows.medium,
  },
  workoutCardDisabled: {
    opacity: 0.5,
  },
  cardHeader: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    marginBottom: Spacing.sm,
  },
  cardTitleContainer: {
    flex: 1,
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  cardTitle: {
    ...Typography.h3,
    flex: 1,
    fontSize: 18,
    color: Colors.text.primary,
  },
  cardTitleDisabled: {
    color: Colors.text.tertiary,
  },
  startButton: {
    backgroundColor: Colors.primary.DEFAULT,
    borderRadius: BorderRadius.full,
    width: 40,
    height: 40,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  cardDescription: {
    ...Typography.body2,
    marginBottom: Spacing.sm,
    color: Colors.text.secondary,
  },
  cardMetadata: {
    flexDirection: "row" as const,
    marginBottom: Spacing.sm,
  },
  metadataRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: Spacing.md,
  },
  durationContainer: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  metadataText: {
    ...Typography.body2,
    marginLeft: Spacing.xs,
    color: Colors.text.secondary,
  },
  muscleGroups: {
    marginBottom: Spacing.sm,
  },
  muscleBadge: {
    backgroundColor: Colors.background.secondary,
    borderRadius: BorderRadius.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    marginRight: Spacing.xs,
  },
  muscleBadgeText: {
    fontSize: 12,
    fontWeight: "500" as const,
    color: Colors.text.secondary,
  },
  assignedTag: {
    alignSelf: "flex-start" as const,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderRadius: 12,
  },
  ptTag: {
    backgroundColor: "#3B82F6", // Blue for PT
  },
  physioTag: {
    backgroundColor: "#10B981", // Green for Physio
  },
  assignedTagText: {
    ...Typography.caption,
    color: Colors.text.primary,
    fontWeight: "600" as const,
  },
  exerciseCountContainer: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  exerciseCountText: {
    ...Typography.caption,
    color: Colors.text.secondary,
    marginLeft: Spacing.xs,
  },
  muscleTagsContainer: {
    flexDirection: "row" as const,
    flexWrap: "wrap" as const,
    alignItems: "center" as const,
  },
  cardActions: {
    flexDirection: "row" as const,
    justifyContent: "flex-end" as const,
    gap: Spacing.md,
  },
  actionButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
  },
  actionButtonText: {
    ...Typography.body2,
    marginLeft: Spacing.xs,
    color: Colors.text.secondary,
  },
  actionButtonTextDisabled: {
    color: Colors.text.tertiary,
  },
};
