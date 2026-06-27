import { renderHook } from "@testing-library/react-native";
import type { RefObject } from "react";
import type { ScrollView } from "react-native";
import { useScrollToTopOnTabPress } from "../useScrollToTopOnTabPress";

// `mock`-prefixed so jest's hoisted factory may reference them.
const mockAddListener = jest.fn();
const mockUnsubscribe = jest.fn();
jest.mock("expo-router", () => ({
  useNavigation: () => ({ addListener: mockAddListener }),
}));

const addListener = mockAddListener;
const unsubscribe = mockUnsubscribe;

beforeEach(() => {
  addListener.mockReset();
  unsubscribe.mockReset();
  addListener.mockReturnValue(unsubscribe);
});

function refWith(scrollTo: jest.Mock): RefObject<ScrollView | null> {
  return { current: { scrollTo } as unknown as ScrollView };
}

describe("useScrollToTopOnTabPress", () => {
  it("registers a tabPress listener and scrolls the ref to the top on press", () => {
    const scrollTo = jest.fn();
    renderHook(() => useScrollToTopOnTabPress(refWith(scrollTo)));

    expect(addListener).toHaveBeenCalledTimes(1);
    const [event, cb] = addListener.mock.calls[0];
    expect(event).toBe("tabPress");

    cb();
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });

  it("no-ops safely when the ref isn't attached yet", () => {
    const ref: RefObject<ScrollView | null> = { current: null };
    renderHook(() => useScrollToTopOnTabPress(ref));
    const cb = addListener.mock.calls[0][1];
    expect(() => cb()).not.toThrow();
  });

  it("unsubscribes on unmount", () => {
    const { unmount } = renderHook(() =>
      useScrollToTopOnTabPress(refWith(jest.fn())),
    );
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});
