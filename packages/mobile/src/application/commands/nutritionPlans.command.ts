/**
 * List meal plans (PER-133, Design D) — offline-first writes.
 *
 * Every write updates the plans cache first, then queues the wire mutation;
 * the sync drain sends it. Nothing here calls the network.
 *
 * - **Create / duplicate** get a `local-…` id; the queue row's
 *   Idempotency-Key makes a replay answer with the first plan. When the reply
 *   lands, `applyNutritionPlanSynced` swaps the id everywhere.
 * - **Edit** is a full `PUT` with `expectedRevision` (the revision the edit
 *   started from). Repeated edits fold into one queued PUT. A 409 keeps the
 *   server's copy and flags the plan "updated elsewhere"
 *   (`applyNutritionPlanConflict`).
 * - **Delete** archives; logged food stays.
 * - **Coach plan answers** (Add to my plans, Not now, seen) fold into one
 *   queued `POST …/assignment` per plan.
 * - **Shopping list** plan add/remove; ticks never leave the phone.
 * - **Adding to today** builds entries from the cached plan and logs each
 *   through `logEntryCommand`, so PER-132's batch replay sends them with their
 *   own keys and nothing is logged twice.
 */
import type { StoragePort, SyncQueueEntry } from "@/domain/ports/storage.port";
import type { NutritionEntry } from "@/domain/models/nutrition";
import type {
  NutritionPlan,
  NutritionPlansCache,
  PlanAssignmentStatus,
  PlansShoppingCache,
  PlansShoppingList,
} from "@/domain/models/nutritionPlans";
import { emptyPlansCache } from "@/domain/models/nutritionPlans";
import type { UserMeal } from "@/domain/models/userMeals";
import { isAutoResolvableSyncEntry } from "@/domain/ports/sync.types";
import {
  logInputsForPlan,
  logInputsForPlanMeal,
  recomputePlan,
  toPlanInput,
} from "@/domain/services/nutritionPlans.service";
import { logEntryCommand } from "./nutrition.command";

export const NUTRITION_PLAN_ENTITY = "nutrition_plan";
export const NUTRITION_PLAN_ASSIGNMENT_ENTITY = "nutrition_plan_assignment";
export const SHOPPING_LIST_PLAN_ENTITY = "shopping_list_plan";
export const MEAL_PLANS_ENDPOINT = "/nutrition/meal-plans";
export const SHOPPING_LIST_PLANS_ENDPOINT = "/nutrition/shopping-list/plans";

export type NutritionPlansCommandDeps = {
  storage: StoragePort;
  userId: string;
  idFactory: () => string;
  now?: () => string;
};

const nowIso = (deps: NutritionPlansCommandDeps) =>
  deps.now ? deps.now() : new Date().toISOString();

export function readPlansCache(
  storage: StoragePort,
  userId: string,
): NutritionPlansCache {
  return storage.getCachedNutritionPlans(userId) ?? emptyPlansCache();
}

function writeMine(
  storage: StoragePort,
  userId: string,
  update: (mine: NutritionPlan[]) => NutritionPlan[],
): void {
  const cache = readPlansCache(storage, userId);
  storage.cacheNutritionPlans(userId, { ...cache, mine: update(cache.mine) });
}

function parse(payload: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(payload) as unknown;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Queue rows for a plan that are still waiting and never left the phone. */
function unsentFor(
  storage: StoragePort,
  entityType: string,
  entityId: string,
): SyncQueueEntry[] {
  return storage
    .getQueuedEntriesForEntity(entityType, entityId)
    .filter(
      (e) =>
        (e.status === "pending" || e.status === "failed") &&
        (e.dispatchCount ?? 0) === 0,
    );
}

/** Plans with a create, edit or delete that can still reach the server. */
export function livePlanEdits(storage: StoragePort): SyncQueueEntry[] {
  return storage
    .getUncompletedMutations()
    .filter(
      (e) =>
        (e.entityType === NUTRITION_PLAN_ENTITY ||
          e.entityType === NUTRITION_PLAN_ASSIGNMENT_ENTITY) &&
        isAutoResolvableSyncEntry(e),
    );
}

// -- Mine: create, edit, delete, duplicate ---------------------------------------

/**
 * Save a new plan (N28 → N32 "Save plan"). Returns the cached plan, whose id
 * is `local-…` until the create syncs.
 */
export function createPlanCommand(
  deps: NutritionPlansCommandDeps,
  draft: NutritionPlan,
): NutritionPlan {
  const { storage, userId } = deps;
  const id = draft.id.startsWith("local-")
    ? draft.id
    : `local-${deps.idFactory()}`;
  const plan = recomputePlan({
    ...draft,
    id,
    ownerId: userId,
    revision: 0,
    updatedAt: nowIso(deps),
  });
  writeMine(storage, userId, (mine) => [
    ...mine.filter((p) => p.id !== id),
    plan,
  ]);
  storage.enqueueMutation({
    entityType: NUTRITION_PLAN_ENTITY,
    entityId: id,
    operation: "create",
    payload: toPlanInput(plan),
    endpoint: MEAL_PLANS_ENDPOINT,
    method: "POST",
  });
  return plan;
}

/**
 * Save an edit to one of my plans (N34 "Save changes"). The PUT carries the
 * revision the edit started from; edits made while it waits fold into it.
 */
export function savePlanCommand(
  deps: NutritionPlansCommandDeps,
  plan: NutritionPlan,
): NutritionPlan {
  const { storage, userId } = deps;
  const next = recomputePlan({ ...plan, updatedAt: nowIso(deps) });
  writeMine(storage, userId, (mine) =>
    mine.map((p) => (p.id === next.id ? next : p)),
  );
  const body = toPlanInput(next);

  // Still only on the phone: fold into the create.
  const create = unsentFor(storage, NUTRITION_PLAN_ENTITY, next.id).find(
    (e) => e.operation === "create" && e.method === "POST",
  );
  if (create) {
    storage.updateMutationPayload(create.id, body);
    return next;
  }

  const queuedPut = storage
    .getQueuedEntriesForEntity(NUTRITION_PLAN_ENTITY, next.id)
    .find(
      (e) =>
        e.method === "PUT" &&
        (e.status === "pending" || e.status === "failed") &&
        isAutoResolvableSyncEntry(e),
    );
  if (queuedPut) {
    const prev = parse(queuedPut.payload);
    const expectedRevision = prev?.expectedRevision;
    storage.updateMutationPayload(queuedPut.id, {
      ...body,
      ...(typeof expectedRevision === "number" ? { expectedRevision } : {}),
    });
    return next;
  }

  storage.enqueueMutation({
    entityType: NUTRITION_PLAN_ENTITY,
    entityId: next.id,
    operation: "update",
    payload: {
      ...body,
      // A plan created on this phone has no server revision yet.
      ...(next.revision > 0 ? { expectedRevision: next.revision } : {}),
    },
    endpoint: `${MEAL_PLANS_ENDPOINT}/${next.id}`,
    method: "PUT",
  });
  return next;
}

/** Delete (archive) one of my plans. Food already logged stays. */
export function deletePlanCommand(
  deps: NutritionPlansCommandDeps,
  planId: string,
): void {
  const { storage, userId } = deps;
  writeMine(storage, userId, (mine) => mine.filter((p) => p.id !== planId));
  removeFromShoppingCache(storage, userId, planId);

  // Never left the phone: forget it entirely.
  const unsent = unsentFor(storage, NUTRITION_PLAN_ENTITY, planId);
  const create = unsent.find((e) => e.operation === "create");
  if (create) {
    const shopping = storage
      .getQueuedEntriesForEntity(SHOPPING_LIST_PLAN_ENTITY, planId)
      .filter((e) => (e.dispatchCount ?? 0) === 0);
    storage.discardEntries([...unsent, ...shopping].map((e) => e.id));
    return;
  }
  // Pending edits are moot once it's deleted.
  const edits = unsent.filter((e) => e.method === "PUT");
  if (edits.length > 0) storage.discardEntries(edits.map((e) => e.id));
  storage.enqueueMutation({
    entityType: NUTRITION_PLAN_ENTITY,
    entityId: planId,
    operation: "delete",
    payload: {},
    endpoint: `${MEAL_PLANS_ENDPOINT}/${planId}`,
    method: "DELETE",
  });
}

/**
 * Duplicate a plan into my plans (mine, or a coach's: any client with the
 * assignment, Free included). The copy shows at once under a local id.
 */
export function duplicatePlanCommand(
  deps: NutritionPlansCommandDeps,
  source: NutritionPlan,
): NutritionPlan {
  const { storage, userId } = deps;
  const id = `local-${deps.idFactory()}`;
  const now = nowIso(deps);
  const copy: NutritionPlan = {
    ...source,
    id,
    ownerId: userId,
    source: "duplicate",
    sourcePlanId: source.id,
    revision: 0,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
    meals: source.meals.map((m) => ({
      ...m,
      id: `local-${deps.idFactory()}`,
      items: m.items.map((it) => ({ ...it, id: `local-${deps.idFactory()}` })),
    })),
  };
  writeMine(storage, userId, (mine) => [...mine, copy]);
  storage.enqueueMutation({
    entityType: NUTRITION_PLAN_ENTITY,
    entityId: id,
    operation: "create",
    payload: {},
    endpoint: `${MEAL_PLANS_ENDPOINT}/${source.id}/duplicate`,
    method: "POST",
  });
  return copy;
}

// -- From coaches: Add to my plans, Not now, seen --------------------------------

function patchCoachPlan(
  storage: StoragePort,
  userId: string,
  planId: string,
  patch: (
    c: NutritionPlansCache["fromCoaches"][number],
  ) => Partial<NutritionPlansCache["fromCoaches"][number]>,
): void {
  const cache = readPlansCache(storage, userId);
  storage.cacheNutritionPlans(userId, {
    ...cache,
    fromCoaches: cache.fromCoaches.map((c) =>
      c.plan.id === planId ? { ...c, ...patch(c) } : c,
    ),
  });
}

function queueAssignment(
  storage: StoragePort,
  planId: string,
  body: { status?: "added" | "dismissed"; seenRevision?: number },
): void {
  const queued = unsentFor(
    storage,
    NUTRITION_PLAN_ASSIGNMENT_ENTITY,
    planId,
  )[0];
  if (queued) {
    storage.updateMutationPayload(queued.id, {
      ...(parse(queued.payload) ?? {}),
      ...body,
    });
    return;
  }
  storage.enqueueMutation({
    entityType: NUTRITION_PLAN_ASSIGNMENT_ENTITY,
    entityId: planId,
    operation: "update",
    payload: body,
    endpoint: `${MEAL_PLANS_ENDPOINT}/${planId}/assignment`,
    method: "POST",
  });
}

/** "Add to my plans" (true) or "Not now" (false) on a plan from a coach. */
export function answerCoachPlanCommand(
  deps: NutritionPlansCommandDeps,
  planId: string,
  add: boolean,
): void {
  const status: PlanAssignmentStatus = add ? "added" : "dismissed";
  const now = nowIso(deps);
  patchCoachPlan(deps.storage, deps.userId, planId, (c) => ({
    status,
    addedAt: add ? (c.addedAt ?? now) : c.addedAt,
  }));
  queueAssignment(deps.storage, planId, { status });
}

/** Opening a coach plan clears its "updated" marker. No-op when not marked. */
export function markCoachPlanSeenCommand(
  deps: NutritionPlansCommandDeps,
  planId: string,
): void {
  const cache = readPlansCache(deps.storage, deps.userId);
  const entry = cache.fromCoaches.find((c) => c.plan.id === planId);
  if (!entry || !entry.updatedSinceSeen) return;
  patchCoachPlan(deps.storage, deps.userId, planId, () => ({
    updatedSinceSeen: false,
  }));
  queueAssignment(deps.storage, planId, {
    seenRevision: entry.plan.revision,
  });
}

/** Forget the "updated elsewhere" note once shown. */
export function clearPlanConflictCommand(
  storage: StoragePort,
  userId: string,
  planId: string,
): void {
  const cache = readPlansCache(storage, userId);
  if (!cache.conflictPlanIds.includes(planId)) return;
  storage.cacheNutritionPlans(userId, {
    ...cache,
    conflictPlanIds: cache.conflictPlanIds.filter((id) => id !== planId),
  });
}

// -- Adding to today ---------------------------------------------------------------

/**
 * Add one plan meal (or, with `mealId` null, the whole plan) to the day.
 * Each item becomes its own queued food log with its own key, so the drain
 * batches them and a replay never duplicates. Works offline.
 */
export function addPlanToDayCommand(
  deps: NutritionPlansCommandDeps,
  plan: NutritionPlan,
  mealId: string | null,
  userMeals: readonly UserMeal[],
  loggedAt: string,
): NutritionEntry[] {
  const meal = mealId ? plan.meals.find((m) => m.id === mealId) : null;
  if (mealId && !meal) return [];
  const inputs = meal
    ? logInputsForPlanMeal(plan, meal, userMeals, loggedAt)
    : logInputsForPlan(plan, userMeals, loggedAt);
  return inputs.map((input) =>
    logEntryCommand(
      { storage: deps.storage, userId: deps.userId, idFactory: deps.idFactory },
      input,
    ),
  );
}

// -- Shopping list -------------------------------------------------------------------

export function readShoppingCache(
  storage: StoragePort,
  userId: string,
): PlansShoppingCache {
  return storage.getCachedPlansShopping(userId) ?? { list: null, ticked: [] };
}

function removeFromShoppingCache(
  storage: StoragePort,
  userId: string,
  planId: string,
): void {
  const cache = storage.getCachedPlansShopping(userId);
  if (!cache?.list) return;
  storage.cachePlansShopping(userId, {
    ...cache,
    list: {
      ...cache.list,
      plans: cache.list.plans.filter((p) => p.nutritionPlanId !== planId),
    },
  });
}

/**
 * Add a plan to the shopping list (or take it off). The plan chip shows at
 * once; the aisles update when the list is next read online.
 */
export function setPlanInShoppingListCommand(
  deps: NutritionPlansCommandDeps,
  planId: string,
  include: boolean,
): void {
  const { storage, userId } = deps;
  const cache = readShoppingCache(storage, userId);
  const list: PlansShoppingList = cache.list ?? {
    aisles: [],
    totalItems: 0,
    plans: [],
    asOf: nowIso(deps),
  };
  const has = list.plans.some((p) => p.nutritionPlanId === planId);
  if (has === include) return;
  storage.cachePlansShopping(userId, {
    ...cache,
    list: {
      ...list,
      plans: include
        ? [
            ...list.plans,
            {
              nutritionPlanId: planId,
              mealPlanId: null,
              addedAt: nowIso(deps),
            },
          ]
        : list.plans.filter((p) => p.nutritionPlanId !== planId),
    },
  });

  // An unsent opposite change cancels out.
  const opposite = unsentFor(storage, SHOPPING_LIST_PLAN_ENTITY, planId).filter(
    (e) => e.method === (include ? "DELETE" : "POST"),
  );
  if (opposite.length > 0) {
    storage.discardEntries(opposite.map((e) => e.id));
    return;
  }
  storage.enqueueMutation(
    include
      ? {
          entityType: SHOPPING_LIST_PLAN_ENTITY,
          entityId: planId,
          operation: "create",
          payload: { nutritionPlanId: planId },
          endpoint: SHOPPING_LIST_PLANS_ENDPOINT,
          method: "POST",
        }
      : {
          entityType: SHOPPING_LIST_PLAN_ENTITY,
          entityId: planId,
          operation: "delete",
          payload: {},
          endpoint: `${SHOPPING_LIST_PLANS_ENDPOINT}/${planId}`,
          method: "DELETE",
        },
  );
}

/** Tick or untick an item. Stays on the phone (N23). */
export function toggleShoppingTickCommand(
  storage: StoragePort,
  userId: string,
  itemId: string,
): void {
  const cache = readShoppingCache(storage, userId);
  const ticked = cache.ticked.includes(itemId)
    ? cache.ticked.filter((id) => id !== itemId)
    : [...cache.ticked, itemId];
  storage.cachePlansShopping(userId, { ...cache, ticked });
}

/** A fresh list from the server keeps this phone's ticks. */
export function applyShoppingListRead(
  storage: StoragePort,
  userId: string,
  list: PlansShoppingList,
): PlansShoppingCache {
  const cache = readShoppingCache(storage, userId);
  // Plan chips changed on the phone but not yet sent stay as the phone has them.
  const pending = storage
    .getUncompletedMutations()
    .filter(
      (e) =>
        e.entityType === SHOPPING_LIST_PLAN_ENTITY &&
        isAutoResolvableSyncEntry(e),
    );
  let plans = list.plans;
  for (const e of pending) {
    const id = e.entityId;
    if (!id) continue;
    if (e.method === "POST" && !plans.some((p) => p.nutritionPlanId === id)) {
      plans = [
        ...plans,
        { nutritionPlanId: id, mealPlanId: null, addedAt: e.createdAt },
      ];
    }
    if (e.method === "DELETE") {
      plans = plans.filter((p) => p.nutritionPlanId !== id);
    }
  }
  const next = { list: { ...list, plans }, ticked: cache.ticked };
  storage.cachePlansShopping(userId, next);
  return next;
}

// -- Sync replies ---------------------------------------------------------------------

function isPlanDto(v: unknown): v is NutritionPlan {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.revision === "number" &&
    Array.isArray(p.meals)
  );
}

/**
 * A plan create, duplicate or edit synced: swap a local id for the server's,
 * adopt the server's copy (new revision, server item ids) unless a newer edit
 * is still queued, and move later queued edits onto the new revision.
 */
export function applyNutritionPlanSynced(
  storage: StoragePort,
  entry: SyncQueueEntry,
  responseBody: unknown,
): void {
  const data = (responseBody as { data?: unknown } | null)?.data;
  if (!isPlanDto(data)) return;
  const localId = entry.entityId;
  if (localId && localId !== data.id && localId.startsWith("local-")) {
    storage.swapLocalNutritionPlanId(localId, data.id);
  }
  const userId = data.ownerId;
  const laterEdits = storage
    .getQueuedEntriesForEntity(NUTRITION_PLAN_ENTITY, data.id)
    .filter((e) => e.id !== entry.id && e.method === "PUT");
  for (const e of laterEdits) {
    const body = parse(e.payload);
    if (body && e.status !== "in_flight") {
      storage.replaceInactiveMutationPayload(e.id, {
        ...body,
        expectedRevision: data.revision,
      });
    }
  }
  if (laterEdits.length > 0) return;
  const cache = storage.getCachedNutritionPlans(userId);
  if (!cache) return;
  const has = cache.mine.some((p) => p.id === data.id);
  storage.cacheNutritionPlans(userId, {
    ...cache,
    mine: has
      ? cache.mine.map((p) => (p.id === data.id ? data : p))
      : [...cache.mine, data],
  });
}

/** The same plan content, ignoring ids (a replay of our own write). */
function samePlanContent(a: unknown, b: NutritionPlan): boolean {
  const pick = (v: unknown) => {
    const o = (v ?? {}) as Record<string, unknown>;
    return JSON.stringify({ name: o.name, meals: o.meals });
  };
  return pick(a) === pick(toPlanInput(b));
}

/**
 * A queued edit answered 409: the plan changed on another device. Keep the
 * server's copy, flag it for the Plan screen, and drop the edit. When the
 * server's copy already IS this edit (a replay after a lost reply), the
 * edit simply succeeded.
 *
 * Returns true when it handled the reply.
 */
export function applyNutritionPlanConflict(
  storage: StoragePort,
  entry: SyncQueueEntry,
  status: number,
  bodyText: string,
): boolean {
  if (entry.entityType !== NUTRITION_PLAN_ENTITY || entry.method !== "PUT")
    return false;
  if (status !== 409) return false;
  let current: unknown;
  try {
    current = (JSON.parse(bodyText) as { current?: unknown }).current;
  } catch {
    return false;
  }
  if (!isPlanDto(current)) return false;
  const userId = current.ownerId;
  const cache = readPlansCache(storage, userId);
  const replay = samePlanContent(parse(entry.payload), current);
  storage.cacheNutritionPlans(userId, {
    ...cache,
    mine: cache.mine.some((p) => p.id === current.id)
      ? cache.mine.map((p) => (p.id === current.id ? current : p))
      : [...cache.mine, current],
    conflictPlanIds:
      replay || cache.conflictPlanIds.includes(current.id)
        ? cache.conflictPlanIds
        : [...cache.conflictPlanIds, current.id],
  });
  return true;
}
