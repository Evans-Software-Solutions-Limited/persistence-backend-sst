import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppState, type AppStateStatus } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPurchasesAdapter } from "@/adapters/purchases/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type {
  PurchaseProduct,
  PurchasesPort,
} from "@/domain/ports/purchases.port";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  PURCHASE_OFFERINGS_STALE_TIME_MS,
  usePurchaseOfferings,
} from "@/ui/hooks/usePurchaseOfferings";

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

const PKG: PurchaseProduct = {
  packageId: "$rc_monthly",
  productId: "app.persistence.premium.monthly",
  tier: "premium",
  billingCycle: "monthly",
  price: 9.99,
  priceString: "£9.99",
  pricePerMonthString: "£9.99",
  introTrialDays: null,
};

describe("usePurchaseOfferings", () => {
  it("treats storefront-localised offerings as immediately stale", () => {
    expect(PURCHASE_OFFERINGS_STALE_TIME_MS).toBe(0);
  });

  it("resolves the offering packages", async () => {
    const purchases = new MockPurchasesAdapter();
    purchases.packages = [PKG];
    const { result } = renderHook(() => usePurchaseOfferings(), {
      wrapper: wrap(makeAdapters(purchases), qc()),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([PKG]);
  });

  it("refreshes storefront-localised offerings after returning to the foreground", async () => {
    let appStateHandler: ((state: AppStateStatus) => void) | undefined;
    const remove = jest.fn();
    const appStateSpy = jest
      .spyOn(AppState, "addEventListener")
      .mockImplementation((_event, handler) => {
        appStateHandler = handler;
        return { remove };
      });
    const purchases = new MockPurchasesAdapter();
    purchases.packages = [PKG];

    try {
      const { result, unmount } = renderHook(() => usePurchaseOfferings(), {
        wrapper: wrap(makeAdapters(purchases), qc()),
      });
      await waitFor(() => expect(result.current.data).toEqual([PKG]));

      purchases.packages = [
        {
          ...PKG,
          price: 12.99,
          priceString: "US$12.99",
          pricePerMonthString: "US$12.99",
        },
      ];
      act(() => {
        appStateHandler?.("background");
        appStateHandler?.("active");
      });

      await waitFor(() => expect(purchases.getPackagesCalls).toBe(2));
      await waitFor(() =>
        expect(result.current.data?.[0]?.priceString).toBe("US$12.99"),
      );
      unmount();
      expect(remove).toHaveBeenCalledTimes(1);
    } finally {
      appStateSpy.mockRestore();
    }
  });

  it("surfaces a purchases error", async () => {
    const purchases = new MockPurchasesAdapter();
    purchases.nextPackagesError = {
      kind: "network",
      code: null,
      message: "offline",
    };
    const { result } = renderHook(() => usePurchaseOfferings(), {
      wrapper: wrap(makeAdapters(purchases), qc()),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.kind).toBe("network");
  });

  it("is disabled when no purchases adapter is present", () => {
    const { result } = renderHook(() => usePurchaseOfferings(), {
      wrapper: wrap(makeAdapters(undefined), qc()),
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });
});
