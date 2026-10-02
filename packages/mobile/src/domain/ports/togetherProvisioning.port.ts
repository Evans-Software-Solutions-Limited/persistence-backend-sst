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
export interface TogetherProvisioningPort {
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
