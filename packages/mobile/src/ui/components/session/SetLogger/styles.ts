import { GEIST_MONO_FAMILY } from "@/ui/theme/fonts";
import { color } from "@/ui/theme/tokens";

/**
 * 05.3 re-skin — 5-column set row matching the prototype
 * (`active-workout.jsx:88–96`): `SET · PREV · REPS · KG · ×`. Column widths
 * mirror the prototype grid `36 / 1fr / 1fr / 1fr / 24`. Numerics render in
 * `$mono`; inputs use the `$surface2` field treatment with a `$border` hairline
 * and 6pt radius. The grid HEADER row lives in the parent ExerciseBlock card.
 */
export const styles = {
  row: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: color.$border,
    backgroundColor: "transparent" as const,
  },
  // SET — 36pt fixed column, mono.
  setNumber: {
    width: 36,
    fontFamily: GEIST_MONO_FAMILY,
    fontSize: 13,
    color: color.$text2,
    textAlign: "left" as const,
  },
  // PREV — flexible column, tap-to-fill.
  previousContainer: {
    flex: 1,
    alignItems: "flex-start" as const,
    justifyContent: "center" as const,
  },
  previousText: {
    fontFamily: GEIST_MONO_FAMILY,
    fontSize: 12,
    color: color.$text4,
  },
  previousDisabled: {
    flex: 1,
    fontFamily: GEIST_MONO_FAMILY,
    fontSize: 12,
    color: color.$text4,
  },
  // REPS / KG — flexible inputs, centred mono.
  input: {
    flex: 1,
    backgroundColor: color.$surface2,
    borderWidth: 1,
    borderColor: color.$border,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontFamily: GEIST_MONO_FAMILY,
    fontSize: 13,
    color: color.$text,
    textAlign: "center" as const,
  },
  repsInput: {},
  weightInput: {},
  // × — 24pt fixed delete column.
  trashContainer: {
    width: 24,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
};
