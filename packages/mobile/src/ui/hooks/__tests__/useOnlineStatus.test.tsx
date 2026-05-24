import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useOnlineStatus } from "@/ui/hooks/useOnlineStatus";

function makeAdapters(initialConnected: boolean = true): {
  adapters: Adapters;
  netInfo: InMemoryNetInfoAdapter;
} {
  const netInfo = new InMemoryNetInfoAdapter(initialConnected);
  const adapters: Adapters = {
    api: new InMemoryApiAdapter(),
    auth: new InMemoryAuthAdapter(),
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo,
  };
  return { adapters, netInfo };
}

function wrap(adapters: Adapters) {
  return function TestWrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

describe("useOnlineStatus", () => {
  it("returns true when the adapter reports connected", async () => {
    const { adapters } = makeAdapters(true);
    const { result } = renderHook(() => useOnlineStatus(), {
      wrapper: wrap(adapters),
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("returns false when the adapter reports disconnected", async () => {
    const { adapters } = makeAdapters(false);
    const { result } = renderHook(() => useOnlineStatus(), {
      wrapper: wrap(adapters),
    });
    await waitFor(() => expect(result.current).toBe(false));
  });

  it("updates when the adapter transitions online → offline → online", async () => {
    const { adapters, netInfo } = makeAdapters(true);
    const { result } = renderHook(() => useOnlineStatus(), {
      wrapper: wrap(adapters),
    });
    await waitFor(() => expect(result.current).toBe(true));

    act(() => {
      netInfo.setConnected(false);
    });
    await waitFor(() => expect(result.current).toBe(false));

    act(() => {
      netInfo.setConnected(true);
    });
    await waitFor(() => expect(result.current).toBe(true));
  });

  it("unsubscribes on unmount (no listener leak)", async () => {
    const { adapters, netInfo } = makeAdapters(true);
    const { unmount } = renderHook(() => useOnlineStatus(), {
      wrapper: wrap(adapters),
    });
    // Wait for the subscription side-effect.
    await waitFor(() => expect(netInfo.subscriberCount).toBe(1));
    unmount();
    expect(netInfo.subscriberCount).toBe(0);
  });

  it("swallows probe failures and defaults to true until a transition arrives", async () => {
    // Custom adapter that fails the initial probe — simulates RN
    // NetInfo's `fetch()` throwing on a Jest device with no native
    // bindings. The hook MUST NOT propagate the error to the React
    // tree; it should keep the optimistic default and let the
    // subscription stream correct it.
    const probeError = new Error("netinfo probe failed");
    const flakyAdapter = new InMemoryNetInfoAdapter(false);
    jest.spyOn(flakyAdapter, "isConnected").mockRejectedValueOnce(probeError);

    const adapters: Adapters = {
      api: new InMemoryApiAdapter(),
      auth: new InMemoryAuthAdapter(),
      storage: new InMemoryStorageAdapter(),
      health: new StubHealthAdapter(),
      notifications: new StubNotificationsAdapter(),
      payments: new MockPaymentsAdapter(),
      netInfo: flakyAdapter,
    };

    const { result } = renderHook(() => useOnlineStatus(), {
      wrapper: wrap(adapters),
    });

    // Probe rejected; the hook keeps the optimistic default `true`
    // (no transition from the adapter yet because subscribe doesn't
    // emit on attach in InMemoryNetInfoAdapter).
    await waitFor(() => expect(result.current).toBe(true));

    // Now flip via subscribe — the value updates.
    act(() => {
      flakyAdapter.setConnected(true);
      flakyAdapter.setConnected(false);
    });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
