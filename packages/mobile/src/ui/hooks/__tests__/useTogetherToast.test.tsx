import { act, renderHook } from "@testing-library/react-native";
import { TOGETHER_TOAST_MS, useTogetherToast } from "../useTogetherToast";

describe("useTogetherToast", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("shows a line for 3.5 s; a newer one restarts the clock", () => {
    const { result, unmount } = renderHook(() => useTogetherToast());
    expect(result.current[0]).toBeNull();
    act(() => result.current[1]("first"));
    expect(result.current[0]).toBe("first");
    act(() => jest.advanceTimersByTime(TOGETHER_TOAST_MS - 1));
    act(() => result.current[1]("second"));
    act(() => jest.advanceTimersByTime(TOGETHER_TOAST_MS - 1));
    expect(result.current[0]).toBe("second");
    act(() => jest.advanceTimersByTime(1));
    expect(result.current[0]).toBeNull();
    act(() => result.current[1]("third"));
    unmount();
  });
});
