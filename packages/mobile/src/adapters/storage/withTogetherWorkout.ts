import type { WorkoutSession } from "@/domain/models/session";
import type { StoragePort } from "@/domain/ports/storage.port";
import type { TogetherWorkoutPort } from "@/domain/ports/togetherWorkout.port";

/** Keep the personal cache as a mirror once the durable Together checkpoint owns a workout. */
export function withTogetherWorkout(
  storage: StoragePort,
  workout?: TogetherWorkoutPort,
): StoragePort {
  if (!workout) return storage;

  const read = (userId: string, latest = false): WorkoutSession | null => {
    const recovered = workout.getActive(userId);
    if (recovered) return recovered;
    const base = latest
      ? storage.getLatestSession(userId)
      : storage.getActiveSession(userId);
    return base ? (workout.read(userId, base.id) ?? base) : null;
  };
  const overrides: Partial<StoragePort> = {
    getActiveSession: (userId) => read(userId),
    getLatestSession: (userId) => read(userId, true),
    cacheActiveSession(userId, session) {
      const active = read(userId);
      if (active?.together && active.id !== session.id) {
        throw new Error("Your Together workout must be retained for recovery.");
      }
      const promoted = workout.read(userId, session.id);
      if (!promoted) {
        // A marker without a checkpoint is not permission to create an orphan.
        if (session.together)
          throw new Error("Together workout checkpoint unavailable.");
        storage.cacheActiveSession(userId, session);
        return;
      }
      // Commit the complete personal snapshot and signed mutations first. A
      // failed cache mirror must not misreport a successful durable save.
      workout.save(userId, session);
      try {
        storage.cacheActiveSession(userId, workout.read(userId, session.id)!);
      } catch {
        // Reads discover the checkpoint independently of the personal mirror.
      }
    },
    clearActiveSession(userId) {
      if (read(userId, true)?.together) {
        throw new Error("Your Together workout must be retained for recovery.");
      }
      storage.clearActiveSession(userId);
    },
    getSessionSets(userId, sessionId, exerciseId) {
      const promoted = workout.read(userId, sessionId);
      if (!promoted)
        return storage.getSessionSets(userId, sessionId, exerciseId);
      return promoted.exercises
        .filter((exercise) => exercise.exerciseId === exerciseId)
        .flatMap((exercise) => exercise.sets);
    },
  };
  return new Proxy(storage, {
    get(target, property) {
      const override = Reflect.get(overrides, property);
      if (override) return override;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
