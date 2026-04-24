import { useRef } from "react";

/**
 * Stable client-side mock-history generator for the M1 Home tiles.
 *
 * Legacy Home generated a 7-day random "trend" for body-weight / body-
 * fat tiles client-side, because the backend history endpoints aren't
 * built yet (they land in M4 Progress). We mirror that here so the
 * SimpleLineGraph has something to draw, but we CANNOT inline the
 * `Math.random()` calls inside a `useMemo` factory:
 *
 * 1. `useMemo` factories are meant to be pure. `Math.random()` isn't.
 * 2. Any unrelated dependency change (e.g. a `health.stepsToday` tick)
 *    re-runs the factory and generates a fresh random trend — the tile
 *    graphs visibly jump each time.
 * 3. React StrictMode double-invokes `useMemo` factories on mount; an
 *    impure factory produces mismatched results across the two calls.
 *
 * This hook caches the generated history on a `useRef`, keyed on the
 * input value. The history only regenerates when `value` genuinely
 * changes, never on unrelated re-renders. Returns a stable array
 * identity for consumers that depend on reference equality (memo
 * deps, React.memo props).
 *
 * Once M4 Progress ships real trend endpoints, replace every call
 * site with the real data and delete this hook.
 */
export type MockHistoryPoint = { date: Date; value: number };

export function useStableMockHistory(
  value: number | null,
  days: number = 7,
): MockHistoryPoint[] {
  const cacheRef = useRef<{
    key: number | null;
    days: number;
    history: MockHistoryPoint[];
  }>({ key: null, days, history: [] });

  if (cacheRef.current.key !== value || cacheRef.current.days !== days) {
    cacheRef.current = {
      key: value,
      days,
      history: generateMockHistory(value, days),
    };
  }

  return cacheRef.current.history;
}

/** Test-only: the raw generator. Prefer the hook in production code. */
export function generateMockHistory(
  currentValue: number | null,
  days: number = 7,
): MockHistoryPoint[] {
  if (currentValue === null) return [];
  const history: MockHistoryPoint[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const variation = (Math.random() - 0.5) * 0.1; // ±5% variation
    history.push({
      date,
      value: currentValue * (1 + variation),
    });
  }
  return history;
}
