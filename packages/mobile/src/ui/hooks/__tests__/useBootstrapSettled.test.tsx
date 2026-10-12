import { act, renderHook } from "@testing-library/react-native";
import { beginBootstrap } from "@/application/bootstrap/gate";
import { useBootstrapSettled } from "@/ui/hooks/useBootstrapSettled";

describe("useBootstrapSettled", () => {
  it("is true with no user or no pending bootstrap and flips when the gate settles", () => {
    expect(renderHook(() => useBootstrapSettled(null)).result.current).toBe(
      true,
    );
    const { result } = renderHook(() => useBootstrapSettled("u-x"));
    expect(result.current).toBe(true);
    let settle!: () => void;
    act(() => {
      settle = beginBootstrap("u-x");
    });
    expect(result.current).toBe(false);
    act(() => settle());
    expect(result.current).toBe(true);
  });
});
