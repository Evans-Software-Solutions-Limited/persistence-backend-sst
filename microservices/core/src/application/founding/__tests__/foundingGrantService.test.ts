/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FoundingGrantService } from "../foundingGrantService";

function makeRepos() {
  const grants = {
    tierExists: vi.fn(async () => true),
    findProfileById: vi.fn(async () => null),
    findProfileByEmail: vi.fn(async () => null),
    create: vi.fn(),
    findPendingByEmail: vi.fn(async () => []),
    applyPending: vi.fn(),
    markInvited: vi.fn(async () => undefined),
    findById: vi.fn(),
    revoke: vi.fn(),
    list: vi.fn(async () => []),
  };
  const referrals = {
    findCodeByCanonical: vi.fn(async () => null),
    findCodeById: vi.fn(async () => null),
    findCodeByIdIn: vi.fn(async () => null),
    hasLockedOtherCode: vi.fn(async () => false),
    isCodeEligible: vi.fn(async () => true),
    isCodeEligibleForPendingGrant: vi.fn(async () => true),
    claim: vi.fn(async () => ({ kind: "applied" })),
    lock: vi.fn(async () => true),
  };
  const audit = { record: vi.fn(async () => undefined) };
  const mailer = vi.fn(async () => undefined);
  const svc = new FoundingGrantService(
    grants as any,
    referrals as any,
    audit as any,
    mailer as any,
    "https://example.test",
  );
  return { svc, grants, referrals, audit, mailer };
}

const created = (overrides: Partial<any> = {}) => ({
  kind: "created",
  grant: { id: "g1", amountMinor: 3000, ...overrides },
  subscriptionExpiresAt: new Date("2027-03-03T00:00:00Z"),
  seats: { pool: "consumer", used: 1, cap: 200 },
});

function mockGrantCreated(
  grants: ReturnType<typeof makeRepos>["grants"],
  outcome = created(),
) {
  grants.create.mockImplementationOnce(async (_input, _pool, finalize) => {
    await finalize({
      transaction: { kind: "test-transaction" },
      grant: outcome.grant,
      subscriptionExpiresAt: outcome.subscriptionExpiresAt,
    });
    return outcome;
  });
}

describe("FoundingGrantService.grant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates an ACTIVE grant + subscription when the account exists, locks attribution, audits, invites", async () => {
    const { svc, grants, referrals, audit, mailer } = makeRepos();
    grants.findProfileByEmail.mockResolvedValue({
      id: "u1",
      email: "Buyer@Example.com",
      role: "user",
    } as any);
    mockGrantCreated(grants);

    const res = await svc.grant(
      {
        email: " Buyer@Example.com ",
        tierName: "premium",
        paymentMethod: "bank_transfer",
        paymentReference: "REF1",
      },
      "admin-1",
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.status).toBe("active");
    expect(res.result.email).toBe("buyer@example.com");
    expect(res.result.invited).toBe(true);
    // Defaults: 6 months, £30 for premium, consumer pool.
    expect(grants.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        email: "buyer@example.com",
        tierName: "premium",
        months: 6,
        amountMinor: 3000,
        grantedBy: "admin-1",
      }),
      "consumer",
      expect.any(Function),
    );
    expect(referrals.lock).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ kind: "test-transaction" }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "founding_grant.create",
        entityType: "founding_grant",
      }),
      expect.objectContaining({ kind: "test-transaction" }),
    );
    expect((audit.record.mock.calls[0] as any)[0].entityId).toBe(
      res.result.grantId,
    );
    expect(mailer).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "buyer@example.com",
        replyTo: "admin@evans-software-solutions.com",
      }),
    );
    expect((mailer.mock.calls[0] as any)[0].text).toMatch(/already on/);
  });

  it("creates a PENDING grant when there is no account yet and sends the sign-up invite", async () => {
    const { svc, grants, referrals, mailer } = makeRepos();
    mockGrantCreated(grants, created({ id: "g2" }));

    const res = await svc.grant(
      {
        email: "new@example.com",
        tierName: "premium_plus",
        paymentMethod: "card_in_person",
      },
      "admin-1",
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.status).toBe("pending");
    expect(res.result.userId).toBeNull();
    expect(grants.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId: null, amountMinor: 5000 }),
      "consumer",
      expect.any(Function),
    );
    expect(referrals.lock).not.toHaveBeenCalled();
    expect((mailer.mock.calls[0] as any)[0].text).toMatch(
      /sign up with this email/,
    );
  });

  it("refuses a consumer tier on a coach account unless allowRoleChange", async () => {
    const { svc, grants } = makeRepos();
    grants.findProfileByEmail.mockResolvedValue({
      id: "c1",
      email: "coach@x.co",
      role: "personal_trainer",
    } as any);
    const res = await svc.grant(
      { email: "coach@x.co", tierName: "premium", paymentMethod: "other" },
      "a",
    );
    expect(res).toEqual({ ok: false, error: { code: "coach_demotion" } });
    expect(grants.create).not.toHaveBeenCalled();

    mockGrantCreated(grants);
    const forced = await svc.grant(
      {
        email: "coach@x.co",
        tierName: "premium",
        paymentMethod: "other",
        allowRoleChange: true,
      },
      "a",
    );
    expect(forced.ok).toBe(true);
  });

  it("allows a coach tier on a coach account without the flag", async () => {
    const { svc, grants } = makeRepos();
    grants.findProfileByEmail.mockResolvedValue({
      id: "c1",
      email: "coach@x.co",
      role: "personal_trainer",
    } as any);
    mockGrantCreated(grants, {
      ...created(),
      seats: { pool: "coach", used: 1, cap: 20 },
    });
    const res = await svc.grant(
      {
        email: "coach@x.co",
        tierName: "start_up_coach_plus",
        paymentMethod: "bank_transfer",
      },
      "a",
    );
    expect(res.ok).toBe(true);
    expect(grants.create).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinor: 9900 }),
      "coach",
      expect.any(Function),
    );
  });

  it("maps pool_full / duplicate / bad input to typed errors without side effects", async () => {
    const { svc, grants, audit, mailer } = makeRepos();
    grants.create.mockResolvedValueOnce({
      kind: "pool_full",
      seats: { pool: "consumer", used: 200, cap: 200 },
    });
    expect(
      await svc.grant(
        { email: "a@b.co", tierName: "premium", paymentMethod: "other" },
        "a",
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "pool_full",
        seats: { pool: "consumer", used: 200, cap: 200 },
      },
    });
    grants.create.mockResolvedValueOnce({ kind: "duplicate" });
    expect(
      await svc.grant(
        { email: "a@b.co", tierName: "premium", paymentMethod: "other" },
        "a",
      ),
    ).toEqual({ ok: false, error: { code: "duplicate" } });
    expect(
      await svc.grant(
        { email: "a@b.co", tierName: "coach", paymentMethod: "other" },
        "a",
      ),
    ).toEqual({ ok: false, error: { code: "invalid_tier" } });
    expect(
      await svc.grant(
        { email: "not-an-email", tierName: "premium", paymentMethod: "other" },
        "a",
      ),
    ).toEqual({ ok: false, error: { code: "invalid_email" } });
    expect(audit.record).not.toHaveBeenCalled();
    expect(mailer).not.toHaveBeenCalled();
  });

  it("validates the referral code before taking a seat and attaches it via claim", async () => {
    const { svc, grants, referrals } = makeRepos();
    grants.findProfileByEmail.mockResolvedValue({
      id: "u1",
      email: "a@b.co",
      role: "user",
    } as any);
    expect(
      await svc.grant(
        {
          email: "a@b.co",
          tierName: "premium",
          paymentMethod: "other",
          referralCode: "nope!",
        },
        "a",
      ),
    ).toEqual({
      ok: false,
      error: { code: "invalid_referral_code" },
    });
    expect(grants.create).not.toHaveBeenCalled();

    referrals.findCodeByCanonical.mockResolvedValue({
      id: "code1",
      code: "UONFRESHERS",
      displayCode: "UonFreshers",
      label: "UoN",
      status: "active",
    } as any);
    referrals.findCodeById.mockResolvedValue({
      id: "code1",
      code: "UONFRESHERS",
    } as any);
    mockGrantCreated(grants);
    const res = await svc.grant(
      {
        email: "a@b.co",
        tierName: "premium",
        paymentMethod: "other",
        referralCode: "uon freshers",
      },
      "a",
    );
    expect(res.ok).toBe(true);
    expect(grants.create).toHaveBeenCalledWith(
      expect.objectContaining({ referralCodeId: "code1" }),
      "consumer",
      expect.any(Function),
    );
    expect(referrals.claim).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        canonicalCode: "UONFRESHERS",
        source: "admin",
      }),
      expect.objectContaining({ kind: "test-transaction" }),
    );
    expect(referrals.lock).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({ kind: "test-transaction" }),
    );
  });

  it("rolls the grant back when the transactional referral claim is no longer eligible", async () => {
    const { svc, grants, referrals, audit, mailer } = makeRepos();
    grants.findProfileByEmail.mockResolvedValue({
      id: "u1",
      email: "a@b.co",
      role: "user",
    } as any);
    referrals.findCodeByCanonical.mockResolvedValue({
      id: "code1",
      code: "EXPIRED",
      displayCode: "EXPIRED",
      label: "Expired",
    } as any);
    referrals.claim.mockResolvedValue({ kind: "invalid" });
    mockGrantCreated(grants);

    expect(
      await svc.grant(
        {
          email: "a@b.co",
          tierName: "premium",
          paymentMethod: "other",
          referralCode: "EXPIRED",
        },
        "admin-1",
      ),
    ).toEqual({ ok: false, error: { code: "invalid_referral_code" } });
    expect(audit.record).not.toHaveBeenCalled();
    expect(mailer).not.toHaveBeenCalled();
  });

  it("treats an invite email failure as non-fatal and reports it", async () => {
    const { svc, grants, mailer } = makeRepos();
    mockGrantCreated(grants);
    mailer.mockRejectedValueOnce(new Error("Resend 500"));
    const res = await svc.grant(
      { email: "a@b.co", tierName: "premium", paymentMethod: "other" },
      "a",
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.invited).toBe(false);
    expect(res.result.inviteError).toBe("Resend 500");
    expect(grants.markInvited).not.toHaveBeenCalled();
  });
});

describe("FoundingGrantService.applyPendingForUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("is a cheap no-op without a pending grant", async () => {
    const { svc, grants } = makeRepos();
    expect(await svc.applyPendingForUser("u1", "a@b.co")).toBe(false);
    expect(grants.applyPending).not.toHaveBeenCalled();
    expect(await svc.applyPendingForUser("u1", undefined)).toBe(false);
  });

  it("applies each pending grant, attaches + locks the referral, audits", async () => {
    const { svc, grants, referrals, audit } = makeRepos();
    grants.findPendingByEmail.mockResolvedValue([
      { id: "g9", referralCodeId: "code1", grantedBy: "admin-1" },
    ] as any);
    grants.applyPending.mockImplementation(
      async (_grantId, _userId, finalize) => {
        await finalize({
          transaction: { kind: "test-transaction" },
          grant: {
            id: "g9",
            tierName: "premium",
            referralCodeId: "code1",
          },
          expiresAt: new Date("2027-01-01T00:00:00Z"),
        });
        return {
          applied: true,
          expiresAt: new Date("2027-01-01T00:00:00Z"),
          tierName: "premium",
        };
      },
    );
    referrals.findCodeByIdIn.mockResolvedValue({
      id: "code1",
      code: "UONFRESHERS",
    } as any);

    expect(await svc.applyPendingForUser("u9", "A@B.co")).toBe(true);
    expect(grants.applyPending).toHaveBeenCalledWith(
      "g9",
      "u9",
      expect.any(Function),
    );
    expect(referrals.claim).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "u9", canonicalCode: "UONFRESHERS" }),
      expect.objectContaining({ kind: "test-transaction" }),
    );
    expect(referrals.lock).toHaveBeenCalledWith(
      "u9",
      expect.objectContaining({ kind: "test-transaction" }),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "founding_grant.apply_pending",
        entityId: "g9",
        after: expect.objectContaining({ referralApplication: "applied" }),
      }),
      expect.objectContaining({ kind: "test-transaction" }),
    );
  });

  it("applies purchased access while preserving a conflicting locked attribution", async () => {
    const { svc, grants, referrals, audit } = makeRepos();
    const grant = {
      id: "g10",
      tierName: "premium",
      referralCodeId: "reserved-code",
      grantedBy: "admin-1",
    };
    grants.findPendingByEmail.mockResolvedValue([grant] as any);
    grants.applyPending.mockImplementation(
      async (_grantId, _userId, finalize) => {
        await finalize({
          transaction: { kind: "test-transaction" },
          grant,
          expiresAt: new Date("2027-01-01T00:00:00Z"),
        });
        return {
          applied: true,
          expiresAt: new Date("2027-01-01T00:00:00Z"),
          tierName: "premium",
        };
      },
    );
    referrals.findCodeByIdIn.mockResolvedValue({
      id: "reserved-code",
      code: "RESERVED",
    } as any);
    referrals.claim.mockResolvedValue({
      kind: "locked",
      applied: { codeId: "other-code", code: "OTHER" },
    } as any);

    expect(await svc.applyPendingForUser("u9", "buyer@example.test")).toBe(
      true,
    );
    expect(referrals.lock).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        after: expect.objectContaining({
          referralApplication: "locked_conflict",
        }),
      }),
      expect.objectContaining({ kind: "test-transaction" }),
    );
  });

  it("never throws — a repository error is logged and swallowed", async () => {
    const { svc, grants } = makeRepos();
    grants.findPendingByEmail.mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await svc.applyPendingForUser("u1", "a@b.co")).toBe(false);
    spy.mockRestore();
  });
});

describe("FoundingGrantService.revoke", () => {
  it("revokes once and audits with the reason", async () => {
    const { svc, grants, audit } = makeRepos();
    grants.findById.mockResolvedValueOnce({ id: "g1", revokedAt: null } as any);
    grants.revoke.mockImplementationOnce(async (_id, _reason, finalize) => {
      const grant = {
        id: "g1",
        revokedAt: new Date("2026-09-03T00:00:00Z"),
      } as any;
      await finalize(grant, { kind: "test-transaction" });
      return grant;
    });
    expect(await svc.revoke("g1", "refunded", "admin-1")).toEqual({ ok: true });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "founding_grant.revoke",
        reason: "refunded",
      }),
      expect.objectContaining({ kind: "test-transaction" }),
    );

    grants.findById.mockResolvedValueOnce({
      id: "g1",
      revokedAt: new Date(),
    } as any);
    expect(await svc.revoke("g1", "again", "admin-1")).toEqual({
      ok: false,
      error: "already_revoked",
    });
    grants.findById.mockResolvedValueOnce(null);
    expect(await svc.revoke("nope", "x", "admin-1")).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});
