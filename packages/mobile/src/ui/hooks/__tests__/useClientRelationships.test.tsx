import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { ok, fail, type ApiError } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useClientRelationships } from "@/ui/hooks/useClientRelationships";
import type { ClientTrainerRelationship } from "@/domain/models/clientRelationship";

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

function wrapperFor(api: StubApi) {
  const adapters = { api } as unknown as Adapters;
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

describe("useClientRelationships", () => {
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

  it("threads consent/consentVersion through to the adapter on accept (26-coach-data-sharing-consent)", async () => {
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
});
