import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";

export const styles = {
  exerciseRow: {
    borderRadius: BorderRadius.sm,
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  exerciseHeader: {
    flexDirection: "row" as const,
    gap: Spacing.sm,
  },
  exerciseImage: {
    width: 50,
    height: 50,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface.secondary,
  },
  exerciseImagePlaceholder: {
    width: 50,
    height: 50,
    borderRadius: BorderRadius.sm,
    backgroundColor: Colors.surface.secondary,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  exerciseInfo: {
    flex: 1,
    gap: Spacing.xxs,
    justifyContent: "center" as const,
  },
  exerciseTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  exerciseName: {
    ...Typography.body2,
    color: Colors.text.primary,
  },
  exerciseDescription: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
  exerciseActions: {
    flexDirection: "row" as const,
    gap: Spacing.xs,
    marginLeft: Spacing.md,
  },
  actionButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  columnHeaders: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
    gap: Spacing.xs,
  },
  columnHeader: {
    ...Typography.caption,
    color: Colors.text.secondary,
    fontWeight: "600" as const,
    textTransform: "uppercase" as const,
  },
  columnHeaderSet: {
    flex: 1,
    textAlign: "center" as const,
  },
  columnHeaderPrevious: {
    flex: 2,
    textAlign: "center" as const,
  },
  columnHeaderReps: {
    width: 60,
    textAlign: "center" as const,
  },
  columnHeaderKg: {
    width: 60,
    textAlign: "center" as const,
  },
  columnHeaderSpacer: {
    flex: 1,
  },
  buttonsContainer: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    paddingHorizontal: Spacing.md,
  },
  footerButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: Spacing.xs,
    paddingVertical: Spacing.sm,
    marginTop: Spacing.xs,
  },
  footerButtonText: {
    ...Typography.caption,
    color: Colors.primary.DEFAULT,
  },
};
