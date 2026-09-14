import { beforeEach, describe, expect, it, vi } from "vitest";
import Elysia from "elysia";
vi.mock("@persistence/api-utils/auth/supabaseAuth", () => ({
  getAuthUser: vi.fn(async (header: string | undefined) =>
    header
      ? {
          sub: "00000000-0000-4000-8000-000000000001",
          app_metadata: { admin: header === "Bearer admin" },
        }
      : null,
  ),
  getUser: (ctx: { user: unknown }) => ctx.user,
  requireAuth: (ctx: { user: unknown; set: { status: number } }) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
  },
  requireAdmin: (ctx: {
    user: { app_metadata: { admin: boolean } };
    set: { status: number };
  }) => {
    if (!ctx.user) {
      ctx.set.status = 401;
      return { message: "Unauthorized" };
    }
    if (!ctx.user.app_metadata.admin) {
      ctx.set.status = 403;
      return { message: "Forbidden" };
    }
  },
}));
const prepare = vi.fn();
const verify = vi.fn();
const redeem = vi.fn();
const list = vi.fn();
const create = vi.fn();
const detail = vi.fn();
const assign = vi.fn();
const revoke = vi.fn();
const exportAudit = vi.fn();
vi.mock("../voucherService", () => ({
  VoucherService: class {
    prepare = prepare;
    verify = verify;
    redeem = redeem;
  },
}));
vi.mock("../../repositories/voucherRepository", () => ({
  VoucherRepository: class {
    list = list;
    create = create;
    detail = detail;
    assign = assign;
    revoke = revoke;
    exportAudit = exportAudit;
  },
}));
import { vouchersHandler } from "../vouchersHandler";
import { adminVouchersHandler } from "../../admin/vouchers/adminVouchersHandler";
import { VoucherError } from "../voucherRules";
const app = new Elysia()
  .use(new Elysia().use(adminVouchersHandler))
  .use(vouchersHandler);
const id = "00000000-0000-4000-8000-000000000001";
function request(
  path: string,
  body?: unknown,
  token = "Bearer member",
  method = body ? "POST" : "GET",
) {
  return app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: {
        ...(token ? { authorization: token } : {}),
        "content-type": "application/json",
        origin: "https://persistence.evans-software-solutions.com",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  process.env.WEB_ORIGIN = "https://persistence.evans-software-solutions.com";
  prepare.mockResolvedValue({ challengeId: id, verified: true });
  verify.mockResolvedValue({ challengeId: id, verified: true });
  redeem.mockResolvedValue({ voucherId: id });
  list.mockResolvedValue([]);
  create.mockResolvedValue({ batch: { id }, codes: [] });
  detail.mockResolvedValue({ batch: { id }, vouchers: [{ id }] });
  assign.mockResolvedValue({ updated: 1 });
  revoke.mockResolvedValue({ revoked: 1 });
  exportAudit.mockResolvedValue({ recorded: true });
});
describe("voucher API boundary", () => {
  it("requires customer auth and admin authorization independently", async () => {
    expect(
      (
        await request(
          "/vouchers/prepare",
          { code: "test", eligibilityEmail: "a@test.com" },
          "",
        )
      ).status,
    ).toBe(401);
    expect(
      (await request("/admin/voucher-batches", undefined, "")).status,
    ).toBe(401);
    expect((await request("/admin/voucher-batches")).status).toBe(403);
  });
  it("answers preflight without auth and uses website-only CORS", async () => {
    const response = await request(
      "/vouchers/prepare",
      undefined,
      "",
      "OPTIONS",
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      process.env.WEB_ORIGIN,
    );
    expect(prepare).not.toHaveBeenCalled();
    const denied = await app.handle(
      new Request("http://localhost/vouchers/prepare", {
        method: "OPTIONS",
        headers: { origin: "https://evil.example" },
      }),
    );
    expect(denied.headers.has("access-control-allow-origin")).toBe(false);
  });
  it("validates bodies and returns neutral domain failures with CORS", async () => {
    expect(
      (await request("/vouchers/verify", { challengeId: "wrong", otp: "123" }))
        .status,
    ).toBe(422);
    prepare.mockRejectedValueOnce(new VoucherError());
    const response = await request("/vouchers/prepare", {
      code: "wrong",
      eligibilityEmail: "a@test.com",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_voucher" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("binds all customer calls to authenticated subject", async () => {
    expect(
      (
        await request("/vouchers/prepare", {
          code: "test",
          eligibilityEmail: "a@test.com",
        })
      ).status,
    ).toBe(200);
    expect(prepare).toHaveBeenCalledWith(id, "test", "a@test.com");
    expect(
      (await request("/vouchers/verify", { challengeId: id, otp: "123456" }))
        .status,
    ).toBe(200);
    expect(verify).toHaveBeenCalledWith(id, id, "123456");
    expect(
      (await request("/vouchers/redeem", { challengeId: id })).status,
    ).toBe(200);
    expect(redeem).toHaveBeenCalledWith(id, id);
  });
  it("serves all batch operations and prevents caching issued secrets", async () => {
    expect(
      (await request("/admin/voucher-batches", undefined, "Bearer admin"))
        .status,
    ).toBe(200);
    const response = await request(
      "/admin/voucher-batches",
      {
        businessName: "Acme",
        quantity: 1,
        tierName: "premium",
        months: 12,
        allowedDomains: [],
        redeemBy: null,
      },
      "Bearer admin",
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(
      (await request(`/admin/voucher-batches/${id}`, undefined, "Bearer admin"))
        .status,
    ).toBe(200);
    expect(
      (
        await request(
          `/admin/voucher-batches/${id}/vouchers/${id}`,
          { employeeEmail: null },
          "Bearer admin",
          "PATCH",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/admin/voucher-batches/${id}/assignments`,
          { assignments: [{ voucherId: id, employeeEmail: null }] },
          "Bearer admin",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/admin/voucher-batches/${id}/revoke`,
          { reason: "Lost" },
          "Bearer admin",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/admin/voucher-batches/${id}/vouchers/${id}/revoke`,
          { reason: "Lost" },
          "Bearer admin",
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await request(
          `/admin/voucher-batches/${id}/export-audit`,
          {},
          "Bearer admin",
        )
      ).status,
    ).toBe(200);
    create.mockRejectedValueOnce(new VoucherError("invalid_batch"));
    expect(
      (
        await request(
          "/admin/voucher-batches",
          {
            businessName: " ",
            quantity: 1,
            tierName: "premium",
            months: 12,
            allowedDomains: [],
            redeemBy: null,
          },
          "Bearer admin",
        )
      ).status,
    ).toBe(400);
  });
});

it("supports native bearer calls without Origin and leaves unrelated failures alone", async () => {
  const response = await app.handle(
    new Request("http://localhost/vouchers/redeem", {
      method: "POST",
      headers: {
        authorization: "Bearer member",
        "content-type": "application/json",
      },
      body: JSON.stringify({ challengeId: id }),
    }),
  );
  expect(response.status).toBe(200);
  expect(
    (await app.handle(new Request("http://localhost/unrelated"))).status,
  ).toBe(404);
});
