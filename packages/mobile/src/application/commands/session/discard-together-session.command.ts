import type { StoragePort } from "@/domain/ports/storage.port";
import type { TogetherWorkoutPort } from "@/domain/ports/togetherWorkout.port";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";

/** Explicit user discard, never an automatic recovery or network-failure fallback. */
export function discardTogetherSession(deps: {
  storage: StoragePort;
  userId: string;
  localSessionId: string;
  workout?: TogetherWorkoutPort;
  cloud?: TogetherCloudPort;
}) {
  const own = deps.storage.getActiveSession(deps.userId);
  if (!own?.together || own.id !== deps.localSessionId)
    throw new Error("workout-changed");
  if (own.together.transport === "cloud") {
    if (!deps.cloud?.discardDraft) throw new Error("discard-unavailable");
    deps.cloud.discardDraft(deps.userId, own.id);
  } else {
    if (!deps.workout?.discard) throw new Error("discard-unavailable");
    deps.workout.discard(deps.userId, own.id);
  }
  deps.storage.clearActiveSession(deps.userId);
  deps.storage.invalidateDashboard(deps.userId);
}
