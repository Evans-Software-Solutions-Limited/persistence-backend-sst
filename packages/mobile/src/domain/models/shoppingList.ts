/**
 * Mealprint shopping list (spec-26 amendment 2026-08, § B — STORY-006).
 *
 * Client-side mirror of `GET /nutrition/plans/:id/shopping`. **Day-scoped**
 * (decision B.1): the backend derives this from a SINGLE accepted day plan —
 * exploding `meal_plan_meals` into foods and grouping by aisle — nothing is
 * stored server-side, and nothing is cached client-side either. The
 * check-off state this file's consumers layer on top is local-only
 * optimistic UI state (decision B.2), not synced back to the server this
 * slice.
 *
 * Wire shape is camelCase pass-through, same convention as
 * `domain/models/mealprint.ts`. Kept in its OWN file (not added to
 * `mealprint.ts`) — a separate track owns that file this slice.
 */

/** One line item within an aisle group. `id` is either a curated food's uuid
 * or `custom:<key>` for a free-text item the backend couldn't resolve to a
 * catalogue food — either way it's stable enough to key local checked-state
 * off of. */
export type ShoppingItem = {
  readonly id: string;
  readonly name: string;
  readonly quantity: string;
};

/** Aisle vocabulary + order per § B.2: `Meat & fish` → `Dairy & eggs` →
 * `Fruit & veg` → `Bakery` → `Cupboard` → `Other`. The backend already
 * pre-orders `aisles` and omits empty ones — this type does not re-derive
 * either property, it just carries what the wire sends. */
export type ShoppingAisle = {
  readonly aisle: string;
  readonly items: readonly ShoppingItem[];
};

export type ShoppingList = {
  readonly planId: string;
  readonly aisles: readonly ShoppingAisle[];
  readonly totalItems: number;
};

/**
 * Defensively normalise a `GET /nutrition/plans/:id/shopping` response body
 * (the already-unwrapped `data` envelope) into a {@link ShoppingList}. The
 * wire shape matches the type field-for-field, so this is mostly a runtime
 * shape guard — it never throws; anything missing/malformed degrades to an
 * empty list rather than crashing the screen.
 */
export function parseShoppingList(raw: unknown): ShoppingList {
  const body = (raw ?? {}) as Partial<ShoppingList>;
  const planId = typeof body.planId === "string" ? body.planId : "";
  const aisles: ShoppingAisle[] = Array.isArray(body.aisles)
    ? body.aisles.map((aisle) => parseShoppingAisle(aisle))
    : [];
  const derivedTotal = aisles.reduce((sum, a) => sum + a.items.length, 0);
  const totalItems =
    typeof body.totalItems === "number" ? body.totalItems : derivedTotal;
  return { planId, aisles, totalItems };
}

function parseShoppingAisle(raw: unknown): ShoppingAisle {
  const body = (raw ?? {}) as Partial<ShoppingAisle>;
  const aisle = typeof body.aisle === "string" ? body.aisle : "Other";
  const items: ShoppingItem[] = Array.isArray(body.items)
    ? body.items.map((item) => parseShoppingItem(item))
    : [];
  return { aisle, items };
}

function parseShoppingItem(raw: unknown): ShoppingItem {
  const body = (raw ?? {}) as Partial<ShoppingItem>;
  return {
    id: typeof body.id === "string" ? body.id : "",
    name: typeof body.name === "string" ? body.name : "",
    quantity: typeof body.quantity === "string" ? body.quantity : "",
  };
}

/** Every item across every aisle, in aisle order — the id set local
 * checked-state is keyed against and the source for {@link countChecked}. */
export function allShoppingItems(list: ShoppingList): readonly ShoppingItem[] {
  return list.aisles.flatMap((a) => a.items);
}

/** How many of `list`'s items are checked in `checked` — stale ids in
 * `checked` (e.g. left over from a previously viewed list) are NOT counted,
 * since they no longer name an item this list contains. */
export function countChecked(
  list: ShoppingList,
  checked: Readonly<Record<string, boolean>>,
): number {
  return allShoppingItems(list).filter((item) => checked[item.id]).length;
}
