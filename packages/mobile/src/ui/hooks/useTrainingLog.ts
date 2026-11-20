import { useCallback, useMemo, useState } from "react";
import type { Exercise } from "@/domain/models/exercise";
import type { PersonalRecord } from "@/domain/models/record";
import type { WorkoutSession } from "@/domain/models/session";
import type { ReferenceEntry } from "@/domain/models/reference-list";
import type { MusclesOf } from "@/domain/services/youPage";
import { resolveMuscles } from "@/domain/services/workoutSummary";
import { TRAINING_LOG_TABLES } from "@/adapters/storage/tables";
import { useAdapters } from "./useAdapters";
import { useCacheRevision } from "./useCacheRevision";

/**
 * Muscles for an exercise id from the cached exercise library. Cached
 * exercises carry catalogue UUIDs; the `muscle_groups` reference list names
 * them (the same lookup the workout summary uses).
 */
export function musclesLookup(
  exercises: readonly Exercise[],
  muscleGroups: readonly Pick<ReferenceEntry, "id" | "name">[],
): MusclesOf {
  const byId = new Map(exercises.map((e) => [e.id, e] as const));
  const names = new Map(muscleGroups.map((e) => [e.id, e.name] as const));
  return (exerciseId) => {
    const e = byId.get(exerciseId);
    return e
      ? {
          primary: resolveMuscles(
            e.primaryMuscleGroups,
            e.primaryMuscleGroupLabels,
            names,
          ),
          secondary: resolveMuscles(
            e.secondaryMuscleGroups,
            e.secondaryMuscleGroupLabels,
            names,
          ),
        }
      : null;
  };
}

export type TrainingLogState = {
  /** Finished workouts in the requested window (all when none), oldest first. */
  sessions: WorkoutSession[];
  /** Cached personal records (for gold top lifts and History's ★). */
  records: PersonalRecord[];
  /** When this phone started keeping the log. */
  since: string | null;
  musclesOf: MusclesOf;
  /** Re-read the cache (on focus; the change bus covers local writes). */
  reload(): void;
};

/**
 * The phone's training log for the You page, History and Recap (PER-141),
 * bounded to the window the screen shows.
 * Local and synchronous: no network, so it works offline. The first read
 * stamps when the log started, which tells the containers which ranges
 * need BE-H1 (`application/queries/youRemote.ts`).
 */
export function useTrainingLog(
  userId: string | null,
  /** The window the screen shows; only these workouts are read. */
  range?: { from: Date; to: Date },
): TrainingLogState {
  const fromIso = range?.from.toISOString();
  const toIso = range?.to.toISOString();
  const { storage } = useAdapters();
  const revision = useCacheRevision(TRAINING_LOG_TABLES);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  return useMemo(() => {
    void revision;
    void tick;
    if (!userId)
      return {
        sessions: [],
        records: [],
        since: null,
        musclesOf: () => null,
        reload,
      };
    // Idempotent: only the first read on this phone stamps the start.
    storage.markTrainingLogSince(userId, new Date().toISOString());
    return {
      sessions: storage.getTrainingLog(userId, { from: fromIso, to: toIso }),
      records: storage.getPersonalRecords(userId),
      since: storage.getTrainingLogSince(userId),
      musclesOf: musclesLookup(
        storage.getCachedExercises(),
        storage.getCachedReferenceList("muscle_groups")?.entries ?? [],
      ),
      reload,
    };
  }, [storage, userId, revision, tick, reload, fromIso, toIso]);
}
