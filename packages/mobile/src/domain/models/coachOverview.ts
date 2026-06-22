/**
 * CoachOverview domain model (10-trainer-features, Coach You slice).
 *
 * Mirrors the backend `GET /trainers/me/overview` payload 1:1 — the SST
 * backend emits camelCase, so the wire shape and this domain shape are
 * structurally identical and the adapter passes it through unchanged.
 *
 * Backend source of truth:
 *   microservices/core/src/application/repositories/trainerRepository.ts
 *   (CoachOverview / RecentActivityEvent / ClientHealthBand).
 */

/** Client-health adherence band (v1 adherence buckets). */
export type ClientHealthBand = "strong" | "wobbling" | "atRisk";

/** Event types the Coach You recent-activity feed can render in this slice. */
export type RecentActivityType =
  | "session_completed"
  | "pr_achieved"
  | "missed_day";

export type RecentActivityEvent = {
  type: RecentActivityType;
  clientId: string;
  clientName: string;
  clientInitials: string;
  payload: Record<string, unknown>;
  /** ISO timestamp. */
  occurredAt: string;
};

export type CoachBusinessStats = {
  activeClients: number;
  newClientsThisMonth: number;
  /** From the trainer's tier `trainerClientLimit`; null when unknown. */
  slotsTotal: number | null;
  slotsOpen: number | null;
  /** v1 mean adherence across included clients; null when none. */
  avgAdherence: number | null;
  /** This 28d window vs the previous 28d; null when either is null. */
  adherenceDelta: number | null;
  clientPRsThisMonth: number;
  clientsWithPRs: number;
  /** v1 90d retention %; null when no denominator. */
  retentionPct: number | null;
  churnThisQuarter: number;
};

export type CoachProgram = {
  id: string;
  name: string;
  activeClients: number;
};

export type CoachProgramStats = {
  activeProgramsCount: number;
  /** Top 3 by active clients. */
  programs: CoachProgram[];
};

export type CoachOverview = {
  trainer: {
    name: string;
    initials: string;
    /** profiles.created_at as ISO string, or null. */
    coachSince: string | null;
  };
  businessStats: CoachBusinessStats;
  /** Always 3 entries in band order: strong, wobbling, atRisk. */
  clientHealthBreakdown: { band: ClientHealthBand; count: number }[];
  programStats: CoachProgramStats;
  recentActivity: RecentActivityEvent[];
};

/**
 * Cache envelope for the offline-first Coach You overview (mirrors
 * `CachedDashboard`). One row per trainer userId; `payload` is the full
 * JSON-serialised overview.
 */
export type CachedCoachOverview = {
  userId: string;
  payload: CoachOverview;
  syncedAt: string;
};
