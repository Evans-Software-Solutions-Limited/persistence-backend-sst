import { renderHook } from "@testing-library/react-native";
import { useRefreshOnFocus } from "../useRefreshOnFocus";

// Capture the callback expo-router's useFocusEffect is given so the test can
// simulate focus events (mount focus + subsequent re-entries).
let focusCb: (() => void | (() => void)) | null = null;
jest.mock("expo-router", () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    focusCb = cb;
  },
}));

describe("useRefreshOnFocus", () => {
  beforeEach(() => {
    focusCb = null;
  });

  it("skips the FIRST focus (mount) and runs onFocus on every subsequent focus", () => {
    const onFocus = jest.fn();
    renderHook(() => useRefreshOnFocus(onFocus));

    expect(focusCb).not.toBeNull();

    // First focus = mount → skipped (cache-first hooks already auto-fetch once).
    focusCb?.();
    expect(onFocus).not.toHaveBeenCalled();

    // Second focus (re-entry) → runs.
    focusCb?.();
    expect(onFocus).toHaveBeenCalledTimes(1);

    // Every subsequent focus keeps refreshing.
    focusCb?.();
    expect(onFocus).toHaveBeenCalledTimes(2);
  });
});
