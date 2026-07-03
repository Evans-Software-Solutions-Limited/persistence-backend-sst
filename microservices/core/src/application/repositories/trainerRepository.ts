import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  personalRecords,
  profiles,
  programAssignments,
  ptClientRelationships,
  subscriptionTiers,
  trainerInvitations,
  userSubscriptions,
  workoutAssignments,
  workoutPrograms,
  workoutSessions,
  type NewPtClientRelationship,
  type NewTrainerInvitation,
  type TrainerInvitation,
} from "@persistence/db";
import { getDb } from "@persistence/db/client";
import type { Db } from "@persistence/db/client";
import { liveSubscriptionFilter } from "./subscriptionRepository";
import { currentWeek } from "../programs/scheduling";

// ─── Wire shapes ──────────────────────────────────────────────────────────────

/**
 * `RecentActivityEvent` — mirrors specs/10-trainer-features/design.md
 * § Backend — recent activity feed. `occurredAt` is serialised to an ISO
 * string at the wire boundary (the spec types it as `Date`; over HTTP it is
 * a string). This slice only emits the three event types it can derive from
 * existing tables — session_completed, pr_achieved, missed_day. The remaining
 * spec types (goal_assigned_to_client, streak_milestone) are deferred to the
 * M8 proper feed and are intentionally not produced here.
 */
export type RecentActivityType =
  | "session_completed"
  | "pr_achieved"
  | "missed_day";

export interface RecentActivityEvent {
  type: RecentActivityType;
  clientId: string;
  clientName: string;
  clientInitials: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export type ClientHealthBand = "strong" | "wobbling" | "atRisk";

// ─── Clients roster (GET /trainers/me/clients) wire shapes ──────────────────────

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

export interface ClientFlag {
  tone: "gold" | "ember" | "error" | "trainer";
  label: string;
}

/** Live programme assignment info per roster client (specs/19-programs). */
export interface LiveProgramInfo {
  programName: string;
  startDate: string;
  endDate: string | null;
  durationWeeks: number | null;
}

/** "Strength · Wk 4 / 12" (finite) / "Cut · Wk 4" (indefinite). */
export function formatProgramLabel(
  info: LiveProgramInfo,
  today: string,
): string {
  const week = currentWeek(info.startDate, today, info.durationWeeks);
  return info.durationWeeks === null
    ? `${info.programName} · Wk ${week}`
    : `${info.programName} · Wk ${week} / ${info.durationWeeks}`;
}

export interface TrainerClient {
  /** clientId (profiles.id). */
  id: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
  /** pt_client_relationships.status — only active | pending reach the roster. */
  status: ClientStatus;
  /**
   * "{programme name} · Wk N / M" (finite) or "{programme name} · Wk N"
   * (indefinite) from the client's live `program_assignments` row, trainer-
   * scoped. Null when this trainer has no live programme assignment for the
   * client — the presenter hides the segment.
   */
  programLabel: string | null;
  /**
   * The live assignment's end date (YYYY-MM-DD) — null when indefinite or
   * no live programme. Powers the "Programme ends" summary chip (ends
   * within 14 days).
   */
  programEndDate: string | null;
  /** v1 28-day adherence %, or null when the client has no in-window assignments. */
  adherence: number | null;
  /** null when adherence is null (no band without a number). */
  band: ClientBand | null;
  /** Most recent completed-session completedAt as ISO, or null. */
  lastSeenAt: string | null;
  flags: ClientFlag[];
}

export interface CoachOverview {
  trainer: {
    name: string;
    initials: string;
    /** profiles.created_at as ISO string, or null. */
    coachSince: string | null;
  };
  businessStats: {
    activeClients: number;
    newClientsThisMonth: number;
    slotsTotal: number | null;
    slotsOpen: number | null;
    avgAdherence: number | null;
    adherenceDelta: number | null;
    clientPRsThisMonth: number;
    clientsWithPRs: number;
    retentionPct: number | null;
    churnThisQuarter: number;
  };
  clientHealthBreakdown: { band: ClientHealthBand; count: number }[];
  programStats: {
    activeProgramsCount: number;
    programs: { id: string; name: string; activeClients: number }[];
  };
  recentActivity: RecentActivityEvent[];
}

/**
 * Mirrors the legacy `InviteClientResponse` (RPC `invite_client_by_email`).
 * Field names are camelCase here (the SST wire convention) — the legacy
 * snake_case (`relationship_id`, `client_id`, …) is mapped at the port seam
 * on the mobile side.
 */
export interface InviteClientResult {
  success: true;
  action: "relationship_created" | "invitation_created";
  relationshipId?: string;
  invitationId?: string;
  clientId?: string;
  clientName?: string | null;
  clientEmail?: string;
  message: string;
}

/**
 * Structured failure raised by the invite flow. Carries an HTTP status and a
 * stable machine `code` so the handler can map it to a JSON error body
 * without string-matching messages (the legacy app string-matched the RPC's
 * `RAISE EXCEPTION` text — we replace that with explicit codes).
 */
export type InviteErrorCode = "self_invite" | "no_slots" | "exists";

export class InviteError extends Error {
  readonly status: number;
  readonly code: InviteErrorCode;

  constructor(status: number, code: InviteErrorCode, message: string) {
    super(message);
    this.name = "InviteError";
    this.status = status;
    this.code = code;
  }
}

const ADHERENCE_WINDOW_DAYS = 28;
const RETENTION_WINDOW_DAYS = 90;
const RECENT_ACTIVITY_LIMIT = 20;
const TOP_PROGRAMS_LIMIT = 3;

const ADHERENCE_STRONG_MIN = 85;
const ADHERENCE_WOBBLING_MIN = 65;

// 5-band roster thresholds (prototype ClientRowV2).
const BAND_STELLAR_MIN = 95;
const BAND_STRONG_MIN = 85;
const BAND_WOBBLING_MIN = 65;
const BAND_AT_RISK_MIN = 40;

/**
 * Whole days idle (no completed session) AT OR AFTER which a client is flagged.
 * Inclusive: exactly 4 whole days → "4d IDLE", matching the prototype's
 * canonical idle row (`ClientRowV2` Tom · 4d).
 */
const IDLE_DAYS = 4;

// ─── Pure helpers (exported for unit testing) ──────────────────────────────────

export function initialsFromName(name: string | null | undefined): string {
  if (!name) return "";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Start of the current calendar month, UTC. */
export function startOfMonth(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Start of the current calendar quarter, UTC. */
export function startOfQuarter(now: Date): Date {
  const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
  return new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1));
}

export function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * v1 adherence band for a client adherence percentage.
 *   strong   ≥ 85
 *   wobbling 65–84
 *   atRisk   < 65
 */
export function adherenceBand(pct: number): ClientHealthBand {
  if (pct >= ADHERENCE_STRONG_MIN) return "strong";
  if (pct >= ADHERENCE_WOBBLING_MIN) return "wobbling";
  return "atRisk";
}

/**
 * v1 per-client adherence over a window: % of assignments with
 * `status='completed'` among those whose `due_date` falls in the window.
 * Returns `null` when the client has zero such assignments (excluded from the
 * average and shown as no-band).
 */
export function clientAdherence(
  completed: number,
  total: number,
): number | null {
  if (total === 0) return null;
  return Math.round((completed / total) * 100);
}

/**
 * v1 5-level roster band for a client adherence percentage (prototype
 * `ClientRowV2`). Kept separate from the 3-level `adherenceBand()` — the Coach
 * You donut still uses that one.
 *   stellar  ≥ 95
 *   strong   85–94
 *   wobbling 65–84
 *   atRisk   40–64
 *   crisis   < 40
 */
export function clientRosterBand(pct: number): ClientBand {
  if (pct >= BAND_STELLAR_MIN) return "stellar";
  if (pct >= BAND_STRONG_MIN) return "strong";
  if (pct >= BAND_WOBBLING_MIN) return "wobbling";
  if (pct >= BAND_AT_RISK_MIN) return "atRisk";
  return "crisis";
}

/**
 * Whole days between two instants (floor). Negative deltas clamp to 0 so a
 * future `lastSeenAt` (clock skew) never produces a nonsense idle flag.
 */
export function wholeDaysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (ms <= 0) return 0;
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((acc, v) => acc + v, 0);
  return Math.round(sum / values.length);
}

// ─── Repository ────────────────────────────────────────────────────────────────

/**
 * Per-client adherence counters over an arbitrary window. Used both to build
 * the average and to bucket clients into health bands.
 */
interface AdherenceRow {
  clientId: string;
  completed: number;
  total: number;
}

export class TrainerRepository {
  static readonly key = "TrainerRepository";

  /**
   * Role guard. Returns true if the user is a trainer / physiotherapist.
   * Mirrors the legacy RPC's `role IN ('personal_trainer','physiotherapist')`
   * check. Handlers map `false` → 403.
   */
  async isTrainer(userId: string): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ role: profiles.role })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    const role = rows[0]?.role;
    return (
      role === "personal_trainer" ||
      role === "physiotherapist" ||
      // admins can act as trainers
      role === "admin"
    );
  }

  /** Trainer's identity slice for the overview header. */
  async getTrainerIdentity(userId: string): Promise<{
    name: string;
    email: string | null;
    coachSince: string | null;
  }> {
    const db = getDb();
    const rows = await db
      .select({
        fullName: profiles.fullName,
        email: profiles.email,
        createdAt: profiles.createdAt,
      })
      .from(profiles)
      .where(eq(profiles.id, userId))
      .limit(1);
    const row = rows[0];
    return {
      name: row?.fullName ?? "",
      email: row?.email ?? null,
      coachSince: toIsoString(row?.createdAt ?? null),
    };
  }

  /**
   * Active, non-AI client ids for the trainer. Single source of truth for the
   * "active clients" set used across every aggregate.
   */
  async getActiveClients(
    trainerId: string,
  ): Promise<
    { clientId: string; clientName: string; createdAt: Date | null }[]
  > {
    const db = getDb();
    const rows = await db
      .select({
        clientId: ptClientRelationships.clientId,
        clientName: profiles.fullName,
        createdAt: ptClientRelationships.createdAt,
      })
      .from(ptClientRelationships)
      .leftJoin(profiles, eq(ptClientRelationships.clientId, profiles.id))
      .where(
        and(
          eq(ptClientRelationships.trainerId, trainerId),
          eq(ptClientRelationships.status, "active"),
          eq(ptClientRelationships.isAiTrainer, false),
        ),
      );
    return rows.map((r) => ({
      clientId: r.clientId,
      clientName: r.clientName ?? "",
      createdAt: r.createdAt ?? null,
    }));
  }

  /**
   * Roster client set for the Clients tab: active AND pending non-AI
   * relationships, left-joined to `profiles` for name + avatarUrl + status.
   *
   * Distinct from `getActiveClients` (active-only, no avatar/status) which the
   * Coach You aggregates depend on — that one is left untouched. The roster
   * shows pending clients too (prototype "All" filter + pending state).
   */
  async getRosterClients(trainerId: string): Promise<
    {
      clientId: string;
      clientName: string;
      avatarUrl: string | null;
      status: ClientStatus;
    }[]
  > {
    const db = getDb();
    const rows = await db
      .select({
        clientId: ptClientRelationships.clientId,
        clientName: profiles.fullName,
        avatarUrl: profiles.avatarUrl,
        status: ptClientRelationships.status,
      })
      .from(ptClientRelationships)
      .leftJoin(profiles, eq(ptClientRelationships.clientId, profiles.id))
      .where(
        and(
          eq(ptClientRelationships.trainerId, trainerId),
          inArray(ptClientRelationships.status, ["active", "pending"]),
          eq(ptClientRelationships.isAiTrainer, false),
        ),
      );
    return rows.map((r) => ({
      clientId: r.clientId,
      clientName: r.clientName ?? "",
      avatarUrl: r.avatarUrl ?? null,
      // status is enum-typed nullable in the schema (default 'pending'); the
      // WHERE constrains it to active|pending, so the coalesce is just a
      // type-narrowing safety net.
      status: (r.status as ClientStatus | null) ?? "pending",
    }));
  }

  /**
   * Most recent completed-session `completedAt` per client (status='completed').
   * These are the client's OWN sessions (scoped by clientId via
   * `workout_sessions.user_id`), so no trainer filter is needed — this is the
   * client's own activity, not a per-trainer assignment.
   */
  async getLastSeenByClient(
    clientIds: string[],
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    if (clientIds.length === 0) return result;
    const db = getDb();
    const rows = await db
      .select({
        clientId: workoutSessions.userId,
        // max() of the timestamp per client. Grouped by the column ref below
        // (NOT a reused parameterised sql`` expr) — safe re. the Drizzle
        // GROUP BY 42803 bug (reference_drizzle_groupby_param_bug).
        lastSeenAt: sql<string | null>`max(${workoutSessions.completedAt})`,
      })
      .from(workoutSessions)
      .where(
        and(
          inArray(workoutSessions.userId, clientIds),
          eq(workoutSessions.status, "completed"),
          sql`${workoutSessions.completedAt} is not null`,
        ),
      )
      .groupBy(workoutSessions.userId);
    for (const r of rows) {
      result.set(r.clientId, toIsoString(r.lastSeenAt));
    }
    return result;
  }

  /**
   * Per-client count of THIS trainer's missed assignments in the window — a
   * past-due assignment (dueDate in [windowStart, now)) that was not completed
   * (covers both 'skipped' and still-'assigned'/'started' rows). A future-dated
   * 'skipped' row (e.g. a trainer pre-cancelling next week's sessions) is NOT
   * missed yet, so the `dueDate < now` bound applies to every status — skipped
   * included (PR #125 review). Trainer-scoped: a co-trainer's missed assignment
   * for a jointly-coached client must not inflate this trainer's "N MISSED"
   * flag (PR #123 review lesson).
   */
  async getMissedCountsByClient(
    trainerId: string,
    clientIds: string[],
    windowStart: Date,
    now: Date,
  ): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (clientIds.length === 0) return result;
    const db = getDb();
    const startDate = windowStart.toISOString().slice(0, 10);
    const nowDate = now.toISOString().slice(0, 10);
    const rows = await db
      .select({
        clientId: workoutAssignments.clientId,
        missed: sql<number>`count(*)::int`,
      })
      .from(workoutAssignments)
      .where(
        and(
          eq(workoutAssignments.trainerId, trainerId),
          inArray(workoutAssignments.clientId, clientIds),
          sql`${workoutAssignments.dueDate} is not null`,
          sql`${workoutAssignments.dueDate} >= ${startDate}`,
          // Past-due only — excludes future-dated 'skipped' rows. 'skipped' is a
          // subset of "not completed", so the OR collapses to this single pair.
          sql`${workoutAssignments.status} not in ('completed')`,
          sql`${workoutAssignments.dueDate} < ${nowDate}`,
        ),
      )
      .groupBy(workoutAssignments.clientId);
    for (const r of rows) {
      result.set(r.clientId, r.missed);
    }
    return result;
  }

  /**
   * Per-client live programme info for the roster, scoped to THIS trainer's
   * assignments (a co-trainer's programme must not label this trainer's
   * roster row). One entry per client — with the live-unique index a client
   * holds at most one live assignment per programme; across programmes the
   * most recently started wins.
   */
  async getLiveProgramInfoByClient(
    trainerId: string,
    clientIds: string[],
  ): Promise<Map<string, LiveProgramInfo>> {
    const result = new Map<string, LiveProgramInfo>();
    if (clientIds.length === 0) return result;
    const db = getDb();
    const rows = await db
      .select({
        clientId: programAssignments.clientId,
        programName: workoutPrograms.name,
        startDate: programAssignments.startDate,
        endDate: programAssignments.endDate,
        durationWeeks: workoutPrograms.durationWeeks,
      })
      .from(programAssignments)
      .innerJoin(
        workoutPrograms,
        eq(workoutPrograms.id, programAssignments.programId),
      )
      .where(
        and(
          eq(programAssignments.assignedBy, trainerId),
          inArray(programAssignments.clientId, clientIds),
          inArray(programAssignments.status, ["assigned", "started"]),
        ),
      )
      // Ascending start date + Map overwrite ⇒ the latest-started live
      // programme wins per client.
      .orderBy(sql`${programAssignments.startDate} asc`);
    for (const r of rows) {
      result.set(r.clientId, {
        programName: r.programName,
        startDate: r.startDate,
        endDate: r.endDate,
        durationWeeks: r.durationWeeks,
      });
    }
    return result;
  }

  /**
   * Set of clients with ≥1 personal_record this month (powers the gold "NEW PR"
   * flag). PRs are the client's own data (scoped by clientId via
   * `personal_records.user_id`), so no trainer filter — correct per spec.
   */
  async getClientsWithPRsThisMonth(
    clientIds: string[],
    monthStart: Date,
  ): Promise<Set<string>> {
    const result = new Set<string>();
    if (clientIds.length === 0) return result;
    const db = getDb();
    const rows = await db
      .select({ clientId: personalRecords.userId })
      .from(personalRecords)
      .where(
        and(
          inArray(personalRecords.userId, clientIds),
          sql`${personalRecords.achievedAt} >= ${monthStart.toISOString()}`,
        ),
      )
      .groupBy(personalRecords.userId);
    for (const r of rows) {
      result.add(r.clientId);
    }
    return result;
  }

  /**
   * Resolve the trainer's `subscription_tiers.trainer_client_limit` from their
   * most-recent subscription row. Returns `null` when the tier is unknown
   * (no subscription row, or the joined tier has a null limit) — the handler
   * surfaces `slotsTotal: null` / `slotsOpen: null` in that case.
   */
  async getTrainerClientLimit(
    trainerId: string,
    // Executor defaults to a fresh pooled connection, but callers inside a
    // transaction MUST pass their `tx` — otherwise this opens a second pooled
    // connection and deadlocks under Supavisor transaction-mode pooling (the
    // outer tx holds the only connection while this query waits for it).
    executor: Pick<Db, "select"> = getDb(),
  ): Promise<number | null> {
    const rows = await executor
      .select({ limit: subscriptionTiers.trainerClientLimit })
      .from(userSubscriptions)
      .innerJoin(
        subscriptionTiers,
        eq(userSubscriptions.tierName, subscriptionTiers.tierName),
      )
      .where(
        and(
          eq(userSubscriptions.userId, trainerId),
          // Only LIVE, non-expired subscriptions grant slots — a
          // cancelled/expired trainer (or one whose trial lapsed) who
          // previously held a 25-slot tier must NOT keep that allowance.
          // Shares the API/DB-aligned expiry guard (see liveSubscriptionFilter).
          liveSubscriptionFilter(),
        ),
      )
      .orderBy(desc(userSubscriptions.createdAt))
      .limit(1);
    return rows[0]?.limit ?? null;
  }

  /** Count of active non-AI rels created within the current month. */
  async countNewClientsThisMonth(
    trainerId: string,
    monthStart: Date,
  ): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(ptClientRelationships)
      .where(
        and(
          eq(ptClientRelationships.trainerId, trainerId),
          eq(ptClientRelationships.status, "active"),
          eq(ptClientRelationships.isAiTrainer, false),
          sql`${ptClientRelationships.createdAt} >= ${monthStart.toISOString()}`,
        ),
      );
    return rows[0]?.total ?? 0;
  }

  /** Count of rels terminated within the current quarter (by updated_at). */
  async countChurnThisQuarter(
    trainerId: string,
    quarterStart: Date,
  ): Promise<number> {
    const db = getDb();
    const rows = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(ptClientRelationships)
      .where(
        and(
          eq(ptClientRelationships.trainerId, trainerId),
          eq(ptClientRelationships.status, "terminated"),
          sql`${ptClientRelationships.updatedAt} >= ${quarterStart.toISOString()}`,
        ),
      );
    return rows[0]?.total ?? 0;
  }

  /**
   * v1 retention: of clients with an active relationship `RETENTION_WINDOW_DAYS`
   * ago (created on/before that cutoff), the % still active now. Returns `null`
   * when the denominator is 0.
   *
   * v1 assumption: we approximate "had an active relationship 90 days ago"
   * with "relationship created on/before the 90-day cutoff". There is no
   * relationship status-history table to reconstruct the exact past state, so
   * a row terminated since then still counts in the denominator (created before
   * cutoff) but not the numerator (no longer active) — which is the intended
   * churn signal. Confirm on PR.
   */
  async getRetention(trainerId: string, cutoff: Date): Promise<number | null> {
    const db = getDb();
    const rows = await db
      .select({
        denom: sql<number>`count(*)::int`,
        numer: sql<number>`count(*) filter (where ${ptClientRelationships.status} = 'active')::int`,
      })
      .from(ptClientRelationships)
      .where(
        and(
          eq(ptClientRelationships.trainerId, trainerId),
          eq(ptClientRelationships.isAiTrainer, false),
          sql`${ptClientRelationships.createdAt} <= ${cutoff.toISOString()}`,
        ),
      );
    const denom = rows[0]?.denom ?? 0;
    const numer = rows[0]?.numer ?? 0;
    if (denom === 0) return null;
    return Math.round((numer / denom) * 100);
  }

  /**
   * Per-client adherence counters over a window (assignments whose `due_date`
   * is within [windowStart, windowEnd]). `due_date` is stored as a `text`
   * column (YYYY-MM-DD) so we compare on the date literal.
   *
   * Scoped to `trainerId`: a client can be jointly coached (multiple active
   * `pt_client_relationships` rows differing only by `trainer_id`), so without
   * this filter another trainer's assignments to the same client would skew
   * THIS trainer's adherence / health bands.
   */
  async getAdherenceRows(
    trainerId: string,
    clientIds: string[],
    windowStart: Date,
    windowEnd: Date,
  ): Promise<AdherenceRow[]> {
    if (clientIds.length === 0) return [];
    const db = getDb();
    const startDate = windowStart.toISOString().slice(0, 10);
    const endDate = windowEnd.toISOString().slice(0, 10);
    const rows = await db
      .select({
        clientId: workoutAssignments.clientId,
        completed: sql<number>`count(*) filter (where ${workoutAssignments.status} = 'completed')::int`,
        total: sql<number>`count(*)::int`,
      })
      .from(workoutAssignments)
      .where(
        and(
          eq(workoutAssignments.trainerId, trainerId),
          inArray(workoutAssignments.clientId, clientIds),
          sql`${workoutAssignments.dueDate} is not null`,
          sql`${workoutAssignments.dueDate} >= ${startDate}`,
          sql`${workoutAssignments.dueDate} <= ${endDate}`,
        ),
      )
      // Group by the column reference (ordinal would also work; the column
      // ref here is NOT a reused parameterised sql`` expression, so it is
      // safe — cf. reference_drizzle_groupby_param_bug).
      .groupBy(workoutAssignments.clientId);
    return rows.map((r) => ({
      clientId: r.clientId,
      completed: r.completed,
      total: r.total,
    }));
  }

  /** Personal records achieved this month across the given clients. */
  async getClientPRsThisMonth(
    clientIds: string[],
    monthStart: Date,
  ): Promise<{ count: number; distinctClients: number }> {
    if (clientIds.length === 0) return { count: 0, distinctClients: 0 };
    const db = getDb();
    const rows = await db
      .select({
        count: sql<number>`count(*)::int`,
        distinctClients: sql<number>`count(distinct ${personalRecords.userId})::int`,
      })
      .from(personalRecords)
      .where(
        and(
          inArray(personalRecords.userId, clientIds),
          sql`${personalRecords.achievedAt} >= ${monthStart.toISOString()}`,
        ),
      );
    return {
      count: rows[0]?.count ?? 0,
      distinctClients: rows[0]?.distinctClients ?? 0,
    };
  }

  /**
   * Program stats: programmes created by the trainer, each with a count of
   * distinct clients having a LIVE `program_assignments` row (specs/19-programs
   * — the flat model replaced the old program_weeks join). Returns top
   * `TOP_PROGRAMS_LIMIT` by activeClients and the count of programmes with
   * ≥1 active client.
   */
  async getProgramStats(
    trainerId: string,
    clientIds: string[],
  ): Promise<CoachOverview["programStats"]> {
    const db = getDb();
    const programs = await db
      .select({ id: workoutPrograms.id, name: workoutPrograms.name })
      .from(workoutPrograms)
      .where(eq(workoutPrograms.createdBy, trainerId));

    if (programs.length === 0) {
      return { activeProgramsCount: 0, programs: [] };
    }

    const programIds = programs.map((p) => p.id);

    // Distinct live-assignment clients per program. Live = `assigned` or
    // `started` (not completed / skipped) — currently in-flight.
    let counts: { programId: string; activeClients: number }[] = [];
    if (clientIds.length > 0) {
      counts = await db
        .select({
          programId: programAssignments.programId,
          activeClients: sql<number>`count(distinct ${programAssignments.clientId})::int`,
        })
        .from(programAssignments)
        .where(
          and(
            // Only count assignments THIS trainer made — a jointly coached
            // client could also hold a co-trainer's assignment, which must
            // not leak into this trainer's active-client count.
            eq(programAssignments.assignedBy, trainerId),
            inArray(programAssignments.programId, programIds),
            inArray(programAssignments.clientId, clientIds),
            inArray(programAssignments.status, ["assigned", "started"]),
          ),
        )
        .groupBy(programAssignments.programId);
    }

    const countByProgram = new Map(
      counts.map((c) => [c.programId, c.activeClients]),
    );

    const withCounts = programs.map((p) => ({
      id: p.id,
      name: p.name,
      activeClients: countByProgram.get(p.id) ?? 0,
    }));

    const activeProgramsCount = withCounts.filter(
      (p) => p.activeClients > 0,
    ).length;

    const top = [...withCounts]
      .sort((a, b) => b.activeClients - a.activeClients)
      .slice(0, TOP_PROGRAMS_LIMIT);

    return { activeProgramsCount, programs: top };
  }

  /**
   * Recent activity feed (last `RECENT_ACTIVITY_LIMIT`, newest first) — a union
   * across the trainer's active clients of completed sessions, PRs, and missed
   * assignments. Each branch is queried independently then merged + sorted +
   * truncated in JS (simpler than a SQL UNION across heterogeneous shapes, and
   * the per-branch limit keeps the row counts small).
   */
  async getRecentActivity(
    trainerId: string,
    clients: { clientId: string; clientName: string }[],
    now: Date,
  ): Promise<RecentActivityEvent[]> {
    if (clients.length === 0) return [];
    const db = getDb();
    const clientIds = clients.map((c) => c.clientId);
    const nameById = new Map(clients.map((c) => [c.clientId, c.clientName]));

    const decorate = (
      type: RecentActivityType,
      clientId: string,
      payload: Record<string, unknown>,
      occurredAt: Date | string | null,
    ): RecentActivityEvent => {
      const clientName = nameById.get(clientId) ?? "";
      return {
        type,
        clientId,
        clientName,
        clientInitials: initialsFromName(clientName),
        payload,
        occurredAt: toIsoString(occurredAt) ?? new Date(0).toISOString(),
      };
    };

    // 1. Completed sessions.
    const sessions = await db
      .select({
        clientId: workoutSessions.userId,
        name: workoutSessions.name,
        completedAt: workoutSessions.completedAt,
      })
      .from(workoutSessions)
      .where(
        and(
          inArray(workoutSessions.userId, clientIds),
          eq(workoutSessions.status, "completed"),
          sql`${workoutSessions.completedAt} is not null`,
        ),
      )
      .orderBy(desc(workoutSessions.completedAt))
      .limit(RECENT_ACTIVITY_LIMIT);

    // 2. Personal records.
    const prs = await db
      .select({
        clientId: personalRecords.userId,
        recordType: personalRecords.recordType,
        value: personalRecords.value,
        achievedAt: personalRecords.achievedAt,
      })
      .from(personalRecords)
      .where(inArray(personalRecords.userId, clientIds))
      .orderBy(desc(personalRecords.achievedAt))
      .limit(RECENT_ACTIVITY_LIMIT);

    // 3. Missed assignments — past-due (dueDate < now) and not completed.
    //    Covers 'skipped' and still-'assigned'/'started' rows; a future-dated
    //    'skipped' (pre-cancelled session) is not missed yet, so the dueDate
    //    bound applies to every status (PR #125 review). Scoped to this
    //    trainer's own assignments: a co-trainer's missed assignment for a
    //    shared client isn't something THIS trainer scheduled or can act on.
    const nowDate = now.toISOString().slice(0, 10);
    const missed = await db
      .select({
        clientId: workoutAssignments.clientId,
        status: workoutAssignments.status,
        dueDate: workoutAssignments.dueDate,
      })
      .from(workoutAssignments)
      .where(
        and(
          eq(workoutAssignments.trainerId, trainerId),
          inArray(workoutAssignments.clientId, clientIds),
          sql`${workoutAssignments.status} not in ('completed')`,
          sql`${workoutAssignments.dueDate} is not null`,
          sql`${workoutAssignments.dueDate} < ${nowDate}`,
        ),
      )
      .orderBy(desc(workoutAssignments.dueDate))
      .limit(RECENT_ACTIVITY_LIMIT);

    const events: RecentActivityEvent[] = [
      ...sessions.map((s) =>
        decorate(
          "session_completed",
          s.clientId,
          { sessionName: s.name ?? null },
          s.completedAt,
        ),
      ),
      ...prs.map((p) =>
        decorate(
          "pr_achieved",
          p.clientId,
          { recordType: p.recordType, value: p.value },
          p.achievedAt,
        ),
      ),
      ...missed.map((m) =>
        decorate(
          "missed_day",
          m.clientId,
          { dueDate: m.dueDate, status: m.status },
          // due_date is a date string; surface it as the event time.
          m.dueDate ? new Date(m.dueDate) : null,
        ),
      ),
    ];

    return events
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, RECENT_ACTIVITY_LIMIT);
  }

  /**
   * Assemble the full Coach You overview. Orchestrates the per-aggregate
   * queries; all computation rules follow the approved plan's v1 definitions
   * (documented at each call site).
   */
  async getOverview(
    trainerId: string,
    now: Date = new Date(),
  ): Promise<CoachOverview> {
    const monthStart = startOfMonth(now);
    const quarterStart = startOfQuarter(now);

    const [identity, activeClients] = await Promise.all([
      this.getTrainerIdentity(trainerId),
      this.getActiveClients(trainerId),
    ]);

    const clientIds = activeClients.map((c) => c.clientId);

    // Adherence: this 28d window and the previous 28d window.
    const win1End = now;
    const win1Start = daysAgo(now, ADHERENCE_WINDOW_DAYS);
    // Previous window ends the day BEFORE the current window's start — both
    // bounds are date-inclusive in getAdherenceRows, so sharing the boundary
    // date would double-count assignments due exactly on the cutoff.
    const win0End = daysAgo(now, ADHERENCE_WINDOW_DAYS + 1);
    const win0Start = daysAgo(now, ADHERENCE_WINDOW_DAYS * 2);

    const [
      slotsTotal,
      newClientsThisMonth,
      churnThisQuarter,
      retentionPct,
      adherenceThis,
      adherencePrev,
      prs,
      programStats,
      recentActivity,
    ] = await Promise.all([
      this.getTrainerClientLimit(trainerId),
      this.countNewClientsThisMonth(trainerId, monthStart),
      this.countChurnThisQuarter(trainerId, quarterStart),
      this.getRetention(trainerId, daysAgo(now, RETENTION_WINDOW_DAYS)),
      this.getAdherenceRows(trainerId, clientIds, win1Start, win1End),
      this.getAdherenceRows(trainerId, clientIds, win0Start, win0End),
      this.getClientPRsThisMonth(clientIds, monthStart),
      this.getProgramStats(trainerId, clientIds),
      this.getRecentActivity(trainerId, activeClients, now),
    ]);

    const activeCount = activeClients.length;
    const slotsOpen = slotsTotal === null ? null : slotsTotal - activeCount;

    // v1 adherence: per-client % over the included (≥1 assignment) clients,
    // then the mean. Clients with zero assignments are excluded from both the
    // average and the health-band buckets.
    const perClientThis = adherenceThis
      .map((r) => ({
        clientId: r.clientId,
        pct: clientAdherence(r.completed, r.total),
      }))
      .filter((r): r is { clientId: string; pct: number } => r.pct !== null);

    const avgAdherence = mean(perClientThis.map((r) => r.pct));

    const prevPercents = adherencePrev
      .map((r) => clientAdherence(r.completed, r.total))
      .filter((p): p is number => p !== null);
    const avgPrev = mean(prevPercents);
    const adherenceDelta =
      avgAdherence === null || avgPrev === null ? null : avgAdherence - avgPrev;

    // Health bands over the *included* clients only.
    const bandCounts: Record<ClientHealthBand, number> = {
      strong: 0,
      wobbling: 0,
      atRisk: 0,
    };
    for (const r of perClientThis) {
      bandCounts[adherenceBand(r.pct)] += 1;
    }
    const clientHealthBreakdown: CoachOverview["clientHealthBreakdown"] = [
      { band: "strong", count: bandCounts.strong },
      { band: "wobbling", count: bandCounts.wobbling },
      { band: "atRisk", count: bandCounts.atRisk },
    ];

    return {
      trainer: {
        name: identity.name,
        initials: initialsFromName(identity.name),
        coachSince: identity.coachSince,
      },
      businessStats: {
        activeClients: activeCount,
        newClientsThisMonth,
        slotsTotal,
        slotsOpen,
        avgAdherence,
        adherenceDelta,
        clientPRsThisMonth: prs.count,
        clientsWithPRs: prs.distinctClients,
        retentionPct,
        churnThisQuarter,
      },
      clientHealthBreakdown,
      programStats,
      recentActivity,
    };
  }

  /**
   * Assemble the Clients-tab roster. One row per active/pending non-AI
   * relationship, decorated with v1 28-day adherence + band, last-seen, and
   * the three derivable flags (NEW PR / N MISSED / Nd IDLE).
   *
   * v1 assumptions (confirm on PR):
   *  - adherence: reuse `getAdherenceRows` over the last 28 days; null when the
   *    client has zero in-window assignments → null band.
   *  - programLabel/programEndDate: from the client's live programme
   *    assignment via `getLiveProgramInfoByClient` (specs/19-programs).
   *  - flags + adherence are trainer-scoped on the assignment side so a
   *    co-trainer's data for a jointly-coached client can't leak.
   *
   * Sort: adherence ascending (lowest/at-risk first, matching the prototype
   * "SORTED BY · ADHERENCE"); null-adherence clients sort LAST.
   */
  async getClients(
    trainerId: string,
    now: Date = new Date(),
  ): Promise<TrainerClient[]> {
    const monthStart = startOfMonth(now);
    const winStart = daysAgo(now, ADHERENCE_WINDOW_DAYS);

    const roster = await this.getRosterClients(trainerId);
    if (roster.length === 0) return [];

    const clientIds = roster.map((c) => c.clientId);

    const [
      adherenceRows,
      lastSeenByClient,
      missedByClient,
      clientsWithPRs,
      programInfoByClient,
    ] = await Promise.all([
      this.getAdherenceRows(trainerId, clientIds, winStart, now),
      this.getLastSeenByClient(clientIds),
      this.getMissedCountsByClient(trainerId, clientIds, winStart, now),
      this.getClientsWithPRsThisMonth(clientIds, monthStart),
      this.getLiveProgramInfoByClient(trainerId, clientIds),
    ]);
    const todayIso = now.toISOString().slice(0, 10);

    const adherenceByClient = new Map<string, number | null>();
    for (const r of adherenceRows) {
      adherenceByClient.set(r.clientId, clientAdherence(r.completed, r.total));
    }

    const clients: TrainerClient[] = roster.map((c) => {
      const adherence = adherenceByClient.get(c.clientId) ?? null;
      const band = adherence === null ? null : clientRosterBand(adherence);
      const lastSeenAt = lastSeenByClient.get(c.clientId) ?? null;

      const flags: ClientFlag[] = [];
      if (clientsWithPRs.has(c.clientId)) {
        flags.push({ tone: "gold", label: "NEW PR" });
      }
      const missed = missedByClient.get(c.clientId) ?? 0;
      if (missed > 0) {
        flags.push({ tone: "ember", label: `${missed} MISSED` });
      }
      if (lastSeenAt !== null) {
        const idleDays = wholeDaysBetween(new Date(lastSeenAt), now);
        if (idleDays >= IDLE_DAYS) {
          flags.push({ tone: "error", label: `${idleDays}d IDLE` });
        }
      }

      const programInfo = programInfoByClient.get(c.clientId) ?? null;

      return {
        id: c.clientId,
        name: c.clientName,
        initials: initialsFromName(c.clientName),
        avatarUrl: c.avatarUrl,
        status: c.status,
        programLabel: programInfo
          ? formatProgramLabel(programInfo, todayIso)
          : null,
        programEndDate: programInfo?.endDate ?? null,
        adherence,
        band,
        lastSeenAt,
        flags,
      };
    });

    // Adherence ascending; null-adherence clients sort last.
    return clients.sort((a, b) => {
      if (a.adherence === null && b.adherence === null) return 0;
      if (a.adherence === null) return 1;
      if (b.adherence === null) return -1;
      return a.adherence - b.adherence;
    });
  }

  // ─── Invitations ──────────────────────────────────────────────────────────

  /** Pending invitations for the trainer, newest first. */
  async listPendingInvitations(
    trainerId: string,
  ): Promise<TrainerInvitation[]> {
    const db = getDb();
    return db
      .select()
      .from(trainerInvitations)
      .where(
        and(
          eq(trainerInvitations.trainerId, trainerId),
          eq(trainerInvitations.status, "pending"),
        ),
      )
      .orderBy(desc(trainerInvitations.invitedAt));
  }

  /**
   * Invite a client by email. Drizzle reimplementation of the legacy
   * `invite_client_by_email` RPC — same behaviour, runs in a transaction.
   *
   * Throws `InviteError` for the domain failures (self_invite / no_slots /
   * exists); the handler maps `.status` + `.code` to a JSON error body.
   */
  async inviteClientByEmail(
    trainerId: string,
    rawEmail: string,
    relationshipReason: string | null,
  ): Promise<InviteClientResult> {
    const db = getDb();
    const clientEmail = rawEmail.toLowerCase().trim();

    return db.transaction(async (tx) => {
      // Self-invite guard: compare against the trainer's own email.
      const trainerRows = await tx
        .select({ email: profiles.email })
        .from(profiles)
        .where(eq(profiles.id, trainerId))
        .limit(1);
      const trainerEmail = (trainerRows[0]?.email ?? "").toLowerCase().trim();
      if (trainerEmail !== "" && trainerEmail === clientEmail) {
        throw new InviteError(400, "self_invite", "You cannot invite yourself");
      }

      // Slot check: slotsTotal from tier, activeClients from active non-AI rels.
      // CRITICAL: pass `tx` so the slot-limit query runs on the transaction's
      // own connection. Calling getTrainerClientLimit() with the default
      // executor would grab a SECOND pooled connection and deadlock under
      // Supavisor transaction-mode pooling (20s Lambda timeouts).
      const slotsTotal = await this.getTrainerClientLimit(trainerId, tx);

      const activeRows = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(ptClientRelationships)
        .where(
          and(
            eq(ptClientRelationships.trainerId, trainerId),
            eq(ptClientRelationships.status, "active"),
            eq(ptClientRelationships.isAiTrainer, false),
          ),
        );
      const activeClients = activeRows[0]?.total ?? 0;

      // No tier / null limit ⇒ no configured slots ⇒ full. (Matches legacy
      // check_trainer_slots which returns has_slots=false when limit is null.)
      const slotsOpen = slotsTotal === null ? 0 : slotsTotal - activeClients;
      if (slotsOpen <= 0) {
        throw new InviteError(
          403,
          "no_slots",
          "Trainer has no available client slots",
        );
      }

      // Look up the client profile by email.
      const clientRows = await tx
        .select({ id: profiles.id, fullName: profiles.fullName })
        .from(profiles)
        .where(sql`lower(${profiles.email}) = ${clientEmail}`)
        .limit(1);
      const client = clientRows[0];

      if (client) {
        // Existing user → create or revive a pending relationship.
        //
        // The `pt_client_relationships_trainer_client_idx` unique index is
        // UNCONDITIONAL on (trainer_id, client_id) — there is at most one row
        // per pair regardless of status. So we must inspect ANY existing row,
        // not just active/pending ones: a blind INSERT for a pair that was
        // previously inactive/terminated would hit the unique constraint and
        // escape as a 500. Instead:
        //   - active/pending  → 409 (already a live relationship)
        //   - inactive/terminated → revive the existing row back to pending
        //   - none → insert fresh
        const existing = await tx
          .select({
            id: ptClientRelationships.id,
            status: ptClientRelationships.status,
          })
          .from(ptClientRelationships)
          .where(
            and(
              eq(ptClientRelationships.trainerId, trainerId),
              eq(ptClientRelationships.clientId, client.id),
            ),
          )
          .limit(1);

        const existingRel = existing[0];
        if (
          existingRel &&
          (existingRel.status === "active" || existingRel.status === "pending")
        ) {
          throw new InviteError(
            409,
            "exists",
            "Relationship already exists with this client",
          );
        }

        let relationshipId: string;
        if (existingRel) {
          // Revive the dormant (inactive/terminated) relationship in place —
          // the unique index forbids a second row for this pair.
          await tx
            .update(ptClientRelationships)
            .set({
              status: "pending",
              relationshipReason,
              endDate: null,
              updatedAt: new Date(),
            })
            .where(eq(ptClientRelationships.id, existingRel.id));
          relationshipId = existingRel.id;
        } else {
          const inserted = await tx
            .insert(ptClientRelationships)
            .values({
              trainerId,
              clientId: client.id,
              status: "pending",
              relationshipReason,
            } as NewPtClientRelationship)
            .returning({ id: ptClientRelationships.id });
          relationshipId = inserted[0].id;
        }

        return {
          success: true as const,
          action: "relationship_created" as const,
          relationshipId,
          clientId: client.id,
          clientName: client.fullName ?? null,
          message: `Training request sent to ${client.fullName ?? clientEmail}`,
        };
      }

      // No user → create a pending invitation (unless one exists).
      const existingInvite = await tx
        .select({ id: trainerInvitations.id })
        .from(trainerInvitations)
        .where(
          and(
            eq(trainerInvitations.trainerId, trainerId),
            sql`lower(${trainerInvitations.clientEmail}) = ${clientEmail}`,
            eq(trainerInvitations.status, "pending"),
          ),
        )
        .limit(1);
      if (existingInvite[0]) {
        throw new InviteError(
          409,
          "exists",
          "Invitation already sent to this email",
        );
      }

      const inserted = await tx
        .insert(trainerInvitations)
        .values({
          trainerId,
          clientEmail,
          relationshipReason,
          status: "pending",
        } as NewTrainerInvitation)
        .returning({ id: trainerInvitations.id });

      return {
        success: true as const,
        action: "invitation_created" as const,
        invitationId: inserted[0].id,
        clientEmail,
        message: `Invitation will be sent when ${clientEmail} signs up`,
      };
    });
  }

  /**
   * Cancel a pending invitation, ownership-scoped. Sets status='cancelled'
   * and stamps cancelled_at. The WHERE includes status='pending' to avoid a
   * race with concurrent acceptance (matches the legacy RPC). Returns true if
   * a row was updated, false if not found / not pending / not owned.
   */
  async cancelInvitation(
    trainerId: string,
    invitationId: string,
  ): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .update(trainerInvitations)
      .set({ status: "cancelled", cancelledAt: new Date() })
      .where(
        and(
          eq(trainerInvitations.id, invitationId),
          eq(trainerInvitations.trainerId, trainerId),
          eq(trainerInvitations.status, "pending"),
        ),
      )
      .returning({ id: trainerInvitations.id });
    return rows.length > 0;
  }
}
