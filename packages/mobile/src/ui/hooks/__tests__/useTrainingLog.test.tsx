import { renderHook, act } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Exercise } from "@/domain/models/exercise";
import type { Adapters } from "@/shared/types";
import { session as finished } from "@/domain/services/__tests__/youFixtures";
import { AdapterProvider } from "../useAdapters";
import { musclesLookup, useTrainingLog } from "../useTrainingLog";

const ex = (over: Partial<Exercise>) =>
  ({
    id: "x",
    primaryMuscleGroups: [],
    secondaryMuscleGroups: [],
    ...over,
  }) as Exercise;

describe("musclesLookup", () => {
  it("resolves catalogue UUIDs through the muscle-group list", () => {
    const of = musclesLookup(
      [
        ex({
          id: "bench",
          primaryMuscleGroups: ["uuid-chest" as never],
          secondaryMuscleGroups: ["triceps"],
        }),
      ],
      [{ id: "uuid-chest", name: "Chest" }],
    );
    expect(of("bench")).toEqual({ primary: ["chest"], secondary: ["triceps"] });
    expect(of("unknown")).toBeNull();
  });
});

describe("useTrainingLog", () => {
  const wrap = (storage: InMemoryStorageAdapter) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return (
        <AdapterProvider adapters={{ storage } as unknown as Adapters}>
          {children}
        </AdapterProvider>
      );
    };

  it("reads the log, stamps its start once and re-reads on reload", () => {
    const storage = new InMemoryStorageAdapter();
    const { result } = renderHook(() => useTrainingLog("u1"), {
      wrapper: wrap(storage),
    });
    expect(result.current.sessions).toEqual([]);
    const since = result.current.since;
    expect(since).not.toBeNull();
    storage.saveTrainingLogEntry(
      "u1",
      finished("a", new Date().toISOString(), { bench: [[100, 5]] }),
    );
    act(() => result.current.reload());
    expect(result.current.sessions.map((s) => s.id)).toEqual(["a"]);
    expect(result.current.since).toBe(since);
  });

  it("is empty when signed out", () => {
    const storage = new InMemoryStorageAdapter();
    const { result } = renderHook(() => useTrainingLog(null), {
      wrapper: wrap(storage),
    });
    expect(result.current.sessions).toEqual([]);
    expect(result.current.since).toBeNull();
    expect(result.current.musclesOf("x")).toBeNull();
  });
});
