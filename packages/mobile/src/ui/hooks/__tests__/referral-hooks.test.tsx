import { act, renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  referralQueryKey,
  useAppliedReferral,
} from "@/ui/hooks/useAppliedReferral";
import { useClaimReferral } from "@/ui/hooks/useClaimReferral";

const applied = {
  code: "UONFRESHERS",
  label: "UoN Freshers",
  partnerName: "University of Nottingham",
  lockedAt: null,
};

function setup(signedIn = true) {
  const api = new InMemoryApiAdapter();
  const auth = new InMemoryAuthAdapter();
  if (signedIn) {
    auth.currentSession = {
      accessToken: "tok",
      refreshToken: "rtok",
      userId: "u-1",
      email: "person@example.com",
      expiresAt: Date.now() + 60_000,
    };
  }
  const adapters: Adapters = {
    api,
    auth,
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
      </QueryClientProvider>
    );
  }
  return { api, queryClient, Wrapper };
}

describe("referral hooks", () => {
  it("does not fetch a referral before auth supplies a user id", () => {
    const { api, Wrapper } = setup(false);
    // A fresh adapter without a current session exercises the anonymous key.
    const getSpy = jest.spyOn(api, "getAppliedReferral");
    const { result } = renderHook(() => useAppliedReferral(), {
      wrapper: Wrapper,
    });
    expect(result.current.fetchStatus).toBe("idle");
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("loads the signed-in user's applied referral with the user-scoped key", async () => {
    const { api, queryClient, Wrapper } = setup();
    api.appliedReferral = applied;

    const { result } = renderHook(() => useAppliedReferral(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(applied);
    expect(queryClient.getQueryData(referralQueryKey("u-1"))).toEqual(applied);
  });

  it("surfaces a referral-read failure", async () => {
    const { api, Wrapper } = setup();
    api.shouldFail = true;
    const { result } = renderHook(() => useAppliedReferral(), {
      wrapper: Wrapper,
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe("Test error");
  });

  it("claims immediately and updates the applied-referral cache", async () => {
    const { api, queryClient, Wrapper } = setup();
    const { result } = renderHook(
      () => ({ applied: useAppliedReferral(), claim: useClaimReferral() }),
      { wrapper: Wrapper },
    );

    await waitFor(() => expect(result.current.applied.isSuccess).toBe(true));

    await result.current.claim.mutateAsync("UONFRESHERS");

    expect(api.claimReferralCalls).toEqual(["UONFRESHERS"]);
    expect(queryClient.getQueryData(referralQueryKey("u-1"))).toMatchObject({
      code: "UONFRESHERS",
    });
  });

  it("can claim before a user id is available without populating a user cache", async () => {
    const { api, queryClient, Wrapper } = setup(false);
    const { result } = renderHook(() => useClaimReferral(), {
      wrapper: Wrapper,
    });

    await result.current.mutateAsync("UONFRESHERS");

    expect(api.claimReferralCalls).toEqual(["UONFRESHERS"]);
    expect(queryClient.getQueryData(referralQueryKey("u-1"))).toBeUndefined();
  });

  it("surfaces the server message verbatim", async () => {
    const { api, Wrapper } = setup();
    api.shouldFail = true;
    api.failError = {
      kind: "api",
      code: "not_found",
      status: 404,
      message: "That code isn't valid",
    };
    const { result } = renderHook(() => useClaimReferral(), {
      wrapper: Wrapper,
    });

    await expect(result.current.mutateAsync("NOPE")).rejects.toMatchObject({
      message: "That code isn't valid",
    });
  });

  it("can abort and reset an in-flight claim", async () => {
    const { api, Wrapper } = setup();
    let aborted = false;
    jest.spyOn(api, "claimReferral").mockImplementation(
      (_code, signal) =>
        new Promise((resolve) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            resolve({
              ok: false,
              error: {
                kind: "api",
                code: "network",
                message: "Request cancelled",
              },
            });
          });
        }),
    );
    const { result } = renderHook(
      () => ({ applied: useAppliedReferral(), claim: useClaimReferral() }),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.applied.isSuccess).toBe(true));

    act(() => result.current.claim.mutate("UONFRESHERS"));
    await waitFor(() => expect(api.claimReferral).toHaveBeenCalledTimes(1));
    act(() => result.current.claim.cancel());

    expect(aborted).toBe(true);
  });

  it("keeps the newest overlapping claim cancellable after the first settles", async () => {
    const { api, Wrapper } = setup();
    const signals: AbortSignal[] = [];
    jest.spyOn(api, "claimReferral").mockImplementation(
      (_code, signal) =>
        new Promise((resolve) => {
          if (signal) signals.push(signal);
          signal?.addEventListener("abort", () => {
            resolve({
              ok: false,
              error: {
                kind: "api",
                code: "network",
                message: "Request cancelled",
              },
            });
          });
        }),
    );
    const { result } = renderHook(() => useClaimReferral(), {
      wrapper: Wrapper,
    });

    act(() => result.current.mutate("FIRST"));
    await waitFor(() => expect(signals).toHaveLength(1));

    act(() => result.current.reset());
    act(() => result.current.mutate("SECOND"));
    await waitFor(() => expect(signals).toHaveLength(2));
    expect(signals[0].aborted).toBe(true);

    act(() => result.current.cancel());
    expect(signals[1].aborted).toBe(true);
  });
});
