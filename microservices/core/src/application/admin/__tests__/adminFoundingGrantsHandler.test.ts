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
const extendMock = vi.fn();
const resendMock = vi.fn();
const listMock = vi.fn(async () => []);
const seatsForPoolMock = vi.fn(async (pool: "consumer" | "coach") => ({
  pool,
  used: 0,
  cap: pool === "consumer" ? 200 : 20,
}));
vi.mock("../../founding/foundingGrantService", () => ({
  FoundingGrantService: vi.fn().mockImplementation(() => ({
    grant: grantMock,
    revoke: revokeMock,
    extend: extendMock,
    resendInvite: resendMock,
  })),
}));
vi.mock("../../repositories/foundingGrantRepository", () => ({
  FoundingGrantRepository: vi.fn().mockImplementation(() => ({
    list: listMock,
    seatsForPool: seatsForPoolMock,
  })),
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

  it("returns the database-backed catalogue caps", async () => {
    const { adminFoundingGrantsHandler } =
      await import("../founding-grants/adminFoundingGrantsHandler");
    const res = await adminFoundingGrantsHandler.handle(
      req("/admin/founding-grants/catalogue", { auth: "Bearer admin" }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { caps: { consumer: number; coach: number } };
    };
    expect(body.data.caps).toEqual({ consumer: 200, coach: 20 });
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
        grantKind: "founding",
        months: 6,
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
          grantKind: "founding",
          months: 6,
          contributionAmountMinor: 3000,
          contributionMethod: "bank_transfer",
          contributionReference: "REF",
          contributedAt: "2026-09-04T12:00:00.000Z",
        }),
      }),
    );
    expect(res.status).toBe(201);
    expect(grantMock).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "a@b.co",
        tierName: "premium",
        grantKind: "founding",
        months: 6,
        contributionMethod: "bank_transfer",
        sendInvite: true,
        allowRoleChange: false,
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
      grantKind: "founding",
      months: 6,
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
        "This account has a live App Store or Play Store subscription. Grant access after the store subscription expires.",
      code: "active_store_subscription",
      subscription: { tierName: "premium", expiresAt: null },
    });
    grantMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "contribution_reference_required" },
    });
    const reference = await post(valid);
    expect(reference.status).toBe(400);
    expect(await reference.json()).toEqual({
      message: "Enter the bank or Stripe reference for this contribution",
      code: "contribution_reference_required",
    });
    grantMock.mockResolvedValueOnce({
      ok: false,
      error: { code: "account_pending_deletion" },
    });
    const deleting = await post(valid);
    expect(deleting.status).toBe(409);
    expect(await deleting.json()).toEqual({
      message:
        "This account is pending deletion. Restore it before granting, or wait until deletion finishes and the buyer signs up again.",
      code: "account_pending_deletion",
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
    for (const [code, status] of [
      ["invalid_tier", 400],
      ["tier_missing", 500],
      ["invalid_months", 400],
      ["invalid_contribution", 400],
      ["user_not_found", 404],
      ["invalid_referral_code", 400],
      ["referral_locked_elsewhere", 409],
    ] as const) {
      grantMock.mockResolvedValueOnce({ ok: false, error: { code } });
      expect((await post(valid)).status).toBe(status);
    }

    // Schema-level rejection never reaches the service.
    const bad = await post({
      email: "a@b.co",
      tierName: "premium",
      paymentMethod: "cash",
    });
    expect(bad.status).toBe(422);
  });

  it("extends a grant with an audited reason", async () => {
    extendMock.mockResolvedValueOnce({
      ok: true,
      result: {
        id: "00000000-0000-4000-8000-000000000009",
        months: 9,
        expiresAt: null,
      },
    });
    const { adminFoundingGrantsHandler } =
      await import("../founding-grants/adminFoundingGrantsHandler");
    const res = await adminFoundingGrantsHandler.handle(
      req(
        "/admin/founding-grants/00000000-0000-4000-8000-000000000009/extend",
        {
          method: "POST",
          auth: "Bearer admin",
          body: JSON.stringify({ additionalMonths: 3, reason: "bonus access" }),
        },
      ),
    );
    expect(res.status).toBe(200);
    expect(extendMock).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000009",
      3,
      "bonus access",
      "admin-1",
    );
  });

  it("maps extension, revocation and resend failures", async () => {
    const { adminFoundingGrantsHandler } =
      await import("../founding-grants/adminFoundingGrantsHandler");
    const id = "11111111-1111-4111-8111-111111111111";
    for (const [error, status] of [
      ["not_found", 404],
      ["invalid_months", 400],
      ["revoked", 409],
    ] as const) {
      extendMock.mockResolvedValueOnce({ ok: false, error });
      const response = await adminFoundingGrantsHandler.handle(
        req(`/admin/founding-grants/${id}/extend`, {
          method: "POST",
          auth: "Bearer admin",
          body: JSON.stringify({ additionalMonths: 3, reason: "test failure" }),
        }),
      );
      expect(response.status).toBe(status);
    }

    revokeMock.mockResolvedValueOnce({ ok: false, error: "not_found" });
    expect(
      (
        await adminFoundingGrantsHandler.handle(
          req(`/admin/founding-grants/${id}/revoke`, {
            method: "POST",
            auth: "Bearer admin",
            body: JSON.stringify({ reason: "not found" }),
          }),
        )
      ).status,
    ).toBe(404);

    for (const [error, status] of [
      ["not_found", 404],
      ["revoked", 409],
      ["send_failed", 502],
    ] as const) {
      resendMock.mockResolvedValueOnce({ ok: false, error });
      const response = await adminFoundingGrantsHandler.handle(
        req(`/admin/founding-grants/${id}/resend-invite`, {
          method: "POST",
          auth: "Bearer admin",
        }),
      );
      expect(response.status).toBe(status);
    }
    resendMock.mockResolvedValueOnce({ ok: true });
    expect(
      (
        await adminFoundingGrantsHandler.handle(
          req(`/admin/founding-grants/${id}/resend-invite`, {
            method: "POST",
            auth: "Bearer admin",
          }),
        )
      ).status,
    ).toBe(200);
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
