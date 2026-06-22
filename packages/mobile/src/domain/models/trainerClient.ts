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
   * v1: ALWAYS null. The prototype's "Strength · Wk 4 / 12" needs a
   * `program_assignments` table, which doesn't exist until the Programs slice
   * (10.4). The presenter hides the segment when null — do NOT fabricate it.
   */
  programLabel: string | null;
  /** v1 28-day adherence %, or null when the client has no in-window assignments. */
  adherence: number | null;
  /** null when adherence is null (no band without a number). */
  band: ClientBand | null;
  /** Most recent completed-session completedAt as ISO, or null. */
  lastSeenAt: string | null;
  /** Already-computed pills, server-side. */
  flags: ClientFlag[];
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
