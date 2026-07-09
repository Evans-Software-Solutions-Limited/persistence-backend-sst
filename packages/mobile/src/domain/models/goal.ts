/**
 * Goal domain model (M16 — Athlete Training page). The athlete-facing view of a
 * `user_goals` row, enriched server-side (`GET /goals`) with its goal-type
 * name/icon/category and — for coach-assigned goals — the assigner's display
 * name (Phase 11 / cross-cuts § 1.5).
 *
 * v1 renders type + target + target date + coach attribution; there is NO
 * progress bar (a goal's `currentValue` is manual with no athlete update path,
 * so it would read permanently empty — M16 decision #2). `targetValue` /
 * `currentValue` / `unit` are carried through for a later progress slice but are
 * null for every goal today (neither the self nor coach write path sets them).
 */

import type { ApiGoal } from "@/domain/ports/api.port";

export type Goal = {
  id: string;
  goalTypeId: string;
  /** Resolved from `goal_types` (server LEFT JOIN); null if the type is gone. */
  goalTypeName: string | null;
  iconName: string | null;
  category: string | null;
  targetValue: number | null;
  currentValue: number | null;
  unit: string | null;
  targetDate: string | null;
  notes: string | null;
  priority: number | null;
  isActive: boolean;
  /** NULL = self-set; non-null = the coach/physio who assigned it. */
  assignedByUserId: string | null;
  /** The assigner's display name (server-resolved); null for self-set goals. */
  assignedByName: string | null;
  /**
   * True when a coach/physio assigned this goal. Coach-assigned goals are
   * view-only for the athlete (no edit/delete, cross-cuts § 2.2 — removal is
   * out-of-band) and carry a <CoachAttribution> badge.
   */
  isCoachAssigned: boolean;
  createdAt: string;
};

export function mapApiGoalToGoal(g: ApiGoal): Goal {
  return {
    id: g.id,
    goalTypeId: g.goalTypeId,
    goalTypeName: g.goalTypeName ?? null,
    iconName: g.goalTypeIconName ?? null,
    category: g.goalTypeCategory ?? null,
    targetValue: g.targetValue ?? null,
    currentValue: g.currentValue ?? null,
    unit: g.unit ?? null,
    targetDate: g.targetDate ?? null,
    notes: g.notes ?? null,
    priority: g.priority ?? null,
    isActive: g.isActive,
    assignedByUserId: g.assignedByUserId ?? null,
    assignedByName: g.assignedByName ?? null,
    isCoachAssigned: (g.assignedByUserId ?? null) !== null,
    createdAt: g.createdAt,
  };
}

/** 5-min TTL, matching the other cache-first read hooks (Home/Fuel). */
export const GOALS_STALE_AFTER_MS = 5 * 60 * 1000;

export function areGoalsStale(
  syncedAtIso: string | null,
  now: number,
): boolean {
  if (!syncedAtIso) return true;
  return now - new Date(syncedAtIso).getTime() > GOALS_STALE_AFTER_MS;
}
