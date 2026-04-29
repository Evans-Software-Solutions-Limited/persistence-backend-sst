import { StyleSheet } from "react-native";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";

export const styles = StyleSheet.create({
  // Header
  title: {
    ...Typography.h3,
    fontSize: 18,
    color: Colors.text.primary,
    lineHeight: 22,
    marginBottom: 0,
  },

  // Loading & Error States
  loadingContainer: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
  },
  loadingText: {
    ...Typography.body2,
    marginTop: Spacing.md,
    color: Colors.text.secondary,
  },
  errorContainer: {
    alignItems: "center",
    paddingVertical: Spacing.xl,
  },
  errorTitle: {
    ...Typography.h3,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  errorMessage: {
    ...Typography.body2,
    textAlign: "center",
    color: Colors.text.secondary,
  },

  // Section
  section: {
    marginBottom: Spacing.lg,
  },
  description: {
    ...Typography.body1,
    marginBottom: Spacing.md,
    color: Colors.text.secondary,
  },
  metadata: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: Spacing.md,
  },
  metadataItem: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: Spacing.lg,
    marginBottom: Spacing.sm,
  },
  metadataText: {
    ...Typography.body2,
    marginLeft: Spacing.xs,
    color: Colors.text.secondary,
  },

  // Exercise rows
  exerciseItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface.secondary,
    borderRadius: BorderRadius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
  },
  exerciseThumbnail: {
    width: 60,
    height: 60,
    borderRadius: BorderRadius.sm,
    marginRight: Spacing.md,
    overflow: "hidden",
  },
  exerciseImage: {
    width: "100%",
    height: "100%",
  },
  exerciseImagePlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: Colors.background.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  exerciseInfo: {
    flex: 1,
  },
  exerciseName: {
    ...Typography.body1,
    fontWeight: "600" as const,
    color: Colors.text.primary,
    marginBottom: Spacing.xxs,
  },
  exerciseDetails: {
    ...Typography.body2,
    color: Colors.text.secondary,
    marginBottom: Spacing.xs,
  },
  exerciseCategory: {
    ...Typography.caption,
    color: Colors.text.tertiary,
  },
  // Superset visual
  supersetBadge: {
    alignSelf: "flex-start",
    backgroundColor: Colors.primary.dark,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xxs,
    borderRadius: BorderRadius.sm,
    marginBottom: Spacing.xs,
  },
  supersetBadgeText: {
    fontSize: 11,
    fontWeight: "600" as const,
    color: Colors.text.primary,
  },

  // Footer / Start button
  startButton: {
    backgroundColor: Colors.primary.DEFAULT,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    ...Shadows.electric,
  },
  startButtonText: {
    ...Typography.button,
    color: Colors.text.primary,
    marginLeft: Spacing.sm,
  },
});
