import type { WorkoutSession } from "../models/session";

export interface TogetherWorkoutStatus {
  sessionId: string;
  executionId: string;
  localSessionId: string;
  pendingCount: number;
  receivedCount: number;
  sharing: "active" | "reconnecting" | "local-only" | "paused";
  error?: string;
}
export interface TogetherWorkoutPort {
  promote(session: WorkoutSession): Promise<void>;
  /** Restore authoritative unfinished work even when the personal cache was cleared. */
  getActive(userId: string): WorkoutSession | null;
  read(userId: string, localSessionId: string): WorkoutSession | null;
  save(userId: string, session: WorkoutSession): void;
  status(userId: string, localSessionId: string): TogetherWorkoutStatus | null;
  subscribe(listener: () => void): () => void;
}
