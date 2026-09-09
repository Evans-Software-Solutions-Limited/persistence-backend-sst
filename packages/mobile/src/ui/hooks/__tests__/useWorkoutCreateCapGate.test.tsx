import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import React from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useWorkoutCreateCapGate } from "../useWorkoutCreateCapGate";

// The hook imports the expo-router singleton; unmocked, requiring it pulls in
// RN's dev-server plumbing.
const mockRouterPush = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));

const USER_ID = "test-user";

function makeAdapters(storage: InMemoryStorageAdapter): Adapters {
  const auth = new InMemoryAuthAdapter();
  return {
    api: new InMemoryApiAdapter(),
    auth,
    storage,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
}

function wrap(adapters: Adapters) {
  return function W({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

async function renderGate(seed?: (s: InMemoryStorageAdapter) => void) {
  const storage = new InMemoryStorageAdapter();
  storage.initialize();
  seed?.(storage);
  const adapters = makeAdapters(storage);
  // `useAuth` resolves the session through the adapter's auth-state
  // subscription, so sign in before rendering.
  await (adapters.auth as InMemoryAuthAdapter).signInWithEmail(
    "test@example.com",
    "password",
  );
  const { result } = renderHook(() => useWorkoutCreateCapGate(), {
    wrapper: wrap(adapters),
  });
  // `useAuth` receives the session through a queueMicrotask'd
  // `onAuthStateChange` callback, so flush it before reading the gate —
  // without a userId the gate correctly fails open, which would make every
  // blocking assertion below vacuously pass.
  await act(async () => {});
  return { result, storage };
}

describe("useWorkoutCreateCapGate", () => {
  beforeEach(() => {
    mockRouterPush.mockReset();
  });

  it("blocks and routes to the paywall when used is AT the limit", async () => {
    // `>=`, matching the CREATE gate (`assertEntitlement`), not the
    // over-limit record lock, which denies strictly over.
    const { result } = await renderGate((s) =>
      s.cacheWorkoutsList(USER_ID, "mine", [], { used: 3, limit: 3 }),
    );

    expect(result.current.blockIfAtLimit()).toBe(true);
    expect(mockRouterPush).toHaveBeenCalledWith(
      "/(auth)/subscription-selection",
    );
  });

  it("blocks when used is over the limit", async () => {
    const { result } = await renderGate((s) =>
      s.cacheWorkoutsList(USER_ID, "mine", [], { used: 5, limit: 3 }),
    );

    expect(result.current.blockIfAtLimit()).toBe(true);
  });

  it("allows when used is under the limit", async () => {
    const { result } = await renderGate((s) =>
      s.cacheWorkoutsList(USER_ID, "mine", [], { used: 2, limit: 3 }),
    );

    expect(result.current.blockIfAtLimit()).toBe(false);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("allows an explicitly unlimited tier however many workouts are owned", async () => {
    // `limit: null` is premium / premium_plus / any coach rung.
    const { result } = await renderGate((s) =>
      s.cacheWorkoutsList(USER_ID, "mine", [], { used: 99, limit: null }),
    );

    expect(result.current.blockIfAtLimit()).toBe(false);
  });

  it("fails OPEN when the quota has never been cached", async () => {
    // A cold or offline first run, or before the `mine` slice has loaded
    // once. An unknown count must not paywall a paying user — the server's
    // 402 is the backstop, and the sync drain now reconciles the optimistic
    // row when it fires, so failing open no longer leaves a phantom behind.
    const { result } = await renderGate();

    expect(result.current.blockIfAtLimit()).toBe(false);
    expect(mockRouterPush).not.toHaveBeenCalled();
  });

  it("reads the quota at PRESS time, not at render time", async () => {
    // The whole reason this gate is a callback rather than a subscription:
    // the coach containers must not mount `useWorkouts()` (a three-slice
    // refresh + queue flush on mount) just to answer this question.
    const { result, storage } = await renderGate((s) =>
      s.cacheWorkoutsList(USER_ID, "mine", [], { used: 2, limit: 3 }),
    );

    expect(result.current.blockIfAtLimit()).toBe(false);

    // A create elsewhere pushes them to the cap, with no re-render.
    storage.cacheWorkoutsList(USER_ID, "mine", [], { used: 3, limit: 3 });

    expect(result.current.blockIfAtLimit()).toBe(true);
  });

  it("allows when there is no signed-in user", async () => {
    const storage = new InMemoryStorageAdapter();
    storage.initialize();
    const adapters = makeAdapters(storage);
    const { result } = renderHook(() => useWorkoutCreateCapGate(), {
      wrapper: wrap(adapters),
    });

    expect(result.current.blockIfAtLimit()).toBe(false);
  });
});
