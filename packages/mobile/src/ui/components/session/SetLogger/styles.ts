import { GEIST_MONO_FAMILY } from "@/ui/theme/fonts";
import { color } from "@/ui/theme/tokens";

/**
 * 05.3 re-skin — 5-column set row from the prototype
 * (`active-workout.jsx:88–96`): `SET · PREV · REPS · KG · ×`. Numerics render in
 * `$mono`; inputs use the `$surface2` field treatment with a `$border` hairline
 * and 6pt radius. The grid HEADER row lives in the parent ExerciseBlock card.
 *
 * Deviation from the prototype's equal `1fr` columns: REPS/KG are FIXED width
 * and PREV takes the remaining slack. The prototype mock only ever shows an
 * em-dash for PREV, so equal thirds looked fine there — but with real data
 * ("10 reps • 25 kg") greedy `flex:1` inputs squeezed PREV until it truncated
 * (Brad's on-device note). PREV is also a tap-to-fill control, so it's styled
 * as a `$primary` link, not dim body text.
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
  // Tap-to-fill control → styled as a primary link, not dim body text.
  previousText: {
    fontFamily: GEIST_MONO_FAMILY,
    fontSize: 12,
    fontWeight: "600" as const,
    color: color.$primary,
  },
  previousDisabled: {
    flex: 1,
    fontFamily: GEIST_MONO_FAMILY,
    fontSize: 12,
    color: color.$text4,
  },
  // REPS / KG — FIXED-width fields (not greedy flex) so PREV keeps its room and
  // the boxes don't balloon. 62pt fits 3-4 mono chars ("100", "12.5").
  input: {
    width: 62,
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
