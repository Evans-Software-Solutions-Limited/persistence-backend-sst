/**
 * Your meals (PER-132, Design D N1b) — offline-first writes.
 *
 * The list is cached optimistically and sent as one `PUT /nutrition/user-meals`
 * (a full replace, last write wins). Repeated edits while the PUT is still
 * queued fold into that one row, so the queue holds at most one list.
 *
 * A meal added offline gets a `local-…` id and a `clientRequestId`; the PUT
 * sends only the key, the server answers with its uuid, and the drain swaps
 * the id everywhere (`swapLocalUserMealId`). Entries logged into the new meal
 * meanwhile wait in the queue (a `local-…` reference defers, never fails).
 */
import type { StoragePort } from "@/domain/ports/storage.port";
import type { UserMeal } from "@/domain/models/userMeals";
import {
  activeUserMeals,
  isSyntheticUserMealId,
  toUserMealsPutBody,
} from "@/domain/services/userMeals.service";

export const USER_MEALS_ENTITY = "user_meals";
export const USER_MEALS_ENDPOINT = "/nutrition/user-meals";

export type UserMealsCommandDeps = {
  storage: StoragePort;
  userId: string;
};

/**
 * Save the whole list (after a rename, reorder or add). Returns the list as
 * cached. Refuses a list of synthetic placeholders: those exist only before
 * the real list has been fetched, and sending them would create copies of
 * the server's seeded defaults.
 */
export function saveUserMealsCommand(
  deps: UserMealsCommandDeps,
  meals: readonly UserMeal[],
): UserMeal[] | null {
  const { storage, userId } = deps;
  const next = activeUserMeals(meals).map((m, i) =>
    m.sortOrder === i ? m : { ...m, sortOrder: i },
  );
  if (next.length === 0 || next.some((m) => isSyntheticUserMealId(m.id))) {
    return null;
  }
  storage.cacheUserMeals(userId, next);

  const payload = toUserMealsPutBody(next);
  const queued = storage
    .getPendingMutations()
    .find((e) => e.entityType === USER_MEALS_ENTITY && e.entityId === userId);
  if (queued) {
    // Safe even if an earlier attempt was dispatched: the server matches each
    // meal by id or clientRequestId, not by the request's Idempotency-Key.
    storage.updateMutationPayload(queued.id, payload);
  } else {
    storage.enqueueMutation({
      entityType: USER_MEALS_ENTITY,
      entityId: userId,
      operation: "update",
      payload,
      endpoint: USER_MEALS_ENDPOINT,
      method: "PUT",
    });
  }
  return next;
}

/**
 * Apply a synced PUT's answer: swap each offline meal's `local-…` id for the
 * server's (matched by `clientRequestId`), then — unless a newer edit is still
 * queued — adopt the server's list as the cache.
 */
export function applyUserMealsResponse(
  storage: StoragePort,
  userId: string,
  serverMeals: readonly UserMeal[],
): void {
  // Swap from the server's reply, not the cache: a stale GET may already have
  // replaced the cached list, but queued entries still carry `local-<key>`.
  for (const m of serverMeals) {
    if (m.clientRequestId) {
      storage.swapLocalUserMealId(`local-${m.clientRequestId}`, m.id);
    }
  }
  const laterEditQueued = storage
    .getPendingMutations()
    .some((e) => e.entityType === USER_MEALS_ENTITY && e.entityId === userId);
  if (!laterEditQueued) storage.cacheUserMeals(userId, [...serverMeals]);
}
