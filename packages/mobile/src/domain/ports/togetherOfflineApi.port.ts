import type {
  Signed,
  Credential,
  FriendshipEvidence,
  Registration,
  TrustedKeys,
} from "@/domain/models/togetherIdentity";
import type { Result, ApiError } from "@/shared/errors";

export interface TogetherOfflineApiError extends ApiError {
  togetherCode?: string;
}

export interface TogetherOfflineApi {
  recovery?: TogetherRecoveryApi;
  trust(): Promise<
    Result<
      { publicKeys: TrustedKeys; maxCredentialAgeMs: number },
      TogetherOfflineApiError
    >
  >;
  register(
    proof: Signed<Registration>,
  ): Promise<Result<Signed<Credential>, TogetherOfflineApiError>>;
  friendship(
    friendId: string,
    requestId: string,
  ): Promise<Result<Signed<FriendshipEvidence>, TogetherOfflineApiError>>;
}

export interface TogetherRecoveryPlan {
  name: string;
  exercises: {
    planExerciseId: string;
    exerciseId: string;
    order: number;
    targetSets: number;
    targetReps?: number;
  }[];
}
export interface TogetherRecoveryExecution {
  exercises: {
    planExerciseId: string;
    substituteExerciseId?: string | null;
    skipped: boolean;
    sets: {
      setId: string;
      reps: number;
      weightKg: number;
      completed: boolean;
    }[];
    everAcknowledged?: boolean;
  }[];
  restEndsAt?: string | null;
}
export interface TogetherRecoveryCommand {
  kind: "together-recovery-v1";
  userId: string;
  sessionId: string;
  executionId: string;
  commandId: string;
  planHash: string;
  startedAt: number;
  expectedVersion: number;
  operation: Record<string, unknown>;
}
export interface TogetherRecoveryCandidate {
  status: "stored_for_review" | "saved" | "finished_empty";
  sharingActive: false;
  historySaved: boolean;
  sessionId: string;
  executionId: string;
  revision: number;
  startedAt: number;
  plan: TogetherRecoveryPlan;
  execution: TogetherRecoveryExecution;
  historyId?: string | null;
  reviewedRevision?: number | null;
  effectsPending?: boolean;
}
export interface TogetherRecoveryResult {
  status: "saved" | "finished_empty";
  historyId: string | null;
  reviewedRevision: number;
  effectsPending: boolean;
  sharingActive: false;
}
export interface TogetherRecoveryApi {
  upload(
    requestId: string,
    body: {
      credential: Signed<Credential>;
      sessionId: string;
      executionId: string;
      startedAt: number;
      plan: TogetherRecoveryPlan;
      commands: Signed<TogetherRecoveryCommand>[];
    },
  ): Promise<
    Result<
      TogetherRecoveryCandidate & {
        receipts: {
          commandId: string;
          commandHash: string;
          revision: number;
          status: "stored_for_review";
        }[];
      },
      TogetherOfflineApiError
    >
  >;
  get(
    executionId: string,
  ): Promise<Result<TogetherRecoveryCandidate, TogetherOfflineApiError>>;
  complete(
    executionId: string,
    requestId: string,
    body: { expectedRevision: number; completedAt: string },
  ): Promise<Result<TogetherRecoveryResult, TogetherOfflineApiError>>;
}
