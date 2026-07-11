import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import type {
  AcceptInviteCodeApiError,
  AcceptInviteCodeResult,
  TrainerInviteCode,
} from "@/domain/models/trainerInviteCode";
import type { RespondToClientRequestResult } from "@/domain/models/clientRelationship";
import type { ApiError, Result } from "@/shared/errors";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import {
  useAcceptInviteCode,
  useCreateInviteCode,
  useRespondToClientRequest,
} from "@/ui/hooks/useTrainerInviteCodes";

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

function wrap(adapters: Adapters) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  };
}

describe("useCreateInviteCode", () => {
  it("invokes the adapter and returns the minted code", async () => {
    const api = new InMemoryApiAdapter();
    const { result } = renderHook(() => useCreateInviteCode(), {
      wrapper: wrap(makeAdapters(api)),
    });
    let res: Result<TrainerInviteCode, ApiError> | undefined;
    expect(result.current.isPending).toBe(false);
    await act(async () => {
      res = await result.current.mutate();
    });
    expect(res?.ok).toBe(true);
    expect(api.createInviteCodeCalls).toBe(1);
    expect(result.current.isPending).toBe(false);
  });

  it("propagates a 402 entitlement denial", async () => {
    const api = new InMemoryApiAdapter();
    api.nextCreateInviteCodeError = {
      kind: "api",
      code: "entitlement_denied",
      message: "Client seat cap reached",
      status: 402,
      entitlement: {
        feature: "trainer_clients",
        currentTier: "individual_trainer",
        upgradeTo: "premium_trainer",
        upgradePriceMonthly: 29.99,
      },
    };
    const { result } = renderHook(() => useCreateInviteCode(), {
      wrapper: wrap(makeAdapters(api)),
    });
    let res: Result<TrainerInviteCode, ApiError> | undefined;
    await act(async () => {
      res = await result.current.mutate();
    });
    expect(res?.ok).toBe(false);
    if (res && !res.ok) {
      expect(res.error.code).toBe("entitlement_denied");
      expect(res.error.entitlement?.feature).toBe("trainer_clients");
    }
  });
});

describe("useAcceptInviteCode", () => {
  it("invokes the adapter with the code and returns success", async () => {
    const api = new InMemoryApiAdapter();
    const { result } = renderHook(() => useAcceptInviteCode(), {
      wrapper: wrap(makeAdapters(api)),
    });
    let res:
      | Result<AcceptInviteCodeResult, AcceptInviteCodeApiError>
      | undefined;
    await act(async () => {
      res = await result.current.mutate("AB23CD");
    });
    expect(res?.ok).toBe(true);
    expect(api.acceptInviteCodeCalls).toEqual(["AB23CD"]);
  });

  it.each([
    "invalid_code",
    "self_invite",
    "exists",
    "code_already_used",
    "coach_client_limit_reached",
  ] as const)("propagates a %s domain error with its code", async (code) => {
    const api = new InMemoryApiAdapter();
    api.nextAcceptInviteCodeError = { code, message: `failed: ${code}` };
    const { result } = renderHook(() => useAcceptInviteCode(), {
      wrapper: wrap(makeAdapters(api)),
    });
    let res:
      | Result<AcceptInviteCodeResult, AcceptInviteCodeApiError>
      | undefined;
    await act(async () => {
      res = await result.current.mutate("BAD000");
    });
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error.acceptCode).toBe(code);
  });
});

describe("useRespondToClientRequest", () => {
  it("invokes the adapter with relationshipId + action and returns success", async () => {
    const api = new InMemoryApiAdapter();
    const { result } = renderHook(() => useRespondToClientRequest(), {
      wrapper: wrap(makeAdapters(api)),
    });
    let res: Result<RespondToClientRequestResult, ApiError> | undefined;
    await act(async () => {
      res = await result.current.mutate("rel-1", "accept");
    });
    expect(res?.ok).toBe(true);
    expect(api.respondToClientRelationshipCalls).toEqual([
      { relationshipId: "rel-1", action: "accept" },
    ]);
    if (res && res.ok) expect(res.value.status).toBe("active");
  });

  it("propagates a 402 entitlement denial on accept-at-cap", async () => {
    const api = new InMemoryApiAdapter();
    api.nextRespondToClientError = {
      kind: "api",
      code: "entitlement_denied",
      message: "Client seat cap reached",
      status: 402,
      entitlement: {
        feature: "trainer_clients",
        currentTier: "individual_trainer",
        upgradeTo: "premium_trainer",
        upgradePriceMonthly: 29.99,
      },
    };
    const { result } = renderHook(() => useRespondToClientRequest(), {
      wrapper: wrap(makeAdapters(api)),
    });
    let res: Result<RespondToClientRequestResult, ApiError> | undefined;
    await act(async () => {
      res = await result.current.mutate("rel-1", "accept");
    });
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error.code).toBe("entitlement_denied");
  });

  it("propagates a 404 when the relationship isn't found", async () => {
    const api = new InMemoryApiAdapter();
    api.nextRespondToClientError = {
      kind: "api",
      code: "not_found",
      message: "Not found",
      status: 404,
    };
    const { result } = renderHook(() => useRespondToClientRequest(), {
      wrapper: wrap(makeAdapters(api)),
    });
    let res: Result<RespondToClientRequestResult, ApiError> | undefined;
    await act(async () => {
      res = await result.current.mutate("rel-missing", "decline");
    });
    expect(res?.ok).toBe(false);
    if (res && !res.ok) expect(res.error.code).toBe("not_found");
  });
});
