import type { AppliedReferral } from "@/domain/models/referral";
import type { ApiError, Result } from "@/shared/errors";

export interface ReferralsPort {
  getAppliedReferral(): Promise<Result<AppliedReferral | null, ApiError>>;
  claimReferral(
    code: string,
    signal?: AbortSignal,
  ): Promise<Result<AppliedReferral, ApiError>>;
  removeReferral(): Promise<Result<{ removed: boolean }, ApiError>>;
}
