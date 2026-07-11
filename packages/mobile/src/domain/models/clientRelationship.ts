/**
 * The client's view of a trainer relationship — the other side of the
 * coach-initiated → client-accepted handshake (10-trainer-features).
 *
 * Backed by `GET /clients/me/relationships`. camelCase wire shape == this
 * domain shape, so the adapter needs no field mapping.
 */
export type ClientRelationshipStatus = "pending" | "active";

export type ClientTrainerRelationship = {
  relationshipId: string;
  trainerId: string;
  trainerName: string;
  /** "personal_trainer" | "physiotherapist" | "admin" | null. */
  trainerRole: string | null;
  trainerAvatarUrl: string | null;
  status: ClientRelationshipStatus;
  relationshipReason: string | null;
  /** ISO timestamp the relationship row was created, or null. */
  since: string | null;
  /**
   * Which side kicked off the handshake (Phase 8 invite/QR — 10-trainer-
   * features). "trainer" = the coach sent the invite/request and the
   * client is the one who accepts (the pre-existing invite-code / email-
   * invite flow); "client" = the client scanned/entered a coach's invite
   * code and the COACH is now the one awaiting accept/decline (the new
   * Phase 8 flow, driven by `respondToClientRelationship`).
   */
  initiatedBy: "trainer" | "client";
};

/** Client's response to a pending coach request. */
export type RelationshipResponseAction = "accept" | "decline";

/** Result of POST /clients/me/relationships/:id/respond. */
export type RelationshipResponseResult = {
  relationshipId: string;
  trainerId: string;
  status: string;
};

/**
 * Result of `POST /trainers/me/relationships/:relationshipId/respond` — the
 * COACH's side of the Phase 8 handshake (accepting/declining a client who
 * joined via invite code). Distinct wire shape from `RelationshipResponseResult`
 * (carries `clientId` + `success` rather than `trainerId`), so it is its own
 * type rather than a reuse of the client-side result. Reuses
 * `RelationshipResponseAction` for the request body ("accept" | "decline" is
 * identical on both sides of the handshake).
 */
export type RespondToClientRequestResult = {
  success: true;
  relationshipId: string;
  clientId: string;
  status: string;
};
