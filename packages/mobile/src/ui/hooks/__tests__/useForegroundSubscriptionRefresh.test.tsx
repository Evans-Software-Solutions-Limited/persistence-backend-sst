import { renderHook } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { useForegroundSubscriptionRefresh } from "../useForegroundSubscriptionRefresh";

const mockInvalidateQueries = jest.fn();
jest.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

describe("useForegroundSubscriptionRefresh", () => {
  let changeHandler: ((s: AppStateStatus) => void) | null = null;
  let removeSpy: jest.Mock;

  beforeEach(() => {
    mockInvalidateQueries.mockClear();
    changeHandler = null;
    removeSpy = jest.fn();
    jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation(
        (_event: string, handler: (s: AppStateStatus) => void) => {
          changeHandler = handler;
          return { remove: removeSpy } as never;
        },
      );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("invalidates the subscription query when the app returns to the foreground", () => {
    renderHook(() => useForegroundSubscriptionRefresh());
    expect(changeHandler).not.toBeNull();

    // Go to background first, then foreground → should invalidate once.
    changeHandler?.("background");
    expect(mockInvalidateQueries).not.toHaveBeenCalled();

    changeHandler?.("active");
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);
    expect(mockInvalidateQueries).toHaveBeenCalledWith({
      queryKey: ["user-subscription"],
    });
  });

  it("does not invalidate on active→active (no real foreground transition)", () => {
    renderHook(() => useForegroundSubscriptionRefresh());
    changeHandler?.("active");
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });

  it("removes the AppState listener on unmount", () => {
    const { unmount } = renderHook(() => useForegroundSubscriptionRefresh());
    unmount();
    expect(removeSpy).toHaveBeenCalledTimes(1);
  });
});
