import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@persistence/api-utils/auth/supabaseAuth", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@persistence/api-utils/auth/supabaseAuth")
    >();
  return {
    ...actual,
    getAuthUser: vi.fn(async () => ({
      sub: "00000000-0000-4000-8000-000000000001",
      email: "admin@example.test",
      email_verified: true,
      iat: 0,
      exp: 9e9,
      app_metadata: { admin: true },
    })),
  };
});

vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

function request(body: object) {
  return new Request(
    "http://localhost/admin/referral-codes/11111111-1111-4111-8111-111111111111",
    {
      method: "PATCH",
      headers: {
        authorization: "Bearer admin",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
}

describe("adminReferralCodesHandler", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["startsAt", { startsAt: "not-a-date" }],
    ["endsAt", { endsAt: "not-a-date" }],
  ])(
    "rejects an invalid PATCH %s instead of silently omitting it",
    async (field, body) => {
      const { getDb } = await import("@persistence/db/client");
      const { adminReferralCodesHandler } =
        await import("../referral-codes/adminReferralCodesHandler");

      const response = await adminReferralCodesHandler.handle(request(body));

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({
        message: `${field} is not a valid date`,
      });
      expect(getDb).not.toHaveBeenCalled();
    },
  );

  it("locks the code row before PATCH and audits the serialized before-state", async () => {
    const { getDb } = await import("@persistence/db/client");
    const { ReferralRepository } =
      await import("../../repositories/referralRepository");
    const { AdminAuditRepository } =
      await import("../../repositories/adminAuditRepository");
    const { adminReferralCodesHandler } =
      await import("../referral-codes/adminReferralCodesHandler");
    const transaction = { kind: "test-transaction" };
    vi.mocked(getDb).mockReturnValue({
      transaction: (run: (tx: object) => unknown) => run(transaction),
    } as never);
    const before = {
      id: "11111111-1111-4111-8111-111111111111",
      status: "active",
      label: "Before",
      maxRedemptions: 10,
      startsAt: null,
      endsAt: null,
    };
    const after = { ...before, status: "archived" };
    const find = vi
      .spyOn(ReferralRepository.prototype, "findCodeByIdForUpdate")
      .mockResolvedValue(before as never);
    vi.spyOn(ReferralRepository.prototype, "updateCodeIn").mockResolvedValue(
      after as never,
    );
    const audit = vi
      .spyOn(AdminAuditRepository.prototype, "record")
      .mockResolvedValue();

    const response = await adminReferralCodesHandler.handle(
      request({ status: "archived" }),
    );

    expect(response.status).toBe(200);
    expect(find).toHaveBeenCalledWith(
      transaction,
      "11111111-1111-4111-8111-111111111111",
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        before: expect.objectContaining({ status: "active" }),
        after: { status: "archived" },
      }),
      transaction,
    );
  });
});
