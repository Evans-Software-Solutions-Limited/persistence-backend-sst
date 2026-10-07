import type { StoragePort } from "@/domain/ports/storage.port";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";

/** Cloud checkpoints precede the personal mirror, including pending admission. */
export function withTogetherCloudWorkout(
  storage: StoragePort,
  cloud: TogetherCloudPort | undefined,
  mirror: StoragePort,
): StoragePort {
  if (!cloud) return storage;
  const own = (userId: string) => {
    const draft = cloud.readDraft(userId);
    return draft?.userId === userId ? draft : null;
  };
  const overrides: Partial<StoragePort> = {
    getActiveSession(userId) {
      const draft = own(userId);
      if (draft?.status === "in_progress") return draft;
      const base = storage.getActiveSession(userId);
      // A pre-promotion mirror may lack the cloud marker. A terminal durable
      // checkpoint still wins for that same draft, including after a crash
      // between explicit discard and clearing the personal cache.
      return base?.id === draft?.id || base?.together?.transport === "cloud"
        ? null
        : base;
    },
    getLatestSession(userId) {
      const draft = own(userId);
      const base = storage.getLatestSession(userId);
      if (draft?.status === "in_progress" || base?.id === draft?.id)
        return draft;
      // A new personal workout takes precedence after confirmed cloud completion,
      // even when the device clock was corrected between workouts.
      if (base?.together?.transport !== "cloud" && base) return base;
      return draft;
    },
    cacheActiveSession(userId, session) {
      if (session.userId !== userId)
        throw new Error("Together account mismatch.");
      const draft = own(userId);
      if (draft?.status === "in_progress" && draft.id !== session.id)
        throw new Error("Your Together workout must be retained for recovery.");
      if (draft?.id !== session.id) {
        if (session.together?.transport === "cloud")
          throw new Error("Together cloud checkpoint unavailable.");
        storage.cacheActiveSession(userId, session);
        return;
      }
      cloud.saveDraft(userId, session);
      const saved = own(userId);
      if (saved?.id === session.id) {
        try {
          mirror.cacheActiveSession(userId, saved);
        } catch {
          /* The durable cloud checkpoint remains authoritative. */
        }
      }
      void cloud.publishOwnDraft().catch(() => {});
    },
    clearActiveSession(userId) {
      if (own(userId)?.status === "in_progress")
        throw new Error("Your Together workout must be retained for recovery.");
      storage.clearActiveSession(userId);
    },
    getSessionSets(userId, sessionId, exerciseId) {
      const draft = own(userId);
      if (draft?.id === sessionId)
        return draft.exercises
          .filter((e) => e.exerciseId === exerciseId)
          .flatMap((e) => e.sets);
      const base = storage.getLatestSession(userId);
      if (base?.id === sessionId && base.together?.transport === "cloud")
        return [];
      return storage.getSessionSets(userId, sessionId, exerciseId);
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
