import type { UseFormReturn } from "react-hook-form";
import { applyServerErrors } from "@/lib/form";
import { isCoachApiError } from "../api/coachApi";
import {
  SCHEDULE_MESSAGE_FIELDS,
  SCHEDULE_SERVER_FIELDS,
  type ScheduleValues,
} from "./scheduleForm";

/** Refusals from the sessions routes (#568) that aren't about one field. */
const REFUSALS: Record<string, string> = {
  not_your_client: "One of these people isn't your active client any more.",
  revision_conflict:
    "This session changed somewhere else. The calendar now shows the latest; open it again to edit.",
  session_cancelled: "This session has been cancelled.",
  session_not_found: "This session no longer exists.",
};

/** What the sheet says when a write is refused; null when a field says it. */
export function writeError(
  e: unknown,
  form: Pick<UseFormReturn<ScheduleValues>, "setError">,
): string | null {
  if (!isCoachApiError(e)) return "We couldn't save this session. Try again.";
  if (e.offline) {
    return "You're offline. Scheduling needs a connection.";
  }
  if (e.code === "workout_not_found") {
    form.setError("workoutId", {
      type: "server",
      message: "That workout isn't in your library any more.",
    });
    return null;
  }
  const known = e.code ? REFUSALS[e.code] : undefined;
  if (known) return known;
  if (
    applyServerErrors(e, form.setError, SCHEDULE_SERVER_FIELDS, {
      fieldsInMessage: SCHEDULE_MESSAGE_FIELDS,
    })
  ) {
    return null;
  }
  return e.message || "We couldn't save this session. Try again.";
}
