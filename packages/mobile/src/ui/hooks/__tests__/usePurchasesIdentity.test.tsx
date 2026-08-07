import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPurchasesAdapter } from "@/adapters/purchases/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { PurchasesPort } from "@/domain/ports/purchases.port";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { usePurchasesIdentity } from "@/ui/hooks/usePurchasesIdentity";

// Drive the auth session per-test.
let mockSession: { userId: string } | null = null;
jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({ session: mockSession }),
}));

function makeAdapters(purchases?: PurchasesPort): Adapters {
  return {
    api: new InMemoryApiAdapter(),
    auth: new InMemoryAuthAdapter(),
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
    purchases,
  };
}

function wrap(adapters: Adapters) {
  return function W({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

beforeEach(() => {
  mockSession = null;
});

describe("usePurchasesIdentity", () => {
  it("logs in with the supabase user id once auth resolves", () => {
    const purchases = new MockPurchasesAdapter();
    mockSession = { userId: "supabase-uid" };
    const { rerender } = renderHook(() => usePurchasesIdentity(), {
      wrapper: wrap(makeAdapters(purchases)),
    });
    expect(purchases.logInCalls).toEqual(["supabase-uid"]);
    // Re-render with the same user → no duplicate logIn.
    rerender({});
    expect(purchases.logInCalls).toEqual(["supabase-uid"]);
  });

  it("logs out after a prior login when the session clears", () => {
    const purchases = new MockPurchasesAdapter();
    mockSession = { userId: "supabase-uid" };
    const { rerender } = renderHook(() => usePurchasesIdentity(), {
      wrapper: wrap(makeAdapters(purchases)),
    });
    expect(purchases.logInCalls).toEqual(["supabase-uid"]);
    mockSession = null;
    rerender({});
    expect(purchases.logOutCalls).toBe(1);
  });

  it("does not log out on a cold, never-signed-in launch", () => {
    const purchases = new MockPurchasesAdapter();
    mockSession = null;
    renderHook(() => usePurchasesIdentity(), {
      wrapper: wrap(makeAdapters(purchases)),
    });
    expect(purchases.logInCalls).toEqual([]);
    expect(purchases.logOutCalls).toBe(0);
  });

  it("no-ops when no purchases adapter is present", () => {
    mockSession = { userId: "supabase-uid" };
    // Should not throw despite no adapter.
    expect(() =>
      renderHook(() => usePurchasesIdentity(), {
        wrapper: wrap(makeAdapters(undefined)),
      }),
    ).not.toThrow();
  });

  it("automatically retries a failed identity binding", async () => {
    jest.useFakeTimers();
    const purchases = new MockPurchasesAdapter();
    purchases.nextLogInResponse = {
      ok: false,
      error: { kind: "network", code: null, message: "offline" },
    };
    mockSession = { userId: "u1" };
    const { unmount } = renderHook(() => usePurchasesIdentity(), {
      wrapper: wrap(makeAdapters(purchases)),
    });
    try {
      await act(async () => {
        await Promise.resolve();
      });
      expect(purchases.logInCalls).toEqual(["u1"]);

      purchases.nextLogInResponse = { ok: true };
      await act(async () => {
        jest.advanceTimersByTime(1_000);
        await Promise.resolve();
      });
      expect(purchases.logInCalls).toEqual(["u1", "u1"]);
    } finally {
      unmount();
      jest.useRealTimers();
    }
  });

  it("sign-out during an in-flight logIn does not stale-latch (re-login still binds)", async () => {
    const purchases = new MockPurchasesAdapter();
    const calls: string[] = [];
    let resolveLogIn: ((r: { ok: true }) => void) | null = null;
    // Override logIn with a manually-controlled deferred so we can interleave
    // a sign-out while the call is still pending.
    purchases.logIn = ((id: string) => {
      calls.push(id);
      return new Promise((res) => {
        resolveLogIn = res as unknown as (r: { ok: true }) => void;
      });
    }) as unknown as typeof purchases.logIn;

    mockSession = { userId: "u1" };
    const { rerender } = renderHook(() => usePurchasesIdentity(), {
      wrapper: wrap(makeAdapters(purchases)),
    });
    expect(calls).toEqual(["u1"]); // logIn(u1) in flight, not yet resolved

    // Sign out before logIn resolves.
    mockSession = null;
    rerender({});
    expect(purchases.logOutCalls).toBe(1);

    // The stale in-flight logIn(u1) now resolves — it must NOT latch u1.
    await act(async () => {
      resolveLogIn?.({ ok: true });
      await Promise.resolve();
    });

    // Sign back in as u1 — logIn must be re-issued, not short-circuited by a
    // stale latch.
    mockSession = { userId: "u1" };
    rerender({});
    await waitFor(() => expect(calls).toEqual(["u1", "u1"]));
  });
});
