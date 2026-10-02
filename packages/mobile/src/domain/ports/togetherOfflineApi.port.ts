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
