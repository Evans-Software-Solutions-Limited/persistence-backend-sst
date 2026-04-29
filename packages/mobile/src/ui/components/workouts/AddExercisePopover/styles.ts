import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: Spacing.lg,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.md,
  },
  createButton: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  createButtonText: {
    ...Typography.body2,
    color: Colors.primary.DEFAULT,
    fontWeight: "600",
  },
  headerContainer: {},
  title: {
    ...Typography.h3,
    color: Colors.text.primary,
    fontWeight: "600",
  },
  closeButton: {
    padding: Spacing.xs,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface.secondary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    marginHorizontal: Spacing.lg,
    marginVertical: Spacing.sm,
  },
  scrollContainer: {
    flex: 1,
  },
  searchIcon: {
    marginRight: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    ...Typography.body1,
    color: Colors.text.primary,
    padding: 0,
  },
  clearButton: {
    padding: Spacing.xs,
  },
  contentContainer: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
  },
  loader: {
    marginTop: Spacing.xl,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingVertical: Spacing.xl,
  },
  emptyText: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
  exerciseRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
    paddingHorizontal: Spacing.xs,
    borderRadius: BorderRadius.sm,
  },
  exerciseRowSelected: {
    backgroundColor: Colors.surface.primary,
    borderLeftWidth: 3,
    borderLeftColor: Colors.primary.DEFAULT,
    borderBottomColor: Colors.primary.DEFAULT,
  },
  exerciseRowDisabled: {
    opacity: 0.5,
  },
  exerciseImageContainer: {
    marginRight: Spacing.md,
  },
  exerciseImage: {
    width: 60,
    height: 60,
    backgroundColor: Colors.surface.secondary,
  },
  exerciseImagePlaceholder: {
    width: 60,
    height: 60,
    backgroundColor: Colors.surface.secondary,
    alignItems: "center",
    justifyContent: "center",
  },
  exerciseInfo: {
    flex: 1,
  },
  exerciseName: {
    ...Typography.body1,
    color: Colors.text.primary,
    marginBottom: Spacing.xs,
  },
  exerciseNameDisabled: {
    color: Colors.text.tertiary,
  },
  exerciseMuscle: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },
  exerciseMuscleDisabled: {
    color: Colors.text.tertiary,
  },
  actionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.sm,
  },
  infoButton: {
    padding: Spacing.xs,
    minWidth: 24,
    minHeight: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.surface.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: {
    backgroundColor: Colors.primary.DEFAULT,
    borderColor: Colors.primary.DEFAULT,
  },
  checkboxDisabled: {
    opacity: 0.3,
  },
  footer: {
    flexDirection: "row",
    gap: Spacing.md,
    padding: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.surface.border,
  },
  button: {
    flex: 1,
  },
  footerButton: {
    flex: 1,
    backgroundColor: Colors.primary.DEFAULT,
    borderRadius: BorderRadius.md,
    paddingVertical: Spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  footerButtonDisabled: {
    backgroundColor: Colors.surface.secondary,
  },
  footerButtonText: {
    ...Typography.body1,
    color: Colors.text.primary,
    fontWeight: "600",
  },
  footerButtonTextDisabled: {
    color: Colors.text.tertiary,
  },
});
