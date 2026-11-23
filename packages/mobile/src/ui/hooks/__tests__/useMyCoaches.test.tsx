import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { MyCoach } from "@/domain/models/myCoaching";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { notifyMyCoachesChanged, useMyCoaches } from "@/ui/hooks/useMyCoaches";

const USER = "athlete-1";

const ELLIE: MyCoach = {
  relationshipId: "rel-ellie",
  trainerId: "t-ellie",
  name: "Ellie Hart",
  avatarUrl: null,
  since: null,
  features: {
    nutrition: true,
    checkIns: true,
    photos: true,
    habits: true,
    messages: true,
    resources: true,
  },
  due: { forms: 0 },
  newPlans: 0,
  resources: 0,
};

function setup() {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "a@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  const adapters: Adapters = {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo: {} as Adapters["netInfo"],
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
  );
  return { api, storage, wrapper };
}

describe("useMyCoaches — every instance sees a write at once (Inspector Brad, #547)", () => {
  it("a refresh in one instance updates another without the storage bus", async () => {
    const { api, wrapper } = setup();
    // The tab layout's instance (auto fetch off, so only the write can update it).
    const layout = renderHook(() => useMyCoaches({ enabled: false }), {
      wrapper,
    });
    // The accept screen's instance.
    const accept = renderHook(() => useMyCoaches({ enabled: false }), {
      wrapper,
    });
    await act(async () => {});
    expect(layout.result.current.coaches).toEqual([]);

    api.myCoaching = { coaches: [ELLIE], asOf: "2026-11-23T09:00:00Z" };
    await act(async () => {
      await accept.result.current.refresh({ silent: true });
    });

    // No `emitChange`: the bus is debounced (and may be unavailable), so
    // the layout must not depend on it to show the Coach tab in time.
    expect(layout.result.current.coaches).toEqual([ELLIE]);
  });

  it("notifyMyCoachesChanged re-reads a direct cache write (leaving a coach)", async () => {
    const { storage, wrapper } = setup();
    storage.cacheMyCoaches(USER, { coaches: [ELLIE], asOf: "x" });
    const hook = renderHook(() => useMyCoaches({ enabled: false }), {
      wrapper,
    });
    await act(async () => {});
    expect(hook.result.current.coaches).toHaveLength(1);

    act(() => {
      storage.removeCachedMyCoach(USER, "rel-ellie");
      notifyMyCoachesChanged();
    });
    expect(hook.result.current.coaches).toEqual([]);
  });

  it("an unmounted instance stops listening", async () => {
    const { storage, wrapper } = setup();
    const hook = renderHook(() => useMyCoaches({ enabled: false }), {
      wrapper,
    });
    await act(async () => {});
    hook.unmount();
    storage.cacheMyCoaches(USER, { coaches: [ELLIE], asOf: "x" });
    expect(() => notifyMyCoachesChanged()).not.toThrow();
  });
});
