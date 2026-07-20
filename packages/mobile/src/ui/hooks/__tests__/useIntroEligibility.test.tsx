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
import { useIntroEligibility } from "@/ui/hooks/useIntroEligibility";

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

describe("useIntroEligibility", () => {
  it("resolves per-product eligibility from the adapter", async () => {
    const purchases = new MockPurchasesAdapter();
    purchases.introEligibility = { "prod.a": true, "prod.b": false };
    const { result } = renderHook(
      () => useIntroEligibility(["prod.a", "prod.b"]),
      { wrapper: wrap(makeAdapters(purchases), qc()) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ "prod.a": true, "prod.b": false });
  });

  it("surfaces a purchases error", async () => {
    const purchases = new MockPurchasesAdapter();
    purchases.nextIntroEligibilityError = {
      kind: "network",
      code: null,
      message: "offline",
    };
    const { result } = renderHook(() => useIntroEligibility(["prod.a"]), {
      wrapper: wrap(makeAdapters(purchases), qc()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.kind).toBe("network");
  });

  it("is disabled with no product ids", () => {
    const purchases = new MockPurchasesAdapter();
    const { result } = renderHook(() => useIntroEligibility([]), {
      wrapper: wrap(makeAdapters(purchases), qc()),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("is disabled when no purchases adapter is present", () => {
    const { result } = renderHook(() => useIntroEligibility(["prod.a"]), {
      wrapper: wrap(makeAdapters(undefined), qc()),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });
});
