/**
 * Habit configure / disable commands — offline-capable (18-habit-setup, Phase
 * 18.7 — T-18.7.3). Mirrors `toggleHabitDayCommand`: an optimistic cache write
 * + a queued mutation, no direct network call; the setup screen re-reads the
 * cache and the server reconciles on the next drain (server wins).
 *
 * Edit-timing semantics match the backend (design.md § 4.4, locked decision 12):
 *  - FIRST enable → write the LIVE config with `effectiveFrom = next Monday`.
 *    The habit is loggable now (appears on the grid) but joins the collection
 *    streak from next Monday.
 *  - Edit to an already-active habit (incl. disable) → write the PENDING config
 *    locally (`pending.from = next Monday`), leaving the live row untouched so
 *    the in-progress week keeps its bar. The UI reads `pending` to show the new
 *    value + "Starts Monday".
 *
 * A habit configured offline for a category with no server goal yet gets a
 * `local-…` goalId; the drain swaps it for the server id and the config cache
 * de-dupes on `category` (STORY-009 AC 9.3).
 */

import type { StoragePort } from "@/domain/ports/storage.port";
import type { ConfigureHabitInput } from "@/domain/ports/api.port";
import {
  HABIT_CATEGORY_META,
  type HabitCategory,
  type HabitConfig,
} from "@/domain/models/habit-config";

export type ConfigureHabitCommandDeps = {
  storage: StoragePort;
  userId: string;
  /** Stable id for a first-enable's optimistic `local-…` goal row. */
  idFactory: () => string;
  /** Injectable clock for deterministic tests (defaults to now). */
  now?: () => Date;
};

export type ConfigureHabitCommandInput = {
  category: HabitCategory;
  targetValue: number;
  daysPerWeek?: number;
  tolerancePct?: number;
};

/** Monday (YYYY-MM-DD) that starts the NEXT week from `now` (user-local). */
export function nextMondayISO(now: Date): string {
  // now.getDay(): 0=Sun..6=Sat. Days until the upcoming Monday (never 0).
  const dow = now.getDay();
  const daysToNextMonday = (8 - dow) % 7 || 7;
  const d = new Date(now);
  d.setDate(d.getDate() + daysToNextMonday);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/** The wire body sent to PUT .../habits/:category/config. */
function toWireBody(input: ConfigureHabitCommandInput): ConfigureHabitInput {
  const meta = HABIT_CATEGORY_META[input.category];
  const body: ConfigureHabitInput = { targetValue: input.targetValue };
  if (meta.freq) body.daysPerWeek = input.daysPerWeek ?? meta.freq.default;
  if (meta.leniency)
    body.tolerancePct = input.tolerancePct ?? meta.leniency.default;
  return body;
}

/**
 * Enable + configure a habit. Optimistic + enqueue + invalidateHome.
 *
 * @param clientId  When set, the write is on a client's behalf (coach mode) —
 *                  routes to the trainer endpoint. Omit for a self write.
 */
export function configureHabitCommand(
  deps: ConfigureHabitCommandDeps,
  input: ConfigureHabitCommandInput,
  clientId?: string,
): void {
  const { storage, userId } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const monday = nextMondayISO(now);
  const meta = HABIT_CATEGORY_META[input.category];

  // For a SELF write we mirror the config into the local cache (offline-first).
  // A coach write targets the CLIENT's data, which the coach device doesn't
  // cache as its own — skip the local mirror there and just enqueue.
  if (!clientId) {
    const existing = storage
      .getHabitConfigs(userId)
      .find((c) => c.category === input.category);
    const daysPerWeek = meta.freq
      ? (input.daysPerWeek ?? existing?.daysPerWeek ?? meta.freq.default)
      : null;
    const tolerancePct = meta.leniency
      ? (input.tolerancePct ?? existing?.tolerancePct ?? meta.leniency.default)
      : null;

    const isFreshEnable = !existing || !existing.enabled;

    if (isFreshEnable) {
      // First enable → live config, effective next Monday; loggable now.
      const goalId = existing?.goalId ?? `local-${deps.idFactory()}`;
      const next: HabitConfig = {
        category: input.category,
        enabled: true,
        goalId,
        assignedByCoach: existing?.assignedByCoach ?? false,
        locked: existing?.locked ?? false,
        targetValue: input.targetValue,
        unit: existing?.unit ?? meta.unit,
        period: meta.period,
        completionRule: meta.completionRule,
        daysPerWeek,
        tolerancePct,
        effectiveFrom: monday,
        pending: null,
      };
      storage.upsertHabitConfig(userId, next);
    } else {
      // Edit to an already-active habit → queue the PENDING config; leave the
      // live row (and this week's bar) untouched.
      const next: HabitConfig = {
        ...existing,
        pending: {
          from: monday,
          targetValue: input.targetValue,
          daysPerWeek,
          tolerancePct,
        },
      };
      storage.upsertHabitConfig(userId, next);
    }
  }

  const endpoint = clientId
    ? `/trainers/me/clients/${encodeURIComponent(clientId)}/habits/${encodeURIComponent(
        input.category,
      )}/config`
    : `/users/me/habits/${encodeURIComponent(input.category)}/config`;

  storage.enqueueMutation({
    entityType: "habit_config",
    entityId: clientId
      ? `${clientId}:${input.category}`
      : `${userId}:${input.category}`,
    operation: "update",
    payload: toWireBody(input),
    endpoint,
    method: "PUT",
  });

  storage.invalidateHome(userId);
}

export type DisableHabitCommandDeps = {
  storage: StoragePort;
  userId: string;
  now?: () => Date;
};

/**
 * Disable a habit. Optimistic + enqueue + invalidateHome. The disable is
 * DEFERRED server-side to next Monday (disable-to-dodge guard, AC 8.2), so the
 * optimistic write queues a PENDING `{ enabled: false }` locally rather than
 * dropping the row — the card stays enabled with a "Starts Monday" tag and the
 * offline streak keeps scoring the habit until the boundary.
 */
export function disableHabitCommand(
  deps: DisableHabitCommandDeps,
  category: HabitCategory,
  clientId?: string,
): void {
  const { storage, userId } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const monday = nextMondayISO(now);

  if (!clientId) {
    const existing = storage
      .getHabitConfigs(userId)
      .find((c) => c.category === category);
    if (existing && existing.enabled) {
      storage.upsertHabitConfig(userId, {
        ...existing,
        pending: { from: monday, enabled: false },
      });
    }
  }

  const endpoint = clientId
    ? `/trainers/me/clients/${encodeURIComponent(clientId)}/habits/${encodeURIComponent(
        category,
      )}`
    : `/users/me/habits/${encodeURIComponent(category)}`;

  storage.enqueueMutation({
    entityType: "habit_config",
    entityId: clientId ? `${clientId}:${category}` : `${userId}:${category}`,
    operation: "delete",
    payload: { category },
    endpoint,
    method: "DELETE",
  });

  storage.invalidateHome(userId);
}
