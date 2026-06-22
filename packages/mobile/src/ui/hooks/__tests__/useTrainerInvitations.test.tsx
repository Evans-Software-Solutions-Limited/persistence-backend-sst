import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type {
  InviteClientResult,
  TrainerInvitation,
} from "@/domain/models/trainerInvitation";
import type { InviteApiError } from "@/domain/ports/api.port";
import type { ApiError, Result } from "@/shared/errors";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  useCancelInvitation,
  useGetInvitations,
  useInviteClient,
} from "@/ui/hooks/useTrainerInvitations";

function makeAdapters(api: InMemoryApiAdapter): Adapters {
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "trainer-1",
    email: "coach@example.com",
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
  return {
    api,
    auth,
    storage: new InMemoryStorageAdapter(),
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo: {} as Adapters["netInfo"],
  };
}

function makeSignedOutAdapters(api: InMemoryApiAdapter): Adapters {
  const auth = {
    getSession: jest.fn(async () => ok(null)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(null);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => null),
  } as unknown as Adapters["auth"];
  return {
    api,
    auth,
    storage: new InMemoryStorageAdapter(),
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
    netInfo: {} as Adapters["netInfo"],
  };
}

function wrap(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

const inv: TrainerInvitation = {
  id: "i1",
  trainerId: "trainer-1",
  clientEmail: "pending@x.com",
  relationshipReason: null,
  status: "pending",
  invitedAt: "2026-06-21T00:00:00.000Z",
  acceptedAt: null,
  cancelledAt: null,
};

describe("useGetInvitations", () => {
  it("fetches the pending list on mount", async () => {
    const api = new InMemoryApiAdapter();
    api.invitations = [inv];
    const { result } = renderHook(() => useGetInvitations(), {
      wrapper: wrap(makeAdapters(api)),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    expect(result.current.data[0].clientEmail).toBe("pending@x.com");
    expect(result.current.error).toBeNull();
  });

  it("surfaces an error when the fetch fails", async () => {
    const api = new InMemoryApiAdapter();
    api.shouldFail = true;
    const { result } = renderHook(() => useGetInvitations(), {
      wrapper: wrap(makeAdapters(api)),
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.data).toHaveLength(0);
  });

  it("refresh refetches the list", async () => {
    const api = new InMemoryApiAdapter();
    const { result } = renderHook(() => useGetInvitations(), {
      wrapper: wrap(makeAdapters(api)),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    api.invitations = [inv];
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.data).toHaveLength(1);
  });

  it("refresh is a no-op when signed out", async () => {
    const api = new InMemoryApiAdapter();
    api.invitations = [inv];
    const { result } = renderHook(() => useGetInvitations(), {
      wrapper: wrap(makeSignedOutAdapters(api)),
    });
    await act(async () => {
      await result.current.refresh();
    });
    expect(api.getInvitationsCalls).toBe(0);
    expect(result.current.data).toHaveLength(0);
  });

  it("does not refetch on re-render for the same user", async () => {
    const api = new InMemoryApiAdapter();
    api.invitations = [inv];
    const wrapper = wrap(makeAdapters(api));
    const { result, rerender } = renderHook(() => useGetInvitations(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));
    const before = api.getInvitationsCalls;
    rerender({});
    // Same signed-in user → the fetched-for guard short-circuits the effect.
    expect(api.getInvitationsCalls).toBe(before);
  });
});

describe("useInviteClient", () => {
  it("invokes the adapter and returns success", async () => {
    const api = new InMemoryApiAdapter();
    const { result } = renderHook(() => useInviteClient(), {
      wrapper: wrap(makeAdapters(api)),
    });
    let res: Result<InviteClientResult, InviteApiError> | undefined;
    await act(async () => {
      res = await result.current.mutate({ clientEmail: "a@b.com" });
    });
    expect(res?.ok).toBe(true);
    expect(api.inviteClientCalls[0].clientEmail).toBe("a@b.com");
  });

  it("propagates a domain error with its code", async () => {
    const api = new InMemoryApiAdapter();
    api.nextInviteError = { code: "no_slots", message: "full" };
    const { result } = renderHook(() => useInviteClient(), {
      wrapper: wrap(makeAdapters(api)),
    });
    let res: Result<InviteClientResult, InviteApiError> | undefined;
    await act(async () => {
      res = await result.current.mutate({ clientEmail: "a@b.com" });
    });
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error.inviteCode).toBe("no_slots");
  });
});

describe("useCancelInvitation", () => {
  it("invokes the adapter delete", async () => {
    const api = new InMemoryApiAdapter();
    api.invitations = [inv];
    const { result } = renderHook(() => useCancelInvitation(), {
      wrapper: wrap(makeAdapters(api)),
    });
    let res: Result<{ success: true }, ApiError> | undefined;
    await act(async () => {
      res = await result.current.mutate("i1");
    });
    expect(res?.ok).toBe(true);
    expect(api.cancelInvitationCalls).toContain("i1");
  });
});
