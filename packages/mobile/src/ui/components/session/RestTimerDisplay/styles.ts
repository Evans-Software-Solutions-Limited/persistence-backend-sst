import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";

export const styles = {
  container: {
    position: "absolute" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.background.primary,
    justifyContent: "center" as const,
    alignItems: "center" as const,
    zIndex: 2000,
    elevation: 20,
  },
  content: {
    alignItems: "center" as const,
    width: "100%" as const,
    paddingHorizontal: Spacing.xl,
  },
  timerContainer: {
    alignItems: "center" as const,
    marginBottom: Spacing.xl * 2,
  },
  timerText: {
    ...Typography.h1,
    fontSize: 72,
    fontWeight: "700" as const,
    color: Colors.primary.DEFAULT,
    marginVertical: Spacing.lg,
    fontVariant: ["tabular-nums" as const],
  },
  timerLabel: {
    ...Typography.body1,
    color: Colors.text.secondary,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
  },
  buttonContainer: {
    width: "100%" as const,
    maxWidth: 300,
  },
  stopButton: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    borderRadius: BorderRadius.md,
    backgroundColor: Colors.surface.secondary,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  stopButtonText: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600" as const,
  },
};
