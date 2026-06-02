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
import { CreateExerciseSheetPresenter } from "@/ui/presenters/CreateExerciseSheetPresenter";

/**
 * <CreateExerciseSheetContainer> — wires the Create-Exercise sheet to the
 * offline-first `createExerciseCommand`. Mounted inside <TrainHubContainer>.
 *
 * Spec: specs/04-workout-management/design.md § <CreateExerciseSheetPresenter>
 *       — Container; requirements.md STORY-006 (AC 6.3, 6.4, 6.5)
 *
 * The command validates → writes the new exercise to the local cache with a
 * `local-*` id → enqueues a POST /exercises mutation for the sync engine. On
 * success we bump the shared library revision so the (sibling) exercise list
 * re-reads and the new exercise appears under the "Mine" filter without a
 * reload. The mutation never awaits the network — fully offline-capable.
 *
 * Note: the coarse UI labels convert to the granular domain enum *keys*
 * (`"chest"`, `"barbell"`) per design.md's conversion layer — NOT reference-
 * list UUIDs. Resolving labels → UUIDs for the create payload is deferred
 * (it touches the adapter layer, which STORY-009 freezes for this spec).
 */
export type CreateExerciseSheetContainerProps = {
  visible: boolean;
  onClose: () => void;
};

export function CreateExerciseSheetContainer({
  visible,
  onClose,
}: CreateExerciseSheetContainerProps) {
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
    <CreateExerciseSheetPresenter
      visible={visible}
      onClose={onClose}
      onSave={onSave}
    />
  );
}
