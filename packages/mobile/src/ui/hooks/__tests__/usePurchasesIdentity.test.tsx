import { renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
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
    payments: new MockPaymentsAdapter(),
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
});
