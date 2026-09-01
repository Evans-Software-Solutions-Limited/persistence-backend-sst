import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useExercisePerformanceSummary } from "@/ui/hooks/useExercisePerformanceSummary";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { ExercisePerformanceSummary } from "@/domain/models/exercisePerformance";

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

function summary(estimateKg: number): ExercisePerformanceSummary {
  const source = {
    weightKg: 100,
    reps: 6,
    completedAt: "2026-09-01T10:00:00Z",
  };
  return {
    estimatedOneRepMax: { estimateKg, source },
    estimatedTenRepMax: { estimateKg: estimateKg * 0.75, source },
    tenRepMax: null,
    heaviestSet: { weightKg: source.weightKg, source },
    bestSetVolume: { volumeKg: 600, source },
    lifetimeVolumeKg: 600,
  };
}

describe("useExercisePerformanceSummary", () => {
  it("does not fetch when its rollout slice is disabled", async () => {
    const api = { getExercisePerformanceSummary: jest.fn() };
    const adapters = { api } as unknown as Adapters;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );
    const { result } = renderHook(
      () => useExercisePerformanceSummary("exercise-disabled", false),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toBeNull();
    expect(api.getExercisePerformanceSummary).not.toHaveBeenCalled();
  });

  it("clears prior private metrics when the exercise or user key changes", async () => {
    const pending: ((
      value: ReturnType<typeof ok<ExercisePerformanceSummary | null>>,
    ) => void)[] = [];
    const api = {
      getExercisePerformanceSummary: jest.fn(
        () =>
          new Promise<ReturnType<typeof ok<ExercisePerformanceSummary | null>>>(
            (resolve) => pending.push(resolve),
          ),
      ),
    };
    const adapters = { api } as unknown as Adapters;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );
    const { result, rerender } = renderHook(
      ({ exerciseId }) => useExercisePerformanceSummary(exerciseId),
      { initialProps: { exerciseId: "bench" }, wrapper },
    );

    await act(async () => pending.shift()?.(ok(summary(120))));
    await waitFor(() =>
      expect(result.current.data?.estimatedOneRepMax?.estimateKg).toBe(120),
    );

    rerender({ exerciseId: "squat" });
    expect(result.current.data).toBeNull();

    await act(async () => pending.shift()?.(ok(summary(180))));
    await waitFor(() =>
      expect(result.current.data?.estimatedOneRepMax?.estimateKg).toBe(180),
    );

    mockSession = { ...mockSession!, userId: "user-b", email: "b@example.com" };
    rerender({ exerciseId: "squat" });
    expect(result.current.data).toBeNull();
  });

  it("rejects an older same-key response after a newer refresh resolves", async () => {
    const pending: ((
      value: ReturnType<typeof ok<ExercisePerformanceSummary | null>>,
    ) => void)[] = [];
    const api = {
      getExercisePerformanceSummary: jest.fn(
        () =>
          new Promise<ReturnType<typeof ok<ExercisePerformanceSummary | null>>>(
            (resolve) => pending.push(resolve),
          ),
      ),
    };
    const adapters = { api } as unknown as Adapters;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );
    const { result } = renderHook(
      () => useExercisePerformanceSummary("overlapping-bench"),
      { wrapper },
    );
    await waitFor(() => expect(pending).toHaveLength(1));

    act(() => {
      void result.current.refresh();
    });
    await waitFor(() => expect(pending).toHaveLength(2));

    await act(async () => pending[1]?.(ok(summary(150))));
    await waitFor(() =>
      expect(result.current.data?.estimatedOneRepMax?.estimateKg).toBe(150),
    );

    await act(async () => pending[0]?.(ok(summary(100))));
    expect(result.current.data?.estimatedOneRepMax?.estimateKg).toBe(150);
  });

  it("does not let an unmounted instance overwrite a newer instance's cache", async () => {
    const pending: ((
      value: ReturnType<typeof ok<ExercisePerformanceSummary | null>>,
    ) => void)[] = [];
    const api = {
      getExercisePerformanceSummary: jest.fn(
        () =>
          new Promise<ReturnType<typeof ok<ExercisePerformanceSummary | null>>>(
            (resolve) => pending.push(resolve),
          ),
      ),
    };
    const adapters = { api } as unknown as Adapters;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    );

    const first = renderHook(
      () => useExercisePerformanceSummary("remounted-bench"),
      { wrapper },
    );
    await waitFor(() => expect(pending).toHaveLength(1));
    first.unmount();

    const second = renderHook(
      () => useExercisePerformanceSummary("remounted-bench"),
      { wrapper },
    );
    await waitFor(() => expect(pending).toHaveLength(2));
    await act(async () => pending[1]?.(ok(summary(175))));
    await waitFor(() =>
      expect(second.result.current.data?.estimatedOneRepMax?.estimateKg).toBe(
        175,
      ),
    );

    await act(async () => pending[0]?.(ok(summary(90))));
    second.unmount();

    const third = renderHook(
      () => useExercisePerformanceSummary("remounted-bench"),
      { wrapper },
    );
    expect(third.result.current.data?.estimatedOneRepMax?.estimateKg).toBe(175);
    third.unmount();
  });
});
