import { renderHook } from "@testing-library/react-native";
import {
  generateMockHistory,
  useStableMockHistory,
} from "@/ui/hooks/useStableMockHistory";

describe("useStableMockHistory", () => {
  it("returns an empty array when value is null", () => {
    const { result } = renderHook(() => useStableMockHistory(null));
    expect(result.current).toEqual([]);
  });

  it("returns `days` entries when value is non-null", () => {
    const { result } = renderHook(() => useStableMockHistory(78.2, 7));
    expect(result.current).toHaveLength(7);
    for (const pt of result.current) {
      expect(pt.value).toBeGreaterThan(78.2 * 0.9);
      expect(pt.value).toBeLessThan(78.2 * 1.1);
    }
  });

  it("preserves array identity across re-renders for the same value", () => {
    // Regression for bugbot finding on PR #37: Math.random() inside
    // useMemo broke memoization — any unrelated dep change re-rolled
    // the history. This hook wraps the random generation in a ref so
    // the array reference is stable until `value` actually changes.
    const { result, rerender } = renderHook(
      (props: { v: number | null }) => useStableMockHistory(props.v),
      { initialProps: { v: 78.2 } },
    );
    const first = result.current;
    rerender({ v: 78.2 });
    rerender({ v: 78.2 });
    rerender({ v: 78.2 });
    expect(result.current).toBe(first); // reference equality, not deep equal
  });

  it("regenerates when value changes", () => {
    const { result, rerender } = renderHook(
      (props: { v: number | null }) => useStableMockHistory(props.v),
      { initialProps: { v: 78.2 } },
    );
    const first = result.current;
    rerender({ v: 79.0 });
    expect(result.current).not.toBe(first);
    expect(result.current[0].value).toBeGreaterThan(79.0 * 0.9);
  });

  it("regenerates when `days` changes even if value is unchanged", () => {
    const { result, rerender } = renderHook(
      (props: { v: number; days: number }) =>
        useStableMockHistory(props.v, props.days),
      { initialProps: { v: 78.2, days: 7 } },
    );
    const first = result.current;
    expect(first).toHaveLength(7);
    rerender({ v: 78.2, days: 14 });
    expect(result.current).not.toBe(first);
    expect(result.current).toHaveLength(14);
  });

  it("handles the null → value transition by generating fresh history", () => {
    const { result, rerender } = renderHook(
      (props: { v: number | null }) => useStableMockHistory(props.v),
      { initialProps: { v: null as number | null } },
    );
    expect(result.current).toEqual([]);
    rerender({ v: 72.5 });
    expect(result.current).toHaveLength(7);
  });

  it("handles the value → null transition by returning empty history", () => {
    const { result, rerender } = renderHook(
      (props: { v: number | null }) => useStableMockHistory(props.v),
      { initialProps: { v: 72.5 as number | null } },
    );
    expect(result.current).toHaveLength(7);
    rerender({ v: null });
    expect(result.current).toEqual([]);
  });
});

describe("generateMockHistory (raw helper)", () => {
  it("returns empty array for null", () => {
    expect(generateMockHistory(null)).toEqual([]);
  });

  it("returns `days` entries in chronological order (earliest first)", () => {
    const pts = generateMockHistory(100, 3);
    expect(pts).toHaveLength(3);
    expect(pts[0].date.getTime()).toBeLessThan(pts[1].date.getTime());
    expect(pts[1].date.getTime()).toBeLessThan(pts[2].date.getTime());
  });

  it("stays within ±5% of the current value", () => {
    const value = 200;
    const pts = generateMockHistory(value, 30);
    for (const pt of pts) {
      expect(pt.value).toBeGreaterThanOrEqual(value * 0.95);
      expect(pt.value).toBeLessThanOrEqual(value * 1.05);
    }
  });
});
