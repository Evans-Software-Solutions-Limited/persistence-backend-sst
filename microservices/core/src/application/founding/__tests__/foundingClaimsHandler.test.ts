import { beforeEach, describe, it, expect, vi } from "vitest";
// Real requireAdmin/isAdmin; only token verification is faked so the tests
// drive the guard with admin / non-admin / missing users.
vi.mock("@persistence/api-utils/auth/supabaseAuth", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@persistence/api-utils/auth/supabaseAuth")
    >();
  return {
    ...actual,
    getAuthUser: vi.fn(async (authHeader: string | undefined) => {
      if (authHeader === "Bearer admin") {
        return {
          sub: "admin-1",
          email: "brad@x.co",
          email_verified: true,
          iat: 0,
          exp: 9e9,
          app_metadata: { admin: true },
        };
      }
      if (authHeader === "Bearer user") {
        return {
          sub: "user-1",
          email: "u@x.co",
          email_verified: true,
          iat: 0,
          exp: 9e9,
          app_metadata: {},
        };
      }
      return null;
    }),
  };
});

const mocks = vi.hoisted(() => ({ request: vi.fn(), verify: vi.fn() }));
vi.mock("../foundingClaimService", () => ({
  FoundingClaimService: class {
    request = mocks.request;
    verify = mocks.verify;
  },
}));
import { foundingClaimsHandler } from "../foundingClaimsHandler";
import { subscriptionsRoutes } from "../../subscriptionsRoutes";
import { FoundingClaimError } from "../../repositories/foundingClaimRepository";
import { VoucherError } from "../../vouchers/voucherRules";
const id = "00000000-0000-4000-8000-000000000044";
const req = (path: string, body: unknown, auth = true) =>
  foundingClaimsHandler.handle(
    new Request(`http://localhost/founding/claims/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: "Bearer user" } : {}),
      },
      body: JSON.stringify(body),
    }),
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.request.mockResolvedValue({ challengeId: id });
  mocks.verify.mockResolvedValue({
    claimed: true,
    tierName: "premium",
    expiresAt: null,
  });
});
describe("founding claim routes", () => {
  it("requires authentication", async () => {
    expect(
      (await req("request", { email: "buyer@example.test" }, false)).status,
    ).toBe(401);
    expect(
      (await req("verify", { challengeId: id, code: "123456" }, false)).status,
    ).toBe(401);
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it("uses authenticated account identity for both steps", async () => {
    expect(
      (await req("request", { email: "buyer@example.test", userId: "spoof" }))
        .status,
    ).toBe(200);
    expect(mocks.request).toHaveBeenCalledWith("user-1", "buyer@example.test");
    expect(
      (await req("verify", { challengeId: id, code: "123456" })).status,
    ).toBe(200);
    expect(mocks.verify).toHaveBeenCalledWith("user-1", id, "123456");
  });
  it.each([
    { challengeId: "bad", code: "123456" },
    { challengeId: id, code: "12345" },
    { challengeId: id, code: "abcdef" },
  ])("rejects malformed code/identity", async (body) => {
    expect((await req("verify", body)).status).toBe(422);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it.each([new FoundingClaimError(), new VoucherError("rate_limited", 429)])(
    "surfaces safe domain errors",
    async (error) => {
      mocks.verify.mockRejectedValue(error);
      const res = await req("verify", { challengeId: id, code: "123456" });
      expect(res.status).toBe(error.status);
      expect(await res.json()).toMatchObject({ code: error.code });
    },
  );
  it("hides unexpected internal error details", async () => {
    mocks.request.mockRejectedValue(new Error("secret"));
    const res = await req("request", { email: "buyer@example.test" });
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("secret");
  });
});

describe("claim routes mounted in subscriptionsRoutes", () => {
  it("retains authentication on both mounted claim endpoints", async () => {
    for (const [path, body] of [
      ["request", { email: "buyer@example.test" }],
      ["verify", { challengeId: id, code: "123456" }],
    ] as const) {
      const response = await subscriptionsRoutes.handle(
        new Request(`http://localhost/founding/claims/${path}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(401);
    }
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("reaches both real mounted handlers using the authenticated customer identity", async () => {
    const request = (path: string, body: unknown) =>
      subscriptionsRoutes.handle(
        new Request(`http://localhost/founding/claims/${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer user",
          },
          body: JSON.stringify(body),
        }),
      );
    const challenge = await request("request", {
      email: "buyer@example.test",
      userId: "spoof",
    });
    expect(challenge.status).toBe(200);
    expect(await challenge.json()).toEqual({ data: { challengeId: id } });
    const verified = await request("verify", {
      challengeId: id,
      code: "123456",
    });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({
      data: { claimed: true, tierName: "premium" },
    });
    expect(mocks.request).toHaveBeenCalledWith("user-1", "buyer@example.test");
    expect(mocks.verify).toHaveBeenCalledWith("user-1", id, "123456");
  });
});
