import { ActiveSessionContainer } from "@/ui/containers/ActiveSessionContainer";

/**
 * Active-session modal route — `/(app)/session`. (M3, Story-001 / 005 / 008.)
 *
 * Reads `?workoutId=` (start from template) or `?sessionId=` (resume)
 * from `useLocalSearchParams` inside the container. Modal preset
 * registered in `(app)/_layout.tsx` mirrors `workouts/create.tsx`.
 *
 * Spec: specs/05-active-session/requirements.md STORY-001, STORY-008
 *       specs/milestones/M3-active-session/EXECUTION_PLAN.md § 2 Commit 7
 */
export default function ActiveSessionRoute() {
  return <ActiveSessionContainer />;
}
