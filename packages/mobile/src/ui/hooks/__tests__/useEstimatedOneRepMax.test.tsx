import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useEstimatedOneRepMax } from "@/ui/hooks/useEstimatedOneRepMax";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { EstimatedOneRepMax } from "@/domain/models/exercisePerformance";

let mockSession: AuthSession | null = {
  accessToken: "token",
  refreshToken: "refresh",
  userId: "user-a",
  email: "a@example.com",
  expiresAt: Date.now() + 60_000,
};

jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({ session: mockSession }),
}));

describe("useEstimatedOneRepMax", () => {
  it("does not fetch when its rollout slice is disabled", async () => {
    const api = {
      getEstimatedOneRepMax: jest.fn(),
    };
    const adapters = { api } as unknown as Adapters;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );
    const { result } = renderHook(
      () => useEstimatedOneRepMax("exercise-disabled", false),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(api.getEstimatedOneRepMax).not.toHaveBeenCalled();
  });

  it("clears the prior estimate immediately when exercise or user key changes", async () => {
    const pending: ((
      value: ReturnType<typeof ok<EstimatedOneRepMax | null>>,
    ) => void)[] = [];
    const api = {
      getEstimatedOneRepMax: jest.fn(
        () =>
          new Promise<ReturnType<typeof ok<EstimatedOneRepMax | null>>>(
            (resolve) => pending.push(resolve),
          ),
      ),
    };
    const adapters = { api } as unknown as Adapters;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );
    const { result, rerender } = renderHook(
      ({ exerciseId }) => useEstimatedOneRepMax(exerciseId),
      { initialProps: { exerciseId: "bench" }, wrapper },
    );

    await act(async () => {
      pending.shift()?.(
        ok({
          estimateKg: 120,
          source: {
            weightKg: 100,
            reps: 6,
            completedAt: "2026-09-01T10:00:00Z",
          },
        }),
      );
    });
    await waitFor(() => expect(result.current.data?.estimateKg).toBe(120));

    rerender({ exerciseId: "squat" });
    expect(result.current.data).toBeNull();

    await act(async () => {
      pending.shift()?.(
        ok({
          estimateKg: 180,
          source: {
            weightKg: 150,
            reps: 6,
            completedAt: "2026-09-01T11:00:00Z",
          },
        }),
      );
    });
    await waitFor(() => expect(result.current.data?.estimateKg).toBe(180));

    mockSession = { ...mockSession!, userId: "user-b", email: "b@example.com" };
    rerender({ exerciseId: "squat" });
    expect(result.current.data).toBeNull();
  });
});
