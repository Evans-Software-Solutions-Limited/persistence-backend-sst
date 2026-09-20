import { beforeEach, describe, it, expect, vi } from "vitest";
import {
  FoundingClaimService,
  claimHash,
  claimEmail,
} from "../foundingClaimService";
import { FoundingClaimRepository } from "../../repositories/foundingClaimRepository";
import { VoucherRepository } from "../../repositories/voucherRepository";
import { FoundingGrantService } from "../foundingGrantService";
const repo = new FoundingClaimRepository(),
  limits = new VoucherRepository(),
  grants = new FoundingGrantService();
const identity = vi.fn(),
  mailer = vi.fn();
const service = new FoundingClaimService(
  repo,
  identity,
  mailer,
  limits,
  grants,
);
beforeEach(() => {
  vi.restoreAllMocks();
  identity.mockReset();
  mailer.mockReset();
  identity.mockResolvedValue({
    id: "user",
    email: "relay@privaterelay.appleid.com",
    emailConfirmedAt: "2026-01-01",
  });
  mailer.mockResolvedValue({ id: "email" });
  vi.spyOn(repo, "prepare").mockResolvedValue();
  vi.spyOn(repo, "discard").mockResolvedValue();
  vi.spyOn(limits, "rateLimit").mockResolvedValue();
  vi.spyOn(repo, "consume").mockResolvedValue({
    claimed: true,
    tierName: "premium",
    expiresAt: null,
  });
});
describe("purchase-email verification", () => {
  it("sends a one-time code to the purchase email, storing only its challenge-specific hash", async () => {
    const result = await service.request("user", " Buyer@Example.test ");
    expect(result).toEqual({ challengeId: expect.any(String) });
    const email = mailer.mock.calls[0][0];
    expect(email.to).toBe("buyer@example.test");
    expect(email.text).toContain("relay@privaterelay.appleid.com");
    const code = /code is (\d{6})/.exec(email.text)![1];
    expect(repo.prepare).toHaveBeenCalledWith(
      { id: "user", email: "relay@privaterelay.appleid.com" },
      "buyer@example.test",
      result.challengeId,
      claimHash(`${result.challengeId}:${code}`),
    );
    expect(limits.rateLimit).toHaveBeenCalledWith([
      { key: "founding-request-email:buyer@example.test", limit: 5 },
    ]);
  });
  it("does not expose grant existence in the response or email", async () => {
    const result = await service.request("user", "nobody@example.test");
    expect(Object.keys(result)).toEqual(["challengeId"]);
    expect(mailer.mock.calls[0][0].text).toContain("any unclaimed access");
  });
  it("discards an undelivered challenge", async () => {
    mailer.mockRejectedValue(new Error("provider secret"));
    await expect(
      service.request("user", "buyer@example.test"),
    ).rejects.toMatchObject({ code: "delivery_failed", status: 503 });
    expect(repo.discard).toHaveBeenCalledWith(expect.any(String));
  });
  it.each([
    { id: "someone", email: "relay@example.test", emailConfirmedAt: "yes" },
    { id: "user", email: null, emailConfirmedAt: "yes" },
    { id: "user", email: "relay@example.test", emailConfirmedAt: null },
  ])("requires the authoritative confirmed identity", async (value) => {
    identity.mockResolvedValue(value);
    await expect(
      service.request("user", "buyer@example.test"),
    ).rejects.toMatchObject({ code: "verified_account_required" });
    expect(mailer).not.toHaveBeenCalled();
  });
  it("enforces durable rate limits before sending email", async () => {
    vi.mocked(limits.rateLimit).mockRejectedValue(new Error("rate limited"));
    await expect(service.request("user", "buyer@example.test")).rejects.toThrow(
      "rate limited",
    );
    expect(mailer).not.toHaveBeenCalled();
  });
  it("verifies proof and uses the original grant's transactional activation", async () => {
    const fakeGrant = { id: "grant" },
      tx = {};
    vi.spyOn(grants, "applyPendingGrant").mockResolvedValue({
      applied: true,
      tierName: "premium_plus",
      expiresAt: null,
    });
    vi.mocked(repo.consume).mockImplementation(
      async (account, id, hash, apply) => {
        expect(account.email).toBe("relay@privaterelay.appleid.com");
        expect(id).toBe("challenge");
        expect(hash).toBe(claimHash("challenge:123456"));
        await apply(fakeGrant as never, tx as never);
        return { claimed: true, tierName: "premium_plus", expiresAt: null };
      },
    );
    expect(await service.verify("user", "challenge", "123456")).toMatchObject({
      claimed: true,
    });
    expect(grants.applyPendingGrant).toHaveBeenCalledWith(
      fakeGrant,
      "user",
      tx,
    );
  });
  it.each(["", "not an email", `${"x".repeat(250)}@a.test`])(
    "rejects invalid email",
    (email) => expect(() => claimEmail(email)).toThrow("valid email"),
  );
  it("accepts either Apple relay domain without special casing", () => {
    expect(claimEmail("relay@private.icloud.com")).toBe(
      "relay@private.icloud.com",
    );
    expect(claimEmail("relay@privaterelay.appleid.com")).toBe(
      "relay@privaterelay.appleid.com",
    );
  });
});
