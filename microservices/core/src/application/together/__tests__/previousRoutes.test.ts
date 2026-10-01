import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  consent: vi.fn(),
  values: vi.fn(),
  wake: vi.fn(),
}));
vi.mock("../togetherRepository", () => ({
  TogetherRepository: class {
    previousConsent = mocks.consent;
    previousValues = mocks.values;
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
  owner = randomUUID(),
  key = randomUUID();
const body = { expectedVersion: 0, recipientIds: [owner] };
function request(
  path: string,
  method = "GET",
  payload?: unknown,
  auth = true,
  mutationKey: string | null = key,
) {
  return togetherRoutes.fetch(
    new Request(`http://localhost/together/sessions/${path}`, {
      method,
      headers: {
        ...(auth ? { authorization: `Bearer ${actor}` } : {}),
        ...(mutationKey ? { "idempotency-key": mutationKey } : {}),
        ...(payload === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }),
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.consent.mockResolvedValue({ version: 1, recipientIds: [owner] });
  mocks.values.mockResolvedValue({
    sessionId: id,
    ownerId: owner,
    consentVersion: 1,
    values: [],
  });
});
describe("Together PREV HTTP contract", () => {
  it("takes consent ownership only from auth, accepts empty revocation and wakes peers", async () => {
    const response = await request(`${id}/previous-consent`, "PUT", body);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      data: { version: 1, recipientIds: [owner] },
    });
    expect(mocks.consent).toHaveBeenCalledWith(actor, id, key, body);
    const revoke = { expectedVersion: 1, recipientIds: [] };
    expect(
      (await request(`${id}/previous-consent`, "PUT", revoke)).status,
    ).toBe(200);
    expect(mocks.consent).toHaveBeenLastCalledWith(actor, id, key, revoke);
    expect(mocks.wake).toHaveBeenCalledTimes(2);
  });
  it("passes authenticated recipient independently of the requested owner and prevents caching", async () => {
    const response = await request(`${id}/previous/${owner}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      data: { sessionId: id, ownerId: owner, consentVersion: 1, values: [] },
    });
    expect(mocks.values).toHaveBeenCalledWith(actor, id, owner);
    expect(mocks.wake).not.toHaveBeenCalled();
  });
  it("requires auth for both endpoints before data access", async () => {
    for (const [path, method, payload] of [
      [`${id}/previous/${owner}`, "GET", undefined],
      [`${id}/previous-consent`, "PUT", body],
    ] as const) {
      const response = await request(path, method, payload, false);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: { code: "UNAUTHENTICATED" },
      });
    }
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.consent).not.toHaveBeenCalled();
  });
  it("rejects missing version, negative/fractional versions, duplicate/oversized/malformed recipients and keys", async () => {
    for (const payload of [
      { recipientIds: [owner] },
      { ...body, expectedVersion: -1 },
      { ...body, expectedVersion: 1.5 },
      { ...body, recipientIds: [owner, owner] },
      { ...body, recipientIds: Array.from({ length: 4 }, () => randomUUID()) },
      { ...body, recipientIds: ["bad"] },
      { expectedVersion: 0 },
    ]) {
      const response = await request(`${id}/previous-consent`, "PUT", payload);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "INVALID_SCHEMA" },
      });
    }
    expect(
      (await request(`${id}/previous-consent`, "PUT", body, true, null)).status,
    ).toBe(400);
    expect(
      (await request(`${id}/previous-consent`, "PUT", body, true, "bad"))
        .status,
    ).toBe(400);
    expect((await request(`bad/previous/${owner}`)).status).toBe(400);
    expect((await request(`${id}/previous/bad`)).status).toBe(400);
    expect(mocks.values).not.toHaveBeenCalled();
    expect(mocks.consent).not.toHaveBeenCalled();
  });
  it("returns version conflicts and permission denial without historical content", async () => {
    mocks.consent.mockRejectedValue(
      new TogetherError("VERSION_CONFLICT", 409, "Consent changed", 2),
    );
    const conflict = await request(`${id}/previous-consent`, "PUT", body);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: {
        code: "VERSION_CONFLICT",
        message: "Consent changed",
        currentRevision: 2,
      },
    });
    mocks.values.mockRejectedValue(new TogetherError("FORBIDDEN", 403));
    const denied = await request(`${id}/previous/${owner}`);
    expect(denied.status).toBe(403);
    expect(await denied.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Request cannot be completed" },
    });
  });
});
