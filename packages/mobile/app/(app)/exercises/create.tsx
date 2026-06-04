import { CreateExerciseContainer } from "../../../src/ui/containers/CreateExerciseContainer";

/**
 * `/exercises/create` — full-screen create-a-custom-exercise route.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-006
 *
 * Revised 2026-06-03 (Phase 04.3): create is a full-screen route again (not the
 * bottom-sheet the design package originally specced). The 8-section form needs
 * reliable scrolling + keyboard handling that the gorhom sheet kept fighting on
 * device; full-screen matches the legacy creator + the 04.6 editor and reuses
 * the same <ExerciseFormFields>. The Train hub `+ Create` action + the Exercises
 * empty-state CTA `router.push` here; deep links to `/exercises/create` resolve
 * to this screen directly.
 */
export default function CreateExerciseScreen() {
  return <CreateExerciseContainer />;
}
