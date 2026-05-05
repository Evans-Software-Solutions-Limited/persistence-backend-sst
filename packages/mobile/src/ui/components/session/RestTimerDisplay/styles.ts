import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";

export const styles = {
  container: {
    backgroundColor: Colors.surface.secondary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    alignItems: "center" as const,
  },
  ringWrap: {
    width: 160,
    height: 160,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  ringLabel: {
    position: "absolute" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  timeText: {
    ...Typography.h1,
    color: Colors.text.primary,
  },
  captionText: {
    ...Typography.caption,
    color: Colors.text.secondary,
    textTransform: "uppercase" as const,
    letterSpacing: 1.5,
  },
  controls: {
    flexDirection: "row" as const,
    marginTop: Spacing.lg,
    gap: Spacing.sm,
  },
  controlButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface.tertiary,
    gap: Spacing.xs,
  },
  controlButtonPrimary: {
    backgroundColor: Colors.primary.DEFAULT,
  },
  controlText: {
    ...Typography.button,
    color: Colors.text.primary,
  },
  controlTextPrimary: {
    ...Typography.button,
    color: Colors.text.primary,
  },
};
