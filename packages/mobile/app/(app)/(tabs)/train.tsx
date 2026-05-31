import { TrainHubContainer } from "@/ui/containers/TrainHubContainer";

/**
 * Train tab — consolidates the Workouts list + Exercises library under one
 * hub with a two-segment switcher (per Option 3 IA).
 *
 * Spec: specs/14-navigation/design.md § <TrainHubContainer>
 *       specs/14-navigation/requirements.md STORY-005
 *
 * Replaces the legacy flat `workouts.tsx` + `exercises.tsx` tabs. The
 * detail / creator / filters sub-routes still live as siblings of `(tabs)`
 * in `(app)/_layout.tsx` so they push OVER the tab bar.
 */
export default function TrainTab() {
  return <TrainHubContainer />;
}
