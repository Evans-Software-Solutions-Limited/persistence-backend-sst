import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { useRestorePurchases } from "@/ui/hooks/useRestorePurchases";

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

function wrap(adapters: Adapters, qc: QueryClient) {
  return function W({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
      </QueryClientProvider>
    );
  };
}

function qc() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe("useRestorePurchases", () => {
  it("restores and invalidates subscription queries", async () => {
    const purchases = new MockPurchasesAdapter();
    purchases.nextRestoreResponse = {
      ok: true,
      entitlements: [
        {
          entitlementId: "premium",
          tier: "premium",
          productId: null,
          expiresAt: null,
        },
      ],
    };
    const client = qc();
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useRestorePurchases(), {
      wrapper: wrap(makeAdapters(purchases), client),
    });
    const entitlements = await result.current.mutateAsync();
    expect(purchases.restoreCalls).toBe(1);
    expect(entitlements).toHaveLength(1);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["user-subscription"],
    });
  });

  it("throws the purchases error on failure", async () => {
    const purchases = new MockPurchasesAdapter();
    purchases.nextRestoreResponse = {
      ok: false,
      error: { kind: "network", code: null, message: "offline" },
    };
    const { result } = renderHook(() => useRestorePurchases(), {
      wrapper: wrap(makeAdapters(purchases), qc()),
    });
    await expect(result.current.mutateAsync()).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("throws not_configured when no purchases adapter is present", async () => {
    const { result } = renderHook(() => useRestorePurchases(), {
      wrapper: wrap(makeAdapters(undefined), qc()),
    });
    await expect(result.current.mutateAsync()).rejects.toMatchObject({
      kind: "not_configured",
    });
  });
});
