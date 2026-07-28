import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";

import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { EXERCISE_TABLES, WORKOUT_TABLES } from "@/adapters/storage";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useCacheRevision } from "@/ui/hooks/useCacheRevision";
import { useWorkoutLibrary } from "@/ui/hooks/useWorkoutLibrary";

function makeWrapper(storage: InMemoryStorageAdapter) {
  const adapters = { storage } as unknown as Adapters;
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

describe("useCacheRevision", () => {
  it("starts at zero and increments once per delivered change", () => {
    const storage = new InMemoryStorageAdapter();
    const { result } = renderHook(() => useCacheRevision(WORKOUT_TABLES), {
      wrapper: makeWrapper(storage),
    });

    expect(result.current).toBe(0);

    act(() => storage.emitChange("cached_workouts"));
    expect(result.current).toBe(1);

    act(() => storage.emitChange("cached_workout_detail"));
    expect(result.current).toBe(2);
  });

  it("ignores writes to tables it did not subscribe to", () => {
    // The whole point of the table filter: a nutrition write must not re-render
    // every workout list in the app.
    const storage = new InMemoryStorageAdapter();
    const { result } = renderHook(() => useCacheRevision(WORKOUT_TABLES), {
      wrapper: makeWrapper(storage),
    });

    act(() => storage.emitChange("cached_recipes"));
    expect(result.current).toBe(0);

    // ...and still wakes for a batch that includes a subscribed table alongside
    // unsubscribed ones, which is what a multi-table transaction looks like.
    act(() => storage.emitChange("cached_recipes", "cached_workouts"));
    expect(result.current).toBe(1);
  });

  it("releases its subscription on unmount", () => {
    // Asserts the SUBSCRIBER COUNT, not "the unmounted component didn't
    // update": React discards a post-unmount setState either way, so the
    // latter passes even with the cleanup deleted. Deleting
    // `return unsubscribe` must fail this test.
    const storage = new InMemoryStorageAdapter();
    const { result, unmount } = renderHook(
      () => useCacheRevision(EXERCISE_TABLES),
      { wrapper: makeWrapper(storage) },
    );

    expect(storage.changeSubscriberCount()).toBe(1);
    act(() => storage.emitChange("cached_exercises"));
    expect(result.current).toBe(1);

    unmount();
    expect(storage.changeSubscriberCount()).toBe(0);
  });

  it("registers no subscription for an empty table list", () => {
    // Asserts the registry stayed empty, not just that the revision stayed 0 —
    // the latter is true for an empty list either way, so it could not fail.
    const storage = new InMemoryStorageAdapter();
    const { result } = renderHook(() => useCacheRevision([]), {
      wrapper: makeWrapper(storage),
    });

    expect(storage.changeSubscriberCount()).toBe(0);
    act(() => storage.emitChange("cached_workouts"));
    expect(result.current).toBe(0);
  });
});

describe("useWorkoutLibrary", () => {
  beforeEach(() => {
    useWorkoutLibrary.setState({ revision: 0 });
  });

  it("bumps a shared revision that every consumer observes", () => {
    // The reason this store exists: `useWorkouts` is a plain hook, so Home and
    // Train hold independent snapshots and neither can see the other's
    // `cacheVersion`. Two separate hook instances must both move.
    const first = renderHook(() => useWorkoutLibrary((s) => s.revision));
    const second = renderHook(() => useWorkoutLibrary((s) => s.revision));

    expect(first.result.current).toBe(0);
    expect(second.result.current).toBe(0);

    act(() => useWorkoutLibrary.getState().markChanged());

    expect(first.result.current).toBe(1);
    expect(second.result.current).toBe(1);
  });

  it("increments monotonically so consecutive mutations each trigger a re-read", () => {
    act(() => useWorkoutLibrary.getState().markChanged());
    act(() => useWorkoutLibrary.getState().markChanged());
    expect(useWorkoutLibrary.getState().revision).toBe(2);
  });
});
