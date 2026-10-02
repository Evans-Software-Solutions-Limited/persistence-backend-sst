import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  complete: vi.fn(),
  review: vi.fn(),
  close: vi.fn(),
  trust: vi.fn(),
  register: vi.fn(),
  revoke: vi.fn(),
  friendship: vi.fn(),
  recover: vi.fn(),
  getRecovery: vi.fn(),
  wake: vi.fn(),
}));
vi.mock("../completionRepository", () => ({
  TogetherCompletionRepository: class {
    completeOffline = mocks.complete;
    reviewCloud = mocks.review;
  },
}));
vi.mock("../offlineRepository", () => ({
  TogetherOfflineRepository: class {
    trust = mocks.trust;
    register = mocks.register;
    revoke = mocks.revoke;
    friendship = mocks.friendship;
    recover = mocks.recover;
    getRecovery = mocks.getRecovery;
  },
}));
vi.mock("../togetherRepository", () => ({
  TogetherRepository: class {
    close = mocks.close;
  },
}));
vi.mock("../transport", () => ({ wakeTogether: mocks.wake }));
vi.mock("../shared", async (original) => ({
  ...(await original<typeof import("../shared")>()),
  withActors: async (_ids: string[], action: (tx: unknown) => unknown) =>
    action({}),
  enforceRateLimit: vi.fn(),
}));
vi.mock("@persistence/api-utils/auth/supabaseAuth", async (original) => ({
  ...(await original<
    typeof import("@persistence/api-utils/auth/supabaseAuth")
  >()),
  getAuthUser: async (authorization: string | undefined) =>
    authorization?.startsWith("Bearer ")
      ? { sub: authorization.slice(7) }
      : null,
}));
import { togetherRoutes } from "../togetherRoutes";
import { TogetherError } from "../shared";
const actor = randomUUID(),
  id = randomUUID(),
  key = randomUUID();
const registration = {
  payload: {
    kind: "together-register-v1",
    userId: actor,
    deviceId: id,
    publicKey: "validated-by-repository",
    requestId: key,
    timestamp: Date.now(),
  },
  signature: "a".repeat(86),
};
const sessionId = randomUUID(),
  executionId = randomUUID(),
  planExerciseId = randomUUID();
const recovery = {
  credential: {
    payload: {
      kind: "together-device-v1",
      keyId: "current",
      userId: actor,
      deviceId: id,
      publicKey: "public",
      issuedAt: 1,
      expiresAt: 100,
    },
    signature: "a".repeat(86),
  },
  sessionId,
  executionId,
  startedAt: 1,
  plan: {
    name: "Offline workout",
    exercises: [
      { planExerciseId, exerciseId: randomUUID(), order: 0, targetSets: 3 },
    ],
  },
  commands: [
    {
      payload: {
        kind: "together-recovery-v1",
        userId: actor,
        sessionId,
        executionId,
        startedAt: 1,
        commandId: randomUUID(),
        planHash: "a".repeat(64),
        expectedVersion: 0,
        operation: {
          type: "upsertSet",
          planExerciseId,
          set: { setId: randomUUID(), reps: 5, weightKg: 60, completed: true },
        },
      },
      signature: "a".repeat(86),
    },
  ],
};
function request(
  path: string,
  method = "GET",
  body?: unknown,
  options: { auth?: boolean; key?: string | null } = {},
) {
  return togetherRoutes.handle(
    new Request(`http://localhost/together/offline${path}`, {
      method,
      headers: {
        ...(options.auth === false ? {} : { authorization: `Bearer ${actor}` }),
        ...(options.key === null
          ? {}
          : { "idempotency-key": options.key ?? key }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  for (const mock of Object.values(mocks)) mock.mockResolvedValue({ ok: true });
});
describe("offline HTTP contract", () => {
  it("derives the acting account from auth for public-key retrieval and owner reads", async () => {
    mocks.trust.mockResolvedValue({ publicKeys: { current: "public-only" } });
    const trust = await request("/trust");
    expect(trust.status).toBe(200);
    expect(await trust.json()).toEqual({
      data: { publicKeys: { current: "public-only" } },
    });
    expect(mocks.trust).toHaveBeenCalledWith(actor);
    expect((await request(`/recovery/${id}`)).status).toBe(200);
    expect(mocks.getRecovery).toHaveBeenCalledWith(actor, id);
  });
  it("passes signed registration and the HTTP identity without substituting a body account", async () => {
    const body = {
      ...registration,
      payload: { ...registration.payload, userId: randomUUID() },
    };
    expect((await request("/devices", "POST", body)).status).toBe(200);
    expect(mocks.register).toHaveBeenCalledWith(actor, key, body);
  });
  it("requires authentication before every repository operation", async () => {
    for (const [path, method, body] of [
      ["/trust", "GET", undefined],
      ["/recovery", "POST", recovery],
      ["/devices", "POST", registration],
      [`/devices/${id}`, "DELETE", undefined],
      ["/friendship-proof", "POST", { friendId: id }],
      [`/recovery/${id}`, "GET", undefined],
    ] as const) {
      const response = await request(path, method, body, { auth: false });
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "UNAUTHENTICATED" },
      });
    }
    for (const mock of [
      mocks.trust,
      mocks.register,
      mocks.revoke,
      mocks.friendship,
      mocks.getRecovery,
      mocks.recover,
    ])
      expect(mock).not.toHaveBeenCalled();
  });
  it("rejects malformed registration signatures, UUIDs and missing mutation keys", async () => {
    for (const body of [
      { ...registration, signature: "bad" },
      {
        ...registration,
        payload: { ...registration.payload, deviceId: "bad" },
      },
      { ...registration, payload: { ...registration.payload, timestamp: -1 } },
    ]) {
      const response = await request("/devices", "POST", body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_SCHEMA" },
      });
    }
    expect(
      (await request("/devices", "POST", registration, { key: null })).status,
    ).toBe(400);
    expect(mocks.register).not.toHaveBeenCalled();
  });
  it("dispatches owner recovery and returns the explicit unsaved review state", async () => {
    const result = {
      status: "stored_for_review",
      sharingActive: false,
      historySaved: false,
      executionId,
      revision: 1,
    };
    mocks.recover.mockResolvedValue(result);
    const response = await request("/recovery", "POST", recovery);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: result });
    expect(mocks.recover).toHaveBeenCalledWith(actor, key, recovery);
    expect(
      (await request("/recovery", "POST", recovery, { key: null })).status,
    ).toBe(400);
    expect(
      (await request("/recovery", "POST", { ...recovery, commands: [] }))
        .status,
    ).toBe(400);
    const delegated = structuredClone(recovery);
    delegated.commands[0].payload.operation = {
      type: "replacePlan",
      plan: recovery.plan,
    } as unknown as (typeof delegated.commands)[0]["payload"]["operation"];
    expect((await request("/recovery", "POST", delegated)).status).toBe(400);
    expect(mocks.recover).toHaveBeenCalledTimes(1);
  });
  it("requires mutation keys for revocation and pair evidence", async () => {
    expect((await request(`/devices/${id}`, "DELETE")).status).toBe(200);
    expect(mocks.revoke).toHaveBeenCalledWith(actor, id, key);
    expect(
      (await request("/friendship-proof", "POST", { friendId: id })).status,
    ).toBe(200);
    expect(mocks.friendship).toHaveBeenCalledWith(actor, id, key);
    expect(
      (await request(`/devices/${id}`, "DELETE", undefined, { key: null }))
        .status,
    ).toBe(400);
    expect(
      (
        await request(
          "/friendship-proof",
          "POST",
          { friendId: id },
          { key: null },
        )
      ).status,
    ).toBe(400);
  });
  it.each(["FRIENDSHIP_NOT_ACCEPTED", "FORBIDDEN"])(
    "preserves friendship decision %s in the existing error envelope",
    async (code) => {
      mocks.friendship.mockRejectedValue(new TogetherError(code, 403));
      const response = await request("/friendship-proof", "POST", {
        friendId: id,
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: { code, message: "Request cannot be completed" },
      });
    },
  );
  it("exposes domain failures without issuing a success receipt", async () => {
    mocks.register.mockRejectedValue(new TogetherError("DEVICE_REVOKED", 403));
    const response = await request("/devices", "POST", registration);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: "DEVICE_REVOKED", message: "Request cannot be completed" },
    });
  });
});

describe("reviewed completion routes", () => {
  const paths = [
    {
      path: `/together/offline/recovery/${executionId}/complete`,
      body: { expectedRevision: 1, completedAt: new Date().toISOString() },
      mock: mocks.complete,
      id: executionId,
    },
    {
      path: `/together/sessions/${sessionId}/review`,
      body: { expectedOwnRevision: 1, execution: { exercises: [] } },
      mock: mocks.review,
      id: sessionId,
    },
    {
      path: `/together/sessions/${sessionId}/close`,
      body: { expectedRevision: 1, expectedOwnRevision: 0, mode: "finish_all" },
      mock: mocks.close,
      id: sessionId,
    },
  ];
  it.each(paths)(
    "authorizes and forwards $path",
    async ({ path, body, mock, id }) => {
      mock.mockResolvedValue({ status: "saved" });
      const response = await togetherRoutes.handle(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${actor}`,
            "idempotency-key": key,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(200);
      expect(mock).toHaveBeenCalledWith(actor, id, key, body);
    },
  );
  it.each(paths)(
    "requires auth and valid body for $path",
    async ({ path, body, mock }) => {
      const response = await togetherRoutes.handle(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: {
            "idempotency-key": key,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(401);
      const invalid = await togetherRoutes.handle(
        new Request(`http://localhost${path}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${actor}`,
            "idempotency-key": key,
            "content-type": "application/json",
          },
          body: "{}",
        }),
      );
      expect(invalid.status).toBe(400);
      expect(mock).not.toHaveBeenCalled();
    },
  );
});
