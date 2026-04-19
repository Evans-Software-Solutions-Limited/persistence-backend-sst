import { act, renderHook } from "@testing-library/react-native";
import { useDebouncedValue } from "../useDebouncedValue";

describe("useDebouncedValue", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns the initial value synchronously", () => {
    const { result } = renderHook(() => useDebouncedValue("hello", 300));
    expect(result.current).toBe("hello");
  });

  it("delays updates until the debounce window elapses", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "b" });
    expect(result.current).toBe("a");

    act(() => {
      jest.advanceTimersByTime(299);
    });
    expect(result.current).toBe("a");

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(result.current).toBe("b");
  });

  it("cancels pending updates when the value changes again", () => {
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedValue(value, 300),
      { initialProps: { value: "a" } },
    );

    rerender({ value: "b" });
    act(() => {
      jest.advanceTimersByTime(200);
    });
    rerender({ value: "c" });
    act(() => {
      jest.advanceTimersByTime(200);
    });
    // Total elapsed since "b" was 400ms, but the clock was reset by "c",
    // so the debounced value must still be "a".
    expect(result.current).toBe("a");

    act(() => {
      jest.advanceTimersByTime(100);
    });
    expect(result.current).toBe("c");
  });
});
