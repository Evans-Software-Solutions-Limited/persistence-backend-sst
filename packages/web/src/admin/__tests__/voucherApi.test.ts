import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { voucherApi } from "../voucherApi";
import { saveSession } from "../adminAuth";
let fetchMock: ReturnType<typeof vi.fn>;
describe("voucher API contract", () => {
  beforeEach(() => {
    saveSession({
      accessToken: "token",
      refreshToken: null,
      expiresAt: 9999999999,
      email: "admin@example.com",
      isAdmin: true,
    });
    fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: { ok: true } })),
    );
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    saveSession(null);
    vi.unstubAllGlobals();
  });
  it.each([
    [() => voucherApi.batches(), "GET", "?q=", undefined],
    [() => voucherApi.batches("a & b"), "GET", "?q=a%20%26%20b", undefined],
    [
      () =>
        voucherApi.issue("b/1", {
          quantity: 3,
          employeeEmails: ["a@acme.com", "", "b@acme.com"],
        }),
      "POST",
      "/b%2F1/issue",
      { quantity: 3, employeeEmails: ["a@acme.com", "", "b@acme.com"] },
    ],
    [() => voucherApi.detail("b/1"), "GET", "/b%2F1", undefined],
    [
      () =>
        voucherApi.create({
          businessName: "Acme",
          quantity: 2,
          tierName: "premium",
          months: 12,
          allowedDomains: [],
          redeemBy: null,
        }),
      "POST",
      "",
      {
        businessName: "Acme",
        quantity: 2,
        tierName: "premium",
        months: 12,
        allowedDomains: [],
        redeemBy: null,
      },
    ],
    [
      () => voucherApi.assign("b", "v", null),
      "PATCH",
      "/b/vouchers/v",
      { employeeEmail: null },
    ],
    [
      () =>
        voucherApi.importAssignments("b", [
          { voucherId: "v", employeeEmail: "a@b.com" },
        ]),
      "POST",
      "/b/assignments",
      { assignments: [{ voucherId: "v", employeeEmail: "a@b.com" }] },
    ],
    [
      () => voucherApi.revoke("b", "reason"),
      "POST",
      "/b/revoke",
      { reason: "reason" },
    ],
    [
      () => voucherApi.revoke("b", "reason", "v"),
      "POST",
      "/b/vouchers/v/revoke",
      { reason: "reason" },
    ],
    [() => voucherApi.exportAudit("b"), "POST", "/b/export-audit", {}],
  ] as const)(
    "uses authenticated method, route and payload",
    async (call, method, path, body) => {
      expect(await call()).toEqual({ ok: true });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toContain(`/admin/voucher-batches${path}`);
      expect(init.method ?? "GET").toBe(method);
      expect(init.headers).toMatchObject({ Authorization: "Bearer token" });
      expect(init.body ? JSON.parse(init.body as string) : undefined).toEqual(
        body,
      );
    },
  );
  it("propagates structured API errors", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ message: "Assignment conflict", code: "conflict" }),
        { status: 409 },
      ),
    );
    await expect(voucherApi.assign("b", "v", "a@b.com")).rejects.toThrow(
      "Assignment conflict",
    );
  });
});
