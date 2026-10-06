import type { TogetherRecoveryCommand } from "./togetherOfflineApi.port";
import type {
  Credential,
  Signed,
  TrustedKeys,
  FriendshipEvidence,
} from "../models/togetherIdentity";
import type { Result } from "../../shared/errors/result";
export type ProvisioningErrorCode =
  | "disabled"
  | "signed-out"
  | "offline-unprepared"
  | "expired"
  | "key-unavailable"
  | "paid-required"
  | "authentication-required"
  | "service-unavailable"
  | "device-revoked"
  | "registration-conflict"
  | "registration-invalid"
  | "unauthorized"
  | "unavailable"
  | "cancelled"
  | "invalid-proof"
  | "storage";
export interface ProvisioningError {
  kind: "together-provisioning";
  code: ProvisioningErrorCode;
}
/** Internal capability: never put the seed in UI state or public persistence. */
export interface ReadyIdentity {
  credential: Signed<Credential>;
  trustedKeys: TrustedKeys;
  seed: Uint8Array;
  deviceId: string;
}
/** Verified sharing authority only; never credentials or signing material. */
export interface TogetherAccessSnapshot {
  accountId: string | null;
  state: "pending" | "allowed" | "locked" | "unavailable";
  expiresAt: number | null;
  error?: ProvisioningErrorCode;
}
export interface TogetherProvisioningPort {
  getAccessSnapshot?(): TogetherAccessSnapshot;
  subscribeAccess?(listener: () => void): () => void;
  /** Prepare sharing authority without returning secret material to UI callers. */
  refreshAccess?(options: { online: boolean }): Promise<void>;
  /** Original owner key only; never prepares, renews or registers sharing. */
  signRecovery?(
    credential: Signed<Credential>,
    commands: readonly TogetherRecoveryCommand[],
  ): Promise<Result<Signed<TogetherRecoveryCommand>[], ProvisioningError>>;
  setAccount(userId: string | null): void;
  prepare(options: {
    online: boolean;
  }): Promise<Result<ReadyIdentity, ProvisioningError>>;
  friendship(
    friendId: string,
    options: { online: boolean },
  ): Promise<Result<Signed<FriendshipEvidence> | null, ProvisioningError>>;
  /** Latest locally known pair refusals, including fail-closed bounded-cache overflow. */
  deniedPairs?(
    candidateUserIds?: readonly string[],
  ): readonly (readonly [string, string])[];
  dispose(): void;
}
