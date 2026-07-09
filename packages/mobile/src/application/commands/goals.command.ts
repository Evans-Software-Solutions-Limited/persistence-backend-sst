/**
 * Athlete goal CRUD commands (M16 — Athlete Training page).
 *
 * Goals are net-new self-service UX. Like the coach goal-assign path (and
 * unlike the offline habit/session writes) these are ONLINE-DIRECT — no sync
 * queue — since a goal create needs the server id and goals aren't required
 * offline. Each command writes the goals CACHE optimistically BEFORE awaiting
 * the network (so the Train overview reflects instantly once the container
 * `reload()`s — the #173 optimistic-rerender lesson), then reconciles on
 * success or reverts on failure. The container calls `reload()` after the
 * synchronous optimistic write and again once the promise resolves.
 *
 * Self-set goals only: coach-assigned goals are view-only (no edit/delete
 * affordance in the UI, and the server self-PATCH/DELETE is ownership-scoped),
 * so these never touch a coach-assigned row.
 */

import type { StoragePort } from "@/domain/ports/storage.port";
import type { ApiPort, GoalType } from "@/domain/ports/api.port";
import type { Goal } from "@/domain/models/goal";
import { mapApiGoalToGoal } from "@/domain/models/goal";
import type { Result, ApiError } from "@/shared/errors";
import { ok } from "@/shared/errors";
import { localIdFactory } from "./localId";

export type GoalCommandDeps = {
  storage: StoragePort;
  api: ApiPort;
  userId: string;
  /** Stable id factory for the optimistic local row (overridable in tests). */
  idFactory?: () => string;
};

export type CreateGoalCommandInput = {
  /** The picked catalog type — carries name/icon/category for the optimistic tile. */
  goalType: GoalType;
  targetDate?: string;
};

export type UpdateGoalCommandInput = {
  targetDate?: string | null;
};

function currentGoals(storage: StoragePort, userId: string): Goal[] {
  return storage.getCachedGoals(userId) ?? [];
}

/**
 * Create a self-set goal. Optimistically prepends a `local-…` row (goals list
 * is newest-first), then swaps in the server row on success / drops it on
 * failure.
 */
export async function createGoalCommand(
  deps: GoalCommandDeps,
  input: CreateGoalCommandInput,
): Promise<Result<Goal, ApiError>> {
  const { storage, api, userId } = deps;
  const idFactory = deps.idFactory ?? localIdFactory;
  const tempId = `local-${idFactory()}`;
  const baseline = currentGoals(storage, userId);

  const optimistic: Goal = {
    id: tempId,
    goalTypeId: input.goalType.id,
    goalTypeName: input.goalType.name,
    iconName: input.goalType.iconName ?? null,
    category: input.goalType.category ?? null,
    targetValue: null,
    currentValue: null,
    unit: null,
    targetDate: input.targetDate ?? null,
    notes: null,
    priority: null,
    isActive: true,
    assignedByUserId: null,
    assignedByName: null,
    isCoachAssigned: false,
    createdAt: new Date().toISOString(),
  };
  storage.cacheGoals(userId, [optimistic, ...baseline]);

  const result = await api.createGoal({
    goalTypeId: input.goalType.id,
    targetDate: input.targetDate,
  });

  if (!result.ok) {
    // Revert — drop the optimistic row.
    storage.cacheGoals(userId, baseline);
    return result;
  }

  // The self POST /goals response is the RAW (un-enriched) row — no goal-type
  // join — so keep the picked type's name/icon/category (immutable on create)
  // rather than blanking the tile until the next list refresh. Self-created →
  // never coach-assigned.
  const saved: Goal = {
    ...mapApiGoalToGoal(result.value),
    goalTypeName: input.goalType.name,
    iconName: input.goalType.iconName ?? null,
    category: input.goalType.category ?? null,
    assignedByUserId: null,
    assignedByName: null,
    isCoachAssigned: false,
  };
  storage.cacheGoals(userId, [
    saved,
    ...currentGoals(storage, userId).filter(
      (g) => g.id !== tempId && g.id !== saved.id,
    ),
  ]);
  return ok(saved);
}

/**
 * Edit a self-set goal's target date. Optimistically patches the cached row,
 * reconciles with the server row on success, reverts on failure.
 */
export async function updateGoalCommand(
  deps: GoalCommandDeps,
  goalId: string,
  input: UpdateGoalCommandInput,
): Promise<Result<Goal, ApiError>> {
  const { storage, api, userId } = deps;
  const baseline = currentGoals(storage, userId);

  storage.cacheGoals(
    userId,
    baseline.map((g) =>
      g.id === goalId ? { ...g, targetDate: input.targetDate ?? null } : g,
    ),
  );

  const result = await api.updateGoal(goalId, {
    targetDate: input.targetDate ?? undefined,
  });

  if (!result.ok) {
    storage.cacheGoals(userId, baseline);
    return result;
  }

  // PATCH /goals/:id returns the RAW row (no join). The goal type + attribution
  // don't change on an edit, so keep the existing enriched fields and only take
  // the server's mutated columns (target date / priority / active state).
  const target = baseline.find((g) => g.id === goalId);
  const raw = mapApiGoalToGoal(result.value);
  const saved: Goal = target
    ? {
        ...target,
        targetDate: raw.targetDate,
        priority: raw.priority,
        isActive: raw.isActive,
      }
    : raw;
  storage.cacheGoals(
    userId,
    currentGoals(storage, userId).map((g) => (g.id === goalId ? saved : g)),
  );
  return ok(saved);
}

/**
 * Delete a self-set goal. Optimistically removes it, restores it on failure.
 */
export async function deleteGoalCommand(
  deps: GoalCommandDeps,
  goalId: string,
): Promise<Result<void, ApiError>> {
  const { storage, api, userId } = deps;
  const baseline = currentGoals(storage, userId);

  storage.cacheGoals(
    userId,
    baseline.filter((g) => g.id !== goalId),
  );

  const result = await api.deleteGoal(goalId);
  if (!result.ok) {
    storage.cacheGoals(userId, baseline);
    return result;
  }
  return ok(undefined);
}
