/**
 * Trainer invite-code domain models (Coach Mode Phase 8 — invite/QR,
 * 10-trainer-features). Backs the coach's "Add client" invite-code + QR
 * flow: a trainer mints a short reusable code, a client redeems it via
 * `POST /trainers/accept-invite-code`, which creates a pending
 * (client-initiated) relationship the coach then accepts/declines via
 * `POST /trainers/me/relationships/:relationshipId/respond`.
 *
 * Backend source of truth:
 *   microservices/core/src/application/repositories/trainerRepository.ts
 *   (invite-code mint/redeem + AcceptInviteCodeErrorCode)
 *
 * See also `@/domain/models/clientRelationship` for the relationship-side
 * types (`ClientTrainerRelationship.initiatedBy`, `RespondToClientRequestResult`).
 */

import type { ApiError } from "@/shared/errors";

/**
 * A minted (or re-fetched still-live) trainer invite code
 * (`POST /trainers/me/invite-codes`). `code` is a 6-character A-Z2-9
 * string (ambiguous characters excluded server-side). `isExisting` is true
 * when the trainer already had a live code and the endpoint returned it
 * instead of minting a new one (idempotent re-fetch — does NOT count
 * against the client-seat cap check, which only runs when actually minting).
 */
export type TrainerInviteCode = {
  id: string;
  code: string;
  /** ISO timestamp the code stops being redeemable. */
  expiresAt: string;
  isExisting: boolean;
};

/** Success result of `POST /trainers/accept-invite-code`. */
export type AcceptInviteCodeResult = {
  success: true;
  relationshipId: string;
  trainerName: string;
  message: string;
};

/**
 * Machine codes the backend returns on the accept-invite-code error body
 * (`{ code, message }`):
 *   - invalid_code             (404) — code doesn't exist / expired
 *   - self_invite              (400) — trainer redeeming their own code
 *   - exists                   (409) — relationship already exists
 *   - code_already_used        (409) — single-use code already redeemed
 *   - coach_client_limit_reached (409) — the trainer's client-slot cap is full
 */
export type AcceptInviteCodeErrorCode =
  | "invalid_code"
  | "self_invite"
  | "exists"
  | "code_already_used"
  | "coach_client_limit_reached";

/**
 * `ApiError` extended with the structured accept-invite-code domain `code`
 * the backend returns on a flat `{ code, message }` error body. `acceptCode`
 * is undefined for transport/auth errors that don't carry a domain code —
 * mirrors `InviteApiError.inviteCode`.
 */
export type AcceptInviteCodeApiError = ApiError & {
  acceptCode?: AcceptInviteCodeErrorCode;
};
