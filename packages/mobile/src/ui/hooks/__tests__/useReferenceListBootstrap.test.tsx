import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { fail, ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useReferenceListBootstrap } from "@/ui/hooks/useReferenceListBootstrap";

/**
 * The catalogue warmer is mounted unconditionally in the root layout, so it runs for
 * every session of every user — and it is the resolution half of the sync layer's
 * enum→UUID translation: without a catalogue, every custom-exercise write defers.
 *
 * `AuthGate.test.tsx` claimed this file existed before it did. It didn't, and the hook
 * shipped at 0% coverage, including the reconnect-retry path that exists specifically
 * to recover the failure it is most likely to hit (a fetch that fails at mount because
 * the device is offline).
 */

const session: AuthSession = {
  accessToken: "t",
  refreshToken: "r",
  userId: "user-1",
  email: "u@example.com",
  expiresAt: Date.now() + 60_000,
};

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
  netInfo: InMemoryNetInfoAdapter,
  activeSession: AuthSession | null = session,
): Adapters {
  const auth = {
    ...new InMemoryAuthAdapter(),
    onAuthStateChange: (cb: (s: AuthSession | null) => void) => {
      cb(activeSession);
      return () => {};
    },
    getSession: jest.fn(async () => ok(activeSession)),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    api,
    auth,
    storage,
    netInfo,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
  };
}

function wrap(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

/** The two catalogues the exercise write path needs. */
const KINDS = ["muscle_groups", "equipment"] as const;

describe("useReferenceListBootstrap", () => {
  let api: InMemoryApiAdapter;
  let storage: InMemoryStorageAdapter;
  let netInfo: InMemoryNetInfoAdapter;

  beforeEach(() => {
    api = new InMemoryApiAdapter();
    storage = new InMemoryStorageAdapter();
    storage.initialize();
    netInfo = new InMemoryNetInfoAdapter(true);
  });

  it("warms both catalogues on mount", async () => {
    const spy = jest.spyOn(api, "getReferenceList").mockResolvedValue(ok([]));

    renderHook(() => useReferenceListBootstrap(), {
      wrapper: wrap(makeAdapters(api, storage, netInfo)),
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(KINDS.length));
    expect(spy.mock.calls.map((c) => c[0]).sort()).toEqual([...KINDS].sort());
  });

  it("does nothing without a session", async () => {
    // The catalogue is per-backend, not per-user, but fetching it with no token
    // would 401 — and the hook is mounted above the auth boundary.
    const spy = jest.spyOn(api, "getReferenceList");

    renderHook(() => useReferenceListBootstrap(), {
      wrapper: wrap(makeAdapters(api, storage, netInfo, null)),
    });

    await act(async () => {
      await Promise.resolve();
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips a catalogue that is already cached and fresh", async () => {
    storage.cacheReferenceList("muscle_groups", [
      { id: "m1", name: "Chest", displayName: "Chest" },
    ]);
    const spy = jest.spyOn(api, "getReferenceList").mockResolvedValue(ok([]));

    renderHook(() => useReferenceListBootstrap(), {
      wrapper: wrap(makeAdapters(api, storage, netInfo)),
    });

    // Cache-first: only the missing one is fetched.
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(spy).toHaveBeenCalledWith("equipment");
  });

  it("swallows a failed fetch — nothing renders off this, and the drain defers", async () => {
    const spy = jest
      .spyOn(api, "getReferenceList")
      .mockResolvedValue(
        fail({ kind: "api", code: "network", message: "off" }),
      );

    const { unmount } = renderHook(() => useReferenceListBootstrap(), {
      wrapper: wrap(makeAdapters(api, storage, netInfo)),
    });

    await waitFor(() => expect(spy).toHaveBeenCalled());
    // No throw, no unhandled rejection, and no catalogue written.
    expect(storage.getCachedReferenceList("muscle_groups")).toBeNull();
    expect(() => unmount()).not.toThrow();
  });

  it("RETRIES on a real offline→online transition", async () => {
    // The whole point. A mount-time failure is the likely one (the device is
    // offline), and one attempt per mount could never recover from it — which left
    // the sync layer's `catalogue_unavailable` deferral, classified `transport` i.e.
    // "a reconnect is new information", with no mechanism behind that promise.
    const spy = jest
      .spyOn(api, "getReferenceList")
      .mockResolvedValue(
        fail({ kind: "api", code: "network", message: "off" }),
      );

    renderHook(() => useReferenceListBootstrap(), {
      wrapper: wrap(makeAdapters(api, storage, netInfo)),
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(KINDS.length));

    spy.mockResolvedValue(ok([]));
    await act(async () => {
      netInfo.setConnected(false);
      netInfo.setConnected(true);
      await Promise.resolve();
    });

    await waitFor(() =>
      expect(spy.mock.calls.length).toBeGreaterThan(KINDS.length),
    );
  });

  it("does not fetch twice for one mount", async () => {
    // The effect both warms and subscribes. If the subscribe path counted its first
    // observation as a transition, every cold start would fetch both catalogues twice.
    const spy = jest.spyOn(api, "getReferenceList").mockResolvedValue(ok([]));

    renderHook(() => useReferenceListBootstrap(), {
      wrapper: wrap(makeAdapters(api, storage, netInfo)),
    });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(KINDS.length));
    await act(async () => {
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(KINDS.length);
  });

  it("does not re-fetch on going OFFLINE, only on coming back", async () => {
    const spy = jest
      .spyOn(api, "getReferenceList")
      .mockResolvedValue(
        fail({ kind: "api", code: "network", message: "off" }),
      );

    renderHook(() => useReferenceListBootstrap(), {
      wrapper: wrap(makeAdapters(api, storage, netInfo)),
    });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(KINDS.length));

    await act(async () => {
      netInfo.setConnected(false);
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(KINDS.length);
  });

  it("unsubscribes from connectivity on unmount", async () => {
    const spy = jest.spyOn(api, "getReferenceList").mockResolvedValue(ok([]));

    const { unmount } = renderHook(() => useReferenceListBootstrap(), {
      wrapper: wrap(makeAdapters(api, storage, netInfo)),
    });
    await waitFor(() => expect(spy).toHaveBeenCalled());
    unmount();
    spy.mockClear();

    // A transition after unmount must reach nothing. Asserted via the adapter's
    // listener count, not via "no fetch happened" — the latter would also pass if
    // cleanup never ran but the cache had gone warm.
    expect(netInfo.subscriberCount).toBe(0);
    await act(async () => {
      netInfo.setConnected(false);
      netInfo.setConnected(true);
      await Promise.resolve();
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
