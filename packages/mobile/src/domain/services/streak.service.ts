/**
 * Client-side streak derivation (06-progress-goals, Phase 06.7). Pure.
 *
 * When offline, the UI derives "current streak" from cached habit_completions
 * by walking back from today and counting consecutive satisfied periods. On
 * reconnect the server engine reconciles and the cache refreshes — **server
 * wins** (e.g. a freeze-token spend the client can't see). See
 * design.md § Offline behaviour.
 *
 * Day bucketing uses the calendar date portion of `completedAt` (YYYY-MM-DD),
 * matching how the SQLite cache stores `day`. A "grace" rule mirrors every
 * streak app: a period the user simply hasn't completed *yet today* doesn't
 * break a streak that was alive in the previous period — the walk starts one
 * period back when the current period has no completion.
 */

export type StreakDerivationPeriod = "daily" | "weekly";

export interface DeriveStreakCompletion {
  completedAt: string | Date;
}

/** YYYY-MM-DD (UTC calendar date) for an ISO string or Date. */
function toDayISO(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  return d.toISOString().slice(0, 10);
}

function addDays(dayISO: string, delta: number): string {
  const d = new Date(`${dayISO}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Monday (UTC) of the week containing `dayISO`. */
function weekStart(dayISO: string): string {
  const weekday = new Date(`${dayISO}T00:00:00.000Z`).getUTCDay(); // 0=Sun..6=Sat
  const sinceMonday = (weekday + 6) % 7;
  return addDays(dayISO, -sinceMonday);
}

/**
 * Count of consecutive satisfied periods ending at (or just before) `today`.
 *
 * - `daily`  → a period is a day satisfied by ≥1 completion that day.
 * - `weekly` → a period is a Mon–Sun week satisfied by ≥1 completion that week.
 *
 * Future-dated completions are ignored (the walk never moves forward). An empty
 * set, or a current-and-previous-period gap, yields 0.
 */
export function deriveStreak(
  completions: readonly DeriveStreakCompletion[],
  today: Date,
  period: StreakDerivationPeriod,
): number {
  if (completions.length === 0) return 0;

  const keyOf =
    period === "daily"
      ? (dayISO: string) => dayISO
      : (dayISO: string) => weekStart(dayISO);
  const step = period === "daily" ? 1 : 7;

  // Set of satisfied period keys.
  const satisfied = new Set<string>();
  for (const c of completions) satisfied.add(keyOf(toDayISO(c.completedAt)));

  const todayISO = toDayISO(today);
  let cursorKey = keyOf(todayISO);

  // Grace: if the current period has no completion yet, start the walk at the
  // previous period (a not-yet-done today shouldn't zero a live streak).
  if (!satisfied.has(cursorKey)) {
    cursorKey = keyOf(
      addDays(period === "daily" ? todayISO : cursorKey, -step),
    );
  }

  let count = 0;
  while (satisfied.has(cursorKey)) {
    count += 1;
    cursorKey = keyOf(addDays(cursorKey, -step));
  }
  return count;
}
