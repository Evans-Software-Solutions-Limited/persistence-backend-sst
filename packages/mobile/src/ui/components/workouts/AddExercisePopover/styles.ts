import {
  BorderRadius,
  Colors,
  Spacing,
  Typography,
} from "@/ui/theme/workoutsLegacyTheme";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  // Full-screen modal shell — pageSheet presentation gives a partial
  // sheet on iOS (matches the create-workout modal). On Android the
  // modal fills the screen.
  modalSafeArea: {
    flex: 1,
    backgroundColor: Colors.background.primary,
  },

  // Sticky header (list view) — back arrow + centered title + Create
  // CTA. Same paddings as the workout-creator/editor screen header.
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  modalTitle: {
    ...Typography.body1,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
    color: Colors.text.primary,
  },
  backButton: {
    padding: Spacing.sm,
    minWidth: 40,
  },
  headerSpacer: {
    width: 40,
  },
  createButton: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
    minWidth: 40,
    alignItems: "flex-end",
  },
  createButtonText: {
    ...Typography.body2,
    color: Colors.primary.DEFAULT,
    fontWeight: "600",
  },

  // Sticky header (details view) — same shape, no Create CTA on the
  // right (just a spacer to keep the title centered).
  detailsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: Spacing.md,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.border,
  },
  detailsTitle: {
    ...Typography.body1,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
    color: Colors.text.primary,
  },

  // Sticky search bar (between header and scrollable list).
  searchWrapper: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: Colors.surface.secondary,
    borderRadius: BorderRadius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
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

  // Scrollable list region — flex: 1 so it consumes everything
  // between the sticky search bar above and the sticky footer below.
  modalScroll: {
    flex: 1,
  },
  modalScrollContent: {
    flexGrow: 1,
  },
  contentContainer: {
    paddingHorizontal: Spacing.lg,
  },
  // Centering shell for the in-list loading + empty branches. `flexGrow`
  // (not `flex`) lets the View occupy the ScrollView's full visible area
  // when the content is small (so the loader sits mid-screen) without
  // collapsing the container when there is real list content to render.
  loadingContainer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: Spacing.xl,
  },
  emptyState: {
    paddingVertical: Spacing.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    ...Typography.body2,
    color: Colors.text.secondary,
  },

  // List rows.
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

  // Sticky footer — Add + Superset CTAs in a flex row above the safe
  // area inset.
  modalFooter: {
    flexDirection: "row",
    gap: Spacing.md,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.lg,
    borderTopWidth: 1,
    borderTopColor: Colors.surface.border,
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
