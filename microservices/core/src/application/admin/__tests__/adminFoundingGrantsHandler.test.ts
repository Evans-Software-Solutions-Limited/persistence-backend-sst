/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const grantMock = vi.fn();
const revokeMock = vi.fn();
const listMock = vi.fn(async () => []);
vi.mock("../../founding/foundingGrantService", () => ({
  FoundingGrantService: vi.fn().mockImplementation(() => ({
    grant: grantMock,
    revoke: revokeMock,
    resendInvite: vi.fn(),
  })),
}));
vi.mock("../../repositories/foundingGrantRepository", () => ({
  FoundingGrantRepository: vi
    .fn()
    .mockImplementation(() => ({ list: listMock })),
}));

function req(path: string, init: RequestInit & { auth?: string } = {}) {
  const { auth, ...rest } = init;
  return new Request(`http://localhost${path}`, {
    ...rest,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { authorization: auth } : {}),
      ...(rest.headers ?? {}),
    },
  });
}

describe("adminFoundingGrantsHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it("401s without a token and 403s a non-admin with a constant body", async () => {
    const { adminFoundingGrantsHandler } =
      await import("../founding-grants/adminFoundingGrantsHandler");
    const anon = await adminFoundingGrantsHandler.handle(
      req("/admin/founding-grants"),
    );
    expect(anon.status).toBe(401);
    const user = await adminFoundingGrantsHandler.handle(
      req("/admin/founding-grants", { auth: "Bearer user" }),
    );
    expect(user.status).toBe(403);
    expect(await user.json()).toEqual({ message: "Forbidden" });
    expect(listMock).not.toHaveBeenCalled();
  });

  it("lists for an admin", async () => {
    const { adminFoundingGrantsHandler } =
      await import("../founding-grants/adminFoundingGrantsHandler");
    const res = await adminFoundingGrantsHandler.handle(
      req("/admin/founding-grants?revoked=false", { auth: "Bearer admin" }),
    );
    expect(res.status).toBe(200);
    expect(listMock).toHaveBeenCalledWith({ revoked: false, limit: undefined });
  });

  it("creates a grant with the JWT subject as actor and returns 201", async () => {
    grantMock.mockResolvedValue({
      ok: true,
      result: {
        grantId: "g1",
        status: "pending",
        email: "a@b.co",
        userId: null,
        tierName: "premium",
        expiresAt: null,
        invited: true,
        inviteError: null,
        seats: { pool: "consumer", used: 1, cap: 200 },
        referral: null,
      },
    });
    const { adminFoundingGrantsHandler } =
      await import("../founding-grants/adminFoundingGrantsHandler");
    const res = await adminFoundingGrantsHandler.handle(
      req("/admin/founding-grants", {
        method: "POST",
        auth: "Bearer admin",
        body: JSON.stringify({
          email: "a@b.co",
          tierName: "premium",
          paymentMethod: "bank_transfer",
          paymentReference: "REF",
        }),
      }),
    );
    expect(res.status).toBe(201);
    expect(grantMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "a@b.co",
        tierName: "premium",
        paymentMethod: "bank_transfer",
        sendInvite: true,
        allowRoleChange: false,
        allowSupersedeStoreSubscription: false,
      }),
      "admin-1",
    );
    expect(((await res.json()) as any).data.status).toBe("pending");
  });

  it("maps service errors to statuses", async () => {
    const { adminFoundingGrantsHandler } =
      await import("../founding-grants/adminFoundingGrantsHandler");
    const post = (body: object) =>
      adminFoundingGrantsHandler.handle(
        req("/admin/founding-grants", {
          method: "POST",
          auth: "Bearer admin",
          body: JSON.stringify(body),
        }),
      );
    const valid = {
      email: "a@b.co",
      tierName: "premium",
      paymentMethod: "other",
    };

    grantMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "pool_full",
        seats: { pool: "consumer", used: 200, cap: 200 },
      },
    });
    expect((await post(valid)).status).toBe(409);
    grantMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "coach_demotion" },
    });
    const demote = await post(valid);
    expect(demote.status).toBe(409);
    expect(((await demote.json()) as any).code).toBe("coach_demotion");
    grantMock.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "active_store_subscription",
        subscription: { tierName: "premium", expiresAt: null },
      },
    });
    const store = await post(valid);
    expect(store.status).toBe(409);
    expect(await store.json()).toEqual({
      message:
        "This account has a live App Store subscription. A founding grant would be undone by the next store sync. Grant after it expires, or confirm the override.",
      code: "active_store_subscription",
      subscription: { tierName: "premium", expiresAt: null },
    });
    grantMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "payment_reference_required" },
    });
    const reference = await post(valid);
    expect(reference.status).toBe(400);
    expect(await reference.json()).toEqual({
      message: "Enter the bank or Stripe reference for this payment",
      code: "payment_reference_required",
    });
    grantMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "invalid_email" },
    });
    expect((await post(valid)).status).toBe(400);
    grantMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "duplicate" },
    });
    expect((await post(valid)).status).toBe(409);

    // Schema-level rejection never reaches the service.
    const bad = await post({
      email: "a@b.co",
      tierName: "premium",
      paymentMethod: "cash",
    });
    expect(bad.status).toBe(422);
  });

  it("revokes with a mandatory reason", async () => {
    revokeMock.mockResolvedValue({ ok: true });
    const { adminFoundingGrantsHandler } =
      await import("../founding-grants/adminFoundingGrantsHandler");
    const id = "11111111-1111-4111-8111-111111111111";
    const res = await adminFoundingGrantsHandler.handle(
      req(`/admin/founding-grants/${id}/revoke`, {
        method: "POST",
        auth: "Bearer admin",
        body: JSON.stringify({ reason: "refunded" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(revokeMock).toHaveBeenCalledWith(id, "refunded", "admin-1");
    const noReason = await adminFoundingGrantsHandler.handle(
      req(`/admin/founding-grants/${id}/revoke`, {
        method: "POST",
        auth: "Bearer admin",
        body: JSON.stringify({}),
      }),
    );
    expect(noReason.status).toBe(422);
  });
});
