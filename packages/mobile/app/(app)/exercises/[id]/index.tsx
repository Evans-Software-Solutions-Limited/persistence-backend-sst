import { ExerciseDetailContainer } from "../../../../src/ui/containers/ExerciseDetailContainer";

/**
 * `/exercises/[id]` — full-screen exercise detail.
 *
 * Spec: specs/04-workout-management/requirements.md STORY-007
 *
 * Phase 04.6: replaces the trivial placeholder that previously lived at
 * `exercises/[id].tsx`. Restructured to the folder form so the owner-only
 * editor can live at the sibling `[id]/edit.tsx` (mirrors the workouts
 * `[id]/index.tsx` + `[id]/edit.tsx` precedent). The Train > Exercises list's
 * `router.push('/(app)/exercises/:id')` resolves here.
 */
export default function ExerciseDetailScreen() {
  return <ExerciseDetailContainer />;
}
