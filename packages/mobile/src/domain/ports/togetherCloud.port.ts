import type { WorkoutSession } from "../models/session";
import type { Result } from "../../shared/errors/result";
import type {
  TogetherOfflineApiError,
  TogetherRecoveryPlan,
  TogetherRecoveryExecution,
  TogetherRecoveryResult,
} from "./togetherOfflineApi.port";
export type CloudPlan = TogetherRecoveryPlan;
export type CloudExecution = TogetherRecoveryExecution;
export interface CloudParticipant {
  progress?: {
    planExerciseId: string;
    completedSets: number;
    skipped: boolean;
  }[];
  displayName?: string | null;
  avatarUrl?: string | null;
  userId: string;
  status: "active" | "finalizing" | "saved" | "finished_empty";
  ownRevision: number;
  delegationGeneration: number;
  allowPartnerLogging: boolean;
  execution: CloudExecution | null;
  numbersAvailable: boolean;
  previousValuesAvailable: boolean;
  numbersConsent?: { version: number; recipientIds: string[] };
  previousConsent?: { version: number; recipientIds: string[] };
  exerciseCatalog: Record<
    string,
    { name: string; category: string | null; primaryMuscles: string[] }
  >;
  historyId?: string | null;
}
export interface CloudSnapshot {
  sessionId: string;
  state: "active" | "closed";
  sharingActive: boolean;
  continuation: "solo" | null;
  hostId: string | null;
  revision: number;
  planVersion: number;
  plan: CloudPlan;
  participants: CloudParticipant[];
  completion: {
    status: string;
    historyId: string | null;
    ownRevision: number;
    recoveryMayBePending: boolean;
  };
}
export interface CloudDraft {
  clientDraftId: string;
  plan: CloudPlan;
  ownExecution: CloudExecution;
  startedAt?: string;
  personalDraft?: WorkoutSession;
}
export interface CloudCommand {
  commandId: string;
  expectedVersion: number;
  target: { kind: "plan" | "execution"; athleteId?: string };
  delegationGeneration?: number;
  operation: Record<string, unknown>;
}
export interface CloudPrevious {
  sessionId: string;
  ownerId: string;
  consentVersion: number;
  revision: number;
  planVersion: number;
  ownRevision: number;
  values: Record<string, unknown>[];
}
export interface CloudRequest {
  requestId: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
}
export interface CloudFinish {
  status: string;
  historyId: string | null;
}
export interface CloudPage<T> {
  data: T[];
  nextCursor: string | null;
}
export type CloudJoin = ({ sessionId: string } | { inviteToken: string }) & {
  startedAt?: string;
};
export type CloudResult<T> = Promise<Result<T, TogetherOfflineApiError>>;
export interface TogetherCloudApi {
  create(
    key: string,
    draft: Omit<CloudDraft, "personalDraft">,
  ): CloudResult<{
    sessionId: string;
    revision: number;
    snapshot: CloudSnapshot;
  }>;
  active(): CloudResult<{ sessionId: string; status: string }[]>;
  snapshot(id: string): CloudResult<CloudSnapshot>;
  invite(
    id: string,
    key: string,
  ): CloudResult<{ tokenId: string; token: string; expiresAt: string }>;
  revokeInvite(
    id: string,
    tokenId: string,
    key: string,
  ): CloudResult<{ revoked: boolean }>;
  join(
    key: string,
    target: CloudJoin,
  ): CloudResult<{
    requestId: string;
    status: "approved" | "pending";
    sessionId: string;
  }>;
  joinStatus(requestId: string): CloudResult<{
    requestId: string;
    sessionId: string;
    status: "pending" | "approved" | "rejected" | "unavailable";
  }>;
  cancelJoin(
    requestId: string,
    key: string,
  ): CloudResult<{ cancelled: boolean }>;
  requests(id: string, cursor?: string): CloudResult<CloudPage<CloudRequest>>;
  decide(
    id: string,
    requestId: string,
    key: string,
    body: { decision: "approve" | "reject"; expectedRevision: number },
  ): CloudResult<CloudSnapshot>;
  remove(
    id: string,
    userId: string,
    key: string,
    expectedRevision: number,
  ): CloudResult<{ removed: boolean; snapshot: CloudSnapshot }>;
  command(
    id: string,
    key: string,
    body: CloudCommand,
  ): CloudResult<{
    commandId: string;
    revision: number;
    event: Record<string, unknown>;
  }>;
  delegation(
    id: string,
    key: string,
    allowed: boolean,
  ): CloudResult<{ generation: number; allowed: boolean }>;
  consent(
    id: string,
    key: string,
    kind: "numbers" | "previous",
    body: { expectedVersion: number; recipientIds: string[] },
  ): CloudResult<{
    sessionId: string;
    ownerId: string;
    version: number;
    recipientIds: string[];
  }>;
  previous(id: string, ownerId: string): CloudResult<CloudPrevious>;
  visibility(
    id: string,
    key: string,
    body: { audience: "private" | "friends"; expiresAt: string },
  ): CloudResult<{ revision: number }>;
  friends(cursor?: string): CloudResult<
    CloudPage<{
      sessionId: string;
      host: {
        userId: string;
        displayName: string | null;
        avatarUrl: string | null;
      };
      occupancy: number;
      expiresAt: string;
    }>
  >;
  discard(id: string, key: string): CloudResult<{ retired: true }>;
  stopSharing?(id: string, key: string): CloudResult<{ stopped: true }>;
  finish(
    id: string,
    key: string,
    revision: number,
    leave: boolean,
  ): CloudResult<CloudFinish>;
  close(
    id: string,
    key: string,
    body: {
      expectedRevision: number;
      expectedOwnRevision: number;
      mode: "finish_all" | "save_own";
    },
  ): CloudResult<
    CloudFinish & {
      revision: number;
      ownRevision: number;
      sharingActive: false;
      recoveryMayBePending: true;
      acknowledgedStateOnly: true;
      mode: "finish_all" | "save_own";
    }
  >;
  review(
    id: string,
    key: string,
    body: { expectedOwnRevision: number; execution: CloudExecution },
  ): CloudResult<TogetherRecoveryResult>;
}
export interface TogetherCloudState {
  canDetachDraft?: boolean;
  phase:
    | "idle"
    | "preparing"
    | "pending-approval"
    | "active"
    | "reconnecting"
    | "private"
    | "finished"
    | "unavailable";
  snapshot?: CloudSnapshot;
  requests: CloudRequest[];
  previous: Record<string, CloudPrevious>;
  pendingCount: number;
  error?: string;
}
export interface TogetherCloudPort {
  getSnapshot(): TogetherCloudState;
  subscribe(listener: () => void): () => void;
  setAccount(userId: string | null): void;
  setActive(active: boolean): void;
  hostWorkout(session: WorkoutSession): Promise<void>;
  saveDraft(userId: string, session: WorkoutSession): void;
  publishOwnDraft(): Promise<void>;
  host(draft: CloudDraft): Promise<void>;
  join(target: CloudJoin, personalDraft?: WorkoutSession): Promise<void>;
  resume(sessionId: string): Promise<void>;
  refresh(): Promise<void>;
  retry(): Promise<void>;
  cancelJoin(): Promise<void>;
  cancel(): void;
  dispose(): void;
  discardDraft?(userId: string, localSessionId: string): void;
  stopSharing?(): Promise<void>;
  readDraft(userId: string): WorkoutSession | null;
  detachDraft(
    userId: string,
    persistPersonal: (draft: WorkoutSession) => void,
  ): WorkoutSession;
  invite(): Promise<{ tokenId: string; token: string; expiresAt: string }>;
  revokeInvite(tokenId: string): Promise<void>;
  decide(requestId: string, decision: "approve" | "reject"): Promise<void>;
  remove(userId: string): Promise<void>;
  command(input: Omit<CloudCommand, "commandId">): Promise<void>;
  delegation(allowed: boolean): Promise<void>;
  numbersConsent(recipientIds: string[]): Promise<void>;
  previousConsent(recipientIds: string[]): Promise<void>;
  previous(ownerId: string): Promise<void>;
  visibility(audience: "private" | "friends", expiresAt: string): Promise<void>;
  friends(cursor?: string): ReturnType<TogetherCloudApi["friends"]>;
  prepareReview(): Promise<{
    plan: CloudPlan;
    execution: CloudExecution;
    token: string;
    omissions: string[];
    retainedLocalChanges: boolean;
  }>;
  reviewToken(): string;
  finish(token: string): Promise<void>;
  leave(token: string): Promise<void>;
  close(mode: "finish_all" | "save_own", token: string): Promise<void>;
  reviewOwn(execution: CloudExecution, token: string): Promise<void>;
}
