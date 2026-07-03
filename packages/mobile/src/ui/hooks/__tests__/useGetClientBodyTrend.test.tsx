import { renderHook, waitFor, act } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import type { BodyTrendPoint } from "@/domain/models/progress";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useGetClientBodyTrend } from "@/ui/hooks/useGetClientBodyTrend";

const TREND: BodyTrendPoint[] = [
  { date: "2026-06-20", weightKg: 80, bodyFat: 21 },
  { date: "2026-06-25", weightKg: 79.2, bodyFat: 20.4 },
];

function setup(
  getClientBodyTrend: jest.Mock,
  // NOTE: an options object, not a defaulted positional param — passing an
  // explicit `undefined` positional would silently re-trigger the default.
  opts: { clientId?: string } = { clientId: "client-1" },
) {
  const adapters = { api: { getClientBodyTrend } } as unknown as Adapters;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
  );
  return renderHook(() => useGetClientBodyTrend(opts.clientId), { wrapper });
}

describe("useGetClientBodyTrend", () => {
  it("fetches the client's trend with the default 30d window", async () => {
    const getClientBodyTrend = jest.fn(async () => ok(TREND));
    const { result } = setup(getClientBodyTrend);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual(TREND);
    expect(result.current.error).toBeNull();
    expect(getClientBodyTrend).toHaveBeenCalledWith("client-1", "30d");
  });

  it("surfaces a fetch error and clears it on a successful refresh", async () => {
    const getClientBodyTrend = jest
      .fn()
      .mockResolvedValueOnce(
        fail({ kind: "api", code: "network", message: "offline" }),
      )
      .mockResolvedValue(ok(TREND));
    const { result } = setup(getClientBodyTrend);
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data).toBeNull();

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual(TREND);
  });

  it("does not fetch without a clientId and settles isLoading=false", async () => {
    const getClientBodyTrend = jest.fn(async () => ok(TREND));
    const { result } = setup(getClientBodyTrend, {});
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(getClientBodyTrend).not.toHaveBeenCalled();
    expect(result.current.data).toBeNull();
  });

  it("drops the previous client's data when the id becomes undefined", async () => {
    const getClientBodyTrend = jest.fn(async () => ok(TREND));
    const adapters = { api: { getClientBodyTrend } } as unknown as Adapters;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );
    const { result, rerender } = renderHook(
      ({ id }: { id?: string }) => useGetClientBodyTrend(id),
      { wrapper, initialProps: { id: "client-1" } as { id?: string } },
    );
    await waitFor(() => expect(result.current.data).toEqual(TREND));

    rerender({ id: undefined });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeNull();
  });
});
