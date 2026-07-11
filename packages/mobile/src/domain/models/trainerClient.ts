/**
 * TrainerClient domain model (10-trainer-features, Clients-list slice).
 *
 * Mirrors the backend `GET /trainers/me/clients` payload 1:1 — the SST backend
 * emits camelCase, so the wire shape and this domain shape are structurally
 * identical and the adapter passes it through unchanged.
 *
 * Backend source of truth:
 *   microservices/core/src/application/repositories/trainerRepository.ts
 *   (TrainerClient / ClientStatus / ClientBand / ClientFlag).
 */

/** pt_client_relationships.status — only active | pending reach the roster. */
export type ClientStatus = "active" | "pending";

/**
 * 5-level roster band (distinct from the 3-level `ClientHealthBand` the Coach
 * You donut uses). Mirrors the prototype `ClientRowV2` thresholds.
 */
export type ClientBand =
  | "stellar"
  | "strong"
  | "wobbling"
  | "atRisk"
  | "crisis";

/** A pre-computed roster pill (NEW PR / N MISSED / Nd IDLE). */
export type ClientFlag = {
  tone: "gold" | "ember" | "error" | "trainer";
  label: string;
};

export type TrainerClient = {
  /** clientId (profiles.id). */
  id: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
  status: ClientStatus;
  /**
   * The client's live-programme label (e.g. "Strength · Wk 4 / 12"), derived
   * server-side from the Programs slice (19-programs). Null when the client has
   * no live programme assignment — the presenter hides the segment; do NOT
   * fabricate it.
   */
  programLabel: string | null;
  /**
   * The client's live-programme end date as an ISO string, or null when there
   * is no live programme / no end date. Powers the Coach Home "Programme
   * alerts" windowing. Absent on cached payloads written before 19-programs, so
   * consumers must tolerate `undefined` at runtime.
   */
  programEndDate: string | null;
  /** v1 28-day adherence %, or null when the client has no in-window assignments. */
  adherence: number | null;
  /** null when adherence is null (no band without a number). */
  band: ClientBand | null;
  /** Most recent completed-session completedAt as ISO, or null. */
  lastSeenAt: string | null;
  /** Already-computed pills, server-side. */
  flags: ClientFlag[];
  /**
   * The underlying `pt_client_relationships.id` (Coach Mode Phase 8 — invite/
   * QR, 10-trainer-features). Needed to call `respondToClientRelationship`
   * for a `pending` row. Optional + nullable: absent on cached payloads
   * written before Phase 8, so consumers must tolerate `undefined` (treat
   * the same as `null` — no relationshipId means no accept/decline action).
   */
  relationshipId?: string | null;
  /**
   * Which side kicked off a `pending` row (Phase 8): "trainer" = this
   * trainer emailed an invite / minted a code the CLIENT hasn't redeemed yet
   * — nothing for the coach to do but wait. "client" = the client redeemed
   * this trainer's invite code and is awaiting the COACH's accept/decline —
   * this is the row that gets the accept/decline affordance. Optional +
   * nullable for the same cached-payload-compat reason as `relationshipId`;
   * `undefined`/`null` never render the affordance (defensive default).
   */
  initiatedBy?: "trainer" | "client" | null;
};

/**
 * Cache envelope for the offline-first roster (mirrors `CachedCoachOverview`).
 * One row per trainer userId; `payload` is the full JSON-serialised list.
 */
export type CachedTrainerClients = {
  userId: string;
  payload: TrainerClient[];
  syncedAt: string;
};
