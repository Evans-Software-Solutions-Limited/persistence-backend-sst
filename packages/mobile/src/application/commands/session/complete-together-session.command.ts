import type { StoragePort } from "@/domain/ports/storage.port";
import type { TogetherWorkoutPort } from "@/domain/ports/togetherWorkout.port";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";

/** Rating Submit is explicit acceptance of the athlete's complete supported own draft. */
export async function completeTogetherSession(
  deps: {
    storage: StoragePort;
    workout?: TogetherWorkoutPort;
    cloud?: TogetherCloudPort;
    userId: string;
    localSessionId: string;
    isCurrent: () => boolean;
  },
  input: { rating: number; notes: string; mode?: string },
) {
  const guard = () => {
    if (!deps.isCurrent()) throw new Error("account-changed");
    const latest = deps.storage.getLatestSession(deps.userId);
    if (!latest?.together || latest.id !== deps.localSessionId)
      throw new Error("workout-changed");
    return latest;
  };
  const own = guard();
  let historyId: string | null | undefined;
  if (own.together?.transport === "cloud") {
    const cloud = deps.cloud;
    if (!cloud) throw new Error("recovery-unavailable");
    if (own.status === "in_progress") await cloud.publishOwnDraft();
    guard();
    const candidate = await cloud.prepareReview();
    guard();
    if (candidate.retainedLocalChanges) throw new Error("review-required");
    const snapshot = cloud.getSnapshot().snapshot;
    if (!snapshot) throw new Error("recovery-unavailable");
    const participant = snapshot.participants.find(
      (p) => p.userId === deps.userId,
    );
    if (
      participant?.status !== "saved" &&
      participant?.status !== "finished_empty"
    ) {
      if (!snapshot.sharingActive)
        await cloud.reviewOwn(candidate.execution, candidate.token);
      else if (input.mode === "finish_all" || input.mode === "save_own")
        await cloud.close(input.mode, candidate.token);
      else if (input.mode === "leave") await cloud.leave(candidate.token);
      else await cloud.finish(candidate.token);
    }
    guard();
    const result = cloud
      .getSnapshot()
      .snapshot?.participants.find((p) => p.userId === deps.userId);
    if (result?.status !== "saved" && result?.status !== "finished_empty")
      throw new Error("result-not-confirmed");
    historyId = result.historyId;
  } else {
    const workout = deps.workout;
    if (!workout) throw new Error("recovery-unavailable");
    const candidate = await workout.review(deps.userId, own.id);
    guard();
    if (candidate.retainedLocalChanges) throw new Error("review-required");
    const result = await workout.finish(
      deps.userId,
      own.id,
      candidate.revision,
      candidate.snapshotToken,
    );
    guard();
    if (result.status !== "saved" && result.status !== "finished_empty")
      throw new Error("result-not-confirmed");
    historyId = result.historyId;
  }
  const saved = guard();
  if (saved.status === "in_progress") throw new Error("review-required");
  if (historyId) {
    // Update the already-created own result. Never enqueue a second bulk record.
    deps.storage.enqueueMutation({
      entityType: "session",
      entityId: historyId,
      operation: "update",
      endpoint: `/sessions/${historyId}`,
      method: "PATCH",
      payload: { sessionRating: input.rating, userNotes: input.notes.trim() },
    });
  }
  deps.storage.invalidateDashboard(deps.userId);
  return saved;
}
