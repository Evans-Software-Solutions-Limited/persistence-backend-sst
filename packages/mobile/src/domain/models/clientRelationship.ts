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
};

/** Client's response to a pending coach request. */
export type RelationshipResponseAction = "accept" | "decline";

/** Result of POST /clients/me/relationships/:id/respond. */
export type RelationshipResponseResult = {
  relationshipId: string;
  trainerId: string;
  status: string;
};
