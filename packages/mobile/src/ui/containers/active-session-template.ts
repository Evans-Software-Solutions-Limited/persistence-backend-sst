/**
 * Pure helpers for threading workout-template metadata through the
 * active-session presenter. Pulled out of `ActiveSessionContainer.tsx`
 * so the with-template / no-template / null-field branches can be
 * unit-tested in isolation without rendering the modal stack.
 *
 * Spec: specs/05-active-session/requirements.md STORY-002 / STORY-003
 */

import type { Workout } from "@/domain/models/workout";
import type { SessionExercise } from "@/domain/models/session";
import type { SessionExerciseTemplate } from "@/ui/presenters/ActiveSessionPresenter";

export type BuildTemplateMapInput = {
  sessionExercises: readonly SessionExercise[];
  workout: Workout | null | undefined;
  defaultRestSeconds: number;
};

/**
 * Build a per-session-exercise template map from the workout-template
 * lookup. Quick-Start sessions land outside the workout — every
 * exercise gets `{ restSeconds: defaultRestSeconds }`. When a template
 * is found, all of its nullable fields coerce `null → undefined` to
 * keep the presenter prop type clean.
 */
export function buildTemplateMap({
  sessionExercises,
  workout,
  defaultRestSeconds,
}: BuildTemplateMapInput): Record<string, SessionExerciseTemplate> {
  const map: Record<string, SessionExerciseTemplate> = {};
  const templateExercises = workout?.exercises ?? [];
  for (const ex of sessionExercises) {
    const template = templateExercises.find(
      (we) => we.exerciseId === ex.exerciseId,
    );
    map[ex.id] = template
      ? {
          imageUrl: template.exercise?.thumbnailUrl ?? undefined,
          targetSets: template.targetSets ?? undefined,
          targetRepsMin: template.targetRepsMin,
          targetRepsMax: template.targetRepsMax,
          restSeconds: template.restSeconds ?? defaultRestSeconds,
        }
      : { restSeconds: defaultRestSeconds };
  }
  return map;
}
