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

const mocks = vi.hoisted(() => ({
  tier: vi.fn(),
  preview: vi.fn(),
  refund: vi.fn(),
}));
vi.mock("../../repositories/foundingAdminRepository", async (original) => ({
  ...(await original<
    typeof import("../../repositories/foundingAdminRepository")
  >()),
  FoundingAdminRepository: class {
    changeTier = mocks.tier;
  },
}));
vi.mock("../../founding/foundingAdminService", () => ({
  FoundingAdminService: class {
    preview = mocks.preview;
    refund = mocks.refund;
  },
}));
import { FoundingAdminError } from "../../repositories/foundingAdminRepository";
import { adminFoundingActionsHandler } from "../founding-grants/adminFoundingActionsHandler";
const id = "00000000-0000-4000-8000-000000000003";
const call = (
  action: string,
  method = "POST",
  body: unknown = { reason: "Customer request" },
  auth: string | null = "admin",
  grantId = id,
) =>
  adminFoundingActionsHandler.handle(
    new Request(`http://localhost/admin/founding-grants/${grantId}/${action}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
    }),
  );
beforeEach(() => {
  vi.clearAllMocks();
  mocks.tier.mockResolvedValue({
    id,
    tierName: "premium_plus",
    expiresAt: null,
  });
  mocks.preview.mockResolvedValue({ remainingAmountMinor: 3000 });
  mocks.refund.mockResolvedValue({
    status: "pending",
    refundId: "re_1",
    reason: "Customer request",
  });
});
describe("admin founding action routes", () => {
  it.each(["change-tier", "refund"])(
    "requires authentication and admin privileges for POST %s",
    async (action) => {
      const body = { reason: "Customer request", tierName: "premium_plus" };
      expect((await call(action, "POST", body, null)).status).toBe(401);
      expect((await call(action, "POST", body, "user")).status).toBe(403);
      expect(mocks.tier).not.toHaveBeenCalled();
      expect(mocks.refund).not.toHaveBeenCalled();
    },
  );
  it("protects refund payment details", async () => {
    expect((await call("refund", "GET", undefined, null)).status).toBe(401);
    expect((await call("refund", "GET", undefined, "user")).status).toBe(403);
    expect(mocks.preview).not.toHaveBeenCalled();
  });
  it("passes the server-verified actor and trimmed reason for tier changes", async () => {
    const res = await call("change-tier", "POST", {
      tierName: "premium_plus",
      reason: "  Thank you  ",
      actorId: "spoof",
    });
    expect(res.status).toBe(200);
    expect(mocks.tier).toHaveBeenCalledWith(
      id,
      "premium_plus",
      "Thank you",
      "admin-1",
    );
  });
  it("returns a refund preview", async () => {
    const res = await call("refund", "GET");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { remainingAmountMinor: 3000 } });
  });
  it("initiates refund using the authenticated actor", async () => {
    const res = await call("refund");
    expect(res.status).toBe(200);
    expect(mocks.refund).toHaveBeenCalledWith(
      id,
      "Customer request",
      "admin-1",
    );
  });
  it.each(["", "  ", " ab ", "a", "a".repeat(501)])(
    "rejects invalid reason %s",
    async (reason) => {
      expect((await call("refund", "POST", { reason })).status).toBe(422);
      expect(mocks.refund).not.toHaveBeenCalled();
    },
  );
  it("rejects invalid grant ids", async () => {
    expect(
      (await call("refund", "GET", undefined, "admin", "bad")).status,
    ).toBe(422);
  });
  it.each([
    ["not_found", 404],
    ["revoked", 409],
    ["different_audience", 400],
    ["future_code", 409],
  ])("returns domain error %s", async (code, status) => {
    mocks.refund.mockRejectedValue(
      new FoundingAdminError(String(code), Number(status)),
    );
    const res = await call("refund");
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
  });
  it("does not leak Stripe error details", async () => {
    mocks.refund.mockRejectedValue(new Error("secret Stripe details"));
    const res = await call("refund");
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain("secret Stripe details");
  });
});
