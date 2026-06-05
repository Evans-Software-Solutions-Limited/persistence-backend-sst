import { ExerciseEditorContainer } from "../../../../src/ui/containers/ExerciseEditorContainer";

/**
 * `/exercises/[id]/edit` — full-screen, owner-only exercise editor.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-008
 *
 * Phase 04.6: reached via the owner-only Edit button on the detail screen.
 * Full-screen (not a sheet), matching the create flow + the locked decision #7.
 */
export default function ExerciseEditorScreen() {
  return <ExerciseEditorContainer />;
}
