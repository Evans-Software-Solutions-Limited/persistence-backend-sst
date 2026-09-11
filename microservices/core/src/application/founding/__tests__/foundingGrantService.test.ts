/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FoundingGrantService } from "../foundingGrantService";

function makeRepos() {
  const grants = {
    tierExists: vi.fn(async () => true),
    findProfileById: vi.fn(async (id: string) => ({
      id,
      email: "a@b.co",
      role: "user",
      deletedAt: null,
    })),
    findProfileByEmail: vi.fn(async () => null),
    create: vi.fn(),
    findPendingByEmail: vi.fn(async () => []),
    applyPending: vi.fn(),
    markInvited: vi.fn(async (_grantId, finalize?) => {
      await finalize?.({ kind: "test-transaction" });
    }),
    findById: vi.fn(),
    extend: vi.fn(),
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
  const audit = {
    exists: vi.fn(async () => false),
    record: vi.fn(async () => undefined),
    recordOnce: vi.fn(async () => undefined),
  };
  const subscriptions = {
    findLiveStoreSubscription: vi.fn(async () => null),
  };
  const mailer = vi.fn(async () => undefined);
  const authUserLookup = vi.fn(
    async (
      userId: string,
    ): Promise<{
      id: string;
      email: string | null;
      emailConfirmedAt: string | null;
    }> => ({
      id: userId,
      email: "a@b.co",
      emailConfirmedAt: "2026-09-04T08:00:00.000Z",
    }),
  );
  const svc = new FoundingGrantService(
    grants as any,
    referrals as any,
    audit as any,
    mailer as any,
    "https://example.test",
    authUserLookup,
    subscriptions as any,
  );
  return {
    svc,
    grants,
    referrals,
    audit,
    mailer,
    authUserLookup,
    subscriptions,
  };
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

  it("carries a web checkout's actual payment into the pending confirmation", async () => {
    const { svc, grants, mailer } = makeRepos();
    mockGrantCreated(grants, created());
    const result = await svc.grant(
      {
        email: "buyer@example.com",
        tierName: "premium_plus",
        months: 12,
        contributionAmountMinor: 7654,
        contributionCurrency: "EUR",
        contributionMethod: "stripe_checkout",
        contributionReference: "pi_example",
      },
      "admin-1",
    );
    expect(result.ok).toBe(true);
    const mail = (mailer.mock.calls[0] as any)[0];
    expect(mail.text).toContain("Paid: €76.54");
    expect(mail.html).toContain("€76.54");
    expect(mail.text).toContain(
      "Your 12-month term starts when you activate access.",
    );
    expect(mail.text).toContain("Does not renew");
  });

  it("creates an ACTIVE grant + subscription when the account exists, leaves attribution unlocked, audits, invites", async () => {
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
        contributionAmountMinor: 3000,
        contributionMethod: "bank_transfer",
        contributionReference: "REF1",
      },
      "admin-1",
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.status).toBe("active");
    expect(res.result.email).toBe("buyer@example.com");
    expect(res.result.invited).toBe(true);
    // Defaults: 6 months and the consumer pool; contribution is explicit.
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
    expect(referrals.lock).not.toHaveBeenCalled();
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
    expect((mailer.mock.calls[0] as any)[0].text).toContain("Paid: £30.00");
    expect((mailer.mock.calls[0] as any)[0].html).toContain("£30.00");
    expect((mailer.mock.calls[0] as any)[0].text).not.toMatch(
      /sign up within 90 days/,
    );
  });

  it("creates a configurable complimentary grant without contribution metadata or a founding seat", async () => {
    const { svc, grants } = makeRepos();
    grants.findProfileByEmail.mockResolvedValue(null);
    mockGrantCreated(
      grants,
      created({ amountMinor: 0, paymentMethod: null, paidAt: null }),
    );
    const res = await svc.grant(
      {
        email: "friend@example.com",
        tierName: "premium_plus",
        grantKind: "complimentary",
        months: 18,
        sendInvite: false,
      },
      "admin-1",
    );
    expect(res.ok).toBe(true);
    expect(grants.create).toHaveBeenCalledWith(
      expect.objectContaining({
        grantKind: "complimentary",
        months: 18,
        amountMinor: 0,
        paymentMethod: null,
        paidAt: null,
      }),
      "consumer",
      expect.any(Function),
    );
  });

  it("creates a PENDING grant when there is no account yet and sends the sign-up invite", async () => {
    const { svc, grants, referrals, mailer } = makeRepos();
    mockGrantCreated(grants, created({ id: "g2" }));

    const res = await svc.grant(
      {
        email: "new@example.com",
        tierName: "premium_plus",
        contributionAmountMinor: 5000,
        contributionMethod: "card_in_person",
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
    expect((mailer.mock.calls[0] as any)[0].text).not.toMatch(
      /payment|paid in full|90 days/,
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
      { email: "coach@x.co", tierName: "premium" },
      "a",
    );
    expect(res).toEqual({ ok: false, error: { code: "coach_demotion" } });
    expect(grants.create).not.toHaveBeenCalled();

    mockGrantCreated(grants);
    const forced = await svc.grant(
      {
        email: "coach@x.co",
        tierName: "premium",
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
        contributionAmountMinor: 9900,
        contributionMethod: "bank_transfer",
        contributionReference: "BANK-COACH",
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

  it("always refuses a live store subscription", async () => {
    const { svc, grants, subscriptions } = makeRepos();
    grants.findProfileByEmail.mockResolvedValue({
      id: "u1",
      email: "buyer@example.com",
      role: "user",
    } as any);
    subscriptions.findLiveStoreSubscription.mockResolvedValue({
      id: "store-1",
      tierName: "premium",
      expiresAt: new Date("2026-10-01T00:00:00Z"),
    } as any);

    expect(
      await svc.grant(
        {
          email: "buyer@example.com",
          tierName: "premium_plus",
        },
        "admin-1",
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "active_store_subscription",
        subscription: {
          tierName: "premium",
          expiresAt: new Date("2026-10-01T00:00:00Z"),
        },
      },
    });
    expect(grants.create).not.toHaveBeenCalled();
  });

  it("refuses to attach a grant to an account pending deletion", async () => {
    const { svc, grants } = makeRepos();
    grants.findProfileByEmail.mockResolvedValue({
      id: "u-deleting",
      email: "buyer@example.com",
      role: "user",
      deletedAt: new Date("2026-09-03T00:00:00Z"),
    } as any);

    await expect(
      svc.grant(
        {
          email: "buyer@example.com",
          tierName: "premium",
        },
        "admin-1",
      ),
    ).resolves.toEqual({
      ok: false,
      error: { code: "account_pending_deletion" },
    });
    expect(grants.create).not.toHaveBeenCalled();
  });

  it("maps pool_full / duplicate / bad input to typed errors without side effects", async () => {
    const { svc, grants, audit, mailer } = makeRepos();
    grants.create.mockResolvedValueOnce({
      kind: "pool_full",
      seats: { pool: "consumer", used: 200, cap: 200 },
    });
    expect(
      await svc.grant({ email: "a@b.co", tierName: "premium" }, "a"),
    ).toEqual({
      ok: false,
      error: {
        code: "pool_full",
        seats: { pool: "consumer", used: 200, cap: 200 },
      },
    });
    grants.create.mockResolvedValueOnce({ kind: "duplicate" });
    expect(
      await svc.grant({ email: "a@b.co", tierName: "premium" }, "a"),
    ).toEqual({ ok: false, error: { code: "duplicate" } });
    expect(
      await svc.grant({ email: "a@b.co", tierName: "coach" }, "a"),
    ).toEqual({ ok: false, error: { code: "invalid_tier" } });
    expect(
      await svc.grant({ email: "not-an-email", tierName: "premium" }, "a"),
    ).toEqual({ ok: false, error: { code: "invalid_email" } });
    expect(audit.record).not.toHaveBeenCalled();
    expect(mailer).not.toHaveBeenCalled();
  });

  it("maps a store subscription found by the transactional create recheck", async () => {
    const { svc, grants } = makeRepos();
    grants.findProfileByEmail.mockResolvedValue({
      id: "u1",
      email: "a@b.co",
      role: "user",
      deletedAt: null,
    } as any);
    grants.create.mockResolvedValue({
      kind: "active_store_subscription",
      subscription: {
        tierName: "premium",
        expiresAt: new Date("2027-01-01T00:00:00Z"),
      },
    });

    expect(
      await svc.grant({ email: "a@b.co", tierName: "premium" }, "admin-1"),
    ).toEqual({
      ok: false,
      error: {
        code: "active_store_subscription",
        subscription: {
          tierName: "premium",
          expiresAt: new Date("2027-01-01T00:00:00Z"),
        },
      },
    });
  });

  it.each(["bank_transfer", "stripe_link"] as const)(
    "requires a non-blank reference for %s",
    async (contributionMethod) => {
      const { svc, grants } = makeRepos();
      for (const contributionReference of [undefined, "   "]) {
        expect(
          await svc.grant(
            {
              email: "a@b.co",
              tierName: "premium",
              contributionAmountMinor: 3000,
              contributionMethod,
              contributionReference,
            },
            "a",
          ),
        ).toEqual({
          ok: false,
          error: { code: "contribution_reference_required" },
        });
      }
      expect(grants.create).not.toHaveBeenCalled();
    },
  );

  it.each(["card_in_person", "other"] as const)(
    "allows %s without a contribution reference",
    async (contributionMethod) => {
      const { svc, grants } = makeRepos();
      mockGrantCreated(grants);
      expect(
        (
          await svc.grant(
            {
              email: "a@b.co",
              tierName: "premium",
              contributionAmountMinor: 3000,
              contributionMethod,
            },
            "a",
          )
        ).ok,
      ).toBe(true);
    },
  );

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
    expect(referrals.lock).not.toHaveBeenCalled();
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
    const res = await svc.grant({ email: "a@b.co", tierName: "premium" }, "a");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.result.invited).toBe(false);
    expect(res.result.inviteError).toBe("Resend 500");
    expect(grants.markInvited).not.toHaveBeenCalled();
  });

  it("reports a delivered invite when only invited-at bookkeeping fails", async () => {
    const { svc, grants, mailer } = makeRepos();
    mockGrantCreated(grants);
    grants.markInvited.mockRejectedValueOnce(new Error("database unavailable"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await svc.grant({ email: "a@b.co", tierName: "premium" }, "a");

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(mailer).toHaveBeenCalledOnce();
    expect(grants.markInvited).toHaveBeenCalledOnce();
    expect(res.result.invited).toBe(true);
    expect(res.result.inviteError).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("invite bookkeeping failed for grant"),
    );
    errSpy.mockRestore();
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
    expect(referrals.lock).not.toHaveBeenCalled();
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
    const { svc, grants, referrals, audit, authUserLookup } = makeRepos();
    authUserLookup.mockResolvedValueOnce({
      id: "u9",
      email: "buyer@example.test",
      emailConfirmedAt: "2026-09-04T08:00:00.000Z",
    });
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

  it("does not apply a pending grant until the authoritative auth email is confirmed and matches", async () => {
    const { svc, grants, authUserLookup } = makeRepos();
    grants.findPendingByEmail.mockResolvedValue([{ id: "g1" }] as any);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    authUserLookup.mockResolvedValueOnce({
      id: "u1",
      email: "a@b.co",
      emailConfirmedAt: null,
    });
    expect(await svc.applyPendingForUser("u1", "a@b.co")).toBe(false);

    authUserLookup.mockResolvedValueOnce({
      id: "u1",
      email: "other@example.com",
      emailConfirmedAt: "2026-09-04T08:00:00.000Z",
    });
    expect(await svc.applyPendingForUser("u1", "a@b.co")).toBe(false);

    expect(grants.applyPending).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it.each([
    ["missing", null],
    [
      "pending deletion",
      {
        id: "u1",
        email: "a@b.co",
        role: "user",
        deletedAt: new Date("2026-09-04T00:00:00Z"),
      },
    ],
  ])(
    "does not apply a pending grant to a %s profile",
    async (_label, profile) => {
      const { svc, grants, authUserLookup } = makeRepos();
      grants.findPendingByEmail.mockResolvedValue([{ id: "g1" }] as any);
      grants.findProfileById.mockResolvedValue(profile as any);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

      expect(await svc.applyPendingForUser("u1", "a@b.co")).toBe(false);
      expect(authUserLookup).not.toHaveBeenCalled();
      expect(grants.applyPending).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("profile missing or pending deletion"),
      );
      warnSpy.mockRestore();
    },
  );

  it("defers pending grants behind a live store subscription and audits only once", async () => {
    const { svc, grants, subscriptions, audit } = makeRepos();
    grants.findPendingByEmail.mockResolvedValue([
      { id: "g1", grantedBy: "admin-1" },
    ] as any);
    subscriptions.findLiveStoreSubscription.mockResolvedValue({
      id: "store-1",
      tierName: "premium",
      expiresAt: null,
    } as any);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await svc.applyPendingForUser("u1", "a@b.co")).toBe(false);
    expect(audit.recordOnce).toHaveBeenCalledWith({
      actorId: "admin-1",
      action: "founding_grant.apply_deferred",
      entityType: "founding_grant",
      entityId: "g1",
      after: { userId: "u1", reason: "active_store_subscription" },
    });
    expect(grants.applyPending).not.toHaveBeenCalled();

    expect(await svc.applyPendingForUser("u1", "a@b.co")).toBe(false);
    expect(audit.recordOnce).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it("defers when the transactional recheck observes a concurrent store subscription", async () => {
    const { svc, grants, audit } = makeRepos();
    grants.findPendingByEmail.mockResolvedValue([
      { id: "g1", grantedBy: "admin-1" },
    ] as any);
    grants.applyPending.mockResolvedValue({
      applied: false,
      expiresAt: null,
      tierName: null,
      storeSubscription: {
        tierName: "premium",
        expiresAt: new Date("2027-01-01T00:00:00Z"),
      },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await svc.applyPendingForUser("u1", "a@b.co")).toBe(false);
    expect(grants.applyPending).toHaveBeenCalledOnce();
    expect(audit.recordOnce).toHaveBeenCalledWith({
      actorId: "admin-1",
      action: "founding_grant.apply_deferred",
      entityType: "founding_grant",
      entityId: "g1",
      after: { userId: "u1", reason: "active_store_subscription" },
    });
    expect(audit.record).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("FoundingGrantService.resendInvite", () => {
  it("reports a render failure without sending or marking the grant invited", async () => {
    const { svc, grants, mailer } = makeRepos();
    grants.findById.mockResolvedValue({
      id: "g1",
      email: "buyer@example.com",
      tierName: "premium",
      grantKind: "founding",
      months: 6,
      amountMinor: -1,
      currency: "GBP",
      revokedAt: null,
      userId: null,
    } as any);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await svc.resendInvite("g1", "admin-1")).toMatchObject({
      ok: false,
      error: "send_failed",
      detail: "Valid actual payment amount and currency are required",
    });
    expect(mailer).not.toHaveBeenCalled();
    expect(grants.markInvited).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("resends actual stored payment, term and expiry rather than catalogue defaults", async () => {
    const { svc, grants, mailer } = makeRepos();
    grants.findById.mockResolvedValue({
      id: "g1",
      email: "buyer@example.com",
      tierName: "premium_plus",
      grantKind: "founding",
      months: 12,
      amountMinor: 7654,
      currency: "EUR",
      paymentMethod: "stripe_checkout",
      revokedAt: null,
      userId: "u1",
    } as any);
    grants.list.mockResolvedValue([
      { id: "g1", subscriptionExpiresAt: new Date("2028-04-09T12:00:00Z") },
    ] as any);
    expect(await svc.resendInvite("g1", "admin-1")).toEqual({ ok: true });
    const mail = (mailer.mock.calls[0] as any)[0];
    expect(mail.text).toContain(
      "Plan: Premium+\nTerm: 12 months\nPaid: €76.54",
    );
    expect(mail.text).toContain("9 April 2028");
    expect(mail.html).toContain("€76.54");
    expect(mailer).toHaveBeenCalledOnce();
  });

  beforeEach(() => vi.clearAllMocks());

  it("reports success after delivery when only invited-at bookkeeping fails", async () => {
    const { svc, grants, audit, mailer } = makeRepos();
    grants.findById.mockResolvedValue({
      id: "g1",
      email: "buyer@example.com",
      tierName: "premium",
      months: 6,
      grantKind: "founding",
      amountMinor: 3000,
      currency: "GBP",
      paymentMethod: "stripe_checkout",
      revokedAt: null,
      userId: null,
    } as any);
    grants.markInvited.mockRejectedValueOnce(new Error("database unavailable"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await svc.resendInvite("g1", "admin-1");

    expect(res).toEqual({ ok: true });
    expect(mailer).toHaveBeenCalledOnce();
    expect(audit.record).not.toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("invite bookkeeping failed for grant g1"),
    );
    errSpy.mockRestore();
  });

  it("reports success and rolls bookkeeping back together when resend auditing fails", async () => {
    const { svc, grants, audit, mailer } = makeRepos();
    grants.findById.mockResolvedValue({
      id: "g1",
      email: "buyer@example.com",
      tierName: "premium",
      months: 6,
      grantKind: "founding",
      amountMinor: 3000,
      currency: "GBP",
      paymentMethod: "stripe_checkout",
      revokedAt: null,
      userId: null,
    } as any);
    audit.record.mockRejectedValueOnce(new Error("audit unavailable"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await svc.resendInvite("g1", "admin-1");

    expect(res).toEqual({ ok: true });
    expect(mailer).toHaveBeenCalledOnce();
    expect(grants.markInvited).toHaveBeenCalledWith("g1", expect.any(Function));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "founding_grant.resend_invite",
        after: { ok: true },
      }),
      expect.objectContaining({ kind: "test-transaction" }),
    );
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("invite bookkeeping failed for grant g1"),
    );
    errSpy.mockRestore();
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

describe("FoundingGrantService.extend", () => {
  it("extends access and records the reason in the same transaction", async () => {
    const { svc, grants, audit } = makeRepos();
    grants.extend.mockImplementationOnce(async (_id, _months, finalize) => {
      const before = { id: "g1", months: 6 } as any;
      const after = { id: "g1", months: 9 } as any;
      const expiresAt = new Date("2027-06-03T00:00:00Z");
      await finalize(before, after, expiresAt, {
        kind: "test-transaction",
      });
      return { kind: "extended", grant: after, expiresAt };
    });

    const result = await svc.extend("g1", 3, "thank you", "admin-1");

    expect(result).toEqual({
      ok: true,
      result: {
        id: "g1",
        months: 9,
        expiresAt: new Date("2027-06-03T00:00:00Z"),
      },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "founding_grant.extend",
        reason: "thank you",
        before: { months: 6 },
        after: expect.objectContaining({ additionalMonths: 3, months: 9 }),
      }),
      expect.objectContaining({ kind: "test-transaction" }),
    );
  });

  it("rejects invalid lengths before writing", async () => {
    const { svc, grants } = makeRepos();
    expect(await svc.extend("g1", 0, "nope", "admin-1")).toEqual({
      ok: false,
      error: "invalid_months",
    });
    expect(grants.extend).not.toHaveBeenCalled();
  });

  it("returns invalid_months when an extension would exceed the total cap", async () => {
    const { svc, grants } = makeRepos();
    grants.extend.mockResolvedValueOnce({ kind: "invalid_months" });

    expect(await svc.extend("g1", 120, "bonus", "admin-1")).toEqual({
      ok: false,
      error: "invalid_months",
    });
  });
});
