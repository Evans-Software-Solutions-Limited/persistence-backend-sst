/**
 * TrainerInvitation + invite-client domain models (10-trainer-features,
 * Coach You slice).
 *
 * `TrainerInvitation` mirrors the backend `trainer_invitations` row
 * (`$inferSelect`, camelCase over the wire). `InviteClientRequest` /
 * `InviteClientResult` mirror the `POST /trainers/me/invitations` contract.
 *
 * Backend source of truth:
 *   microservices/core/src/application/repositories/trainerRepository.ts
 *   (InviteClientResult, InviteErrorCode)
 *   packages/db/src/schema.ts (trainerInvitations).
 */

export type TrainerInvitation = {
  id: string;
  trainerId: string;
  clientEmail: string;
  relationshipReason: string | null;
  /** "pending" | "accepted" | "cancelled" — defaults to "pending". */
  status: string | null;
  invitedAt: string | null;
  acceptedAt: string | null;
  cancelledAt: string | null;
};

export type InviteClientRequest = {
  clientEmail: string;
  relationshipReason?: string;
};

/**
 * Success result of `POST /trainers/me/invitations`. `action` discriminates
 * whether an existing user got a pending relationship request, or a pending
 * email invitation was created for a not-yet-registered user.
 */
export type InviteClientResult = {
  success: true;
  action: "relationship_created" | "invitation_created";
  relationshipId?: string;
  invitationId?: string;
  clientId?: string;
  clientName?: string | null;
  clientEmail?: string;
  message: string;
};

/**
 * Machine codes the backend returns on the invite error body
 * (`{ code, message }`):
 *   - self_invite (400) — trainer used their own email
 *   - no_slots    (403) — client limit reached
 *   - exists      (409) — relationship/invitation already exists
 */
export type InviteErrorCode = "self_invite" | "no_slots" | "exists";
