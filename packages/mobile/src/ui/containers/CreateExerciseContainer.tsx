import { router } from "expo-router";
import { useCallback } from "react";
import { Alert } from "react-native";

import { createExerciseCommand } from "@/application/commands/create-exercise.command";
import {
  toCreateExerciseInput,
  type NewExerciseInput,
} from "@/ui/components/exercises/ExerciseFormFields";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useExerciseLibrary } from "@/ui/hooks/useExerciseLibrary";
import { CreateExercisePresenter } from "@/ui/presenters/CreateExercisePresenter";

/**
 * <CreateExerciseContainer> — wires the full-screen Create-Exercise route to
 * the offline-first `createExerciseCommand`. Rendered by `(app)/exercises/
 * create.tsx`; opened via `router.push` from the Train hub `+ Create` action
 * and the Exercises empty-state CTA.
 *
 * Spec: specs/04-workout-management/design.md § <CreateExercisePresenter>
 *       — Container; requirements.md STORY-006 (AC 6.3, 6.4, 6.5)
 *
 * The command validates → writes the new exercise to the local cache with a
 * `local-*` id → enqueues a POST /exercises mutation for the sync engine. On
 * success we bump the shared library revision so the exercise list re-reads
 * (it stays mounted under this pushed screen) and the new exercise appears
 * under "Mine" when the user pops back — no reload, no network wait.
 *
 * Note: the coarse UI labels convert to the granular domain enum *keys*
 * (`"chest"`, `"barbell"`) per design.md's conversion layer — NOT reference-
 * list UUIDs. Resolving labels → UUIDs is deferred (it touches the adapter
 * layer, which STORY-009 freezes for this spec).
 */
export function CreateExerciseContainer() {
  const { storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;
  const markChanged = useExerciseLibrary((s) => s.markChanged);

  // Stable id factory (no captured state) — mirrors WorkoutCreatorContainer.
  const generateId = useCallback(
    () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    [],
  );

  const onSave = useCallback(
    async (input: NewExerciseInput) => {
      if (!userId) {
        Alert.alert("Sign in required", "Sign in to create exercises.");
        throw new Error("Not authenticated");
      }
      const result = createExerciseCommand(
        { storage, userId, generateId },
        toCreateExerciseInput(input),
      );
      if (!result.ok) {
        const firstFieldMessage =
          Object.values(result.error.fields)[0] ?? "Failed to save exercise";
        Alert.alert("Invalid input", firstFieldMessage);
        throw new Error(firstFieldMessage);
      }
      markChanged();
    },
    [storage, userId, generateId, markChanged],
  );

  return (
    <CreateExercisePresenter onClose={() => router.back()} onSave={onSave} />
  );
}
