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
import { usePurchasePackage } from "@/ui/hooks/usePurchasePackage";

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

describe("usePurchasePackage", () => {
  it("returns active entitlements and invalidates subscription queries on success", async () => {
    const purchases = new MockPurchasesAdapter();
    purchases.nextPurchaseResponse = {
      ok: true,
      entitlements: [
        {
          entitlementId: "premium",
          tier: "premium",
          productId: "app.persistence.premium.monthly",
          expiresAt: null,
        },
      ],
    };
    const client = qc();
    const invalidateSpy = jest.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => usePurchasePackage(), {
      wrapper: wrap(makeAdapters(purchases), client),
    });

    const entitlements = await result.current.mutateAsync("$rc_monthly");
    expect(entitlements[0].tier).toBe("premium");
    expect(purchases.purchaseCalls).toEqual(["$rc_monthly"]);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["user-subscription"],
    });
  });

  it("throws the purchases error (e.g. cancelled) without invalidating", async () => {
    const purchases = new MockPurchasesAdapter();
    purchases.nextPurchaseResponse = {
      ok: false,
      error: { kind: "cancelled", code: null, message: "Purchase cancelled." },
    };
    const { result } = renderHook(() => usePurchasePackage(), {
      wrapper: wrap(makeAdapters(purchases), qc()),
    });
    await expect(
      result.current.mutateAsync("$rc_monthly"),
    ).rejects.toMatchObject({ kind: "cancelled" });
  });

  it("throws not_configured when no purchases adapter is present", async () => {
    const { result } = renderHook(() => usePurchasePackage(), {
      wrapper: wrap(makeAdapters(undefined), qc()),
    });
    await expect(
      result.current.mutateAsync("$rc_monthly"),
    ).rejects.toMatchObject({ kind: "not_configured" });
  });
});
