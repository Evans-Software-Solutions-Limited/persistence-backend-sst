import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Exercise } from "@/domain/models/exercise";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useExercise } from "@/ui/hooks/useExercise";
import { useExerciseLibrary } from "@/ui/hooks/useExerciseLibrary";

const buildExercise = (overrides: Partial<Exercise> = {}): Exercise => ({
  id: "ex-1",
  name: "Bench Press",
  description: null,
  instructions: null,
  category: "strength",
  difficulty: "intermediate",
  primaryMuscleGroups: ["chest"],
  secondaryMuscleGroups: [],
  equipment: ["barbell"],
  videoUrl: null,
  thumbnailUrl: null,
  isCustom: false,
  createdBy: null,
  ...overrides,
});

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
): Adapters {
  return {
    api,
    auth: {} as Adapters["auth"],
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo: {} as Adapters["netInfo"],
  };
}

function wrap(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

describe("useExercise", () => {
  it("returns EMPTY when id is null", () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const { result } = renderHook(() => useExercise(null), {
      wrapper: wrap(makeAdapters(api, storage)),
    });
    expect(result.current.exercise).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it("renders cache-first without hitting the network", async () => {
    const api = new InMemoryApiAdapter();
    const getSpy = jest.spyOn(api, "getExercise");
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise({ id: "ex-1", name: "Cached" })]);

    const { result } = renderHook(() => useExercise("ex-1"), {
      wrapper: wrap(makeAdapters(api, storage)),
    });

    expect(result.current.exercise?.name).toBe("Cached");
    // Cached row → no auto-fetch.
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("auto-fetches and caches when the row isn't cached", async () => {
    const api = new InMemoryApiAdapter();
    const fresh = buildExercise({ id: "ex-9", name: "Fetched" });
    const getSpy = jest.spyOn(api, "getExercise").mockResolvedValue(ok(fresh));
    const storage = new InMemoryStorageAdapter();

    const { result } = renderHook(() => useExercise("ex-9"), {
      wrapper: wrap(makeAdapters(api, storage)),
    });

    await waitFor(() => expect(getSpy).toHaveBeenCalledWith("ex-9"));
    await waitFor(() => expect(result.current.exercise?.name).toBe("Fetched"));
    // Fetched row is written through to the cache.
    expect(storage.getCachedExercise("ex-9")?.name).toBe("Fetched");
  });

  it("surfaces an API error when the fetch fails and there's no cache", async () => {
    const api = new InMemoryApiAdapter();
    jest
      .spyOn(api, "getExercise")
      .mockResolvedValue(
        fail({ kind: "api", code: "server", message: "boom" }),
      );
    const storage = new InMemoryStorageAdapter();

    const { result } = renderHook(() => useExercise("ex-x"), {
      wrapper: wrap(makeAdapters(api, storage)),
    });

    await waitFor(() => expect(result.current.error?.message).toBe("boom"));
    expect(result.current.exercise).toBeNull();
  });

  it("runs no fetch when id is null", () => {
    const api = new InMemoryApiAdapter();
    const getSpy = jest.spyOn(api, "getExercise");
    const storage = new InMemoryStorageAdapter();
    renderHook(() => useExercise(null), {
      wrapper: wrap(makeAdapters(api, storage)),
    });
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("discards a fetch that resolves after the id changed (stale-closure guard)", async () => {
    const api = new InMemoryApiAdapter();
    const deferred: Record<
      string,
      (v: ReturnType<typeof ok<Exercise>>) => void
    > = {};
    jest.spyOn(api, "getExercise").mockImplementation(
      (exId: string) =>
        new Promise((resolve) => {
          deferred[exId] = resolve;
        }),
    );
    const storage = new InMemoryStorageAdapter();

    const { result, rerender } = renderHook(({ id }) => useExercise(id), {
      initialProps: { id: "ex-1" },
      wrapper: wrap(makeAdapters(api, storage)),
    });

    // Auto-fetch armed for ex-1; swap to ex-2 before ex-1 resolves.
    rerender({ id: "ex-2" });

    await act(async () => {
      // ex-1 resolves late — latestIdRef is now ex-2, so the write is skipped.
      deferred["ex-1"]?.(ok(buildExercise({ id: "ex-1", name: "Stale" })));
    });
    expect(result.current.exercise).toBeNull();

    await act(async () => {
      deferred["ex-2"]?.(ok(buildExercise({ id: "ex-2", name: "Fresh" })));
    });
    expect(result.current.exercise?.id).toBe("ex-2");
  });

  it("re-reads the cache when the library-changed signal fires (post-edit)", async () => {
    const api = new InMemoryApiAdapter();
    const getSpy = jest.spyOn(api, "getExercise");
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise({ id: "ex-1", name: "Old Name" })]);

    const { result } = renderHook(() => useExercise("ex-1"), {
      wrapper: wrap(makeAdapters(api, storage)),
    });

    expect(result.current.exercise?.name).toBe("Old Name");

    // Simulate the editor: write the edit straight into the shared cache,
    // then bump the library-changed revision. The still-mounted detail hook
    // must pick the edit up without a remount or a network round-trip.
    await act(async () => {
      storage.saveCustomExercise(
        buildExercise({
          id: "ex-1",
          name: "New Name",
          isCustom: true,
          createdBy: "me",
        }),
      );
      useExerciseLibrary.getState().markChanged();
    });

    expect(result.current.exercise?.name).toBe("New Name");
    // No network was involved — the re-read came straight off the cache.
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("dedupes concurrent refreshes for the same id", async () => {
    const api = new InMemoryApiAdapter();
    const getSpy = jest.spyOn(api, "getExercise").mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(ok(buildExercise({ id: "ex-1" }))), 10);
        }),
    );
    const storage = new InMemoryStorageAdapter();
    storage.cacheExercises([buildExercise({ id: "ex-1" })]);

    const { result } = renderHook(() => useExercise("ex-1"), {
      wrapper: wrap(makeAdapters(api, storage)),
    });

    await act(async () => {
      await Promise.all([result.current.refresh(), result.current.refresh()]);
    });
    expect(getSpy).toHaveBeenCalledTimes(1);
  });
});
