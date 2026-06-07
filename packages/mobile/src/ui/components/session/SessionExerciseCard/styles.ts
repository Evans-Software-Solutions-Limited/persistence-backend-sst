import { GEIST_FAMILY } from "@/ui/theme/fonts";
import { color } from "@/ui/theme/tokens";

/**
 * 05.3 re-skin — ExerciseBlock visual per the prototype
 * (`active-workout.jsx:73–106`): 28×28 icon tile + name + "{N} sets × reps"
 * meta + action IconBtns; an uppercase 5-column grid header aligned to the
 * SetLogger rows (`SET 36 · PREV 1fr · REPS 1fr · KG 1fr · × 24`); inline
 * `+ ADD SET` / `{rest}S REST` links below. Notes + remove affordances are
 * preserved alongside the prototype's swap (legacy fidelity).
 */
export const styles = {
  exerciseRow: {
    gap: 8,
    marginBottom: 14,
  },
  exerciseHeader: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 10,
    marginBottom: 8,
  },
  // 28×28 toned icon tile (or thumbnail when an image URL is present).
  iconTile: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: color.$surface2,
    borderWidth: 1,
    borderColor: color.$border,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  exerciseImage: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: color.$surface2,
  },
  exerciseInfo: {
    flex: 1,
    justifyContent: "center" as const,
  },
  exerciseTitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
  },
  exerciseName: {
    fontSize: 15,
    fontWeight: "600" as const,
    color: color.$text,
  },
  exerciseDescription: {
    fontSize: 11,
    color: color.$text3,
    marginTop: 1,
  },
  exerciseActions: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 2,
  },
  actionButton: {
    width: 28,
    height: 28,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  // 5-column grid header — widths mirror SetLogger row columns.
  columnHeaders: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingHorizontal: 4,
    marginBottom: 4,
  },
  columnHeader: {
    fontFamily: GEIST_FAMILY,
    fontSize: 10.5,
    fontWeight: "600" as const,
    color: color.$text3,
    letterSpacing: 1,
    textTransform: "uppercase" as const,
  },
  columnHeaderSet: {
    width: 36,
    textAlign: "left" as const,
  },
  columnHeaderPrevious: {
    flex: 1,
    textAlign: "left" as const,
  },
  columnHeaderReps: {
    flex: 1,
    textAlign: "center" as const,
  },
  columnHeaderKg: {
    flex: 1,
    textAlign: "center" as const,
  },
  columnHeaderSpacer: {
    width: 24,
  },
  buttonsContainer: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    marginTop: 6,
  },
  footerButton: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    paddingVertical: 4,
  },
  footerButtonText: {
    color: color.$primary,
    fontSize: 11.5,
    fontWeight: "600" as const,
  },
};
