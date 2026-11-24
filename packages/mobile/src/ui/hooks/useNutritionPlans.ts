import { useCallback, useMemo, useRef } from "react";
import { getApiBaseUrl } from "@/adapters/api";
import {
  NUTRITION_PLAN_TABLES,
  PLANS_SHOPPING_TABLES,
} from "@/adapters/storage/tables";
import { localIdFactory } from "@/application/commands/localId";
import {
  NUTRITION_PLAN_ASSIGNMENT_ENTITY,
  NUTRITION_PLAN_ENTITY,
  addPlanToDayCommand,
  answerCoachPlanCommand,
  applyShoppingListRead,
  clearPlanConflictCommand,
  createPlanCommand,
  deletePlanCommand,
  duplicatePlanCommand,
  livePlanEdits,
  markCoachPlanSeenCommand,
  readShoppingCache,
  savePlanCommand,
  setPlanInShoppingListCommand,
  toggleShoppingTickCommand,
  type NutritionPlansCommandDeps,
} from "@/application/commands/nutritionPlans.command";
import { processSyncQueue } from "@/application/commands/sync.command";
import type { NutritionEntry } from "@/domain/models/nutrition";
import type {
  NutritionPlan,
  NutritionPlansCache,
  PlansShoppingCache,
} from "@/domain/models/nutritionPlans";
import { emptyPlansCache } from "@/domain/models/nutritionPlans";
import type { UserMeal } from "@/domain/models/userMeals";
import type { StoragePort } from "@/domain/ports/storage.port";
import {
  mergePlansResponse,
  overlayLocalPlans,
} from "@/domain/services/nutritionPlans.service";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";
import { useCachedResource } from "./useCachedResource";

/**
 * Meal plans (PER-133) — mine and from coaches, cache-first.
 *
 * Online, each refresh asks only for what changed since the last read
 * (`?since=`), so a coach's edit reaches the phone on the next refresh. A
 * plan with a live queued write keeps its local version until it syncs.
 */

function liveIds(storage: StoragePort): {
  plans: Set<string>;
  assignments: Set<string>;
} {
  const plans = new Set<string>();
  const assignments = new Set<string>();
  for (const e of livePlanEdits(storage)) {
    if (!e.entityId) continue;
    if (e.entityType === NUTRITION_PLAN_ENTITY) plans.add(e.entityId);
    if (e.entityType === NUTRITION_PLAN_ASSIGNMENT_ENTITY)
      assignments.add(e.entityId);
  }
  return { plans, assignments };
}

/** Apply a server read over the cache, keeping queued local intent. */
export function reconcilePlansRead(
  storage: StoragePort,
  userId: string,
  server: NutritionPlansCache,
): NutritionPlansCache {
  const local = storage.getCachedNutritionPlans(userId);
  const { plans, assignments } = liveIds(storage);
  return overlayLocalPlans(server, local, plans, assignments);
}

export type NutritionPlansState = {
  cache: NutritionPlansCache;
  /** True until the plans have been read once on this phone. */
  isLoading: boolean;
  isRefreshing: boolean;
  hasError: boolean;
  refresh: () => Promise<boolean>;
  reload: () => void;
  create: (draft: NutritionPlan) => Promise<NutritionPlan | null>;
  save: (plan: NutritionPlan) => Promise<NutritionPlan | null>;
  remove: (planId: string) => Promise<void>;
  duplicate: (plan: NutritionPlan) => Promise<NutritionPlan | null>;
  answerCoachPlan: (planId: string, add: boolean) => Promise<void>;
  markSeen: (planId: string) => Promise<void>;
  clearConflict: (planId: string) => void;
  addToDay: (
    plan: NutritionPlan,
    mealId: string | null,
    userMeals: readonly UserMeal[],
    loggedAt: string,
  ) => Promise<NutritionEntry[]>;
};

export function useNutritionPlans(enabled = true): NutritionPlansState {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const resource = useCachedResource<NutritionPlansCache>({
    read: (s, uid) => ({
      value: s.getCachedNutritionPlans(uid),
      isStale: true,
    }),
    fetcher: async (api) => {
      const since = userId
        ? (storage.getCachedNutritionPlans(userId)?.asOf ?? null)
        : null;
      const result = await api.getNutritionPlans(since);
      if (!result.ok) return result;
      const current = userId ? storage.getCachedNutritionPlans(userId) : null;
      return {
        ok: true,
        value: mergePlansResponse(current, result.value, since !== null),
      };
    },
    reconcile: reconcilePlansRead,
    preserveConcurrentCacheWrites: true,
    pendingWrites: (s) => livePlanEdits(s),
    write: (s, uid, value) => s.cacheNutritionPlans(uid, value),
    tables: NUTRITION_PLAN_TABLES,
    enabled,
  });

  const { reload, refresh } = resource;
  const deps = useMemo<NutritionPlansCommandDeps | null>(
    () => (userId ? { storage, userId, idFactory: localIdFactory } : null),
    [storage, userId],
  );

  const drain = useCallback(async () => {
    reload();
    try {
      await processSyncQueue(storage, auth, getApiBaseUrl());
    } catch (err) {
      console.error("[useNutritionPlans] queue flush failed:", err);
    }
    reload();
  }, [auth, storage, reload]);

  const create = useCallback(
    async (draft: NutritionPlan) => {
      if (!deps) return null;
      const plan = createPlanCommand(deps, draft);
      await drain();
      return plan;
    },
    [deps, drain],
  );
  const save = useCallback(
    async (plan: NutritionPlan) => {
      if (!deps) return null;
      const next = savePlanCommand(deps, plan);
      await drain();
      return next;
    },
    [deps, drain],
  );
  const remove = useCallback(
    async (planId: string) => {
      if (!deps) return;
      deletePlanCommand(deps, planId);
      await drain();
    },
    [deps, drain],
  );
  const duplicate = useCallback(
    async (plan: NutritionPlan) => {
      if (!deps) return null;
      const copy = duplicatePlanCommand(deps, plan);
      await drain();
      return copy;
    },
    [deps, drain],
  );
  const answerCoachPlan = useCallback(
    async (planId: string, add: boolean) => {
      if (!deps) return;
      answerCoachPlanCommand(deps, planId, add);
      await drain();
    },
    [deps, drain],
  );
  const markSeen = useCallback(
    async (planId: string) => {
      if (!deps) return;
      markCoachPlanSeenCommand(deps, planId);
      await drain();
    },
    [deps, drain],
  );
  const clearConflict = useCallback(
    (planId: string) => {
      if (!userId) return;
      clearPlanConflictCommand(storage, userId, planId);
      reload();
    },
    [storage, userId, reload],
  );
  const addToDay = useCallback(
    async (
      plan: NutritionPlan,
      mealId: string | null,
      userMeals: readonly UserMeal[],
      loggedAt: string,
    ) => {
      if (!deps) return [];
      const entries = addPlanToDayCommand(
        deps,
        plan,
        mealId,
        userMeals,
        loggedAt,
      );
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[useNutritionPlans] queue flush failed:", err);
      }
      return entries;
    },
    [auth, deps, storage],
  );

  return {
    cache: resource.data ?? emptyPlansCache(),
    isLoading: resource.data === null && resource.error === null,
    isRefreshing: resource.isRefreshing,
    hasError: resource.error !== null,
    refresh,
    reload,
    create,
    save,
    remove,
    duplicate,
    answerCoachPlan,
    markSeen,
    clearConflict,
    addToDay,
  };
}

/** Follow-up reads after a plan is added or removed (1.5s apart). */
const SHOPPING_REREAD_ATTEMPTS = 8;
const SHOPPING_REREAD_MS = 1500;

export type PlansShoppingState = {
  value: PlansShoppingCache;
  isLoading: boolean;
  isRefreshing: boolean;
  hasError: boolean;
  refresh: () => Promise<boolean>;
  toggleTick: (itemId: string) => void;
  setPlanIncluded: (planId: string, include: boolean) => Promise<void>;
};

/**
 * The shopping list across every added plan (N23). The list is read online
 * and cached; ticks stay on the phone.
 */
export function usePlansShoppingList(enabled = true): PlansShoppingState {
  const { auth, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const plansChangedDuringRead = useRef(false);
  const resource = useCachedResource<PlansShoppingCache>({
    read: (s, uid) => ({ value: s.getCachedPlansShopping(uid), isStale: true }),
    fetcher: async (api) => {
      // A plan added or removed while this read is out beats the read's older
      // plan list; ticks never count (they stay on the phone either way).
      // Inspector Brad, #554.
      const plansKey = () =>
        JSON.stringify(
          userId
            ? (readShoppingCache(storage, userId).list?.plans ?? null)
            : null,
        );
      const before = plansKey();
      plansChangedDuringRead.current = false;
      const result = await api.getPlansShoppingList();
      if (!result.ok) return result;
      const local = userId ? readShoppingCache(storage, userId) : null;
      const changed = plansKey() !== before && local?.list;
      plansChangedDuringRead.current = Boolean(changed);
      return {
        ok: true,
        value: {
          list: changed
            ? { ...result.value, plans: local.list!.plans }
            : result.value,
          ticked: local?.ticked ?? [],
        },
      };
    },
    // Plan chips changed on the phone but not yet sent stay; ticks stay.
    reconcile: (s, uid, value) =>
      value.list ? applyShoppingListRead(s, uid, value.list) : value,
    write: (s, uid, value) => s.cachePlansShopping(uid, value),
    tables: PLANS_SHOPPING_TABLES,
    enabled,
  });

  const { reload, refresh } = resource;
  const readUntilCurrent = useCallback(async () => {
    for (let attempt = 0; attempt < SHOPPING_REREAD_ATTEMPTS; attempt++) {
      const ran = await refresh({ silent: true });
      if (ran && !plansChangedDuringRead.current) return;
      await new Promise((r) => setTimeout(r, SHOPPING_REREAD_MS));
    }
  }, [refresh]);
  const toggleTick = useCallback(
    (itemId: string) => {
      if (!userId) return;
      toggleShoppingTickCommand(storage, userId, itemId);
      reload();
    },
    [storage, userId, reload],
  );
  const setPlanIncluded = useCallback(
    async (planId: string, include: boolean) => {
      if (!userId) return;
      setPlanInShoppingListCommand(
        { storage, userId, idFactory: localIdFactory },
        planId,
        include,
      );
      reload();
      try {
        await processSyncQueue(storage, auth, getApiBaseUrl());
      } catch (err) {
        console.error("[usePlansShoppingList] queue flush failed:", err);
      }
      // The aisles change server-side once the plan is in; read them again.
      // A read already out (or one that saw the plans change under it) can't
      // show them, so keep trying until a read runs clean (Inspector Brad, #554).
      void readUntilCurrent();
    },
    [auth, storage, userId, reload, readUntilCurrent],
  );

  return {
    value: resource.data ?? { list: null, ticked: [] },
    isLoading: resource.data === null && resource.error === null,
    isRefreshing: resource.isRefreshing,
    hasError: resource.error !== null,
    refresh,
    toggleTick,
    setPlanIncluded,
  };
}
