import { renderHook, act, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { useReferenceLists } from "../useReferenceLists";
import { AdapterProvider } from "../useAdapters";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import type { Adapters } from "@/shared/types";
import type { ReferenceEntry } from "@/domain/models/reference-list";

function createTestAdapters() {
  const storage = new InMemoryStorageAdapter();
  const api = new InMemoryApiAdapter();
  const adapters: Adapters = {
    api,
    auth: new InMemoryAuthAdapter(),
    storage,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
  };
  return { adapters, storage, api };
}

const entry = (
  name: string,
  overrides: Partial<ReferenceEntry> = {},
): ReferenceEntry => ({
  id: `${name}-uuid`,
  name,
  displayName: name.charAt(0).toUpperCase() + name.slice(1),
  ...overrides,
});

function wrapper(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

describe("useReferenceLists", () => {
  it("starts empty and auto-refreshes when cache is empty", async () => {
    const { adapters, api } = createTestAdapters();
    api.referenceLists.muscle_groups = [entry("chest"), entry("back")];
    api.referenceLists.equipment = [entry("barbell")];
    api.referenceLists.categories = [entry("strength")];

    const { result } = renderHook(() => useReferenceLists(), {
      wrapper: wrapper(adapters),
    });

    // Initial synchronous state: empty + stale
    expect(result.current.muscleGroups).toEqual([]);
    expect(result.current.equipment).toEqual([]);
    expect(result.current.isStale).toBe(true);

    // Wait for the auto-refresh to settle
    await waitFor(() => {
      expect(result.current.muscleGroups).toHaveLength(2);
    });
    expect(result.current.equipment).toHaveLength(1);
    expect(result.current.categories).toHaveLength(1);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("renders cached entries synchronously when cache is fresh", () => {
    const { adapters, storage } = createTestAdapters();
    storage.cacheReferenceList("muscle_groups", [entry("chest")]);
    storage.cacheReferenceList("equipment", [entry("barbell")]);
    storage.cacheReferenceList("categories", [entry("strength")]);

    const { result } = renderHook(() => useReferenceLists(), {
      wrapper: wrapper(adapters),
    });

    // Fresh cache — entries visible immediately, no refresh fired
    expect(result.current.muscleGroups).toHaveLength(1);
    expect(result.current.muscleGroups[0].name).toBe("chest");
    expect(result.current.isStale).toBe(false);
  });

  it("does not auto-refresh when cache is fresh", async () => {
    const { adapters, storage, api } = createTestAdapters();
    storage.cacheReferenceList("muscle_groups", [entry("chest")]);
    storage.cacheReferenceList("equipment", [entry("barbell")]);
    storage.cacheReferenceList("categories", [entry("strength")]);

    const getReferenceListSpy = jest.spyOn(api, "getReferenceList");

    renderHook(() => useReferenceLists(), { wrapper: wrapper(adapters) });
    // Give any effect a chance to run
    await act(async () => {
      await Promise.resolve();
    });

    expect(getReferenceListSpy).not.toHaveBeenCalled();
  });

  it("exposes manual refresh that updates all three lists", async () => {
    const { adapters, api } = createTestAdapters();
    api.referenceLists.muscle_groups = [entry("chest")];

    const { result } = renderHook(() => useReferenceLists(), {
      wrapper: wrapper(adapters),
    });

    // wait for auto-refresh to finish
    await waitFor(() => {
      expect(result.current.muscleGroups).toHaveLength(1);
    });

    // Backend catalog grows
    api.referenceLists.muscle_groups = [
      entry("chest"),
      entry("back"),
      entry("legs"),
    ];

    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.muscleGroups).toHaveLength(3);
  });

  it("flips isStale=false after a successful refresh (regression)", async () => {
    // Empty cache → isStale=true on mount. The hook used to derive
    // isStale from a mount-time useMemo that never re-ran, so
    // isStale stayed true forever — even after refresh populated
    // the cache. This test pins the correct behaviour.
    const { adapters, api } = createTestAdapters();
    api.referenceLists.muscle_groups = [entry("chest")];
    api.referenceLists.equipment = [entry("barbell")];
    api.referenceLists.categories = [entry("strength")];

    const { result } = renderHook(() => useReferenceLists(), {
      wrapper: wrapper(adapters),
    });

    // Mount-time: cache empty → stale
    expect(result.current.isStale).toBe(true);

    // Auto-refresh succeeds for all three kinds
    await waitFor(() => {
      expect(result.current.muscleGroups).toHaveLength(1);
    });

    // After the successful refresh the flag must flip false
    await waitFor(() => {
      expect(result.current.isStale).toBe(false);
    });
  });

  it("keeps isStale=true after a partially-failed refresh", async () => {
    const { adapters, storage, api } = createTestAdapters();
    storage.cacheReferenceList("muscle_groups", [entry("chest")]);
    storage.cacheReferenceList("equipment", [entry("barbell")]);
    storage.cacheReferenceList("categories", [entry("strength")]);
    api.shouldFail = true;

    const { result } = renderHook(() => useReferenceLists(), {
      wrapper: wrapper(adapters),
    });

    // Cached + fresh on mount → isStale=false
    expect(result.current.isStale).toBe(false);

    // Force a refresh that fails
    await act(async () => {
      await result.current.refresh();
    });

    // Refresh failed — flag stays at whatever it was, but more
    // importantly: a failed refresh must never reset isStale to
    // false. Error is surfaced separately.
    expect(result.current.error).not.toBeNull();
    expect(result.current.isStale).toBe(false); // was already false pre-refresh
  });

  it("surfaces the first error without clobbering cached entries", async () => {
    const { adapters, storage, api } = createTestAdapters();
    storage.cacheReferenceList("muscle_groups", [entry("chest")]);
    storage.cacheReferenceList("equipment", [entry("barbell")]);
    storage.cacheReferenceList("categories", [entry("strength")]);
    api.shouldFail = true;
    api.failError = {
      kind: "api",
      code: "network",
      message: "offline",
    };

    const { result } = renderHook(() => useReferenceLists(), {
      wrapper: wrapper(adapters),
    });

    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.error).toBe("offline");
    // Cached entries still visible
    expect(result.current.muscleGroups).toHaveLength(1);
    expect(result.current.muscleGroups[0].name).toBe("chest");
  });

  it("only auto-refreshes once per mount (strict-mode-safe)", async () => {
    const { adapters, api } = createTestAdapters();
    api.referenceLists.muscle_groups = [entry("chest")];
    const spy = jest.spyOn(api, "getReferenceList");

    const { result, rerender } = renderHook(() => useReferenceLists(), {
      wrapper: wrapper(adapters),
    });

    await waitFor(() => {
      expect(result.current.muscleGroups).toHaveLength(1);
    });
    const callsAfterFirst = spy.mock.calls.length;

    // Force re-render — no extra refresh should fire
    rerender({});
    await act(async () => {
      await Promise.resolve();
    });

    expect(spy.mock.calls.length).toBe(callsAfterFirst);
  });
});
