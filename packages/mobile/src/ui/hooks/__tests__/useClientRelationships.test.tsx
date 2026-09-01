import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ok, fail, type ApiError, type Result } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useClientRelationships } from "@/ui/hooks/useClientRelationships";
import type { ClientTrainerRelationship } from "@/domain/models/clientRelationship";
import type { AuthSession } from "@/domain/ports/auth.port";

function rel(
  over: Partial<ClientTrainerRelationship> = {},
): ClientTrainerRelationship {
  return {
    relationshipId: "rel-1",
    trainerId: "trainer-1",
    trainerName: "Coach",
    trainerRole: "personal_trainer",
    trainerAvatarUrl: null,
    status: "pending",
    relationshipReason: null,
    since: null,
    initiatedBy: "trainer",
    ...over,
  };
}

type StubApi = {
  getClientRelationships: jest.Mock;
  respondToRelationship: jest.Mock;
};

let userSequence = 0;

function sessionFor(userId: string): AuthSession {
  return {
    accessToken: "token",
    refreshToken: "refresh",
    userId,
    email: `${userId}@example.com`,
    expiresAt: Date.now() + 60_000,
  };
}

function wrapperFor(api: StubApi) {
  const session = sessionFor(`relationship-user-${++userSequence}`);
  const auth = {
    getPersistedSession: jest.fn(async () => session),
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn(() => () => {}),
  } as unknown as Adapters["auth"];
  const adapters = { api, auth } as unknown as Adapters;
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

function switchingUserHarness(api: StubApi) {
  let session = sessionFor(`relationship-user-${++userSequence}`);
  let listener:
    | ((next: AuthSession | null, event: "SIGNED_IN") => void)
    | undefined;
  const auth = {
    getPersistedSession: jest.fn(async () => session),
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn(
      (callback: (next: AuthSession | null, event: "SIGNED_IN") => void) => {
        listener = callback;
        return () => {};
      },
    ),
  } as unknown as Adapters["auth"];
  const adapters = { api, auth } as unknown as Adapters;
  return {
    wrapper({ children }: { children: ReactNode }) {
      return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
    },
    switchUser(userId: string) {
      session = sessionFor(userId);
      listener?.(session, "SIGNED_IN");
    },
  };
}

describe("useClientRelationships", () => {
  it("does not fetch when its rollout slice is disabled", async () => {
    const api: StubApi = {
      getClientRelationships: jest.fn(),
      respondToRelationship: jest.fn(),
    };
    const { result } = renderHook(
      () => useClientRelationships("active", false),
      { wrapper: wrapperFor(api) },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.data).toEqual([]);
    expect(api.getClientRelationships).not.toHaveBeenCalled();
  });

  it("loads relationships on mount", async () => {
    const api: StubApi = {
      getClientRelationships: jest.fn(async () => ok([rel()])),
      respondToRelationship: jest.fn(),
    };
    const { result } = renderHook(() => useClientRelationships("pending"), {
      wrapper: wrapperFor(api),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(api.getClientRelationships).toHaveBeenCalledWith("pending");
    expect(result.current.data).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  it("captures a fetch error", async () => {
    const err: ApiError = { kind: "api", code: "server", message: "boom" };
    const api: StubApi = {
      getClientRelationships: jest.fn(async () => fail(err)),
      respondToRelationship: jest.fn(),
    };
    const { result } = renderHook(() => useClientRelationships(), {
      wrapper: wrapperFor(api),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toEqual(err);
  });

  it("respond removes the row on success and clears the pending flag", async () => {
    const api: StubApi = {
      getClientRelationships: jest.fn(async () => ok([rel()])),
      respondToRelationship: jest.fn(async () => ok({})),
    };
    const { result } = renderHook(() => useClientRelationships("pending"), {
      wrapper: wrapperFor(api),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    await act(async () => {
      await result.current.respond("rel-1", "accept");
    });

    expect(api.respondToRelationship).toHaveBeenCalledWith(
      "rel-1",
      "accept",
      undefined,
      undefined,
    );
    expect(result.current.data).toHaveLength(0);
    expect(result.current.pendingIds.has("rel-1")).toBe(false);
  });

  it("threads consent/consentVersion through to the adapter on accept (28-coach-data-sharing-consent)", async () => {
    const api: StubApi = {
      getClientRelationships: jest.fn(async () => ok([rel()])),
      respondToRelationship: jest.fn(async () => ok({})),
    };
    const { result } = renderHook(() => useClientRelationships("pending"), {
      wrapper: wrapperFor(api),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    await act(async () => {
      await result.current.respond("rel-1", "accept", true, "v1-2026-07");
    });

    expect(api.respondToRelationship).toHaveBeenCalledWith(
      "rel-1",
      "accept",
      true,
      "v1-2026-07",
    );
  });

  it("respond keeps the row when the call fails", async () => {
    const err: ApiError = { kind: "api", code: "server", message: "no" };
    const api: StubApi = {
      getClientRelationships: jest.fn(async () => ok([rel()])),
      respondToRelationship: jest.fn(async () => fail(err)),
    };
    const { result } = renderHook(() => useClientRelationships("pending"), {
      wrapper: wrapperFor(api),
    });
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    await act(async () => {
      await result.current.respond("rel-1", "decline");
    });
    expect(result.current.data).toHaveLength(1);
  });

  it("refresh re-fetches", async () => {
    const api: StubApi = {
      getClientRelationships: jest.fn(async () => ok([rel()])),
      respondToRelationship: jest.fn(),
    };
    const { result } = renderHook(() => useClientRelationships(), {
      wrapper: wrapperFor(api),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await act(async () => {
      await result.current.refresh();
    });
    expect(api.getClientRelationships).toHaveBeenCalledTimes(2);
  });

  it("ignores an older same-key refresh that resolves after newer state", async () => {
    let resolveOlder!: (
      value: Result<ClientTrainerRelationship[], ApiError>,
    ) => void;
    const older = new Promise<Result<ClientTrainerRelationship[], ApiError>>(
      (resolve) => {
        resolveOlder = resolve;
      },
    );
    const api: StubApi = {
      getClientRelationships: jest
        .fn()
        .mockResolvedValueOnce(ok([rel({ status: "active" })]))
        .mockImplementationOnce(() => older)
        .mockResolvedValueOnce(ok([])),
      respondToRelationship: jest.fn(),
    };
    const wrapper = wrapperFor(api);
    const { result, unmount } = renderHook(
      () => useClientRelationships("active"),
      {
        wrapper,
      },
    );
    await waitFor(() => expect(result.current.data).toHaveLength(1));

    let olderRefresh!: Promise<void>;
    await act(async () => {
      olderRefresh = result.current.refresh();
      await result.current.refresh({ silent: true });
    });
    expect(result.current.data).toEqual([]);

    await act(async () => {
      resolveOlder(ok([rel({ status: "active" })]));
      await olderRefresh;
    });
    expect(result.current.data).toEqual([]);

    let resolveRemount!: (
      value: Result<ClientTrainerRelationship[], ApiError>,
    ) => void;
    api.getClientRelationships.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRemount = resolve;
        }),
    );
    unmount();
    const remounted = renderHook(() => useClientRelationships("active"), {
      wrapper,
    });
    await waitFor(() =>
      expect(api.getClientRelationships).toHaveBeenCalledTimes(4),
    );
    expect(remounted.result.current.data).toEqual([]);
    await act(async () => resolveRemount(ok([])));
  });

  it("does not expose the previous user's rows while an uncached key loads", async () => {
    let resolveSecond!: (
      value: Result<ClientTrainerRelationship[], ApiError>,
    ) => void;
    const second = new Promise<Result<ClientTrainerRelationship[], ApiError>>(
      (resolve) => {
        resolveSecond = resolve;
      },
    );
    const api: StubApi = {
      getClientRelationships: jest
        .fn()
        .mockResolvedValueOnce(ok([rel({ trainerName: "First coach" })]))
        .mockImplementationOnce(() => second),
      respondToRelationship: jest.fn(),
    };
    const harness = switchingUserHarness(api);
    const { result } = renderHook(() => useClientRelationships("active"), {
      wrapper: harness.wrapper,
    });
    await waitFor(() =>
      expect(result.current.data[0]?.trainerName).toBe("First coach"),
    );

    act(() => harness.switchUser("uncached-next-user"));
    expect(result.current.data).toEqual([]);
    expect(result.current.isLoading).toBe(true);

    resolveSecond(ok([rel({ trainerName: "Second coach" })]));
    await waitFor(() =>
      expect(result.current.data[0]?.trainerName).toBe("Second coach"),
    );
  });
});
