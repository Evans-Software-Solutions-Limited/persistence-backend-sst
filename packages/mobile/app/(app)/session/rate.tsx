import { WorkoutRatingContainer } from "@/ui/containers/WorkoutRatingContainer";

/**
 * Workout rating modal route — `/(app)/session/rate`. Pushed on top of
 * the active-session screen on Complete, before the Summary. Captures
 * the 1-10 difficulty rating + workout notes, then fires
 * `completeSessionCommand` and replaces with the Summary.
 *
 * Spec: specs/05-active-session/requirements.md STORY-006
 */
export default function WorkoutRatingRoute() {
  return <WorkoutRatingContainer />;
}
