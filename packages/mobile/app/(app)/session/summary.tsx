import { SessionSummaryContainer } from "@/ui/containers/SessionSummaryContainer";

/**
 * Session-summary modal route — `/(app)/session/summary`. Pushed on top
 * of the session screen on Finish/Discard. Back returns to the session,
 * Save / Confirm-discard collapses the modal stack.
 *
 * Spec: specs/05-active-session/requirements.md STORY-006, STORY-007
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 8
 */
export default function SessionSummaryRoute() {
  return <SessionSummaryContainer />;
}
