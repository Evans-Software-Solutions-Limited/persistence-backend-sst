import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { Adapters } from "@/shared/types";
import type { ApiProfile } from "@/domain/ports/api.port";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useRestoreAccount } from "@/ui/hooks/useRestoreAccount";

function wrapper(adapters: Adapters, queryClient: QueryClient) {
  function TestWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
      </QueryClientProvider>
    );
  }
  return TestWrapper;
}

function makeSoftDeletedProfile(): ApiProfile {
  return {
    id: "u1",
    email: "u1@example.com",
    fullName: "Test User",
    role: "user",
    fitnessLevel: null,
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    deletedAt: "2026-07-01T00:00:00.000Z",
    purgeAfter: "2026-07-31T00:00:00.000Z",
  };
}

function makeAdapters(): { adapters: Adapters; api: InMemoryApiAdapter } {
  const api = new InMemoryApiAdapter();
  const adapters: Adapters = {
    api,
    auth: new InMemoryAuthAdapter(),
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, api };
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe("useRestoreAccount", () => {
  it("restores a soft-deleted profile and clears deletedAt/purgeAfter", async () => {
    const { adapters, api } = makeAdapters();
    api.profiles = [makeSoftDeletedProfile()];

    const { result } = renderHook(() => useRestoreAccount(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });

    const value = await result.current.mutateAsync();
    expect(value).toEqual({ restored: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(api.profiles[0]?.deletedAt).toBeNull();
    expect(api.profiles[0]?.purgeAfter).toBeNull();
  });

  it("invalidates the legacy-parity profile cache keys on success", async () => {
    const { adapters, api } = makeAdapters();
    api.profiles = [makeSoftDeletedProfile()];
    const queryClient = makeQueryClient();
    const spy = jest.spyOn(queryClient, "invalidateQueries");

    const { result } = renderHook(() => useRestoreAccount(), {
      wrapper: wrapper(adapters, queryClient),
    });
    await result.current.mutateAsync();

    const keys = spy.mock.calls.map((call) => call[0]?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([["user-profile"], ["profile-data"]]),
    );
  });

  it("rejects with a 409 api error when the account isn't soft-deleted", async () => {
    const { adapters, api } = makeAdapters();
    api.profiles = [
      { ...makeSoftDeletedProfile(), deletedAt: null, purgeAfter: null },
    ];

    const { result } = renderHook(() => useRestoreAccount(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });

    await expect(result.current.mutateAsync()).rejects.toMatchObject({
      kind: "api",
      status: 409,
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });

  it("surfaces a generic api error when the call fails", async () => {
    const { adapters, api } = makeAdapters();
    api.profiles = [makeSoftDeletedProfile()];
    api.shouldFail = true;

    const { result } = renderHook(() => useRestoreAccount(), {
      wrapper: wrapper(adapters, makeQueryClient()),
    });

    await expect(result.current.mutateAsync()).rejects.toMatchObject({
      kind: "api",
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});
