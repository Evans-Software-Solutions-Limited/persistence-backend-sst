import type {
  TogetherRecoveryCandidate,
  TogetherRecoveryPlan,
  TogetherRecoveryExecution,
} from "./togetherOfflineApi.port";
import type { WorkoutSession } from "../models/session";

export interface TogetherWorkoutReview extends TogetherRecoveryCandidate {
  snapshotToken: string;
  omissions: string[];
  /** Accepted result excludes unsupported later edits; full draft remains active locally. */
  retainedLocalChanges?: boolean;
}

export interface TogetherWorkoutStatus {
  sessionId: string;
  executionId: string;
  localSessionId: string;
  pendingCount: number;
  receivedCount: number;
  sharing: "active" | "reconnecting" | "local-only" | "paused";
  error?: string;
  recovery?: "uploading" | "review" | "saving" | "saved" | "finished_empty";
  recoveryError?: string;
}
export interface TogetherWorkoutPort {
  getPlan(userId: string, localSessionId: string): TogetherRecoveryPlan | null;
  getOwnExecution(
    userId: string,
    localSessionId: string,
  ): {
    revision: number;
    planHash: string;
    execution: TogetherRecoveryExecution;
  } | null;
  applyOwnOperation(
    userId: string,
    localSessionId: string,
    expectedVersion: number,
    operation: Record<string, unknown>,
  ): void;
  review(
    userId: string,
    localSessionId: string,
  ): Promise<TogetherWorkoutReview>;
  getReview(
    userId: string,
    localSessionId: string,
  ): TogetherWorkoutReview | null;
  finish(
    userId: string,
    localSessionId: string,
    reviewedRevision: number,
    snapshotToken: string,
  ): Promise<TogetherWorkoutReview>;
  promote(session: WorkoutSession): Promise<void>;
  /** Restore authoritative unfinished work even when the personal cache was cleared. */
  getActive(userId: string): WorkoutSession | null;
  read(userId: string, localSessionId: string): WorkoutSession | null;
  save(userId: string, session: WorkoutSession): void;
  status(userId: string, localSessionId: string): TogetherWorkoutStatus | null;
  subscribe(listener: () => void): () => void;
}
