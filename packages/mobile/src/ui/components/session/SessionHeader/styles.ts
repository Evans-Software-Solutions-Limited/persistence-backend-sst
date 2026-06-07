import { GEIST_FAMILY, GEIST_MONO_FAMILY } from "@/ui/theme/fonts";
import { color } from "@/ui/theme/tokens";

/**
 * 05.3 re-skin — active-session header per the prototype
 * (`active-workout.jsx:16–42`): a 36×36 chevron-down minimise button on the
 * left, a centred workout name with a mono elapsed timer beneath it, and an
 * "End" pill on the right.
 */
export const styles = {
  container: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    justifyContent: "space-between" as const,
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
  },
  minimizeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: color.$surface2,
    borderWidth: 1,
    borderColor: color.$border,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  centerSection: {
    flex: 1,
    alignItems: "center" as const,
  },
  workoutName: {
    fontSize: 15,
    fontWeight: "600" as const,
    color: color.$text,
  },
  timerSection: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 4,
    marginTop: 2,
  },
  timer: {
    fontFamily: GEIST_MONO_FAMILY,
    fontSize: 12,
    fontWeight: "600" as const,
    color: color.$primary,
  },
  endButton: {
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: color.$border2,
    alignItems: "center" as const,
    justifyContent: "center" as const,
  },
  endButtonText: {
    fontFamily: GEIST_FAMILY,
    fontSize: 12.5,
    fontWeight: "600" as const,
    color: color.$text3,
  },
};
