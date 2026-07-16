import { color } from "@/ui/theme/tokens";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  // Full-screen modal shell — pageSheet presentation gives a partial
  // sheet on iOS (matches the create-workout modal). On Android the
  // modal fills the screen.
  modalSafeArea: {
    flex: 1,
    backgroundColor: color.$bg,
  },

  // Sticky header (list view) — back arrow + centered title + Create
  // CTA. Same paddings as the workout-creator/editor screen header.
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: color.$surface3,
  },
  modalTitle: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$text,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  backButton: {
    padding: 8,
    minWidth: 40,
  },
  headerSpacer: {
    width: 40,
  },
  createButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 40,
    alignItems: "flex-end",
  },
  createButtonText: {
    fontSize: 14,
    lineHeight: 20,
    color: color.$primary,
    fontWeight: "600",
  },

  // Sticky header (details view) — same shape, no Create CTA on the
  // right (just a spacer to keep the title centered).
  detailsHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: color.$surface3,
  },
  detailsTitle: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$text,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },

  // Sticky search bar (between header and scrollable list).
  searchWrapper: {
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 8,
  },
  searchContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: color.$surface2,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 24,
    color: color.$text,
    padding: 0,
  },
  clearButton: {
    padding: 4,
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
    paddingHorizontal: 24,
  },
  // Centering shell for the in-list loading + empty branches. `flexGrow`
  // (not `flex`) lets the View occupy the ScrollView's full visible area
  // when the content is small (so the loader sits mid-screen) without
  // collapsing the container when there is real list content to render.
  loadingContainer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 32,
  },
  emptyState: {
    paddingVertical: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
    color: color.$text2,
  },

  // List rows.
  exerciseRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: color.$surface3,
    paddingHorizontal: 4,
    borderRadius: 4,
  },
  exerciseRowSelected: {
    backgroundColor: color.$surface,
    borderLeftWidth: 3,
    borderLeftColor: color.$primary,
    borderBottomColor: color.$primary,
  },
  exerciseRowDisabled: {
    opacity: 0.5,
  },
  exerciseImageContainer: {
    marginRight: 16,
  },
  exerciseImage: {
    width: 60,
    height: 60,
    backgroundColor: color.$surface2,
  },
  exerciseImagePlaceholder: {
    width: 60,
    height: 60,
    backgroundColor: color.$surface2,
    alignItems: "center",
    justifyContent: "center",
  },
  exerciseInfo: {
    flex: 1,
  },
  exerciseName: {
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 24,
    color: color.$text,
    marginBottom: 4,
  },
  exerciseNameDisabled: {
    color: color.$text3,
  },
  exerciseMuscle: {
    fontSize: 14,
    fontWeight: "400",
    lineHeight: 20,
    color: color.$text2,
  },
  exerciseMuscleDisabled: {
    color: color.$text3,
  },
  actionButtons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  infoButton: {
    padding: 4,
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
    borderColor: color.$surface3,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: {
    backgroundColor: color.$primary,
    borderColor: color.$primary,
  },
  checkboxDisabled: {
    opacity: 0.3,
  },

  // Sticky footer — Add + Superset CTAs in a flex row above the safe
  // area inset.
  modalFooter: {
    flexDirection: "row",
    gap: 16,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 24,
    borderTopWidth: 1,
    borderTopColor: color.$surface3,
  },
  footerButton: {
    flex: 1,
    backgroundColor: color.$primary,
    borderRadius: 12,
    paddingVertical: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  footerButtonDisabled: {
    backgroundColor: color.$surface2,
  },
  footerButtonText: {
    fontSize: 16,
    lineHeight: 24,
    color: color.$text,
    fontWeight: "600",
  },
  footerButtonTextDisabled: {
    color: color.$text3,
  },
});
